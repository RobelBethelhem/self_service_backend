import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import SalaryIncrementLetter from "../../models/rms/SalaryIncrementLetter.js";
import SalaryIncrementImport from "../../models/rms/SalaryIncrementImport.js";
import SalaryIncrementCounter from "../../models/rms/SalaryIncrementCounter.js";
import SalaryCommitmentPeriod from "../../models/rms/SalaryCommitmentPeriod.js";
import SalaryCommitmentDecision from "../../models/rms/SalaryCommitmentDecision.js";
import PushNotificationService from "../../utils/rms/pushNotificationService.js";
import { parseSalaryWorkbook } from "../../utils/rms/salaryIncrementParser.js";

const router = Router();

// In-memory upload — the workbook is parsed and discarded; persisted data lives in Mongo.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        const okExt = /\.xlsx$|\.xlsm$/i.test(file.originalname || "");
        if (!okExt) {
            return cb(new Error("File must be a .xlsx or .xlsm workbook"), false);
        }
        cb(null, true);
    },
});

const parseDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CAT_KEY = {
    Full: "full",
    Proportionate: "proportionate",
    Discipline: "discipline",
    "Salary Only": "salary_only",
    Promotion: "promotion",
};

// ============================================================
// POST /import — admin uploads the annual salary-increment workbook
// ============================================================
// Per-row decisions live in the SalaryCommitmentDecision collection (set
// by users during the SalaryCommitmentPeriod *before* this import runs):
//   - Decision Approved → row inserted with bonus_months as in the Excel.
//   - Decision Rejected → row inserted with bonus_months overridden to 0.
//   - No decision found → row skipped with reason "no_decision_recorded".
// Letters are created with status="Committed" directly (no Imported→Committed
// gate, since the user already decided).
//
// multipart/form-data fields:
//   file:               .xlsx
//   fiscal_year:        Number (e.g. 2026)
//   effective_date:     Date  (e.g. 2026-07-01)
//   board_meeting_date: Date  (e.g. 2026-07-23)
//   letter_date:        Date  (e.g. 2026-07-31)
//   overwrite:          "true" to replace an existing batch for the same year
router.post(
    "/import",
    auth,
    roleCheck(["admin"]),
    (req, res, next) => {
        // Wrap multer so its errors come back as JSON 400 instead of bubbling up as a generic 500.
        upload.single("file")(req, res, (err) => {
            if (err) {
                return res.status(400).json({ error: true, message: err.message || "File upload failed" });
            }
            next();
        });
    },
    async (req, res) => {
        try {
            // ---------- form field validation ----------
            if (!req.file) {
                return res.status(400).json({ error: true, message: "Excel file is required (field name 'file')" });
            }

            const fiscal_year = Number(req.body.fiscal_year);
            if (!Number.isFinite(fiscal_year) || fiscal_year < 2000 || fiscal_year > 3000) {
                return res.status(400).json({ error: true, message: "fiscal_year is required and must be a valid year" });
            }

            const effective_date = parseDate(req.body.effective_date);
            const board_meeting_date = parseDate(req.body.board_meeting_date);
            const letter_date = parseDate(req.body.letter_date);
            if (!effective_date || !board_meeting_date || !letter_date) {
                return res.status(400).json({
                    error: true,
                    message:
                        "effective_date, board_meeting_date, and letter_date are all required and must be valid dates (YYYY-MM-DD)",
                });
            }

            const overwrite = ["true", "1", "yes"].includes(String(req.body.overwrite || "").toLowerCase());

            const adminUser = await User.findOne({ _id: req.user._id });
            if (!adminUser) {
                return res.status(400).json({ error: true, message: "The requester cannot be found" });
            }

            // ---------- overwrite gating ----------
            // Find ANY existing row for this fiscal_year (active or leftover from a prior
            // failed import). The collection has a unique index on fiscal_year, so at most
            // one such row exists — but we use findOne defensively.
            const existingBatch = await SalaryIncrementImport.findOne({ fiscal_year });
            if (existingBatch && !overwrite) {
                return res.status(409).json({
                    error: true,
                    message: `Fiscal year ${fiscal_year} has already been imported. Pass overwrite=true to replace.`,
                    existing_batch_id: existingBatch._id,
                });
            }

            // ---------- parse workbook ----------
            const { rows, sheet_warnings, row_errors } = parseSalaryWorkbook(req.file.buffer);

            // De-dup within the workbook on domain_user (a single workbook = a single year, so domain_user is the natural key).
            const seen = new Set();
            const dedupedRows = [];
            for (const row of rows) {
                const key = String(row.domain_user || "").toLowerCase();
                if (!key) {
                    row_errors.push({
                        sheet: row.sheet,
                        category: row.category,
                        excel_row: row.excel_row,
                        domain_user: null,
                        reason: "missing_domain_user",
                    });
                    continue;
                }
                if (seen.has(key)) {
                    row_errors.push({
                        sheet: row.sheet,
                        category: row.category,
                        excel_row: row.excel_row,
                        domain_user: row.domain_user,
                        reason: "duplicate_in_workbook",
                    });
                    continue;
                }
                seen.add(key);
                dedupedRows.push(row);
            }

            // ---------- batch user lookup (case-insensitive) ----------
            const usernames = [...new Set(dedupedRows.map((r) => r.domain_user))];
            const userRegexes = usernames.map((n) => new RegExp("^" + escapeRegex(n) + "$", "i"));
            const users = userRegexes.length ? await User.find({ user: { $in: userRegexes } }) : [];
            const userByLower = new Map(users.map((u) => [String(u.user).toLowerCase(), u]));

            const validRows = [];
            for (const row of dedupedRows) {
                const u = userByLower.get(String(row.domain_user).toLowerCase());
                if (!u) {
                    row_errors.push({
                        sheet: row.sheet,
                        category: row.category,
                        excel_row: row.excel_row,
                        domain_user: row.domain_user,
                        reason: "user_not_found",
                    });
                    continue;
                }
                row.domain_user = u.user; // canonicalize to the User collection's casing
                row._user = u;
                validRows.push(row);
            }

            if (validRows.length === 0) {
                return res.status(400).json({
                    error: true,
                    message: "No valid rows to import",
                    sheet_warnings,
                    row_errors,
                });
            }

            // ---------- overwrite cleanup ----------
            // Wipe every record for this fiscal year before inserting the new batch.
            // We delete by fiscal_year (rather than batch _id) so that any leftover rows
            // from a prior failed import are reclaimed — otherwise the unique index on
            // SalaryIncrementImport.fiscal_year would reject the new insert.
            if (existingBatch && overwrite) {
                await SalaryIncrementLetter.deleteMany({ fiscal_year });
                await SalaryIncrementImport.deleteMany({ fiscal_year });
            }

            // ---------- batch decision lookup ----------
            // Pull every commitment decision for this fiscal_year up front so
            // the per-row loop below is a Map lookup, not N round-trips.
            const decisionDocs = await SalaryCommitmentDecision.find({ fiscal_year }).lean();
            const decisionByLowerUser = new Map(
                decisionDocs.map((d) => [String(d.domain_user).toLowerCase(), d])
            );

            // ---------- create batch ----------
            const batch = await new SalaryIncrementImport({
                fiscal_year,
                effective_date,
                board_meeting_date,
                letter_date,
                imported_by: adminUser.user,
            }).save();

            // ---------- save letters one-by-one (collect per-row errors without aborting) ----------
            const inserted = [];
            const insertErrors = [];
            const skippedNoDecision = [];
            for (const row of validRows) {
                const { sheet, excel_row, _user, ...fields } = row;

                // Resolve the user's pre-import commitment decision for this fiscal year.
                const dec = decisionByLowerUser.get(String(row.domain_user).toLowerCase());
                if (!dec) {
                    skippedNoDecision.push({
                        sheet,
                        category: row.category,
                        excel_row,
                        domain_user: row.domain_user,
                        reason: "no_decision_recorded",
                        details:
                            "User did not record an Approve/Reject decision during the commitment period. Their row was skipped.",
                    });
                    continue;
                }

                // For users who rejected the commitment, blank out the bonus.
                // Salary Only never had a bonus to begin with.
                if (dec.decision === "Rejected" && row.category !== "Salary Only") {
                    fields.bonus_months = 0;
                    if (row.category === "Discipline") {
                        fields.discipline_pct = 0;
                    }
                }

                try {
                    const doc = await new SalaryIncrementLetter({
                        ...fields,
                        fiscal_year,
                        import_batch_id: batch._id,
                        imported_by: adminUser.user,
                        status: "Committed",
                        commitment_decision: dec.decision,
                        commitment_decided_at: dec.decided_at,
                    }).save();
                    inserted.push({ doc, user: _user, decision: dec.decision });
                } catch (e) {
                    insertErrors.push({
                        sheet,
                        category: row.category,
                        excel_row,
                        domain_user: row.domain_user,
                        reason: e.code === 11000 ? "duplicate_key" : "insert_failed",
                        details: e.message,
                    });
                }
            }

            // ---------- counts + batch summary ----------
            const counts = { full: 0, proportionate: 0, discipline: 0, salary_only: 0, promotion: 0 };
            for (const { doc } of inserted) {
                const k = CAT_KEY[doc.category];
                if (k) counts[k]++;
            }
            batch.total_rows = inserted.length;
            batch.per_category_counts = counts;
            await batch.save();

            // ---------- push notify each successfully imported user ----------
            // Best-effort: errors are swallowed (existing convention across the codebase).
            const notif = { sent: 0, failed: 0 };
            for (const { doc, user } of inserted) {
                try {
                    const payload = {
                        title: "Salary Increment Letter Ready",
                        body: `Your FY ${fiscal_year} salary increment letter is available. Sign in to review and accept the commitment.`,
                        data: {
                            type: "salary-increment",
                            fiscal_year,
                            letter_id: String(doc._id),
                            url: "/user/salary-increment",
                        },
                    };
                    await PushNotificationService.sendToUser(user._id, payload);
                    notif.sent++;
                } catch (_) {
                    notif.failed++;
                }
            }

            return res.status(201).json({
                error: false,
                message: `Imported ${inserted.length} salary increment letter(s) for fiscal year ${fiscal_year}`,
                batch_id: batch._id,
                fiscal_year,
                total_imported: inserted.length,
                approved_count: inserted.filter((i) => i.decision === "Approved").length,
                rejected_count: inserted.filter((i) => i.decision === "Rejected").length,
                skipped_no_decision: skippedNoDecision,
                per_category: counts,
                sheet_warnings,
                row_errors: [...row_errors, ...insertErrors],
                notifications_sent: notif.sent,
                notifications_failed: notif.failed,
                overwritten: Boolean(existingBatch && overwrite),
            });
        } catch (e) {
            console.error("Salary import error:", e);
            return res.status(500).json({ error: true, message: "Internal Server Error" });
        }
    }
);

// ============================================================
// POST /period — admin upserts the commitment window for a fiscal year.
// Body: { fiscal_year, start_date, end_date, notes? }
// If the period already exists for the FY, dates are updated in place
// (this is how admins extend the deadline).
// ============================================================
router.post("/period", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const fiscal_year = Number(req.body.fiscal_year);
        if (!Number.isFinite(fiscal_year) || fiscal_year < 2000 || fiscal_year > 3000) {
            return res
                .status(400)
                .json({ error: true, message: "fiscal_year is required and must be a valid year" });
        }

        const start_date = parseDate(req.body.start_date);
        const end_date = parseDate(req.body.end_date);
        if (!start_date || !end_date) {
            return res.status(400).json({
                error: true,
                message: "start_date and end_date are required (YYYY-MM-DD)",
            });
        }
        if (start_date >= end_date) {
            return res
                .status(400)
                .json({ error: true, message: "end_date must be after start_date" });
        }

        const adminUser = await User.findOne({ _id: req.user._id });
        if (!adminUser) {
            return res.status(400).json({ error: true, message: "The requester cannot be found" });
        }

        const notes = String(req.body.notes || "").trim();

        const existing = await SalaryCommitmentPeriod.findOne({ fiscal_year });
        let period;
        if (existing) {
            existing.start_date = start_date;
            existing.end_date = end_date;
            existing.notes = notes || existing.notes;
            existing.updated_by = adminUser.user;
            existing.updated_at = new Date();
            period = await existing.save();
        } else {
            period = await new SalaryCommitmentPeriod({
                fiscal_year,
                start_date,
                end_date,
                notes: notes || undefined,
                created_by: adminUser.user,
            }).save();
        }

        return res.json({ error: false, period });
    } catch (e) {
        console.error("Salary /period POST error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// GET /period — anyone authenticated. Returns the most recent period
// (or one for a specific fiscal_year via query param).
// ============================================================
router.get("/period", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const query = {};
        if (req.query.fiscal_year) {
            const fy = Number(req.query.fiscal_year);
            if (Number.isFinite(fy)) query.fiscal_year = fy;
        }
        const period = await SalaryCommitmentPeriod.findOne(query)
            .sort({ fiscal_year: -1 })
            .lean();
        return res.json({ error: false, period });
    } catch (e) {
        console.error("Salary /period GET error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// POST /decision — user records or flips their commitment decision.
// Body: { fiscal_year, decision: "Approved" | "Rejected" }
// Refused once the period for that FY is closed (server-authoritative
// time check). Every flip is appended to decision_history for audit.
// ============================================================
router.post("/decision", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const decision = String(req.body.decision || "").trim();
        if (!["Approved", "Rejected"].includes(decision)) {
            return res
                .status(400)
                .json({ error: true, message: "decision must be 'Approved' or 'Rejected'" });
        }
        const fiscal_year = Number(req.body.fiscal_year);
        if (!Number.isFinite(fiscal_year)) {
            return res.status(400).json({ error: true, message: "fiscal_year is required" });
        }

        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res.status(400).json({ error: true, message: "The requester cannot be found" });
        }

        const period = await SalaryCommitmentPeriod.findOne({ fiscal_year });
        if (!period) {
            return res.status(400).json({
                error: true,
                message: `No commitment period configured for FY ${fiscal_year}`,
            });
        }

        const now = new Date();
        if (now < period.start_date) {
            return res
                .status(400)
                .json({ error: true, message: "The commitment period has not started yet." });
        }
        if (now > period.end_date) {
            return res.status(400).json({
                error: true,
                message: "The commitment period has ended. Decisions are now final.",
            });
        }

        const xff = req.headers["x-forwarded-for"];
        const clientIp = (xff ? String(xff).split(",")[0].trim() : null) || req.ip || null;
        const ua = String(req.headers["user-agent"] || "").slice(0, 500);

        const historyEntry = { decision, at: now, user_agent: ua, ip: clientIp };

        const existing = await SalaryCommitmentDecision.findOne({
            fiscal_year,
            domain_user: user.user,
        });
        let saved;
        if (existing) {
            existing.decision = decision;
            existing.decided_at = now;
            existing.user_agent = ua;
            existing.ip = clientIp;
            existing.decision_history.push(historyEntry);
            saved = await existing.save();
        } else {
            saved = await new SalaryCommitmentDecision({
                fiscal_year,
                domain_user: user.user,
                decision,
                decided_at: now,
                user_agent: ua,
                ip: clientIp,
                decision_history: [historyEntry],
            }).save();
        }

        return res.json({
            error: false,
            decision: {
                fiscal_year: saved.fiscal_year,
                decision: saved.decision,
                decided_at: saved.decided_at,
                flips: saved.decision_history.length,
            },
        });
    } catch (e) {
        console.error("Salary /decision POST error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// GET /decisions/export?fiscal_year=YYYY — admin-only xlsx download.
// Used after the period closes so HR can prepare the import workbook.
// Columns: Domain Name, Employee Name, Decision, Decided At, Flips.
// ============================================================
router.get("/decisions/export", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const fy = Number(req.query.fiscal_year);
        if (!Number.isFinite(fy)) {
            return res
                .status(400)
                .json({ error: true, message: "fiscal_year query param is required" });
        }

        const decisions = await SalaryCommitmentDecision.find({ fiscal_year: fy }).lean();

        const usernames = decisions.map((d) => d.domain_user);
        const users = usernames.length ? await User.find({ user: { $in: usernames } }).lean() : [];
        const nameByLowerUser = new Map();
        for (const u of users) {
            nameByLowerUser.set(
                String(u.user).toLowerCase(),
                `${u.first_name || ""} ${u.last_name || ""}`.trim()
            );
        }

        const aoa = [["Domain Name", "Employee Name", "Decision", "Decided At", "Flips"]];
        for (const d of decisions) {
            const name = nameByLowerUser.get(String(d.domain_user).toLowerCase()) || "";
            aoa.push([
                d.domain_user,
                name,
                d.decision,
                d.decided_at ? new Date(d.decided_at).toISOString() : "",
                Array.isArray(d.decision_history) ? d.decision_history.length : 0,
            ]);
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Decisions FY ${fy}`);
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

        const filename = `salary-decisions-fy-${fy}.xlsx`;
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(buf);
    } catch (e) {
        console.error("Salary /decisions/export error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// GET /my — caller's own salary increment letters + the most recent
// commitment period and their decision for it (single call so the user
// page can render every state without chaining requests).
// ============================================================
router.get("/my", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res.status(400).json({ error: true, message: "The requester cannot be found" });
        }

        const userRegex = new RegExp("^" + escapeRegex(user.user) + "$", "i");

        const [letters, period] = await Promise.all([
            SalaryIncrementLetter.find({ domain_user: userRegex })
                .populate("import_batch_id")
                .sort({ fiscal_year: -1, TimeStamp: -1 }),
            SalaryCommitmentPeriod.findOne({}).sort({ fiscal_year: -1 }).lean(),
        ]);

        let decision = null;
        if (period) {
            decision = await SalaryCommitmentDecision.findOne({
                fiscal_year: period.fiscal_year,
                domain_user: userRegex,
            }).lean();
        }

        const now = new Date();
        const periodOut = period
            ? {
                  fiscal_year: period.fiscal_year,
                  start_date: period.start_date,
                  end_date: period.end_date,
                  notes: period.notes || null,
                  is_open: now >= period.start_date && now <= period.end_date,
                  has_started: now >= period.start_date,
                  has_ended: now > period.end_date,
              }
            : null;

        const decisionOut = decision
            ? {
                  fiscal_year: decision.fiscal_year,
                  decision: decision.decision,
                  decided_at: decision.decided_at,
                  flips: Array.isArray(decision.decision_history)
                      ? decision.decision_history.length
                      : 0,
              }
            : null;

        return res.json({
            error: false,
            letters,
            period: periodOut,
            decision: decisionOut,
        });
    } catch (e) {
        console.error("Salary /my error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// POST /commit — user accepts the 6-month commitment for a letter
// Body: { id }
// Only the named employee can accept; admins cannot accept on behalf of users.
// ============================================================
router.post("/commit", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) {
            return res.status(400).json({ error: true, message: "Letter id is required" });
        }

        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res.status(400).json({ error: true, message: "The requester cannot be found" });
        }

        const letter = await SalaryIncrementLetter.findById(id);
        if (!letter) {
            return res.status(404).json({ error: true, message: "Letter not found" });
        }

        if (String(letter.domain_user).toLowerCase() !== String(user.user).toLowerCase()) {
            return res
                .status(403)
                .json({ error: true, message: "You can only accept your own salary letter" });
        }

        if (letter.status !== "Imported") {
            return res.status(400).json({
                error: true,
                message: `Letter is in status "${letter.status}" and cannot be committed`,
            });
        }

        const xff = req.headers["x-forwarded-for"];
        const clientIp = (xff ? String(xff).split(",")[0].trim() : null) || req.ip || null;

        letter.status = "Committed";
        letter.commitment_agreed = true;
        letter.commitment_date = new Date();
        letter.commitment_user_agent = String(req.headers["user-agent"] || "").slice(0, 500);
        letter.commitment_ip = clientIp;
        await letter.save();

        const populated = await SalaryIncrementLetter.findById(letter._id).populate("import_batch_id");
        return res.json({
            error: false,
            message: "Commitment accepted. You may now print your letter.",
            letter: populated,
        });
    } catch (e) {
        console.error("Salary /commit error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// POST /mark-printed — bumps printed_count, sets first/last_printed_at
// Body: { id }
// ============================================================
router.post("/mark-printed", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) {
            return res.status(400).json({ error: true, message: "Letter id is required" });
        }

        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res.status(400).json({ error: true, message: "The requester cannot be found" });
        }

        const letter = await SalaryIncrementLetter.findById(id);
        if (!letter) {
            return res.status(404).json({ error: true, message: "Letter not found" });
        }

        // Owner-only. Admin prints from the list page are reference/archive copies
        // and are intentionally NOT tracked here — the print count belongs to the
        // user. Admin clients pass trackPrint={false} on the print component, so
        // they don't reach this endpoint at all.
        if (String(letter.domain_user).toLowerCase() !== String(user.user).toLowerCase()) {
            return res
                .status(403)
                .json({ error: true, message: "You can only mark your own letter as printed" });
        }

        if (letter.status !== "Committed") {
            return res.status(400).json({
                error: true,
                message: `Letter must be in "Committed" status to be printed (current: "${letter.status}")`,
            });
        }

        // Assign the system reference number on first print (any caller).
        // Subsequent prints reuse the same value, so the QR code, the
        // printed reference, and the public verify page all line up.
        if (!letter.reference_number) {
            letter.reference_number = await SalaryIncrementCounter.getNextReference(letter.fiscal_year);
            letter.reference_number_assigned_at = new Date();
        }

        const now = new Date();
        letter.printed_count = (letter.printed_count || 0) + 1;
        letter.last_printed_at = now;
        if (!letter.first_printed_at) letter.first_printed_at = now;
        await letter.save();

        return res.json({
            error: false,
            reference_number: letter.reference_number,
            printed_count: letter.printed_count,
            first_printed_at: letter.first_printed_at,
            last_printed_at: letter.last_printed_at,
        });
    } catch (e) {
        console.error("Salary /mark-printed error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// POST /admin-prepare-print — admin's reference-copy print pipeline
// Body: { id }
// Ensures the letter has a system reference_number (assigning lazily if
// missing) but does NOT touch printed_count/first_/last_printed_at.
// Used by the admin list-page modal so HR can produce archive copies.
// ============================================================
router.post("/admin-prepare-print", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) {
            return res.status(400).json({ error: true, message: "Letter id is required" });
        }

        const letter = await SalaryIncrementLetter.findById(id);
        if (!letter) {
            return res.status(404).json({ error: true, message: "Letter not found" });
        }
        if (letter.status !== "Committed") {
            return res.status(400).json({
                error: true,
                message: `Letter must be in "Committed" status to be printed (current: "${letter.status}")`,
            });
        }

        if (!letter.reference_number) {
            letter.reference_number = await SalaryIncrementCounter.getNextReference(letter.fiscal_year);
            letter.reference_number_assigned_at = new Date();
            await letter.save();
        }

        return res.json({
            error: false,
            reference_number: letter.reference_number,
        });
    } catch (e) {
        console.error("Salary /admin-prepare-print error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// GET /list — admin oversight, material-react-table compatible
// Query: ?fiscal_year, ?category, ?status, ?domain_user, ?page, ?limit
// ============================================================
router.get("/list", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const filter = {};
        if (req.query.fiscal_year) {
            const fy = Number(req.query.fiscal_year);
            if (Number.isFinite(fy)) filter.fiscal_year = fy;
        }
        if (req.query.category) filter.category = String(req.query.category);
        if (req.query.status) filter.status = String(req.query.status);
        if (req.query.domain_user) {
            filter.domain_user = {
                $regex: escapeRegex(String(req.query.domain_user)),
                $options: "i",
            };
        }

        // General search across domain_user, employee_name, first_name, AND the
        // populated batch's reference_number. Lets admins find a row when they
        // know any one of those identifiers.
        if (req.query.q) {
            const q = escapeRegex(String(req.query.q));
            const matchingBatches = await SalaryIncrementImport.find(
                { reference_number: { $regex: q, $options: "i" } },
                { _id: 1 }
            ).lean();
            const orClauses = [
                { domain_user: { $regex: q, $options: "i" } },
                { employee_name: { $regex: q, $options: "i" } },
                { first_name: { $regex: q, $options: "i" } },
            ];
            if (matchingBatches.length) {
                orClauses.push({ import_batch_id: { $in: matchingBatches.map((b) => b._id) } });
            }
            filter.$or = orClauses;
        }

        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const skip = (page - 1) * limit;

        const [data, totalRowCount] = await Promise.all([
            SalaryIncrementLetter.find(filter)
                .populate("import_batch_id")
                .sort({ fiscal_year: -1, TimeStamp: -1 })
                .skip(skip)
                .limit(limit),
            SalaryIncrementLetter.countDocuments(filter),
        ]);

        return res.json({ data, meta: { totalRowCount } });
    } catch (e) {
        console.error("Salary /list error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// PATCH /revoke — admin revokes a letter (any status except already-Revoked)
// Body: { id, reason? }
// ============================================================
router.patch("/revoke", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { id, reason } = req.body || {};
        if (!id) {
            return res.status(400).json({ error: true, message: "Letter id is required" });
        }

        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res.status(400).json({ error: true, message: "The requester cannot be found" });
        }

        const letter = await SalaryIncrementLetter.findById(id);
        if (!letter) {
            return res.status(404).json({ error: true, message: "Letter not found" });
        }

        if (letter.status === "Revoked") {
            return res.status(400).json({ error: true, message: "Letter is already revoked" });
        }

        letter.status = "Revoked";
        letter.revoked_by = user.user;
        letter.revoked_date = new Date();
        letter.revoke_reason = String(reason || "").trim() || null;
        await letter.save();

        return res.json({ error: false, message: "Letter revoked", letter });
    } catch (e) {
        console.error("Salary /revoke error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

export default router;

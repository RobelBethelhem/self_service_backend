import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import SalaryIncrementLetter from "../../models/rms/SalaryIncrementLetter.js";
import SalaryIncrementImport from "../../models/rms/SalaryIncrementImport.js";
// Dormant: the per-letter reference counter was retired when the letter moved
// to the admin's batch reference. The import stays so the commented-out
// generation in /mark-printed and /admin-prepare-print can be switched back on
// without hunting for it.
// eslint-disable-next-line no-unused-vars
import SalaryIncrementCounter from "../../models/rms/SalaryIncrementCounter.js";
import SalaryCommitmentPeriod from "../../models/rms/SalaryCommitmentPeriod.js";
import SalaryCommitmentDecision from "../../models/rms/SalaryCommitmentDecision.js";
import PushNotificationService from "../../utils/rms/pushNotificationService.js";
import { parseSalaryWorkbook } from "../../utils/rms/salaryIncrementParser.js";
import {
    getEmployeeIdentity,
    getEmployeeAddress,
    getEmployeeDirectory,
} from "../../utils/rms/test.js";

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

// Push notifications for a completed import, sent AFTER the response has gone
// out rather than inside the request.
//
// Sending them inline is what put a ceiling on the import. Each sendToUser
// does a subscription lookup plus an outbound HTTPS call to the push service,
// so at a realistic 200 ms per employee, 2,500 of them is over eight minutes
// of sequential waiting with the admin's request held open the whole time.
//
// Whether a given deployment has a hard timeout in front of it hardly matters:
// a request that long will eventually meet a proxy, a pool recycle or a
// dropped connection, and when it does the admin sees a failed import that had
// in fact written every letter — so they retry and hit the already-imported
// guard, or overwrite and do it all again.
//
// Notifications are best-effort by existing convention throughout this
// codebase, which makes them a poor reason to hold a request open at all.
// Waves of 25 keep the push service and the connection pool from being
// flooded while still clearing a few thousand in well under a minute.
const notifyImportedUsers = async (fiscal_year, recipients) => {
    const WAVE = 25;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i += WAVE) {
        const wave = recipients.slice(i, i + WAVE);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.allSettled(
            wave.map(({ doc, user }) =>
                PushNotificationService.sendToUser(user._id, {
                    title: "Salary Increment Letter Ready",
                    body: `Your FY ${fiscal_year} salary increment letter is available. Sign in to review and accept the commitment.`,
                    data: {
                        type: "salary-increment",
                        fiscal_year,
                        letter_id: String(doc._id),
                        url: "/user/salary-increment",
                    },
                })
            )
        );
        results.forEach((r) => {
            if (r.status === "fulfilled") sent += 1;
            else failed += 1;
        });
    }

    console.log(
        `[salary-increment] FY ${fiscal_year} notifications finished: ${sent} sent, ${failed} failed`
    );
};

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

            // The Board's decision-document number, printed on every letter in
            // this batch. Required: it is the only reference the letter has,
            // and a blank one would ship letters with an empty Ref. No. line.
            const reference_number = String(req.body.reference_number || "").trim().slice(0, 60);
            if (!reference_number) {
                return res.status(400).json({
                    error: true,
                    message:
                        "reference_number is required — it is the Board decision number printed on every letter in this batch (e.g. ZB/HC/2198/2025)",
                });
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
            // One query, matched in JavaScript, rather than an $in of one
            // case-insensitive regex per row.
            //
            // /^name$/i cannot use an index, so the old form made MongoDB scan
            // the whole collection and evaluate every regex against every
            // document — at 2,500 rows against ~2,500 staff that is over six
            // million regex evaluations for a lookup that is really just a
            // dictionary. Pulling four fields for the user list once and
            // matching on a lowercased Map is a single indexed-free scan and
            // finishes in milliseconds.
            const usernames = [...new Set(dedupedRows.map((r) => r.domain_user))];
            const wantedLower = new Set(usernames.map((n) => String(n).toLowerCase()));
            const userByLower = new Map();
            if (wantedLower.size) {
                const allUsers = await User.find(
                    {},
                    { user: 1, first_name: 1, last_name: 1, employee_id: 1 }
                ).lean();
                for (const u of allUsers) {
                    const key = String(u.user || "").toLowerCase();
                    if (wantedLower.has(key)) userByLower.set(key, u);
                }
            }

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
                reference_number,
                effective_date,
                board_meeting_date,
                letter_date,
                imported_by: adminUser.user,
            }).save();

            // ---------- build the documents ----------
            // Decisions and bonus adjustments are resolved in memory first, so
            // the database work below is pure writing.
            const pending = [];
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

                pending.push({
                    // Kept alongside the document so a write error can be
                    // reported against the spreadsheet row it came from.
                    meta: { sheet, category: row.category, excel_row, domain_user: row.domain_user },
                    user: _user,
                    decision: dec.decision,
                    doc: {
                        ...fields,
                        fiscal_year,
                        import_batch_id: batch._id,
                        imported_by: adminUser.user,
                        status: "Committed",
                        commitment_decision: dec.decision,
                        commitment_decided_at: dec.decided_at,
                    },
                });
            }

            // ---------- write them in chunks ----------
            // Previously one await .save() per row: 2,500 rows meant 2,500
            // sequential round trips. insertMany sends a chunk per round trip.
            //
            // ordered:false so one bad row cannot abort the rest — the whole
            // point of the original loop — and the driver reports each failure
            // with its index within the chunk, which maps back to the
            // spreadsheet row. Chunked rather than one huge call so memory and
            // the write stay bounded, and so the log shows progress on a long
            // import.
            const INSERT_CHUNK = 500;
            const inserted = [];

            for (let start = 0; start < pending.length; start += INSERT_CHUNK) {
                const slice = pending.slice(start, start + INSERT_CHUNK);

                try {
                    // eslint-disable-next-line no-await-in-loop
                    const docs = await SalaryIncrementLetter.insertMany(
                        slice.map((p) => p.doc),
                        { ordered: false }
                    );
                    docs.forEach((doc, i) => {
                        inserted.push({ doc, user: slice[i].user, decision: slice[i].decision });
                    });
                } catch (e) {
                    // ordered:false means the driver carries on past a bad row,
                    // so a throw here is a partial result, not a dead chunk.
                    //
                    // Reconciled by domain_user rather than by trusting any one
                    // error shape: a duplicate key arrives as writeErrors, a
                    // schema violation as a mongoose validation error, and the
                    // two report differently. Matching on what actually landed
                    // means every row is either counted as inserted or reported
                    // as failed — none can fall silently between the two.
                    // domain_user is unique per fiscal year and the rows were
                    // already deduplicated, so it identifies a row exactly.
                    const okDocs = e.insertedDocs || [];
                    const insertedByUser = new Map(
                        okDocs.map((d) => [String(d.domain_user).toLowerCase(), d])
                    );

                    // Itemised reasons, where the driver gave them.
                    const writeErrors = e.writeErrors || (e.result && e.result.writeErrors) || [];
                    const reasonByIndex = new Map();
                    writeErrors.forEach((we) => {
                        const idx = typeof we.index === "number" ? we.index : we.err && we.err.index;
                        const code = we.code || (we.err && we.err.code);
                        if (typeof idx === "number") {
                            reasonByIndex.set(idx, {
                                reason: code === 11000 ? "duplicate_key" : "insert_failed",
                                details: (we.errmsg || (we.err && we.err.errmsg) || "").slice(0, 300),
                            });
                        }
                    });

                    slice.forEach((p, i) => {
                        const landed = insertedByUser.get(String(p.doc.domain_user).toLowerCase());
                        if (landed) {
                            inserted.push({ doc: landed, user: p.user, decision: p.decision });
                            return;
                        }
                        const detail = reasonByIndex.get(i);
                        insertErrors.push({
                            ...p.meta,
                            reason: (detail && detail.reason) || "insert_failed",
                            details:
                                (detail && detail.details) ||
                                (e.message || "Write failed").slice(0, 300),
                        });
                    });
                }

                console.log(
                    `[salary-increment] FY ${fiscal_year} import: ` +
                    `${Math.min(start + INSERT_CHUNK, pending.length)}/${pending.length} rows written`
                );
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

            // ---------- respond, then notify ----------
            // The letters are written and the batch is committed at this point,
            // so the admin's answer does not wait on the push service. See
            // notifyImportedUsers for why that matters at this size.
            res.status(201).json({
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
                notifications_queued: inserted.length,
                overwritten: Boolean(existingBatch && overwrite),
            });

            // Deliberately not awaited — the response is already sent. Errors
            // are logged rather than thrown so a push failure cannot surface as
            // an unhandled rejection and take the worker down under iisnode.
            notifyImportedUsers(
                fiscal_year,
                inserted.map(({ doc, user }) => ({ doc, user }))
            ).catch((e) =>
                console.error("Salary import notification sweep failed:", e && e.message)
            );
            return undefined;
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
// ============================================================
// PATCH /batch-reference — set or correct a batch's reference number
// Body: { fiscal_year, reference_number }
// ============================================================
// Exists so an already-imported year can be given its reference without
// re-importing. Re-importing is destructive — overwrite deletes every letter
// for the fiscal year — so it is the wrong tool for fixing one field, and
// batches imported before reference_number existed would otherwise be stuck
// printing a blank Ref. No.
//
// Every letter in the batch reads through to this, so a correction here is
// immediately reflected on all of them and on the public verify page.
router.patch("/batch-reference", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const fiscal_year = Number((req.body || {}).fiscal_year);
        if (!Number.isFinite(fiscal_year)) {
            return res.status(400).json({ error: true, message: "fiscal_year is required" });
        }

        const reference_number = String((req.body || {}).reference_number || "")
            .trim()
            .slice(0, 60);
        if (!reference_number) {
            return res
                .status(400)
                .json({ error: true, message: "reference_number is required" });
        }

        const user = await User.findOne({ _id: req.user._id });
        const batch = await SalaryIncrementImport.findOneAndUpdate(
            { fiscal_year },
            {
                $set: {
                    reference_number,
                    reference_updated_by: (user && user.user) || "unknown",
                    reference_updated_at: new Date(),
                },
            },
            { new: true }
        ).lean();

        if (!batch) {
            return res.status(404).json({
                error: true,
                message: `No salary increment batch imported for FY ${fiscal_year}`,
            });
        }

        const letters = await SalaryIncrementLetter.countDocuments({ fiscal_year });
        console.log(
            `[salary-increment] FY ${fiscal_year} reference set to "${reference_number}" ` +
            `by ${(user && user.user) || "unknown"} — affects ${letters} letter(s)`
        );

        return res.json({
            error: false,
            message: `Reference number set for FY ${fiscal_year}. It now appears on all ${letters} letter${letters === 1 ? "" : "s"} in this batch.`,
            batch,
            letters_affected: letters,
        });
    } catch (e) {
        console.error("Salary /batch-reference error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

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

        // Which agreement revision was on screen, and whether the employee
        // ticked the read-confirmation. Both are recorded rather than assumed:
        // the agreement's Acknowledgment clause turns on the employee having
        // read it, and the wording is revised between years.
        const agreementVersion = String(req.body.agreement_version || "").trim().slice(0, 20);
        const readConfirmed = req.body.agreement_read_confirmed === true;

        const historyEntry = {
            decision,
            at: now,
            user_agent: ua,
            ip: clientIp,
            agreement_version: agreementVersion,
        };

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
            existing.agreement_version = agreementVersion;
            existing.agreement_read_confirmed = readConfirmed;
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
                agreement_version: agreementVersion,
                agreement_read_confirmed: readConfirmed,
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
// Timestamps in the export are rendered in East Africa Time for HR, e.g.
// "Aug 3, 2025 at 10:00 AM". Everything is stored in UTC; only this export
// converts.
//
// Ethiopia is UTC+3 all year with no daylight saving, so shifting by a fixed
// offset and reading the UTC parts is exact rather than an approximation — and
// it avoids depending on the server's ICU build having timezone data, which a
// small-icu Node would not.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const formatEat = (value) => {
    if (!value) return "";
    const utc = new Date(value);
    if (Number.isNaN(utc.getTime())) return "";

    const eat = new Date(utc.getTime() + EAT_OFFSET_MS);
    const month = MONTHS_SHORT[eat.getUTCMonth()];
    const day = eat.getUTCDate();
    const year = eat.getUTCFullYear();
    const minutes = String(eat.getUTCMinutes()).padStart(2, "0");

    const rawHour = eat.getUTCHours();
    const suffix = rawHour >= 12 ? "PM" : "AM";
    // 0 -> 12 AM, 12 -> 12 PM; every other hour is the remainder.
    const hour = rawHour % 12 === 0 ? 12 : rawHour % 12;

    return `${month} ${day}, ${year} at ${hour}:${minutes} ${suffix}`;
};

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
        // Sort alphabetically by domain user (case-insensitive) — HR scans the
        // export by name when building the import workbook.
        decisions.sort((a, b) =>
            String(a.domain_user || "").localeCompare(String(b.domain_user || ""), "en", {
                sensitivity: "base",
            })
        );

        const usernames = decisions.map((d) => d.domain_user);

        // HRIS is the source for both the name and the employee id.
        //
        // The Mongo User document only holds first_name and last_name, which
        // in Ethiopian naming reaches the FATHER's name and stops — the
        // grandfather's name is simply not there. HRIS carries all three
        // (Name / FName / GFName), so the export reads from it and keeps Mongo
        // only as a fallback for anyone HRIS cannot match.
        //
        // One batched query rather than a lookup per row: each helper in
        // test.js opens and closes the global mssql pool, so hundreds of
        // sequential calls would be slow and any overlap would break them.
        const directory = usernames.length ? await getEmployeeDirectory(usernames) : [];
        const hrisByLowerUser = new Map();
        for (const row of directory) {
            hrisByLowerUser.set(String(row.UserName || "").toLowerCase(), {
                name: [row.Name, row.FName, row.GFName]
                    .map((p) => String(p == null ? "" : p).trim())
                    .filter(Boolean)
                    .join(" "),
                employee_id: row.EmployeeId ? String(row.EmployeeId).trim() : "",
            });
        }

        const users = usernames.length ? await User.find({ user: { $in: usernames } }).lean() : [];
        const fallbackByLowerUser = new Map();
        for (const u of users) {
            fallbackByLowerUser.set(String(u.user).toLowerCase(), {
                name: `${u.first_name || ""} ${u.last_name || ""}`.trim(),
                employee_id: u.employee_id ? String(u.employee_id).trim() : "",
            });
        }

        // Two-sheet workbook: "Approved" first, "Rejected" second. Each sheet
        // gets the same column shape so HR can copy rows between them or out
        // into the salary-increment import workbook.
        //
        // "Source" tells HR which rows came from HRIS and which fell back to
        // the portal's own record — the fallback rows are the ones whose name
        // stops at the father and whose employee id may not match HRIS.
        const headers = [
            "Domain Name",
            "Employee ID",
            "Employee Name",
            "Decision",
            "Decided At",
            "Flips",
            "Agreement Version",
            "Source",
        ];
        const approvedAoa = [headers];
        const rejectedAoa = [headers];

        for (const d of decisions) {
            const key = String(d.domain_user).toLowerCase();
            const hris = hrisByLowerUser.get(key);
            const fallback = fallbackByLowerUser.get(key) || { name: "", employee_id: "" };
            const matched = !!(hris && (hris.name || hris.employee_id));

            const row = [
                d.domain_user,
                (matched && hris.employee_id) || fallback.employee_id || "",
                (matched && hris.name) || fallback.name || "",
                d.decision,
                formatEat(d.decided_at),
                Array.isArray(d.decision_history) ? d.decision_history.length : 0,
                d.agreement_version || "",
                matched ? "HRIS" : "Portal record (not matched in HRIS)",
            ];
            if (d.decision === "Approved") approvedAoa.push(row);
            else if (d.decision === "Rejected") rejectedAoa.push(row);
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(approvedAoa), "Approved");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rejectedAoa), "Rejected");
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

        // HRIS identity lookup is non-fatal — if SQL Server is unreachable
        // or has no row for this user we fall back to the Mongo User row so
        // the agreement can still render. getEmployeeIdentity uses a simpler
        // query than test() (no EmployeeExperience join) so it returns data
        // for staff who haven't been assigned an experience row yet.
        const [letters, period, hrIdentity] = await Promise.all([
            SalaryIncrementLetter.find({ domain_user: userRegex })
                .populate("import_batch_id")
                .sort({ fiscal_year: -1, TimeStamp: -1 }),
            SalaryCommitmentPeriod.findOne({}).sort({ fiscal_year: -1 }).lean(),
            // employee_id is passed so HRIS can be resolved by that stable,
            // business-unique key first and only fall back to the AD username.
            getEmployeeIdentity(user.user, user.employee_id).catch(() => null),
        ]);

        // Address is fetched SEPARATELY, after the identity lookup above, not
        // added to that Promise.all. Every helper in utils/rms/test.js opens
        // the global mssql pool and closes it in a finally, so two of them
        // running concurrently kill each other — the same trap that forced the
        // serialization fix in routes/rms/auth.js.
        //
        // Non-fatal like the identity lookup: the legal team wants the
        // employee's address on the agreement, but a missing HRIS address must
        // not stop someone recording their commitment decision.
        const hrAddress = await getEmployeeAddress(user.user, user.employee_id).catch(
            () => null
        );

        let decision = null;
        if (period) {
            decision = await SalaryCommitmentDecision.findOne({
                fiscal_year: period.fiscal_year,
                domain_user: userRegex,
            }).lean();
        }

        const now = new Date();
        // Format the Ethiopian fiscal-year label "YYYY/YY" once on the server
        // so every consumer (web modal, PDF, mobile) shows the same string.
        // FY 2026 → "2025/26", FY 2027 → "2026/27", etc.
        const fyLabel = period
            ? `${period.fiscal_year - 1}/${(period.fiscal_year % 100).toString().padStart(2, "0")}`
            : null;

        // The Ethiopian fiscal year runs July → June, so the obligatory
        // service period for FY <n> begins on July 1 of <n - 1>. Used as
        // the "Effective Date" line on the agreement.
        const effectiveDate = period
            ? new Date(Date.UTC(period.fiscal_year - 1, 6, 1, 0, 0, 0)).toISOString()
            : null;

        const periodOut = period
            ? {
                  fiscal_year: period.fiscal_year,
                  fiscal_year_label: fyLabel,
                  effective_date: effectiveDate,
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

        // Derive the employee's display identity for the agreement modal:
        // prefer the HRIS canonical name (Name / FName / GFName) and HRIS
        // EmployeeId. Mongo User row is a non-blocking fallback if HRIS is
        // unreachable.
        //
        // Position is also exposed here (preferring HRIS CurrentPosition,
        // i.e. the latest internal experience row) so the mobile greeting
        // card can use this endpoint as a fallback when /me isn't yet
        // deployed, and still show a current job title.
        let employeeInfo = {
            first_name: user.first_name || "",
            middle_name: "",
            last_name: user.last_name || "",
            employee_id: user.employee_id || "",
            position: user.position || "",
            domain_user: user.user,
            source: "user_collection",
        };
        if (hrIdentity) {
            employeeInfo = {
                first_name: hrIdentity.Name || employeeInfo.first_name,
                middle_name: hrIdentity.FName || employeeInfo.middle_name,
                last_name: hrIdentity.GFName || employeeInfo.last_name,
                // NOT falling back to the Mongo employee_id. This is the id
                // printed on a legal agreement, and the Mongo User document
                // has been observed to disagree with HRIS. A blank the client
                // can flag is safer than a plausible wrong number.
                employee_id: hrIdentity.EmployeeId ? String(hrIdentity.EmployeeId) : "",
                position: hrIdentity.CurrentPosition || employeeInfo.position,
                domain_user: user.user,
                source: "hris",
            };
        } else {
            // HRIS did not resolve. The Mongo name is two parts only (given +
            // father), so it cannot render the three-part name the agreement
            // needs — the client shows a warning rather than presenting it as
            // authoritative.
            employeeInfo.employee_id = "";
        }

        employeeInfo.employee_id_source = employeeInfo.employee_id ? "hris" : "missing";

        // The agreement names both parties by address, so the employee's is
        // composed here rather than in each client — web modal, PDF and any
        // future mobile view then print the identical string.
        //
        // Mirrors the Bank's own address format: "<City> City, <SubCity>
        // Sub-City, Woreda <n>, Kebele <n>, House No. <n>, Telephone No. <n>,
        // P.O. Box <n>". Empty parts are dropped rather than printed blank, so
        // a partial HRIS record still reads as a sentence.
        const addressParts = [];
        if (hrAddress) {
            const push = (value, format) => {
                const v = String(value == null ? "" : value).trim();
                if (v && v !== "***") addressParts.push(format(v));
            };
            push(hrAddress.City, (v) => `${v} City`);
            push(hrAddress.SubCity, (v) => `${v} Sub-City`);
            push(hrAddress.Zone, (v) => `Zone ${v}`);
            push(hrAddress.Woreda, (v) => `Woreda ${v}`);
            push(hrAddress.Kebele, (v) => `Kebele ${v}`);
            push(hrAddress.HouseNumber, (v) => `House No. ${v}`);
            push(hrAddress.Telephone, (v) => `Telephone No. ${v}`);
            push(hrAddress.POBox, (v) => `P.O. Box ${v}`);
        }

        employeeInfo.address = addressParts.join(", ");
        employeeInfo.address_parts = hrAddress
            ? {
                  region: hrAddress.Region || "",
                  city: hrAddress.City || "",
                  sub_city: hrAddress.SubCity || "",
                  zone: hrAddress.Zone || "",
                  woreda: hrAddress.Woreda || "",
                  kebele: hrAddress.Kebele || "",
                  house_number: hrAddress.HouseNumber || "",
                  telephone: hrAddress.Telephone || "",
                  po_box: hrAddress.POBox || "",
              }
            : null;
        // Lets the client show "address missing from HRIS — contact HR" rather
        // than silently printing a blank line into a signed agreement.
        employeeInfo.address_source = employeeInfo.address ? "hris" : "missing";

        return res.json({
            error: false,
            letters,
            period: periodOut,
            decision: decisionOut,
            employee_info: employeeInfo,
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

        // ---------------------------------------------------------------
        // RETIRED: per-letter reference generated on first print.
        //
        // The letter now carries the batch reference the admin types in at
        // import time — one number for the whole batch, present whether or not
        // anyone prints, exactly like the effective / board-meeting / letter
        // dates beside it.
        //
        // This also fixes a real mismatch: the public verify page has always
        // read import_batch_id.reference_number, so a printed letter showed
        // ZB/HC/INC/00001/2026 while scanning its own QR code showed the
        // batch number instead. The two now agree.
        //
        // Left in place rather than deleted so the per-letter counter can be
        // brought back without rewriting it. Nothing else references it —
        // SalaryIncrementCounter and the letter's reference_number /
        // reference_number_assigned_at fields are now dormant, and rows that
        // already have a value keep it harmlessly.
        //
        // if (!letter.reference_number) {
        //     letter.reference_number = await SalaryIncrementCounter.getNextReference(letter.fiscal_year);
        //     letter.reference_number_assigned_at = new Date();
        // }
        // ---------------------------------------------------------------

        const now = new Date();
        letter.printed_count = (letter.printed_count || 0) + 1;
        letter.last_printed_at = now;
        if (!letter.first_printed_at) letter.first_printed_at = now;
        await letter.save();

        // Same as /admin-prepare-print: the reference reported back is the
        // batch's, kept in the response only for older clients.
        const printBatch = await SalaryIncrementImport.findById(letter.import_batch_id).lean();

        return res.json({
            error: false,
            reference_number:
                (printBatch && printBatch.reference_number) || letter.reference_number || null,
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

        // RETIRED with the same reasoning as /mark-printed above — the letter
        // now shows the admin's batch reference, so there is nothing to assign
        // before an archive copy is printed. Kept commented rather than
        // deleted.
        //
        // if (!letter.reference_number) {
        //     letter.reference_number = await SalaryIncrementCounter.getNextReference(letter.fiscal_year);
        //     letter.reference_number_assigned_at = new Date();
        //     await letter.save();
        // }

        // Still answers with a reference so an older client that expects one
        // keeps working — it is just the batch's now, not a generated value.
        const batch = await SalaryIncrementImport.findById(letter.import_batch_id).lean();

        return res.json({
            error: false,
            reference_number: (batch && batch.reference_number) || letter.reference_number || null,
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
// Builds the Mongo filter for a letter listing from the query string.
//
// Shared by /list (paginated, feeds the table) and /export-data (unpaginated,
// feeds the bulk PDF archive). They must select exactly the same rows: an
// export that quietly differs from what the admin is looking at on screen is
// the worst possible bug in an audit feature, so there is one implementation.
const buildLetterFilter = async (query) => {
    const filter = {};
    if (query.fiscal_year) {
        const fy = Number(query.fiscal_year);
        if (Number.isFinite(fy)) filter.fiscal_year = fy;
    }
    if (query.category) filter.category = String(query.category);
    if (query.status) filter.status = String(query.status);
    if (query.domain_user) {
        filter.domain_user = {
            $regex: escapeRegex(String(query.domain_user)),
            $options: "i",
        };
    }

    // General search across domain_user, employee_name, first_name, AND the
    // populated batch's reference_number. Lets admins find a row when they
    // know any one of those identifiers.
    if (query.q) {
        const q = escapeRegex(String(query.q));
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

    return filter;
};

router.get("/list", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const filter = await buildLetterFilter(req.query);

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
// GET /export-data — admin-only, every letter matching the filter, unpaginated.
//
// Feeds the "Download All Letters (PDF)" archive on the list page. The browser
// renders the PDFs itself (it already owns the letter layout, and doing it
// client-side keeps the wording in one place rather than reimplementing the
// legal text server-side), so all this has to do is hand over the rows.
//
// Deliberately one request rather than the ~13 paged calls /list would need for
// a full fiscal year. Same filter builder as /list, so the archive contains
// exactly the rows the admin can see in the table — never a different set.
//
// Query: ?fiscal_year, ?category, ?status, ?domain_user, ?q
// ============================================================

// A 2,500-employee year is the real workload; 10,000 covers several years at
// once with room to spare while still refusing to serve an unbounded query.
const EXPORT_CAP = 10000;

router.get("/export-data", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const filter = await buildLetterFilter(req.query);

        // One extra row is fetched purely to detect truncation, then dropped —
        // cheaper than a separate countDocuments over the same filter.
        const rows = await SalaryIncrementLetter.find(filter)
            .populate("import_batch_id")
            .sort({ fiscal_year: -1, employee_name: 1, domain_user: 1 })
            .limit(EXPORT_CAP + 1)
            .lean();

        const truncated = rows.length > EXPORT_CAP;
        const data = truncated ? rows.slice(0, EXPORT_CAP) : rows;

        // The JWT carries only an id and roles, so resolve the username here for
        // the archive's README — an audit archive should say who pulled it.
        let exportedBy = "";
        try {
            const me = await User.findById(req.user._id, { user: 1 }).lean();
            exportedBy = (me && me.user) || "";
        } catch {
            /* the archive is still valid without it */
        }

        console.log(
            `[salary-increment] /export-data by ${exportedBy || req.user._id}: ` +
                `${data.length} letters${truncated ? ` (capped at ${EXPORT_CAP})` : ""}`
        );

        return res.json({
            data,
            meta: {
                count: data.length,
                truncated,
                cap: EXPORT_CAP,
                exported_by: exportedBy,
            },
        });
    } catch (e) {
        console.error("Salary /export-data error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ============================================================
// GET /analytics — admin-only summary of the salary letter program.
// Optional ?fiscal_year filter; otherwise returns aggregates across years.
// ============================================================
router.get("/analytics", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const fy = Number(req.query.fiscal_year);
        const baseFilter = Number.isFinite(fy) ? { fiscal_year: fy } : {};

        const [
            total,
            byStatusAgg,
            byCategoryAgg,
            byDecisionAgg,
            byFiscalYearAgg,
            printedAgg,
            printNeverCount,
            decisionsTotal,
            decisionsApproved,
            decisionsRejected,
            decisionFlipsAgg,
        ] = await Promise.all([
            SalaryIncrementLetter.countDocuments(baseFilter),
            SalaryIncrementLetter.aggregate([
                { $match: baseFilter },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            SalaryIncrementLetter.aggregate([
                { $match: baseFilter },
                { $group: { _id: "$category", count: { $sum: 1 } } },
            ]),
            SalaryIncrementLetter.aggregate([
                { $match: baseFilter },
                { $group: { _id: "$commitment_decision", count: { $sum: 1 } } },
            ]),
            SalaryIncrementLetter.aggregate([
                { $match: {} },
                { $group: { _id: "$fiscal_year", count: { $sum: 1 } } },
                { $sort: { _id: -1 } },
            ]),
            SalaryIncrementLetter.aggregate([
                { $match: { ...baseFilter, printed_count: { $gt: 0 } } },
                {
                    $group: {
                        _id: null,
                        users_printed: { $sum: 1 },
                        total_print_events: { $sum: "$printed_count" },
                    },
                },
            ]),
            SalaryIncrementLetter.countDocuments({
                ...baseFilter,
                $or: [{ printed_count: 0 }, { printed_count: { $exists: false } }],
            }),
            SalaryCommitmentDecision.countDocuments(
                Number.isFinite(fy) ? { fiscal_year: fy } : {}
            ),
            SalaryCommitmentDecision.countDocuments({
                ...(Number.isFinite(fy) ? { fiscal_year: fy } : {}),
                decision: "Approved",
            }),
            SalaryCommitmentDecision.countDocuments({
                ...(Number.isFinite(fy) ? { fiscal_year: fy } : {}),
                decision: "Rejected",
            }),
            SalaryCommitmentDecision.aggregate([
                { $match: Number.isFinite(fy) ? { fiscal_year: fy } : {} },
                {
                    $project: {
                        flips: { $size: { $ifNull: ["$decision_history", []] } },
                    },
                },
                { $match: { flips: { $gt: 1 } } },
                { $count: "users_who_flipped" },
            ]),
        ]);

        const toMap = (arr) =>
            arr.reduce((acc, r) => {
                acc[r._id || "Unknown"] = r.count;
                return acc;
            }, {});

        const printed = printedAgg[0] || { users_printed: 0, total_print_events: 0 };

        return res.json({
            error: false,
            fiscal_year: Number.isFinite(fy) ? fy : null,
            total_letters: total,
            by_status: toMap(byStatusAgg),
            by_category: toMap(byCategoryAgg),
            by_decision: toMap(byDecisionAgg),
            by_fiscal_year: toMap(byFiscalYearAgg),
            printing: {
                users_printed: printed.users_printed,
                users_never_printed: printNeverCount,
                total_print_events: printed.total_print_events,
            },
            commitments: {
                total_decisions: decisionsTotal,
                approved: decisionsApproved,
                rejected: decisionsRejected,
                users_who_flipped:
                    (decisionFlipsAgg[0] && decisionFlipsAgg[0].users_who_flipped) || 0,
            },
        });
    } catch (e) {
        console.error("Salary /analytics error:", e);
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

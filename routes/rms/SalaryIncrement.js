import { Router } from "express";
import multer from "multer";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import SalaryIncrementLetter from "../../models/rms/SalaryIncrementLetter.js";
import SalaryIncrementImport from "../../models/rms/SalaryIncrementImport.js";
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
// multipart/form-data fields:
//   file:               .xlsx
//   fiscal_year:        Number (e.g. 2025)
//   reference_number:   String (admin types in the Board doc number)
//   effective_date:     Date  (e.g. 2025-07-01)
//   board_meeting_date: Date  (e.g. 2025-07-23)
//   letter_date:        Date  (e.g. 2025-07-31)
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

            const reference_number = String(req.body.reference_number || "").trim();
            if (!reference_number) {
                return res.status(400).json({ error: true, message: "reference_number is required" });
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

            // ---------- create batch ----------
            const batch = await new SalaryIncrementImport({
                fiscal_year,
                reference_number,
                effective_date,
                board_meeting_date,
                letter_date,
                imported_by: adminUser.user,
            }).save();

            // ---------- save letters one-by-one (collect per-row errors without aborting) ----------
            const inserted = [];
            const insertErrors = [];
            for (const row of validRows) {
                const { sheet, excel_row, _user, ...fields } = row;
                try {
                    const doc = await new SalaryIncrementLetter({
                        ...fields,
                        fiscal_year,
                        import_batch_id: batch._id,
                        imported_by: adminUser.user,
                        status: "Imported",
                    }).save();
                    inserted.push({ doc, user: _user });
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
                reference_number,
                total_imported: inserted.length,
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
// GET /my — caller's own salary increment letters (newest first)
// ============================================================
router.get("/my", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res.status(400).json({ error: true, message: "The requester cannot be found" });
        }

        const letters = await SalaryIncrementLetter.find({
            domain_user: { $regex: "^" + escapeRegex(user.user) + "$", $options: "i" },
        })
            .populate("import_batch_id")
            .sort({ fiscal_year: -1, TimeStamp: -1 });

        return res.json({ error: false, letters });
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

        const now = new Date();
        letter.printed_count = (letter.printed_count || 0) + 1;
        letter.last_printed_at = now;
        if (!letter.first_printed_at) letter.first_printed_at = now;
        await letter.save();

        return res.json({
            error: false,
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

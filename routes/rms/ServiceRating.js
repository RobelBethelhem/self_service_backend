import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import ServiceRating from "../../models/rms/ServiceRating.js";
import Experiance from "../../models/rms/Experiance_Letter.js";
import Embassy from "../../models/rms/Letter_of_Embassy.js";
import Guaranty from "../../models/rms/Guaranty_Letter.js";
import Supportive from "../../models/rms/Supportive_Letter.js";
import Medical from "../../models/rms/Medical.js";
import ServiceRatingPolicy, { RATING_MODES } from "../../models/rms/ServiceRatingPolicy.js";
import { getRatingProfile } from "../../utils/rms/test.js";

const router = Router();

// Which collection a given request_type lives in. The "Guranty" typo is
// canonical across this codebase — matching it here is deliberate.
const LETTER_MODELS = {
    Experience: Experiance,
    Embassy: Embassy,
    Guranty: Guaranty,
    Supportive: Supportive,
    Medical: Medical,
};

// Frontend switches lowercase everything, so accept any casing and
// normalise back to the canonical stored form.
const CANONICAL_TYPE = {
    experience: "Experience",
    experiance: "Experience",
    embassy: "Embassy",
    guranty: "Guranty",
    guaranty: "Guranty",
    supportive: "Supportive",
    medical: "Medical",
};

const QUESTION_KEYS = ["q1_ease", "q2_timeliness", "q3_met_needs", "q4_overall"];

const QUESTION_LABELS = {
    q1_ease:
        "The service was easy to access and complete through the Employee Self-Service system.",
    q2_timeliness: "My request was processed within a reasonable time.",
    q3_met_needs: "The information or service I received met my needs.",
    q4_overall: "Overall, I am satisfied with the service I received.",
};

const QUESTION_PURPOSE = {
    q1_ease: "Measures system usability.",
    q2_timeliness: "Measures service timeliness.",
    q3_met_needs: "Measures service quality and effectiveness.",
    q4_overall: "Measures overall satisfaction (key KPI).",
};

const SCALE_LABELS = {
    1: "Strongly Disagree",
    2: "Disagree",
    3: "Neutral",
    4: "Agree",
    5: "Strongly Agree",
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Case-insensitive exact match, matching the owner-check idiom used by
// SalaryIncrement's /commit.
const ciExact = (value) => new RegExp(`^${escapeRegex(value)}$`, "i");

const round2 = (n) =>
    n === null || n === undefined || Number.isNaN(n)
        ? null
        : Math.round(Number(n) * 100) / 100;

const normaliseType = (raw) => CANONICAL_TYPE[String(raw || "").toLowerCase()] || null;

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------
// A letter type with NO policy row resolves to "mandatory" — precisely how the
// survey behaved before policies existed. Nothing changes until an admin
// deliberately opts a type into something else.
const DEFAULT_MODE = "mandatory";

// Inside the effective window the configured `mode` applies; outside it the
// `fallback_mode` does. Without a fallback, a campaign that ends would leave
// the next day undefined.
const resolvePolicyMode = (policy, now = new Date()) => {
    if (!policy) return DEFAULT_MODE;
    const from = policy.effective_from ? new Date(policy.effective_from) : null;
    const to = policy.effective_to ? new Date(policy.effective_to) : null;
    if (from && now < from) return policy.fallback_mode || "optional";
    if (to && now > to) return policy.fallback_mode || "optional";
    return policy.mode || DEFAULT_MODE;
};

// Never let a policy lookup failure block a print — fall back to the default.
const modeFor = async (request_type) => {
    let policy = null;
    try {
        policy = await ServiceRatingPolicy.findOne({ request_type }).lean();
    } catch (e) {
        console.error("[service-rating] policy lookup failed:", e.message);
    }
    return { policy: policy || null, mode: resolvePolicyMode(policy) };
};

const clientIpOf = (req) => {
    // IIS sits in front of node, so the real client address arrives in
    // x-forwarded-for — same handling as SalaryIncrement's audit fields.
    const xff = req.headers["x-forwarded-for"];
    return (xff ? String(xff).split(",")[0].trim() : null) || req.ip || null;
};

// ---------------------------------------------------------------------------
// GET /status?request_id=...&request_type=...
// ---------------------------------------------------------------------------
// The print/download gate calls this on mount. Answers exactly one question:
// "has the CALLER already rated this request?" — so a rating left by someone
// else can never unlock a letter, and never leaks across users.
router.get("/status", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const { request_id } = req.query || {};
        const request_type = normaliseType(req.query && req.query.request_type);

        if (!request_id || !request_type) {
            return res.status(400).json({
                error: true,
                message: "request_id and a valid request_type are required",
            });
        }

        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res
                .status(400)
                .json({ error: true, message: "The requester cannot be found" });
        }

        const rating = await ServiceRating.findOne({
            request_type,
            request_id: String(request_id),
            domain_user: ciExact(user.user),
        }).lean();

        // Bundled so the gate resolves "must I ask, and how?" in one call.
        const { policy, mode } = await modeFor(request_type);

        return res.json({
            error: false,
            // A recorded decline counts as answered: the user already said no,
            // so they are not re-prompted on every reprint.
            rated: !!rating,
            rating: rating || null,
            mode,
            policy: policy
                ? {
                      request_type: policy.request_type,
                      mode: policy.mode,
                      effective_from: policy.effective_from,
                      effective_to: policy.effective_to,
                      fallback_mode: policy.fallback_mode,
                      resolved_mode: mode,
                  }
                : { request_type, mode: DEFAULT_MODE, resolved_mode: mode },
        });
    } catch (error) {
        console.error("[service-rating] /status error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// GET /questions
// ---------------------------------------------------------------------------
// Single source of truth for the wording, so the survey text lives in one
// place instead of being duplicated in the modal.
router.get("/questions", auth, roleCheck(["user", "admin"]), (req, res) => {
    return res.json({
        error: false,
        scale: SCALE_LABELS,
        questions: QUESTION_KEYS.map((key, i) => ({
            key,
            order: i + 1,
            label: QUESTION_LABELS[key],
            purpose: QUESTION_PURPOSE[key],
            required: true,
            type: "likert",
        })).concat([
            {
                key: "q5_suggestion",
                order: 5,
                label: "Do you have any suggestions to improve our service?",
                purpose: "Collects actionable feedback.",
                required: false,
                type: "text",
            },
        ]),
    });
});

// ---------------------------------------------------------------------------
// Shared gate for /submit and /decline
// ---------------------------------------------------------------------------
// Both endpoints must apply the SAME owner and state checks. Keeping them in
// one function means a fix to the ownership rule can never land on only one of
// the two paths.
//
// Returns { status, message } when the request must be rejected, otherwise
// { user, letter, existing }.
const resolveRatableRequest = async (req, request_type, request_id) => {
    const user = await User.findOne({ _id: req.user._id });
    if (!user) {
        return { status: 400, message: "The requester cannot be found" };
    }

    const Model = LETTER_MODELS[request_type];
    const letter = await Model.findById(request_id).catch(() => null);
    if (!letter) {
        return { status: 404, message: "Request not found" };
    }

    // Owner-only: you rate the service YOU received. An admin printing
    // someone else's letter is not a service recipient.
    if (
        String(letter.domain_user).toLowerCase() !== String(user.user).toLowerCase()
    ) {
        return { status: 403, message: "You can only rate your own request" };
    }

    // Only an issued letter has a service experience worth rating.
    if (letter.status !== "Viewed") {
        return {
            status: 400,
            message: `Request is in status "${letter.status}" and cannot be rated`,
        };
    }

    const existing = await ServiceRating.findOne({ request_type, request_id }).lean();
    return { user, letter, existing };
};

// Fields common to a submission and a decline, including the HRIS snapshot.
// HRIS is best-effort — a rating must never be lost because that box is
// unreachable, so this never throws upward.
const buildRatingBase = async ({ req, user, letter, request_type, request_id, mode }) => {
    const profile = await getRatingProfile(user.user, user.employee_id).catch(() => null);

    // Medical reuses employee_first_name for the dependent's name, so prefer
    // the Mongo User profile for the rater's own name.
    const employeeName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();

    return {
        request_id,
        request_type,
        reference_number: letter.reference_number || "",
        domain_user: user.user,
        employee_name: employeeName,
        employee_id: (profile && profile.employee_id) || user.employee_id || "",
        approved_by: letter.viewed_by || "",
        approved_date: letter.viewed_date || null,
        policy_mode: mode,
        gender: (profile && profile.gender) || "",
        age: profile ? profile.age : null,
        job_grade: (profile && profile.job_grade) || "",
        department: (profile && profile.department) || "",
        place_of_assignment: (profile && profile.place_of_assignment) || "",
        current_position: (profile && profile.current_position) || "",
        experience_years: profile ? profile.experience_years : null,
        experience_months: profile ? profile.experience_months : null,
        experience_days: profile ? profile.experience_days : null,
        experience_total_days: profile ? profile.experience_total_days : null,
        experience_text: (profile && profile.experience_text) || "",
        employment_date: (profile && profile.employment_date) || null,
        submitted_at: new Date(),
        user_agent: req.headers["user-agent"] || "",
        ip: clientIpOf(req),
    };
};

// ---------------------------------------------------------------------------
// POST /submit
// ---------------------------------------------------------------------------
// Owner-only. Idempotent: a second submit for an already-rated request
// returns the existing row with 200 rather than erroring, so a double-click
// or a retry after a dropped response still unlocks the print button.
router.post("/submit", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const request_type = normaliseType(body.request_type);
        const request_id = body.request_id ? String(body.request_id) : null;

        if (!request_id || !request_type) {
            return res.status(400).json({
                error: true,
                message: "request_id and a valid request_type are required",
            });
        }

        // Q1-Q4 mandatory, integers on the 1..5 Likert scale.
        const answers = {};
        for (const key of QUESTION_KEYS) {
            const raw = body[key];
            const value = Number(raw);
            if (!Number.isInteger(value) || value < 1 || value > 5) {
                return res.status(400).json({
                    error: true,
                    message: `"${key}" is required and must be a whole number between 1 and 5`,
                });
            }
            answers[key] = value;
        }

        // Q5 optional — an empty/absent value is a legitimate skip.
        const suggestion = String(body.q5_suggestion || "").trim().slice(0, 2000);

        const resolved = await resolveRatableRequest(req, request_type, request_id);
        if (resolved.status) {
            return res
                .status(resolved.status)
                .json({ error: true, message: resolved.message });
        }
        const { user, letter, existing } = resolved;

        if (existing) {
            return res.json({
                error: false,
                already: true,
                message: "This request has already been rated",
                rating: existing,
            });
        }

        const { mode } = await modeFor(request_type);

        const average =
            QUESTION_KEYS.reduce((sum, k) => sum + answers[k], 0) /
            QUESTION_KEYS.length;

        const base = await buildRatingBase({
            req,
            user,
            letter,
            request_type,
            request_id,
            mode,
        });

        const doc = new ServiceRating({
            ...base,
            status: "submitted",
            ...answers,
            q5_suggestion: suggestion,
            average_score: round2(average),
        });

        try {
            await doc.save();
        } catch (e) {
            // Duplicate key = someone won the race. Treat as success and
            // return the winning row so the client still unlocks.
            if (e && e.code === 11000) {
                const winner = await ServiceRating.findOne({
                    request_type,
                    request_id,
                }).lean();
                return res.json({
                    error: false,
                    already: true,
                    message: "This request has already been rated",
                    rating: winner,
                });
            }
            throw e;
        }

        return res.json({
            error: false,
            already: false,
            message: "Thank you for your feedback",
            rating: doc.toObject(),
        });
    } catch (error) {
        console.error("[service-rating] /submit error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// POST /decline
// ---------------------------------------------------------------------------
// Only meaningful when the letter type's policy resolves to "optional": the
// user was asked whether they wanted to rate and said no.
//
// The decline is RECORDED rather than dropped. It gives HR a real response
// rate, and it stops the user being re-prompted every time they reprint the
// same letter. Reports exclude these rows from averages.
router.post("/decline", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const request_type = normaliseType(body.request_type);
        const request_id = body.request_id ? String(body.request_id) : null;

        if (!request_id || !request_type) {
            return res.status(400).json({
                error: true,
                message: "request_id and a valid request_type are required",
            });
        }

        const resolved = await resolveRatableRequest(req, request_type, request_id);
        if (resolved.status) {
            return res
                .status(resolved.status)
                .json({ error: true, message: resolved.message });
        }
        const { user, letter, existing } = resolved;

        if (existing) {
            return res.json({
                error: false,
                already: true,
                message: "This request has already been answered",
                rating: existing,
            });
        }

        const { mode } = await modeFor(request_type);

        // Declining a survey the admin made compulsory is not a user decision
        // to make. The frontend never offers the option in this mode, so this
        // only catches a stale client or a hand-crafted request.
        if (mode === "mandatory") {
            return res.status(400).json({
                error: true,
                message: "Rating is mandatory for this letter type and cannot be skipped",
            });
        }

        const base = await buildRatingBase({
            req,
            user,
            letter,
            request_type,
            request_id,
            mode,
        });

        const doc = new ServiceRating({
            ...base,
            status: "declined",
            q5_suggestion: "",
            average_score: null,
        });

        try {
            await doc.save();
        } catch (e) {
            if (e && e.code === 11000) {
                const winner = await ServiceRating.findOne({
                    request_type,
                    request_id,
                }).lean();
                return res.json({
                    error: false,
                    already: true,
                    message: "This request has already been answered",
                    rating: winner,
                });
            }
            throw e;
        }

        return res.json({
            error: false,
            already: false,
            declined: true,
            message: "No problem — continuing without a rating",
            rating: doc.toObject(),
        });
    } catch (error) {
        console.error("[service-rating] /decline error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// Admin policy management
// ---------------------------------------------------------------------------

const ALL_TYPES = Object.keys(LETTER_MODELS);

// GET /admin/policy
// Every letter type, whether or not it has a saved row. Types without one are
// returned as implicit defaults so the admin screen can render all five
// without the backend writing rows nobody asked for.
router.get("/admin/policy", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const saved = await ServiceRatingPolicy.find().lean();
        const byType = {};
        saved.forEach((p) => {
            byType[p.request_type] = p;
        });

        const policies = ALL_TYPES.map((request_type) => {
            const p = byType[request_type];
            if (!p) {
                return {
                    request_type,
                    mode: DEFAULT_MODE,
                    effective_from: null,
                    effective_to: null,
                    fallback_mode: "optional",
                    note: "",
                    configured: false,
                    resolved_mode: DEFAULT_MODE,
                    updated_by: null,
                    updated_at: null,
                    history: [],
                };
            }
            return {
                ...p,
                configured: true,
                resolved_mode: resolvePolicyMode(p),
            };
        });

        return res.json({ error: false, modes: RATING_MODES, policies });
    } catch (error) {
        console.error("[service-rating] /admin/policy error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// PUT /admin/policy
// Upsert one letter type's policy and append the new state to its history.
router.put("/admin/policy", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const request_type = normaliseType(body.request_type);
        if (!request_type) {
            return res
                .status(400)
                .json({ error: true, message: "A valid request_type is required" });
        }

        const mode = String(body.mode || "").toLowerCase();
        if (!RATING_MODES.includes(mode)) {
            return res.status(400).json({
                error: true,
                message: `mode must be one of: ${RATING_MODES.join(", ")}`,
            });
        }

        const fallbackRaw = String(body.fallback_mode || "optional").toLowerCase();
        const fallback_mode = RATING_MODES.includes(fallbackRaw) ? fallbackRaw : "optional";

        const parseDate = (value, endOfDay) => {
            if (!value) return null;
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return null;
            // A window ending "31 Mar" must cover all of 31 Mar, so the end
            // bound is pushed to the last millisecond of that day here rather
            // than complicating every read.
            if (endOfDay) d.setHours(23, 59, 59, 999);
            return d;
        };

        const effective_from = parseDate(body.effective_from, false);
        const effective_to = parseDate(body.effective_to, true);

        if (effective_from && effective_to && effective_to < effective_from) {
            return res.status(400).json({
                error: true,
                message: "effective_to cannot be earlier than effective_from",
            });
        }

        const user = await User.findOne({ _id: req.user._id });
        const changedBy = (user && user.user) || "unknown";
        const note = String(body.note || "").trim().slice(0, 500);
        const now = new Date();

        const historyEntry = {
            mode,
            effective_from,
            effective_to,
            fallback_mode,
            note,
            changed_by: changedBy,
            changed_at: now,
        };

        const policy = await ServiceRatingPolicy.findOneAndUpdate(
            { request_type },
            {
                $set: {
                    request_type,
                    mode,
                    effective_from,
                    effective_to,
                    fallback_mode,
                    note,
                    updated_by: changedBy,
                    updated_at: now,
                },
                $setOnInsert: { created_by: changedBy, created_at: now },
                $push: { history: historyEntry },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        console.log(
            `[service-rating] policy ${request_type} -> ${mode} ` +
            `(from=${effective_from || "-"} to=${effective_to || "-"} fallback=${fallback_mode}) by ${changedBy}`
        );

        return res.json({
            error: false,
            message: `Rating policy for ${request_type} updated`,
            policy: { ...policy, configured: true, resolved_mode: resolvePolicyMode(policy) },
        });
    } catch (error) {
        console.error("[service-rating] PUT /admin/policy error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// GET /admin/policy/history
// Flattened change log across every letter type, newest first.
router.get("/admin/policy/history", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const filter = {};
        const type = normaliseType(req.query && req.query.request_type);
        if (type) filter.request_type = type;

        const policies = await ServiceRatingPolicy.find(filter).lean();

        const entries = [];
        policies.forEach((p) => {
            (p.history || []).forEach((h) => {
                entries.push({ request_type: p.request_type, ...h });
            });
        });
        entries.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));

        return res.json({ error: false, data: entries, meta: { totalRowCount: entries.length } });
    } catch (error) {
        console.error("[service-rating] /admin/policy/history error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// Admin reporting
// ---------------------------------------------------------------------------

// Shared $match built from the query string. Every admin endpoint accepts the
// same filter vocabulary so the dashboard can pass one filter object around.
const buildMatch = (q = {}) => {
    const match = {};

    const type = normaliseType(q.request_type);
    if (type) match.request_type = type;
    if (q.approved_by) match.approved_by = ciExact(q.approved_by);
    if (q.domain_user) match.domain_user = ciExact(q.domain_user);
    if (q.department) match.department = ciExact(q.department);
    if (q.gender) match.gender = ciExact(q.gender);
    if (q.job_grade) match.job_grade = ciExact(q.job_grade);

    if (q.from || q.to) {
        match.submitted_at = {};
        if (q.from) {
            const d = new Date(q.from);
            if (!Number.isNaN(d.getTime())) match.submitted_at.$gte = d;
        }
        if (q.to) {
            const d = new Date(q.to);
            if (!Number.isNaN(d.getTime())) {
                // Inclusive end-of-day so "to = today" includes today.
                d.setHours(23, 59, 59, 999);
                match.submitted_at.$lte = d;
            }
        }
        if (Object.keys(match.submitted_at).length === 0) delete match.submitted_at;
    }

    return match;
};

// Accumulators reused by every $group in the facet: a count, a mean per
// question, the mean of means, how many rows carried a comment, and the full
// 1..5 distribution for each of the four questions.
//
// Built programmatically because writing 4 x 5 = 20 $cond sums by hand is
// where typos live.
const groupAccumulators = () => {
    const acc = {
        count: { $sum: 1 },
        avg_overall: { $avg: "$average_score" },
        comments: {
            $sum: {
                $cond: [
                    {
                        $gt: [
                            { $strLenCP: { $ifNull: ["$q5_suggestion", ""] } },
                            0,
                        ],
                    },
                    1,
                    0,
                ],
            },
        },
    };
    for (const q of QUESTION_KEYS) {
        acc[`avg_${q}`] = { $avg: `$${q}` };
        for (let v = 1; v <= 5; v += 1) {
            acc[`${q}__${v}`] = {
                $sum: { $cond: [{ $eq: [`$${q}`, v] }, 1, 0] },
            };
        }
    }
    return acc;
};

// Declines carry no scores, so they must never reach an $avg.
const SUBMITTED_ONLY = { $match: { status: { $ne: "declined" } } };

// Flat accumulator keys -> nested per-question shape the dashboard renders.
const reshapeGroup = (row) => {
    if (!row) return null;
    const key =
        row._id === null || row._id === undefined || row._id === ""
            ? "(unspecified)"
            : row._id;

    const out = {
        key,
        count: row.count || 0,
        comments: row.comments || 0,
        avg_overall: round2(row.avg_overall),
        questions: {},
    };

    for (const q of QUESTION_KEYS) {
        const distribution = {};
        let answered = 0;
        for (let v = 1; v <= 5; v += 1) {
            const n = row[`${q}__${v}`] || 0;
            distribution[v] = n;
            answered += n;
        }
        out.questions[q] = {
            label: QUESTION_LABELS[q],
            purpose: QUESTION_PURPOSE[q],
            average: round2(row[`avg_${q}`]),
            answered,
            distribution,
        };
    }
    return out;
};

// GET /admin/summary
// Everything the dashboard needs in one round-trip: the overall picture plus
// per-approver, per-letter-type and per-demographic breakdowns, each carrying
// the full Strongly-Disagree..Strongly-Agree distribution per question.
router.get("/admin/summary", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const match = buildMatch(req.query);
        const acc = groupAccumulators();

        const pipeline = [
            { $match: match },
            {
                $addFields: {
                    age_band: {
                        $switch: {
                            branches: [
                                {
                                    case: { $eq: [{ $ifNull: ["$age", null] }, null] },
                                    then: "Unknown",
                                },
                                { case: { $lt: ["$age", 25] }, then: "Under 25" },
                                { case: { $lt: ["$age", 35] }, then: "25-34" },
                                { case: { $lt: ["$age", 45] }, then: "35-44" },
                                { case: { $lt: ["$age", 55] }, then: "45-54" },
                            ],
                            default: "55+",
                        },
                    },
                    experience_band: {
                        $switch: {
                            branches: [
                                {
                                    case: {
                                        $eq: [
                                            { $ifNull: ["$experience_total_days", null] },
                                            null,
                                        ],
                                    },
                                    then: "Unknown",
                                },
                                {
                                    case: { $lt: ["$experience_total_days", 365] },
                                    then: "Under 1 year",
                                },
                                {
                                    case: { $lt: ["$experience_total_days", 1095] },
                                    then: "1-3 years",
                                },
                                {
                                    case: { $lt: ["$experience_total_days", 1825] },
                                    then: "3-5 years",
                                },
                                {
                                    case: { $lt: ["$experience_total_days", 3650] },
                                    then: "5-10 years",
                                },
                            ],
                            default: "10+ years",
                        },
                    },
                },
            },
            {
                $facet: {
                    // Every statistical branch drops declines first. The test
                    // is $ne rather than an equality check on "submitted" so
                    // rows written before the status field existed still count.
                    overall: [SUBMITTED_ONLY, { $group: { _id: null, ...acc } }],
                    by_approver: [
                        SUBMITTED_ONLY,
                        { $group: { _id: "$approved_by", ...acc } },
                        { $sort: { count: -1 } },
                    ],
                    by_request_type: [
                        SUBMITTED_ONLY,
                        { $group: { _id: "$request_type", ...acc } },
                        { $sort: { count: -1 } },
                    ],
                    by_department: [
                        SUBMITTED_ONLY,
                        { $group: { _id: "$department", ...acc } },
                        { $sort: { count: -1 } },
                    ],
                    by_gender: [
                        SUBMITTED_ONLY,
                        { $group: { _id: "$gender", ...acc } },
                        { $sort: { count: -1 } },
                    ],
                    by_job_grade: [
                        SUBMITTED_ONLY,
                        { $group: { _id: "$job_grade", ...acc } },
                        { $sort: { count: -1 } },
                    ],
                    by_age_band: [
                        SUBMITTED_ONLY,
                        { $group: { _id: "$age_band", ...acc } },
                        { $sort: { _id: 1 } },
                    ],
                    by_experience_band: [
                        SUBMITTED_ONLY,
                        { $group: { _id: "$experience_band", ...acc } },
                        { $sort: { _id: 1 } },
                    ],
                    // Counted, never averaged — a decline has no scores.
                    declined: [{ $match: { status: "declined" } }, { $count: "n" }],
                    declined_by_request_type: [
                        { $match: { status: "declined" } },
                        { $group: { _id: "$request_type", count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                    ],
                },
            },
        ];

        const [result] = await ServiceRating.aggregate(pipeline);
        const facet = result || {};

        const list = (name) => (facet[name] || []).map(reshapeGroup).filter(Boolean);

        const overallRow = reshapeGroup((facet.overall || [])[0]);
        const declined = ((facet.declined || [])[0] || {}).n || 0;
        const submitted = overallRow ? overallRow.count : 0;
        const asked = submitted + declined;

        return res.json({
            error: false,
            scale: SCALE_LABELS,
            // Only meaningful where the policy is "optional" — under a
            // mandatory policy there is nothing to decline, so this reads 100%.
            declined,
            asked,
            response_rate: asked ? Math.round((submitted / asked) * 100) : null,
            declined_by_request_type: (facet.declined_by_request_type || []).map((r) => ({
                key: r._id || "(unspecified)",
                count: r.count,
            })),
            question_labels: QUESTION_LABELS,
            question_purpose: QUESTION_PURPOSE,
            overall: overallRow || {
                key: "overall",
                count: 0,
                comments: 0,
                avg_overall: null,
                questions: QUESTION_KEYS.reduce((o, q) => {
                    o[q] = {
                        label: QUESTION_LABELS[q],
                        purpose: QUESTION_PURPOSE[q],
                        average: null,
                        answered: 0,
                        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
                    };
                    return o;
                }, {}),
            },
            by_approver: list("by_approver"),
            by_request_type: list("by_request_type"),
            by_department: list("by_department"),
            by_gender: list("by_gender"),
            by_job_grade: list("by_job_grade"),
            by_age_band: list("by_age_band"),
            by_experience_band: list("by_experience_band"),
        });
    } catch (error) {
        console.error("[service-rating] /admin/summary error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// GET /admin/comments
// The open-ended sidebar. Q5 is optional, but whatever people DO write is the
// most actionable thing in the dataset — this endpoint exists so it never
// gets buried inside an aggregate.
router.get("/admin/comments", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const match = buildMatch(req.query);
        match.q5_suggestion = { $nin: [null, ""] };

        const page = Math.max(0, parseInt(req.query.page, 10) || 0);
        const size = Math.min(200, Math.max(1, parseInt(req.query.size, 10) || 25));

        const [data, totalRowCount] = [
            await ServiceRating.find(match)
                .sort({ submitted_at: -1 })
                .skip(page * size)
                .limit(size)
                .lean(),
            await ServiceRating.countDocuments(match),
        ];

        return res.json({ error: false, data, meta: { totalRowCount } });
    } catch (error) {
        console.error("[service-rating] /admin/comments error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// GET /admin/list
// Raw rows behind the charts, material-react-table shaped. `q` does a loose
// OR-search across the identity columns and the free-text answer.
router.get("/admin/list", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const match = buildMatch(req.query);

        if (req.query.q) {
            const rx = new RegExp(escapeRegex(String(req.query.q).trim()), "i");
            match.$or = [
                { domain_user: rx },
                { employee_name: rx },
                { reference_number: rx },
                { approved_by: rx },
                { department: rx },
                { q5_suggestion: rx },
            ];
        }

        const page = Math.max(0, parseInt(req.query.page, 10) || 0);
        const size = Math.min(200, Math.max(1, parseInt(req.query.size, 10) || 25));

        const [data, totalRowCount] = [
            await ServiceRating.find(match)
                .sort({ submitted_at: -1 })
                .skip(page * size)
                .limit(size)
                .lean(),
            await ServiceRating.countDocuments(match),
        ];

        return res.json({ error: false, data, meta: { totalRowCount } });
    } catch (error) {
        console.error("[service-rating] /admin/list error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

// GET /admin/filters
// Distinct values for the dashboard's dropdowns, so the admin never has to
// type an approver's AD username from memory.
router.get("/admin/filters", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const [approvers, departments, jobGrades, genders] = [
            await ServiceRating.distinct("approved_by"),
            await ServiceRating.distinct("department"),
            await ServiceRating.distinct("job_grade"),
            await ServiceRating.distinct("gender"),
        ];

        const clean = (arr) =>
            arr.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").sort();

        return res.json({
            error: false,
            approvers: clean(approvers),
            departments: clean(departments),
            job_grades: clean(jobGrades),
            genders: clean(genders),
            request_types: Object.keys(LETTER_MODELS),
        });
    } catch (error) {
        console.error("[service-rating] /admin/filters error:", error);
        return res
            .status(500)
            .json({ error: true, message: "Internal Server Error" });
    }
});

export default router;

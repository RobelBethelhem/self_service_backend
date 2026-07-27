import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Service-level satisfaction rating, collected from the requester right
// before the FIRST print/download of an approved letter.
//
// One row per (request_type, request_id) — enforced by a compound unique
// index. Once a request is rated the gate is lifted permanently for that
// request, so repeat prints go straight through.
//
// Q1-Q4 are 5-point Likert, mandatory. Q5 is a free-text suggestion box and
// is optional (the user can skip it). The HRIS block is a SNAPSHOT taken at
// submission time so HR reports stay stable after promotions/transfers.

// 1 = Strongly Disagree ... 5 = Strongly Agree
const likert = {
    type: Number,
    required: true,
    min: 1,
    max: 5,
};

const serviceRatingSchema = new Schema({
    // --- what was rated ---------------------------------------------------
    // request_id is the letter document's Mongo _id, kept as a string
    // because it points into one of five different collections.
    request_id: {
        type: String,
        required: true,
        trim: true,
    },
    request_type: {
        type: String,
        required: true,
        trim: true,
        // "Guranty" typo is canonical across this codebase — do not correct.
        enum: ["Experience", "Embassy", "Guranty", "Supportive", "Medical"],
    },
    reference_number: {
        type: String,
        trim: true,
    },

    // --- who rated --------------------------------------------------------
    domain_user: {
        type: String,
        required: true,
        trim: true,
    },
    employee_name: {
        type: String,
        trim: true,
    },
    employee_id: {
        type: String,
        trim: true,
    },

    // --- the answers ------------------------------------------------------
    // Q1: The service was easy to access and complete through the ESS system.
    q1_ease: likert,
    // Q2: My request was processed within a reasonable time.
    q2_timeliness: likert,
    // Q3: The information or service I received met my needs.
    q3_met_needs: likert,
    // Q4: Overall, I am satisfied with the service I received. (key KPI)
    q4_overall: likert,
    // Q5: Do you have any suggestions to improve our service? (optional)
    q5_suggestion: {
        type: String,
        trim: true,
        default: "",
        maxlength: 2000,
    },
    // Mean of Q1-Q4, stored so the admin dashboard can sort/threshold on it
    // without recomputing per row.
    average_score: {
        type: Number,
    },

    // --- who served -------------------------------------------------------
    // Copied from the rated letter's `viewed_by` (the approving admin's AD
    // username). This is what lets HR evaluate an individual approver.
    approved_by: {
        type: String,
        trim: true,
    },
    approved_date: {
        type: Date,
    },

    // --- HRIS snapshot at submission time ---------------------------------
    gender: { type: String, trim: true },
    age: { type: Number },
    job_grade: { type: String, trim: true },
    department: { type: String, trim: true },
    place_of_assignment: { type: String, trim: true },
    current_position: { type: String, trim: true },
    experience_years: { type: Number },
    experience_months: { type: Number },
    experience_days: { type: Number },
    experience_total_days: { type: Number },
    // e.g. "2 years, 5 months and 26 days"
    experience_text: { type: String, trim: true },
    employment_date: { type: Date },

    // --- audit ------------------------------------------------------------
    submitted_at: {
        type: Date,
        default: Date.now,
    },
    user_agent: { type: String, trim: true },
    ip: { type: String, trim: true },
});

// One rating per request. The upsert path relies on this to stay idempotent
// when a user double-submits from a flaky connection.
serviceRatingSchema.index({ request_type: 1, request_id: 1 }, { unique: true });

// Report-side access paths.
serviceRatingSchema.index({ approved_by: 1, submitted_at: -1 });
serviceRatingSchema.index({ domain_user: 1, submitted_at: -1 });
serviceRatingSchema.index({ submitted_at: -1 });

const ServiceRating = mongoose.model("ServiceRating", serviceRatingSchema);
export default ServiceRating;

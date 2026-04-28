import mongoose from "mongoose";
const Schema = mongoose.Schema;

const salaryIncrementLetterSchema = new Schema({
    // ============ identity ============
    domain_user: {
        type: String,
        required: true,
        trim: true,
    },
    fiscal_year: {
        type: Number,
        required: true,
    },
    category: {
        type: String,
        required: true,
        enum: ["Full", "Proportionate", "Discipline", "Salary Only", "Promotion"],
    },

    // ============ employee snapshot (filled at import time) ============
    employee_name: {
        type: String,
        required: true,
        trim: true,
    },
    first_name: {
        type: String,
        required: true,
        trim: true,
    },

    // ============ shared salary fields (Full / Proportionate / Discipline / Salary Only) ============
    job_grade: {
        type: String,
        trim: true,
    },
    step: {
        type: String,
        trim: true,
    },
    old_salary: {
        type: Number,
    },
    new_salary: {
        type: Number,
    },

    // ============ bonus fields (Full / Proportionate / Discipline / Promotion) ============
    bonus_months: {
        type: Number,
    },
    discipline_pct: {
        type: Number,
    },

    // ============ promotion-specific fields ============
    old_job_position: {
        type: String,
        trim: true,
    },
    new_job_position: {
        type: String,
        trim: true,
    },
    old_job_grade: {
        type: String,
        trim: true,
    },
    new_job_grade: {
        type: String,
        trim: true,
    },
    old_step: {
        type: String,
        trim: true,
    },
    new_step: {
        type: String,
        trim: true,
    },
    salary_after_promotion_adjustment: {
        type: Number,
    },
    promotion_commitment_text: {
        type: String,
        trim: true,
    },

    // ============ workflow state ============
    status: {
        type: String,
        enum: ["Imported", "Committed", "Revoked"],
        default: "Imported",
    },
    commitment_agreed: {
        type: Boolean,
        default: false,
    },
    commitment_date: {
        type: Date,
    },
    commitment_user_agent: {
        type: String,
        trim: true,
    },
    commitment_ip: {
        type: String,
        trim: true,
    },

    printed_count: {
        type: Number,
        default: 0,
    },
    first_printed_at: {
        type: Date,
    },
    last_printed_at: {
        type: Date,
    },

    // ============ audit / linkage ============
    imported_by: {
        type: String,
        trim: true,
    },
    imported_at: {
        type: Date,
        default: Date.now,
    },
    import_batch_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SalaryIncrementImport",
        required: true,
    },
    request_type: {
        type: String,
        trim: true,
        default: "SalaryIncrement",
    },
    TimeStamp: {
        type: Date,
        default: Date.now,
    },

    // ============ revoke ============
    revoked_by: {
        type: String,
        trim: true,
    },
    revoked_date: {
        type: Date,
    },
    revoke_reason: {
        type: String,
        trim: true,
    },
});

// One letter per user per fiscal year — second import for same (user, year) requires overwrite.
salaryIncrementLetterSchema.index({ domain_user: 1, fiscal_year: 1 }, { unique: true });

const SalaryIncrementLetter = mongoose.model("SalaryIncrementLetter", salaryIncrementLetterSchema);
export default SalaryIncrementLetter;

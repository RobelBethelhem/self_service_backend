import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Admin-defined window during which employees may submit/flip their
// commitment decision (Approve or Reject) for a given fiscal year.
//
// One row per fiscal year (unique index). Admin can update start/end dates;
// most commonly they extend `end_date` to grant more time before the cutoff.
const salaryCommitmentPeriodSchema = new Schema({
    fiscal_year: {
        type: Number,
        required: true,
        unique: true,
    },
    start_date: {
        type: Date,
        required: true,
    },
    end_date: {
        type: Date,
        required: true,
    },
    notes: {
        type: String,
        trim: true,
    },

    // audit
    created_by: {
        type: String,
        trim: true,
    },
    created_at: {
        type: Date,
        default: Date.now,
    },
    updated_by: {
        type: String,
        trim: true,
    },
    updated_at: {
        type: Date,
    },
});

const SalaryCommitmentPeriod = mongoose.model(
    "SalaryCommitmentPeriod",
    salaryCommitmentPeriodSchema
);
export default SalaryCommitmentPeriod;

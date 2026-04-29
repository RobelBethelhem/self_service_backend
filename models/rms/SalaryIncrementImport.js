import mongoose from "mongoose";
const Schema = mongoose.Schema;

const categoryCountsSchema = new Schema(
    {
        full: { type: Number, default: 0 },
        proportionate: { type: Number, default: 0 },
        discipline: { type: Number, default: 0 },
        salary_only: { type: Number, default: 0 },
        promotion: { type: Number, default: 0 },
    },
    { _id: false }
);

const salaryIncrementImportSchema = new Schema({
    fiscal_year: {
        type: Number,
        required: true,
        unique: true,
    },

    // The three dates that render verbatim in every letter for this batch.
    effective_date: {
        type: Date,
        required: true,
    },
    board_meeting_date: {
        type: Date,
        required: true,
    },
    letter_date: {
        type: Date,
        required: true,
    },

    // audit / metadata
    imported_by: {
        type: String,
        trim: true,
    },
    imported_at: {
        type: Date,
        default: Date.now,
    },
    total_rows: {
        type: Number,
        default: 0,
    },
    per_category_counts: {
        type: categoryCountsSchema,
        default: () => ({}),
    },

    // Optional path to the uploaded .xlsx kept under /uploads for audit/repro.
    raw_workbook_path: {
        type: String,
        trim: true,
    },
});

const SalaryIncrementImport = mongoose.model("SalaryIncrementImport", salaryIncrementImportSchema);
export default SalaryIncrementImport;

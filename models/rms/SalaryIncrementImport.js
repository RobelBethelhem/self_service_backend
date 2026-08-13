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

    // The Board's own decision-document number, typed in by the admin at
    // import time and shared by every letter in the batch — e.g.
    // "ZB/HC/2198/2025".
    //
    // Deliberately NOT generated. A per-letter counter was tried and retired:
    // it only assigned a number when someone printed, so an unprinted letter
    // had none, and the public verify page reads this field — meaning the
    // paper and its own QR code disagreed. One admin-set number for the batch
    // is what the Board actually issues, and it is present whether or not
    // anyone prints.
    //
    // Not `required` at the schema level so batches imported before this field
    // existed still load; the import route enforces it for anything new.
    reference_number: {
        type: String,
        trim: true,
        default: "",
    },
    // Set when the reference is corrected after import via PATCH
    // /batch-reference, rather than at import time.
    reference_updated_by: { type: String, trim: true },
    reference_updated_at: { type: Date },

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

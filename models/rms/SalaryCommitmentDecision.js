import mongoose from "mongoose";
const Schema = mongoose.Schema;

// A single user's commitment decision for a given fiscal year, recorded
// BEFORE the admin imports the salary increment workbook.
//
// Users may flip their decision (Approve <-> Reject) any number of times
// while the SalaryCommitmentPeriod for the same fiscal year is open. Every
// flip is appended to `decision_history` for audit. Once the period ends,
// the current `decision` field is what HR uses to prepare the import.
//
// Admins later use this collection (via /decisions/export) to know whose
// rows to include in the upload — and the import pipeline reads the
// `decision` field to override `bonus_months` to 0 for Rejected users.

const decisionHistoryEntrySchema = new Schema(
    {
        decision: {
            type: String,
            enum: ["Approved", "Rejected"],
            required: true,
        },
        at: {
            type: Date,
            required: true,
            default: Date.now,
        },
        user_agent: { type: String, trim: true },
        ip: { type: String, trim: true },
        // Which revision of the agreement text was on screen when this
        // decision was made. The legal team revises the wording between
        // years, so "they accepted" is only meaningful alongside "accepted
        // what" — see the Agreement Version line the document itself asks to
        // be auto-tagged into the acceptance record.
        agreement_version: { type: String, trim: true },
    },
    { _id: false }
);

const salaryCommitmentDecisionSchema = new Schema({
    fiscal_year: {
        type: Number,
        required: true,
    },
    domain_user: {
        type: String,
        required: true,
        trim: true,
    },

    // Latest (current) decision. Always equal to the most recent entry in
    // decision_history.
    decision: {
        type: String,
        enum: ["Approved", "Rejected"],
        required: true,
    },
    decided_at: {
        type: Date,
        required: true,
        default: Date.now,
    },
    decision_history: {
        type: [decisionHistoryEntrySchema],
        default: [],
    },

    // audit on the latest flip
    user_agent: { type: String, trim: true },
    ip: { type: String, trim: true },
    agreement_version: { type: String, trim: true },
    // The employee ticked "I have read and understood" before the decision
    // was accepted. Stored because the agreement's own Acknowledgment clause
    // turns on the employee having read it, so it is worth being able to
    // evidence that the confirmation was given rather than inferred.
    agreement_read_confirmed: { type: Boolean, default: false },
});

salaryCommitmentDecisionSchema.index(
    { fiscal_year: 1, domain_user: 1 },
    { unique: true }
);

const SalaryCommitmentDecision = mongoose.model(
    "SalaryCommitmentDecision",
    salaryCommitmentDecisionSchema
);
export default SalaryCommitmentDecision;

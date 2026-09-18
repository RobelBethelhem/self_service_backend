import mongoose from "mongoose";
const Schema = mongoose.Schema;

// An inter-departmental memo HR sends about a departure, in the bank's memo
// format: Date / To / From / Subject, a body, "Regards", a CC list.
//
// Two kinds, mirroring the two paper memos HR issues today:
//   resignation  — "Resignation of Ato X": tells every concerned work unit to
//                  take clearance action;
//   outstanding  — "Outstanding Loan commitments": tells Finance, Credit and
//                  the branches what the employee is owed and owes, with the
//                  List of Benefits embedded.
//
// The body is generated from the clearance so every memo reads the same;
// To / From / CC are HR's to choose — from the registered work units or
// typed — and can be saved as a preset for next time. Recipients (the heads
// of the chosen units) see the memo in their inbox and can print or download
// it; the memo itself is a snapshot, so what was sent is what is kept.

const addresseeSchema = new Schema(
    {
        unit_id: { type: Schema.Types.ObjectId, ref: "ClearanceUnit" },
        label: { type: String, required: true, trim: true },
    },
    { _id: false }
);

const memoBenefitRowSchema = new Schema(
    {
        label: { type: String, required: true, trim: true },
        value: { type: String, trim: true, default: "" },
    },
    { _id: false }
);

const clearanceMemoSchema = new Schema(
    {
        clearance_id: { type: Schema.Types.ObjectId, ref: "Clearance", required: true, index: true },
        domain_user: { type: String, trim: true, lowercase: true, index: true },
        employee_name: { type: String, trim: true, default: "" },

        kind: { type: String, enum: ["resignation", "outstanding"], required: true },
        memo_date: { type: Date, required: true },
        to: { type: [addresseeSchema], default: [] },
        from_line: { type: String, trim: true, default: "" },
        subject: { type: String, trim: true, required: true },
        cc: { type: [addresseeSchema], default: [] },
        // Paragraphs as runs [[{ t, b }], ...] — the same run model the letters use.
        body_runs: { type: Schema.Types.Mixed, default: [] },
        // The List of Benefits as it read when the memo was sent (outstanding only).
        benefits_rows: { type: [memoBenefitRowSchema], default: [] },

        status: { type: String, enum: ["draft", "sent"], default: "draft", index: true },
        // Portal users who receive it: the heads (and delegated signers) of the
        // units in To and CC, resolved at send time.
        recipients: { type: [String], default: [], index: true },

        created_by: { type: String, trim: true, lowercase: true },
        updated_by: { type: String, trim: true, lowercase: true },
        sent_by: { type: String, trim: true, lowercase: true },
        sent_at: { type: Date },
    },
    { timestamps: true }
);

const ClearanceMemo = mongoose.model("ClearanceMemo", clearanceMemoSchema);
export default ClearanceMemo;

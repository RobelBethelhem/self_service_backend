import mongoose from "mongoose";
const Schema = mongoose.Schema;

// One employee's exit clearance, from the moment a departure is recorded to
// the moment the President/CEO's line is signed.
//
// Two phases live in one document:
//
//   1. Approval of the departure itself. An employee-initiated resignation
//      goes to the Immediate Supervisor, then to HR; either may reject with a
//      reason, and the employee may amend and resubmit. HR-initiated
//      departures (dismissal, retirement, contract end…) skip straight to
//      Approved — HR is the authority there.
//
//   2. The clearance form. Opens on the release date (immediately, if the
//      release is immediate). Rows are snapshotted from the active template,
//      signed in parallel unless the template says otherwise, and the final
//      row — the CEO's — completes it.
//
// Tasks are embedded rather than a separate collection so that a row's
// outcome and the overall status change in one atomic write.

export const CLEARANCE_STATUSES = [
    "Pending Supervisor",
    "Pending HR",
    "Rejected",
    "Approved", // departure approved, waiting for the release date
    "Open", // form open, rows being signed
    "Awaiting Final Approval", // every non-final row done; CEO line pending
    "Cleared",
    "Cancelled",
];

export const TERMINATION_TYPES = [
    "Resignation",
    "Termination",
    "Retirement",
    "Contract End",
    "Death",
    "Other",
];

export const TASK_STATUSES = ["Waiting", "Pending", "Cleared", "Outstanding", "Not Applicable"];
export const ITEM_OUTCOMES = ["Pending", "Fulfilled", "Not Applicable", "Outstanding"];

const decisionSchema = new Schema(
    {
        stage: { type: String, enum: ["supervisor", "hr"] },
        decision: { type: String, enum: ["approve", "reject"] },
        by: { type: String, trim: true, lowercase: true },
        by_name: { type: String, trim: true },
        at: { type: Date },
        reason: { type: String, trim: true, default: "" },
        // Set when HR acted at the supervisor stage because none was mapped
        // or the supervisor was unavailable.
        on_behalf: { type: Boolean, default: false },
    },
    { _id: false }
);

const taskItemSchema = new Schema(
    {
        code: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        outcome: { type: String, enum: ITEM_OUTCOMES, default: "Pending" },
        note: { type: String, trim: true, default: "" },
        // Amount still owed, where it makes sense (loans, advances).
        amount: { type: Number },
    },
    { _id: false }
);

const taskHistorySchema = new Schema(
    {
        at: { type: Date, default: Date.now },
        by: { type: String, trim: true, lowercase: true },
        action: { type: String, trim: true },
        from: { type: String, trim: true },
        to: { type: String, trim: true },
        note: { type: String, trim: true, default: "" },
    },
    { _id: false }
);

const taskSchema = new Schema(
    {
        code: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        order: { type: Number, default: 0 },
        is_final: { type: Boolean, default: false },

        // Snapshot of the template's rule, plus any HR reassignment. Signers
        // are resolved LIVE against this rule at every request, never trusted
        // from a stored list — an expired head appointment must stop working
        // the moment it expires.
        signer_rule: {
            mode: { type: String, enum: ["supervisor", "unit_head", "users", "ceo"], required: true },
            unit_id: { type: Schema.Types.ObjectId, ref: "ClearanceUnit" },
            users: { type: [String], default: [] },
        },
        // Informational only: who the rule resolved to the last time this
        // task was read. Shown on screen and on the printed form.
        signers_snapshot: { type: [String], default: [] },

        signature_mode: { type: String, enum: ["electronic", "manual"], default: "electronic" },
        depends_on: { type: [String], default: [] },

        status: { type: String, enum: TASK_STATUSES, default: "Waiting" },
        // True when the template's applies_to rules marked this row N/A
        // automatically, so the printout can say so.
        auto: { type: Boolean, default: false },

        items: { type: [taskItemSchema], default: [] },
        note: { type: String, trim: true, default: "" },

        acted_by: { type: String, trim: true, lowercase: true },
        acted_by_name: { type: String, trim: true },
        acted_at: { type: Date },
        acted_ip: { type: String, trim: true },
        acted_user_agent: { type: String, trim: true },

        // For signature_mode "manual": the wet signature HR verified.
        manual: {
            signed_by_name: { type: String, trim: true },
            signed_on: { type: Date },
            verified_by: { type: String, trim: true, lowercase: true },
            verified_at: { type: Date },
        },

        notified_at: { type: Date },
        last_reminded_at: { type: Date },
        reminder_count: { type: Number, default: 0 },
        escalated_at: { type: Date },

        history: { type: [taskHistorySchema], default: [] },
    },
    { _id: false }
);

const clearanceSchema = new Schema(
    {
        // ---- employee snapshot (HRIS first, Mongo User as fallback) ----
        domain_user: { type: String, required: true, trim: true, lowercase: true, index: true },
        employee_name: { type: String, trim: true, default: "" },
        first_name: { type: String, trim: true, default: "" },
        employee_id: { type: String, trim: true, default: "" },
        job_title: { type: String, trim: true, default: "" },
        department: { type: String, trim: true, default: "" },
        date_of_employment: { type: Date },
        // Fields HRIS could not supply and which were entered by hand. The
        // approver sees them flagged, as with Medical's place of assignment.
        hris_gaps: { type: [String], default: [] },

        // The employee's clearance unit, if they are registered in one.
        unit_id: { type: Schema.Types.ObjectId, ref: "ClearanceUnit" },
        unit_kind: { type: String, enum: ["branch", "department", ""], default: "" },
        unit_name: { type: String, trim: true, default: "" },

        // ---- the departure ----
        initiated_by: { type: String, enum: ["employee", "hr"], required: true },
        termination_type: { type: String, enum: TERMINATION_TYPES, required: true },
        release_date: { type: Date, required: true },
        immediate: { type: Boolean, default: false },
        reason: { type: String, trim: true, default: "" },
        additional_statement: { type: String, trim: true, default: "" },
        // The formatted resignation letter as it read when submitted.
        resignation_letter: { type: String, default: "" },

        // ---- approval chain ----
        status: { type: String, enum: CLEARANCE_STATUSES, required: true, index: true },
        supervisor_user: { type: String, trim: true, lowercase: true, default: "" },
        supervisor_unresolved: { type: Boolean, default: false },
        supervisor_decision: { type: decisionSchema },
        hr_decision: { type: decisionSchema },
        decision_history: { type: [decisionSchema], default: [] },
        submitted_at: { type: Date },
        approved_at: { type: Date },

        // ---- the form ----
        template_id: { type: Schema.Types.ObjectId, ref: "ClearanceTemplate" },
        template_version: { type: Number },
        opened_at: { type: Date },
        tasks: { type: [taskSchema], default: [] },

        // ---- completion ----
        certificate_number: { type: String, trim: true },
        cleared_at: { type: Date },
        cleared_by: { type: String, trim: true, lowercase: true },

        cancelled: {
            by: { type: String, trim: true, lowercase: true },
            at: { type: Date },
            reason: { type: String, trim: true },
        },

        created_by: { type: String, trim: true, lowercase: true },
    },
    { timestamps: true }
);

clearanceSchema.index({ status: 1, release_date: 1 });
clearanceSchema.index({ domain_user: 1, createdAt: -1 });
clearanceSchema.index({ "tasks.status": 1 });

const Clearance = mongoose.model("Clearance", clearanceSchema);
export default Clearance;

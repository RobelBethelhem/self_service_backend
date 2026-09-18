import mongoose from "mongoose";
const Schema = mongoose.Schema;

// One employee's exit clearance, from the moment a departure is recorded to
// the moment the President/CEO's line is signed.
//
// Three phases live in one document:
//
//   1. Approval of the departure itself. An employee-initiated resignation
//      goes to the Immediate Supervisor, then to HR; either may reject with a
//      reason, and the employee may amend and resubmit. HR-initiated
//      departures (dismissal, retirement, contract end…) skip straight to
//      Approved — HR is the authority there.
//
//   2. HR opens the signatories. Approval alone opens nothing: an approved
//      departure waits until HR explicitly opens the form, and until then the
//      employee may still withdraw. Opening snapshots the rows from the active
//      template and the benefits statement from settings.
//
//   3. The clearance form. Rows are signed in parallel unless the template
//      says otherwise; the branch and HR complete the benefits statement and
//      issue it to the signatories; the final row — the CEO's — completes it.
//
// Tasks are embedded rather than a separate collection so that a row's
// outcome and the overall status change in one atomic write.

export const CLEARANCE_STATUSES = [
    "Pending Supervisor",
    "Pending HR",
    "Rejected",
    "Approved", // departure approved, waiting for HR to open the signatories
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
        // Set when a delegate decided in the supervisor's place.
        acting_for: { type: String, trim: true, lowercase: true, default: "" },
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
        // the moment it expires, and a delegation must start the moment it
        // begins.
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
        // The signatory a delegate signed for, when that is what happened.
        acted_for: { type: String, trim: true, lowercase: true, default: "" },
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

// One line of the benefits statement, as snapshotted when the form opened.
const benefitRowSchema = new Schema(
    {
        code: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        filled_by: { type: String, enum: ["system", "branch", "hr"], default: "hr" },
        system_source: { type: String, default: "" },
        value: { type: String, trim: true, default: "" },
        filled_by_user: { type: String, trim: true, lowercase: true, default: "" },
        filled_at: { type: Date },
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
        // "M" / "F" from HRIS, or "" — drives Ato / W/ro and his / her on the
        // memos HR sends about the departure.
        gender: { type: String, enum: ["M", "F", ""], default: "" },

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
        // The formatted resignation letter as it read when submitted: the
        // plain text for the record, and its parts for rendering as a letter.
        resignation_letter: { type: String, default: "" },
        resignation_letter_parts: { type: Schema.Types.Mixed },

        // ---- approval chain ----
        status: { type: String, enum: CLEARANCE_STATUSES, required: true, index: true },
        supervisor_user: { type: String, trim: true, lowercase: true, default: "" },
        supervisor_unresolved: { type: Boolean, default: false },
        supervisor_decision: { type: decisionSchema },
        hr_decision: { type: decisionSchema },
        decision_history: { type: [decisionSchema], default: [] },
        submitted_at: { type: Date },
        approved_at: { type: Date },
        // Sent once, when an approved departure's release date arrives and
        // HR has not yet opened the signatories.
        release_reminder_sent_at: { type: Date },

        // ---- the form ----
        template_id: { type: Schema.Types.ObjectId, ref: "ClearanceTemplate" },
        template_version: { type: Number },
        opened_at: { type: Date },
        opened_by: { type: String, trim: true, lowercase: true },
        tasks: { type: [taskSchema], default: [] },

        // ---- the benefits statement ----
        benefits: {
            rows: { type: [benefitRowSchema], default: [] },
            branch_unit_id: { type: Schema.Types.ObjectId, ref: "ClearanceUnit" },
            branch_unit_code: { type: String, trim: true, default: "" },
            branch_unit_name: { type: String, trim: true, default: "" },
            branch_submitted_by: { type: String, trim: true, lowercase: true },
            branch_submitted_at: { type: Date },
            hr_submitted_by: { type: String, trim: true, lowercase: true },
            hr_submitted_at: { type: Date },
            issued: { type: Boolean, default: false },
            issued_by: { type: String, trim: true, lowercase: true },
            issued_at: { type: Date },
        },

        // ---- completion ----
        certificate_number: { type: String, trim: true },
        // What followed the last signature: the HRIS write, the guaranty
        // revocations and the generated experience letter, each with its
        // outcome. Free-form because each step reports different details.
        completion: { type: Schema.Types.Mixed },
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

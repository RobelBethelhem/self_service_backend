import mongoose from "mongoose";
const Schema = mongoose.Schema;

// The shape of the exit clearance form: which rows it has, who signs each,
// which sub-items each row carries, and when a row applies.
//
// Templates are versioned and a clearance snapshots its rows from the active
// version when it opens. HR can therefore reorganise the form freely —
// rename a department, add a row, change who signs — without any in-flight
// clearance changing underneath the people who are already signing it.
//
// Exactly one row may be `is_final` (the President/CEO line). It implicitly
// depends on every other row and is what flips the clearance to Cleared.

const templateItemSchema = new Schema(
    {
        code: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
    },
    { _id: false }
);

const signerRuleSchema = new Schema(
    {
        // supervisor : the employee's own Immediate Supervisor (resolved per employee)
        // unit_head  : the head of `unit_id`, plus members it delegated signing to
        // users      : an explicit list of AD usernames
        // ceo        : the President/CEO or their active delegate (from settings)
        mode: {
            type: String,
            enum: ["supervisor", "unit_head", "users", "ceo"],
            required: true,
        },
        unit_id: { type: Schema.Types.ObjectId, ref: "ClearanceUnit" },
        users: { type: [String], default: [] },
    },
    { _id: false }
);

const appliesToSchema = new Schema(
    {
        // Empty arrays mean "applies to everyone".
        unit_kinds: { type: [String], default: [] }, // 'branch' | 'department'
        termination_types: { type: [String], default: [] },
        unit_ids: { type: [Schema.Types.ObjectId], default: [] },
    },
    { _id: false }
);

const templateRowSchema = new Schema(
    {
        code: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        order: { type: Number, default: 0 },
        items: { type: [templateItemSchema], default: [] },
        signer: { type: signerRuleSchema, required: true },
        // electronic : the signer clicks in the system (identity + time + IP recorded)
        // manual     : signed by hand on the printed form; HR records the verification
        signature_mode: { type: String, enum: ["electronic", "manual"], default: "electronic" },
        applies_to: { type: appliesToSchema, default: () => ({}) },
        // Codes of rows that must be Cleared / N/A before this one is opened
        // and its signers notified. Empty = opens immediately (parallel).
        depends_on: { type: [String], default: [] },
        is_final: { type: Boolean, default: false },
    },
    { _id: false }
);

const clearanceTemplateSchema = new Schema(
    {
        version: { type: Number, required: true, unique: true },
        name: { type: String, trim: true, default: "Exit Clearance" },
        active: { type: Boolean, default: false },
        rows: { type: [templateRowSchema], default: [] },
        created_by: { type: String, trim: true },
    },
    { timestamps: true }
);

clearanceTemplateSchema.index({ active: 1 });

const ClearanceTemplate = mongoose.model("ClearanceTemplate", clearanceTemplateSchema);
export default ClearanceTemplate;

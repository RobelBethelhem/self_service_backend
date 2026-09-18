import mongoose from "mongoose";
const Schema = mongoose.Schema;

// One person's place inside a ClearanceUnit, registered by that unit's head
// (or by HR).
//
// Two things are derived from this:
//   - the employee's Immediate Supervisor: `reports_to` if set, otherwise the
//     unit's head;
//   - who may sign the unit's row on a clearance form: the head, plus any
//     member with `can_sign_clearance` — which is how a Director delegates
//     signing to a Manager without HR being involved.
//
// Validity windows work the same way as head appointments: outside the window
// the membership is ignored by every lookup, and nothing is deleted.
const clearanceUnitMemberSchema = new Schema(
    {
        unit_id: { type: Schema.Types.ObjectId, ref: "ClearanceUnit", required: true, index: true },
        domain_user: { type: String, required: true, trim: true, lowercase: true, index: true },

        role_in_unit: { type: String, enum: ["deputy", "manager", "staff"], default: "staff" },
        // AD username of this person's own supervisor inside the unit. Empty
        // means the unit head.
        reports_to: { type: String, trim: true, lowercase: true, default: "" },
        can_sign_clearance: { type: Boolean, default: false },

        valid_from: { type: Date },
        valid_to: { type: Date },
        active: { type: Boolean, default: true },

        registered_by: { type: String, trim: true },
        updated_by: { type: String, trim: true },
    },
    { timestamps: true }
);

clearanceUnitMemberSchema.index({ unit_id: 1, domain_user: 1 }, { unique: true });

const ClearanceUnitMember = mongoose.model("ClearanceUnitMember", clearanceUnitMemberSchema);
export default ClearanceUnitMember;

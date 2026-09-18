import mongoose from "mongoose";
const Schema = mongoose.Schema;

// One person's position in the reporting tree: the unit they belong to, who
// they report to, and the role they hold — registered by a manager above them
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

        // A role label from ClearanceSettings.roles ("Director", "District
        // Manager", "Branch Manager", "Staff"…). Whether it may register people
        // beneath it is decided by the settings entry, not here.
        role_in_unit: { type: String, trim: true, default: "Staff" },
        // AD username of this person's manager — anywhere in the bank, not
        // necessarily in the same unit (a branch manager reports to a district
        // manager who sits in the Branch Management department). Empty means
        // the unit's head.
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
clearanceUnitMemberSchema.index({ reports_to: 1, active: 1 });

const ClearanceUnitMember = mongoose.model("ClearanceUnitMember", clearanceUnitMemberSchema);
export default ClearanceUnitMember;

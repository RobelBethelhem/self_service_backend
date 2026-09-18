import mongoose from "mongoose";
const Schema = mongoose.Schema;

// An organisational unit for the exit-clearance module: a branch or a head-
// office department, and the one person who heads it.
//
// This exists because HRIS holds no reporting line at all — position, grade
// and department, but never "who does this person report to". The clearance
// form needs that twice: the Immediate Supervisor row is *this employee's*
// manager, and every departmental row is signed by *that department's* head
// (or someone the head has delegated to). So the hierarchy is kept here and
// maintained by delegation: HR appoints the head of each unit, and the head
// registers the people beneath them (see ClearanceUnitMember).
//
// Head appointments carry a validity window. Outside it the head can neither
// sign clearance rows nor manage members — an expired appointment is not an
// error, it is how a hand-over is expressed without deleting history.
const clearanceUnitSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        // Short unique code — a branch code for branches ("BR-042"), an
        // abbreviation for departments ("CPM").
        code: { type: String, required: true, trim: true, uppercase: true, unique: true },
        kind: { type: String, enum: ["branch", "department"], required: true },

        // Director (department) or Branch Manager (branch). AD username.
        head_user: { type: String, trim: true, lowercase: true, default: "" },
        head_valid_from: { type: Date },
        head_valid_to: { type: Date },
        // Who the head reports to — the supervisor for a head's own clearance.
        // Optional; HR acts when empty.
        head_reports_to: { type: String, trim: true, lowercase: true, default: "" },

        active: { type: Boolean, default: true },

        created_by: { type: String, trim: true },
        updated_by: { type: String, trim: true },
    },
    { timestamps: true }
);

clearanceUnitSchema.index({ kind: 1, active: 1 });
clearanceUnitSchema.index({ head_user: 1 });

const ClearanceUnit = mongoose.model("ClearanceUnit", clearanceUnitSchema);
export default ClearanceUnit;

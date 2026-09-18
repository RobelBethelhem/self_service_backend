import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Kept here rather than imported from the service, which imports this model.
export const DEFAULT_ROLES = [
    { label: "Director", manages: true, unit_head_for: "department" },
    { label: "District Manager", manages: true, unit_head_for: "" },
    { label: "Division Manager", manages: true, unit_head_for: "" },
    { label: "Branch Manager", manages: true, unit_head_for: "branch" },
    { label: "Deputy Manager", manages: true, unit_head_for: "" },
    { label: "Manager", manages: true, unit_head_for: "" },
    { label: "Head", manages: true, unit_head_for: "" },
    { label: "Staff", manages: false, unit_head_for: "" },
];

// The "List of Benefits" statement, as HR's paper version has it. Two dates
// come from the record; the loan and provident rows are the branch's to fill
// (the employee's own branch, or the service branch for head-office staff);
// the rest are HR's. Who fills what is HR's to change.
export const DEFAULT_BENEFITS_ROWS = [
    { code: "date_of_employment", label: "Date of Employment", filled_by: "system", system_source: "date_of_employment" },
    { code: "date_of_resignation", label: "Date of Resignation", filled_by: "system", system_source: "release_date" },
    { code: "accrued_leave", label: "Accrued Annual Leave as of resignation date", filled_by: "hr", system_source: "" },
    { code: "severance", label: "Severance Payment", filled_by: "hr", system_source: "" },
    { code: "provident_fund", label: "Provident Fund", filled_by: "branch", system_source: "" },
    { code: "emergency_loan", label: "Emergency Staff Loan", filled_by: "branch", system_source: "" },
    { code: "personal_loan", label: "Personal Staff Loan", filled_by: "branch", system_source: "" },
    { code: "automobile_loan", label: "Automobile Loan", filled_by: "branch", system_source: "" },
    { code: "housing_loan", label: "Housing Loan", filled_by: "branch", system_source: "" },
    { code: "business_car_loan", label: "Business Car Loan", filled_by: "branch", system_source: "" },
    { code: "training_commitment", label: "Training Commitment", filled_by: "hr", system_source: "" },
    { code: "bonus_commitment", label: "Bonus Commitment", filled_by: "hr", system_source: "" },
    { code: "share_commitment", label: "Share Commitment", filled_by: "hr", system_source: "" },
    { code: "notice_deduction", label: "Notice Period Deduction", filled_by: "hr", system_source: "" },
];

// luTerminationReason codes in use, by departure type. "Other" writes none.
export const DEFAULT_REASON_CODES = {
    Resignation: 7,
    Retirement: 1016,
    "Contract End": 1015,
    Termination: 1019,
    Death: 1021,
    Other: null,
};

// The branch that holds the accounts of head-office staff, so their loan and
// provident rows have a branch manager to fill them. Looked up by code once,
// when no branch has been chosen yet.
export const DEFAULT_SERVICE_BRANCH_CODE = "164";

const benefitsRowSchema = new Schema(
    {
        code: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        filled_by: { type: String, enum: ["system", "branch", "hr"], default: "hr" },
        system_source: { type: String, enum: ["", "date_of_employment", "release_date"], default: "" },
    },
    { _id: false }
);

// Module-wide settings for exit clearance. A single document, keyed "default".
//
// The CEO delegate window is how "the President is away" is expressed: while
// today falls inside it, the delegate may sign the final row exactly as the
// CEO would, and the form records who actually signed.
const clearanceSettingsSchema = new Schema(
    {
        key: { type: String, default: "default", unique: true },

        ceo_user: { type: String, trim: true, lowercase: true, default: "" },
        ceo_delegate_user: { type: String, trim: true, lowercase: true, default: "" },
        ceo_delegate_from: { type: Date },
        ceo_delegate_to: { type: Date },

        // Reminder cadence. A row is "due" sla_days after its signers were
        // notified; reminders repeat every remind_every_days after that; after
        // escalate_after_days HR is told the row is stuck.
        sla_days: { type: Number, default: 3 },
        remind_every_days: { type: Number, default: 1 },
        escalate_after_days: { type: Number, default: 5 },

        // The roles a person may hold in the reporting tree. `manages` lets a
        // holder register people beneath themselves; `unit_head_for` marks the
        // role that heads a department ("Director") or a branch ("Branch
        // Manager"), so appointing one keeps the unit's head in step.
        roles: {
            type: [
                new Schema(
                    {
                        label: { type: String, required: true, trim: true },
                        manages: { type: Boolean, default: false },
                        unit_head_for: { type: String, enum: ["", "department", "branch"], default: "" },
                    },
                    { _id: false }
                ),
            ],
            default: () => DEFAULT_ROLES.map((r) => ({ ...r })),
        },

        // The benefits statement's rows and who fills each.
        benefits_rows: {
            type: [benefitsRowSchema],
            default: () => DEFAULT_BENEFITS_ROWS.map((r) => ({ ...r })),
        },
        // Branch whose manager fills the branch rows for head-office employees.
        service_branch_id: { type: Schema.Types.ObjectId, ref: "ClearanceUnit" },

        // What runs when a clearance is Cleared, and which luTerminationReason
        // code each departure type writes to HRIS.
        completion: {
            hris_write: { type: Boolean, default: true },
            hris_disable_login: { type: Boolean, default: true },
            revoke_guaranties: { type: Boolean, default: true },
            experience_letter: { type: Boolean, default: true },
            reason_codes: { type: Schema.Types.Mixed, default: () => ({ ...DEFAULT_REASON_CODES }) },
        },

        updated_by: { type: String, trim: true },
    },
    { timestamps: true }
);

clearanceSettingsSchema.statics.get = async function () {
    let doc = await this.findOne({ key: "default" });
    if (!doc) doc = await this.create({ key: "default" });
    let dirty = false;
    // A settings document from before these fields existed gets the defaults.
    if (!doc.roles || !doc.roles.length) {
        doc.roles = DEFAULT_ROLES.map((r) => ({ ...r }));
        dirty = true;
    }
    if (!doc.benefits_rows || !doc.benefits_rows.length) {
        doc.benefits_rows = DEFAULT_BENEFITS_ROWS.map((r) => ({ ...r }));
        dirty = true;
    }
    if (!doc.completion || doc.completion.hris_write === undefined) {
        doc.completion = {
            hris_write: true,
            hris_disable_login: true,
            revoke_guaranties: true,
            experience_letter: true,
            reason_codes: { ...DEFAULT_REASON_CODES },
        };
        dirty = true;
    }
    if (!doc.service_branch_id && mongoose.models.ClearanceUnit) {
        const branch = await mongoose.models.ClearanceUnit.findOne({
            kind: "branch",
            active: true,
            code: { $regex: `^0*${DEFAULT_SERVICE_BRANCH_CODE}$` },
        }).lean();
        if (branch) {
            doc.service_branch_id = branch._id;
            dirty = true;
        }
    }
    if (dirty) await doc.save();
    return doc;
};

const ClearanceSettings = mongoose.model("ClearanceSettings", clearanceSettingsSchema);
export default ClearanceSettings;

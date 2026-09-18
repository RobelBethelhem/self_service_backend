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

        updated_by: { type: String, trim: true },
    },
    { timestamps: true }
);

clearanceSettingsSchema.statics.get = async function () {
    let doc = await this.findOne({ key: "default" });
    if (!doc) doc = await this.create({ key: "default" });
    // A settings document from before roles existed gets the defaults.
    if (!doc.roles || !doc.roles.length) {
        doc.roles = DEFAULT_ROLES.map((r) => ({ ...r }));
        await doc.save();
    }
    return doc;
};

const ClearanceSettings = mongoose.model("ClearanceSettings", clearanceSettingsSchema);
export default ClearanceSettings;

import mongoose from "mongoose";
const Schema = mongoose.Schema;

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

        updated_by: { type: String, trim: true },
    },
    { timestamps: true }
);

clearanceSettingsSchema.statics.get = async function () {
    let doc = await this.findOne({ key: "default" });
    if (!doc) doc = await this.create({ key: "default" });
    return doc;
};

const ClearanceSettings = mongoose.model("ClearanceSettings", clearanceSettingsSchema);
export default ClearanceSettings;

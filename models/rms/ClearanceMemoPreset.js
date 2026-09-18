import mongoose from "mongoose";
const Schema = mongoose.Schema;

// A saved To / From / CC for a memo kind, so HR does not rebuild the same
// distribution list for every departure. Loading a preset only pre-fills the
// composer; every line stays editable before sending. One preset per kind may
// be the default, which is what the composer starts from.
const addresseeSchema = new Schema(
    {
        unit_id: { type: Schema.Types.ObjectId, ref: "ClearanceUnit" },
        label: { type: String, required: true, trim: true },
    },
    { _id: false }
);

const clearanceMemoPresetSchema = new Schema(
    {
        kind: { type: String, enum: ["resignation", "outstanding"], required: true },
        name: { type: String, required: true, trim: true },
        to: { type: [addresseeSchema], default: [] },
        from_line: { type: String, trim: true, default: "" },
        cc: { type: [addresseeSchema], default: [] },
        is_default: { type: Boolean, default: false },
        created_by: { type: String, trim: true, lowercase: true },
        updated_by: { type: String, trim: true, lowercase: true },
    },
    { timestamps: true }
);

clearanceMemoPresetSchema.index({ kind: 1, name: 1 }, { unique: true });

const ClearanceMemoPreset = mongoose.model("ClearanceMemoPreset", clearanceMemoPresetSchema);
export default ClearanceMemoPreset;

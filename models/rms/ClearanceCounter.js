import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Per-year counter for cleared exit-clearance certificates.
// Format: ZB/HC/CLR/<5-digit count>/<4-digit year>
//   ZB/HC/CLR/00001/2026
//
// Assigned once, at the moment the final row is signed and the clearance
// becomes Cleared. Nothing earlier in the process carries a number — a
// clearance that is still being signed is not yet a document anyone can
// present.
const clearanceCounterSchema = new Schema({
    year: { type: Number, required: true, unique: true },
    count: { type: Number, default: 0 },
});

clearanceCounterSchema.statics.getNextReference = async function (year) {
    const result = await this.findOneAndUpdate(
        { year },
        { $inc: { count: 1 }, $setOnInsert: { year } },
        { new: true, upsert: true, runValidators: true }
    );
    const padded = result.count.toString().padStart(5, "0");
    return `ZB/HC/CLR/${padded}/${year}`;
};

const ClearanceCounter = mongoose.model("ClearanceCounter", clearanceCounterSchema);
export default ClearanceCounter;

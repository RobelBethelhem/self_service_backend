import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Per-fiscal-year counter for salary increment letter reference numbers.
// Format: ZB/HC/INC/<5-digit count>/<4-digit fiscal year>
//   ZB/HC/INC/00001/2026
//   ZB/HC/INC/00002/2026
//   ZB/HC/INC/00001/2027   ← counter resets when fiscal year changes
//
// The reference is assigned lazily on the FIRST print of a letter (by either
// the owner via /mark-printed or the admin via /admin-prepare-print) and
// reused for every subsequent print of that letter.
const SalaryIncrementCounterSchema = new Schema({
    year: {
        type: Number,
        required: true,
        unique: true,
    },
    count: {
        type: Number,
        default: 0,
    },
});

SalaryIncrementCounterSchema.statics.getNextReference = async function (fiscalYear) {
    const result = await this.findOneAndUpdate(
        { year: fiscalYear },
        {
            $inc: { count: 1 },
            $setOnInsert: { year: fiscalYear },
        },
        {
            new: true,
            upsert: true,
            runValidators: true,
        }
    );

    const paddedCount = result.count.toString().padStart(5, "0");
    return `ZB/HC/INC/${paddedCount}/${fiscalYear}`;
};

const SalaryIncrementCounter = mongoose.model(
    "SalaryIncrementCounter",
    SalaryIncrementCounterSchema
);
export default SalaryIncrementCounter;

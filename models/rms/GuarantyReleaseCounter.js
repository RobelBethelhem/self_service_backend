import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Per-year counter for guaranty release notices: ZB/HC/GRN/00001/26.
const GuarantyReleaseCounterSchema = new Schema({
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

GuarantyReleaseCounterSchema.statics.getNextReference = async function () {
    const currentYear = new Date().getFullYear();
    const twoDigitYear = currentYear % 100;

    const result = await this.findOneAndUpdate(
        { year: currentYear },
        {
            $inc: { count: 1 },
            $setOnInsert: { year: currentYear },
        },
        {
            new: true,
            upsert: true,
            runValidators: true,
        }
    );

    const paddedCount = result.count.toString().padStart(5, "0");
    return `ZB/HC/GRN/${paddedCount}/${twoDigitYear}`;
};

const GuarantyReleaseCounter = mongoose.model("GuarantyReleaseCounter", GuarantyReleaseCounterSchema);
export default GuarantyReleaseCounter;

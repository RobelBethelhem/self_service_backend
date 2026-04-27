import mongoose from "mongoose";
const Schema = mongoose.Schema;

const EmbassyCounterSchema = new Schema({
    year: {
        type: Number,
        required: true,
        unique: true
    },
    count: {
        type: Number,
        default: 0
    }
});

// Add a static method for generating reference numbers
EmbassyCounterSchema.statics.getNextReference = async function() {
    const currentYear = new Date().getFullYear();
    const twoDigitYear = currentYear % 100; // Gets last 2 digits of year

    const result = await this.findOneAndUpdate(
        { year: currentYear },
        {
            $inc: { count: 1 },
            $setOnInsert: { year: currentYear }
        },
        {
            new: true,
            upsert: true,
            runValidators: true
        }
    );

    // Format: ZB/HC/EMB/00001/23
    const paddedCount = result.count.toString().padStart(5, '0');
    return `ZB/HC/EMB/${paddedCount}/${twoDigitYear}`;
};

const EmbassyCounter = mongoose.model('EmbassyCounter', EmbassyCounterSchema);
export default EmbassyCounter;
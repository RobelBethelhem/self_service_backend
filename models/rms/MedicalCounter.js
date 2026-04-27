import mongoose from "mongoose";
const Schema = mongoose.Schema;

const MedicalCounterSchema = new Schema({
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
MedicalCounterSchema.statics.getNextReference = async function(varIs_Spouse) {
    const currentYear = new Date().getFullYear();
    const twoDigitYear = currentYear % 100; // Gets last 2 digits of year
    const medIdentifier = varIs_Spouse ? 'SP' : 'CH';

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

    // Format: ZB/HC/MED/00001/23
    const paddedCount = result.count.toString().padStart(5, '0');
    return `ZB/HC/MED/${medIdentifier}/${paddedCount}/${twoDigitYear}`;
};

const MedicalCounter = mongoose.model('MedicalCounter', MedicalCounterSchema);
export default MedicalCounter;
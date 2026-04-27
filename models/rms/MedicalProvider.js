import mongoose from "mongoose";

const Schema = mongoose.Schema;

const medicalProviderSchema = new Schema({
    short_code: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true
    },
    medical_institution: {
        type: String,
        required: true,
        trim: true
    },
    location: {
        type: String,
        required: true,
        trim: true
    },
    telephone_no: {
        type: String,
        required: true,
        trim: true
    },
    TimeStamp: {
        type: Date,
        default: Date.now
    }
});

const MedicalProvider = mongoose.model('MedicalProvider', medicalProviderSchema);
export default MedicalProvider;
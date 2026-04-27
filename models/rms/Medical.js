import mongoose from "mongoose";
const Schema = mongoose.Schema;

const medicalSchema = new Schema({
    is_Spouse: { 
        type: Boolean,  // Use Boolean, not boolean from joi
        required: true,
        default: false
    },

    medical_place: {
        type: String,   
        required: true,
        trim: true,
    },
    spouse_first_name: { 
        type: String,
        required: false,
        trim: true,
    },
    spouse_middle_name: { 
        type: String,
        required: false,
        trim: true,
    },
    spouse_last_name: { 
        type: String,
        required: false,
        trim: true,
    },

    child_first_name: { 
        type: String,
        required: false,
        trim: true,
    },
    chid_middle_name: { 
        type: String,
        required: false,
        trim: true,
    },
    child_last_name: { 
        type: String,
        required: false,
        trim: true,
    },

    employee_description: { 
        type: String,
        trim: true,
    },

    employee_id_no: { 
        type: String,
        required: true,
        trim: true,
    },
    place_of_assignment: { 
        type: String,
        required: true,
        trim: true,
    },
    domain_user: {
        type: String,
        required: true,
        trim: true,
    },
    employee_count: {
        type: Number,
    },
    request_type: {
        type: String,
        trim: true,
        default: "Medical"
    },

    name_of_supervisor: {
        type: String,
        trim: true,
        default: "Nuru Mustefa"
    },

    viewed_by: {
        type: String,
        trim: true,
    },

    viewed_date: {
        type: Date,
    },

    status: {
        type: String,
        enum: ["Pending", "Viewed", "Rejected"],
        default: "Pending"
    },
    
    rejection_reason: {
        type: String,
        trim: true,
    },
    
    TimeStamp: {
        type: Date,
        default: Date.now
    },
    
    reference_number: {
        type: String,
        trim: true,
    }
});

const Medical = mongoose.model('Medical', medicalSchema);
export default Medical;

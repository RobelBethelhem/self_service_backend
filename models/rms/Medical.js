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

    // Canonical employee name parts, sourced from HRIS at submission /
    // approval time. Used by the Medical Slip render instead of splitting
    // domain_user, which mis-handles AD usernames where the second token
    // is the grandfather name (e.g. Robel.Bogale) rather than the father.
    employee_first_name: {
        type: String,
        trim: true,
    },
    employee_middle_name: {
        type: String,
        trim: true,
    },
    employee_last_name: {
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
    // Where place_of_assignment came from.
    //
    // "hris"   - read from the HRIS record, the normal case.
    // "manual" - HRIS had no value for this employee (a known data-cleansing
    //            gap), so the employee typed it in to avoid being blocked.
    //            The approver sees it flagged and is expected to verify it and
    //            fix the HRIS record. Re-checked at approval time, so once HR
    //            cleans the record the value and this flag correct themselves.
    //
    // Defaults to "hris" so requests written before this field existed keep
    // reading as HRIS-sourced rather than showing a false warning.
    place_of_assignment_source: {
        type: String,
        enum: ["hris", "manual"],
        default: "hris",
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

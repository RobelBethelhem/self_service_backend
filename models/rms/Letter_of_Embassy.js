import mongoose from "mongoose";
const Schema = mongoose.Schema;

const embassySchema = new Schema({
    employee_first_name: {
        type: String,
        required: true,
        trim: true,
    },
    employee_middle_name: {
        type: String,
        required: true,
        trim: true,
    },
    employee_last_name: {
        type: String,
        required: true,
        trim: true,
    },
    employee_embassy_name: {
        type: String,
        required: true,
        trim: true,
    },
    domain_user:{
        type: String,
        required: true,
        trim: true,
    },
    request_type:{
        type: String,
        trim: true,
        default: "Embassy"
    },
    annual_salary: {
        type: Number,
        required: true,
    },
    employee_position:{
        type: String,
        required: true,
        trim: true,    
    },
    date_of_employment: {
        type: Date,
        required: true,
    },
    embassy_location: {
        type: String,
        required: true,
        trim: true,
        default: "Addis Ababa"
    },
    employee_description: {
        type: String,
        trim: true,
    },
    viewed_by:{
        type: String,
        trim: true,
    },
    viewed_date:{
        type: Date,
    },
    status:{
        type: String,
        enum: ["Pending", "Viewed", "Rejected"],
        default: "Pending"
    },
    reference_number: {
        type: String,
        trim: true,
    },

    TimeStamp:{
        type: Date,
        default: new Date()
    }
});

const Embassy = mongoose.model('Embassy', embassySchema);
export default Embassy;
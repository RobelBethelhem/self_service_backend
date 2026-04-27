import mongoose from "mongoose";
const Schema = mongoose.Schema;

const ExperienceItemSchema = new mongoose.Schema({
    period: { 
        type: String,
        required: true
    },
    position: { 
        type: String,
        required: true
    },
    isCurrent: { 
        type: Boolean,
        default: false
    }
});

const experianceSchema = new Schema({
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
    domain_user: {
        type: String,
        required: true,
        trim: true,
    },
    job_grade:{
        type: String,
        required: true,
        trim: true,
    },
    request_type: {
        type: String,
        trim: true,
        default: "Experience"
    },
    employee_description: { 
        type: String,
        trim: true,
    },
    employee_count: {
        type: Number,
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
        enum: ["Pending", "Viewed", "Rejected", "Revoked"],
        default: "Pending"
    },
    TimeStamp: {
        type: Date,
        default: Date.now
    },
    reference_number: {
        type: String,
        trim: true,
    },
    salary: {
        type: String,
        trim: true,
    },
    experiences: [ExperienceItemSchema],
});

const Experience = mongoose.model('Experience', experianceSchema);
export default Experience;

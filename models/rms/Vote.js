import mongoose from "mongoose";
const Schema = mongoose.Schema;

const voteSchema =  new Schema({
    voter_first_name: { 
        type: String,
        required: true,
        trim: true,
    },
    voter_last_name: { 
        type: String,
        required: true,
        trim: true,
    },
    voter_emp_id: { 
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    voter_position:{
        type: String,
        required: true,
     
        trim: true,
    },
    voter_department:{
        type: String,
        required: true,
       
        trim: true,
    },

    candidate_first_name: { 
        type: String,
        required: true,
        trim: true,
    },
    candidate_last_name: { 
        type: String,
        required: true,
        trim: true,
    },
    candidate_emp_id: { 
        type: String,
        required: true,
        trim: true,
    },

    candidate_position:{
        type: String,
        required: true,
      
        trim: true,
    },
    candidate_department:{
        type: String,
        required: true,
       
        trim: true,
    },

    Dedication: { 
        type: Number,
        required: true,
    },
    Quality_of_Work: { 
        type: Number,
        required: true,
    },
    Collaboration_Or_Team_Work: { 
        type: Number,
        required: true,
    },
    Independence: { 
        type: Number,
        required: true,
    },
    Customer_Service: { 
        type: Number,
        required: true,
    },
    Time_Mgt: { 
        type: Number,
        required: true,
    },
    Proper_Office_Attire_and_Dress_Code:{
        type: Number,
        required: true,
    },

    Flexibility:{
        type: Number,
        required: true,
    },

    Total_Weight:{
        type: Number,
        required: true,
    },

    Accrue_Weight:{
        type: Number,
        required: true,
    },
    TimeStamp:{
        type: Date,
        default: new Date()
    }
    });


    const Vote = mongoose.model('Vote', voteSchema);
    export default Vote;

    
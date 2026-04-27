import mongoose from "mongoose";
const Schema = mongoose.Schema;

const candidateSchema =  new Schema({
    employee_id: { 
        type: String,
        required: true,
        trim: true,
    },
    first_name: { 
        type: String,
        required: true,
        trim: true,
    },
    last_name: { 
        type: String,
        required: true,
        trim: true,
    },
    department: { 
        type: String,
        required: true,
        trim: true,
    },
    position: { 
        type: String,
        required: true,
        trim: true,
    },
    registered_By: { 
        type: String,
        required: true,
        trim: true,
    },
    Created_At: { 
        type: Date,
        default: Date.now(),
    },
    Updated_At: { 
        type: Date,
      
    },
    Updated_By: { 
        type: String,
        trim: true,
    },
    
    });


    const Candidate = mongoose.model('Candidate', candidateSchema);
    export default Candidate;

    
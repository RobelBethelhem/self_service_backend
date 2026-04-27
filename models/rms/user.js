

import mongoose from "mongoose";
const Schema = mongoose.Schema;

const userSchema =  new Schema({
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
    
    employee_id: { 
        type: String,
        required: true,
        trim: true,
    },

    user: { 
        type: String,
        required: true,
        trim: true,
    },

    position: { 
        type: String,
        required: true,
        trim: true,
    },
    department: { 
        type: String,
        required: true,
        trim: true,
    },
    
    email: { 
        type: String,
        required: true,
        unique: true,
    },
    password: { 
        type: String,
        required: true,
        default: "$2b$10$FPGWuVHDUTNQ7gyiDa5mzubgI4CFvrud0P7pA1ku2lGh9Br3MXYQa"
    },
   
    roles: { 
        type: [String],
        enum: ["user","admin"],
        default: ["user"],
    },
    status:{
        type: Boolean,
        default: false
    },

    //  pushSubscriptions: [{ 
    //     type: mongoose.Schema.Types.ObjectId,
    //     ref: 'PushSubscription'
    // }],

    
    });

   // const User = mongoose.model("User",userSchema);

    const User = mongoose.models.User || mongoose.model('User', userSchema);
    export default User;

    
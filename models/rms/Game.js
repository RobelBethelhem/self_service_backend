import mongoose from "mongoose";
const Schema = mongoose.Schema;

const gameSchema =  new Schema({
    gamer_first_name: { 
        type: String,
      
        trim: true,
    },
    gamer_last_name: { 
        type: String,
       
        trim: true,
    },
    gamer_emp_id: { 
        type: String,
        required: true,
       
        trim: true,
    },
    gamer_position:{
        type: String,
        required: true,
     
        trim: true,
    },
    gamer_department:{
        type: String,
        required: true,
        trim: true,
    },
    Timestamp:{
        type: Date,
        default: Date.now()
    },
    score:{
        type: Number,

    }

    });


    const Game = mongoose.model('Game', gameSchema);
    export default Game;

    
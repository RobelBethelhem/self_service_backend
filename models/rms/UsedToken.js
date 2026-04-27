import mongoose from "mongoose";
const Schema = mongoose.Schema;

const usedTokenSchema = new Schema({
    token:{
        type: String,
        required: true
    },
});

const UsedToken = mongoose.model("UsedToken", usedTokenSchema);
export default UsedToken;
import mongoose from "mongoose";
const Schema = mongoose.Schema;

const guarantyTrackSchema = new Schema({
    domain_user: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    guaranty_count: {
        type: Number,
        default: 0
    },
    last_updated: {
        type: Date,
        default: Date.now
    }
});

const GuarantyTrack = mongoose.model('GuarantyTrack', guarantyTrackSchema);
export default GuarantyTrack;
import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Admin-managed announcement categories — "Job Post", "Policy Update",
// "Event", whatever HR needs. Deliberately data-driven rather than a hardcoded
// enum so new categories never require a code change.
const announcementCategorySchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        maxlength: 60,
    },
    // Stable machine key derived from the name on save. Used by the frontend
    // for filter chips so a rename does not break saved links.
    slug: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
    },
    // Hex colour driving the category chip and card accent.
    color: {
        type: String,
        trim: true,
        default: "#0d6efd",
    },
    description: {
        type: String,
        trim: true,
        default: "",
        maxlength: 240,
    },
    // Lower sorts first in pickers and filter bars.
    order: {
        type: Number,
        default: 0,
    },
    active: {
        type: Boolean,
        default: true,
    },

    created_by: { type: String, trim: true },
    created_at: { type: Date, default: Date.now },
    updated_by: { type: String, trim: true },
    updated_at: { type: Date },
});

announcementCategorySchema.index({ order: 1, name: 1 });

const AnnouncementCategory = mongoose.model(
    "AnnouncementCategory",
    announcementCategorySchema
);
export default AnnouncementCategory;

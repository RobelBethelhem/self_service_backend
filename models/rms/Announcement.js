import mongoose from "mongoose";
const Schema = mongoose.Schema;

// An announcement / job post shown to employees on the first screen after
// login, and revisitable from a dedicated page.
//
// Content is a LIST OF TYPED BLOCKS rather than an HTML string. The admin
// builder composes them by drag and drop; the frontend renders each block as
// real React elements. Nothing is ever passed through dangerouslySetInnerHTML,
// so a pasted <script> is inert by construction rather than by filtering.
//
// Blocks are Mixed so the builder can gain block types without a migration.
// The route whitelists type + per-type fields on every save, so "Mixed" here
// does not mean "unvalidated" — see sanitizeBlocks() in routes/rms/Announcement.js.

export const ANNOUNCEMENT_MODES = ["mandatory", "optional"];
export const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"];

// Recorded on every save so HR can see how a notice evolved and who changed it.
const announcementHistoryEntrySchema = new Schema(
    {
        action: { type: String, trim: true }, // created | updated | status
        status: { type: String, trim: true },
        mode: { type: String, trim: true },
        publish_from: { type: Date, default: null },
        publish_until: { type: Date, default: null },
        block_count: { type: Number },
        note: { type: String, trim: true, default: "" },
        changed_by: { type: String, trim: true },
        changed_at: { type: Date, default: Date.now },
    },
    { _id: false }
);

const announcementSchema = new Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
    },
    // One-or-two line teaser shown on the card face.
    summary: {
        type: String,
        trim: true,
        default: "",
        maxlength: 400,
    },
    category_id: {
        type: Schema.Types.ObjectId,
        ref: "AnnouncementCategory",
        default: null,
    },

    // Card artwork. Either a data URI (client-compressed on upload) or an
    // absolute URL. Images are embedded rather than uploaded to disk so the
    // feature needs no writable folder and no static-file route on IIS.
    cover_image: {
        type: String,
        default: "",
    },
    accent_color: {
        type: String,
        trim: true,
        default: "",
    },

    blocks: {
        type: [Schema.Types.Mixed],
        default: [],
    },

    // mandatory -> the login overlay cannot be dismissed until acknowledged.
    // optional  -> the employee may skip it.
    mode: {
        type: String,
        enum: ANNOUNCEMENT_MODES,
        default: "optional",
    },
    status: {
        type: String,
        enum: ANNOUNCEMENT_STATUSES,
        default: "draft",
    },

    // Publish window. Null on either side means open-ended in that direction,
    // so both null = visible for as long as it stays published.
    publish_from: { type: Date, default: null },
    publish_until: { type: Date, default: null },

    // Pinned sorts ahead of everything; priority breaks ties (higher first).
    pinned: { type: Boolean, default: false },
    priority: { type: Number, default: 0 },

    // Which roles see it. Matches the JWT's roles[0] on the frontend.
    target_roles: {
        type: [String],
        default: ["user", "admin"],
    },

    // false keeps it off the post-login overlay while still listing it on the
    // dedicated announcements page.
    show_on_login: { type: Boolean, default: true },

    created_by: { type: String, trim: true },
    created_at: { type: Date, default: Date.now },
    updated_by: { type: String, trim: true },
    updated_at: { type: Date },

    history: { type: [announcementHistoryEntrySchema], default: [] },
});

// Feed query path: published, in-window, ordered.
announcementSchema.index({ status: 1, publish_from: 1, publish_until: 1 });
announcementSchema.index({ pinned: -1, priority: -1, created_at: -1 });
announcementSchema.index({ category_id: 1 });

const Announcement = mongoose.model("Announcement", announcementSchema);
export default Announcement;

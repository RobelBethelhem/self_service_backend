import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Per-employee engagement with one announcement.
//
// `seen_at` is written the first time the detail view is opened; `acknowledged`
// only when the employee explicitly confirms they have read it. Mandatory
// announcements gate the login overlay on `acknowledged`, not on `seen_at`,
// so opening and closing a notice is not the same as confirming it.
const announcementAckSchema = new Schema({
    announcement_id: {
        type: Schema.Types.ObjectId,
        ref: "Announcement",
        required: true,
    },
    domain_user: {
        type: String,
        required: true,
        trim: true,
    },
    employee_name: { type: String, trim: true },

    seen_at: { type: Date, default: null },
    open_count: { type: Number, default: 0 },

    acknowledged: { type: Boolean, default: false },
    acknowledged_at: { type: Date, default: null },

    user_agent: { type: String, trim: true },
    ip: { type: String, trim: true },
});

// One row per (announcement, employee). The upsert path relies on this to stay
// idempotent when a user double-clicks acknowledge on a flaky connection.
announcementAckSchema.index({ announcement_id: 1, domain_user: 1 }, { unique: true });
announcementAckSchema.index({ domain_user: 1 });

const AnnouncementAck = mongoose.model("AnnouncementAck", announcementAckSchema);
export default AnnouncementAck;

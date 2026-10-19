import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Usage log for the My Profile page: who opened it, which sections they looked
// at, and how they answered the "new feature" pop-up. Read by the admin
// analytics screen. Records THAT someone looked, never what the values were.
export const PROFILE_SECTIONS = ["overview", "learning", "career", "salary", "history"];

export const PROFILE_EVENTS = [
    "open", // GET /profile/me succeeded (recorded by the server)
    "section", // a tab was shown; `section` says which
    "reveal", // "Show private details" was switched on; `section` is the tab it was on
    "promo_shown", // the new-feature pop-up appeared (once per session)
    "promo_click", // the pop-up's "View my profile" was used
    "promo_dismiss", // the pop-up was closed with "Maybe later" / x / Escape
];

const profileEventSchema = new Schema({
    // Normalised AD login (lower case, no DOMAIN\ or @suffix), so it joins to
    // User.user however that was typed at signup.
    domain_user: { type: String, required: true, trim: true, lowercase: true },
    user_id: { type: Schema.Types.ObjectId, ref: "User" },
    event: { type: String, enum: PROFILE_EVENTS, required: true },
    section: { type: String, enum: [...PROFILE_SECTIONS, null], default: null },
    at: { type: Date, default: Date.now },
});

profileEventSchema.index({ at: 1 });
profileEventSchema.index({ domain_user: 1, event: 1, at: -1 });

const ProfileEvent = mongoose.model("ProfileEvent", profileEventSchema);
export default ProfileEvent;

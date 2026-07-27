import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Per-letter-type rating policy, set by an admin.
//
// One row per request_type. Controls whether the service-rating survey is
// forced, offered, or switched off when a user prints an approved letter of
// that type — and optionally only for a date window.
//
// A type with NO row behaves as "mandatory", which is exactly how the survey
// behaved before policies existed. Nothing changes until an admin opts in.

export const RATING_MODES = ["mandatory", "optional", "disabled"];

// Every change is appended here so HR can answer "what was in force when this
// rating was collected?" long after the setting has moved on.
const policyHistoryEntrySchema = new Schema(
    {
        mode: { type: String, enum: RATING_MODES, required: true },
        effective_from: { type: Date, default: null },
        effective_to: { type: Date, default: null },
        fallback_mode: { type: String, enum: RATING_MODES, default: "optional" },
        note: { type: String, trim: true, default: "" },
        changed_by: { type: String, trim: true },
        changed_at: { type: Date, default: Date.now },
    },
    { _id: false }
);

const serviceRatingPolicySchema = new Schema({
    request_type: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        // "Guranty" typo is canonical across this codebase.
        enum: ["Experience", "Embassy", "Guranty", "Supportive", "Medical"],
    },

    // The mode that applies INSIDE the effective window.
    mode: {
        type: String,
        enum: RATING_MODES,
        default: "mandatory",
        required: true,
    },

    // Optional window. Null on either side means "open-ended in that
    // direction", so both null = the mode simply always applies.
    effective_from: { type: Date, default: null },
    effective_to: { type: Date, default: null },

    // What applies OUTSIDE the window. Without this a campaign that ends
    // would have no defined behaviour the day after.
    fallback_mode: {
        type: String,
        enum: RATING_MODES,
        default: "optional",
    },

    note: { type: String, trim: true, default: "", maxlength: 500 },

    created_by: { type: String, trim: true },
    created_at: { type: Date, default: Date.now },
    updated_by: { type: String, trim: true },
    updated_at: { type: Date },

    history: { type: [policyHistoryEntrySchema], default: [] },
});

const ServiceRatingPolicy = mongoose.model(
    "ServiceRatingPolicy",
    serviceRatingPolicySchema
);
export default ServiceRatingPolicy;

import mongoose from "mongoose";
const Schema = mongoose.Schema;

// The letter that tells a company the employee who stood guarantor for one
// of its people is leaving the bank — the notice every guaranty letter
// promises. One per guaranty letter, written when the exit clearance's
// signatories are opened. Everything it prints is a snapshot taken then:
// the names as the employee wrote them on the guaranty request (Amharic),
// the addressee, the original letter's number and date, the release date,
// and the wording itself.
const GuarantyReleaseNoticeSchema = new Schema(
    {
        clearance_id: { type: Schema.Types.ObjectId, ref: "Clearance", required: true, index: true },
        guaranty_id: { type: Schema.Types.ObjectId, ref: "Guaranty", required: true, unique: true },
        domain_user: { type: String, required: true, trim: true, lowercase: true },

        employee_name: { type: String, trim: true },
        guaranty_name: { type: String, trim: true },
        organization: { type: String, trim: true },
        organization_location: { type: String, trim: true },
        organization_city: { type: String, trim: true },
        original_reference_number: { type: String, trim: true },
        original_letter_date_am: { type: String, trim: true },

        release_date: { type: Date, required: true },
        release_date_am: { type: String, trim: true },
        letter_date: { type: Date, required: true },
        letter_date_am: { type: String, trim: true },
        // "future" while the release day is still ahead when the notice is
        // written (the promise was to tell the company in advance); "past"
        // once it has gone by. Changes a few words of the letter.
        tense: { type: String, enum: ["future", "past"], default: "future" },
        subject: { type: String, trim: true },
        // Paragraphs as runs of { t, b } so the names print bold.
        paragraphs: { type: Schema.Types.Mixed },

        reference_number: { type: String, trim: true, unique: true, sparse: true },
        status: { type: String, enum: ["Issued", "Cancelled"], default: "Issued" },
        issued_by: { type: String, trim: true, lowercase: true },
        cancelled_at: { type: Date },
        cancel_reason: { type: String, trim: true },
    },
    { timestamps: true }
);

const GuarantyReleaseNotice = mongoose.model("GuarantyReleaseNotice", GuarantyReleaseNoticeSchema);
export default GuarantyReleaseNotice;

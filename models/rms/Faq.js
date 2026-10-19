import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Admin-managed Frequently Asked Questions, shown to every signed-in employee
// from the floating help button. The topic ties a question to the page it is
// about (Guaranty form, Medical form, ...) so the button opens on the relevant
// questions first.
export const FAQ_TOPICS = [
    "general",
    "guaranty",
    "experience",
    "embassy",
    "supportive",
    "medical",
    "requests",
    "salary",
    "clearance",
];

const faqSchema = new Schema({
    question: {
        type: String,
        required: true,
        trim: true,
        maxlength: 300,
    },
    // Plain text with the same light formatting as announcement text blocks
    // (**bold**, *italic*, [label](https://url)). Never rendered as HTML.
    answer: {
        type: String,
        required: true,
        trim: true,
        maxlength: 5000,
    },
    topic: {
        type: String,
        enum: FAQ_TOPICS,
        default: "general",
    },
    // Lower sorts first.
    order: {
        type: Number,
        default: 0,
    },
    // Hidden questions stay on record for the admin but never reach employees.
    active: {
        type: Boolean,
        default: true,
    },

    created_by: { type: String, trim: true },
    created_at: { type: Date, default: Date.now },
    updated_by: { type: String, trim: true },
    updated_at: { type: Date },
});

faqSchema.index({ active: 1, order: 1, created_at: 1 });

const Faq = mongoose.model("Faq", faqSchema);
export default Faq;

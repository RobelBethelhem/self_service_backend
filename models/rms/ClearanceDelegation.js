import mongoose from "mongoose";
const Schema = mongoose.Schema;

// A time-boxed proxy: while today is inside the window, `delegate` acts in
// `delegator`'s place everywhere the clearance module resolves who may act —
// signing a row, approving a resignation as supervisor, filling the branch
// rows of a benefits statement. When the window ends the authority returns
// to the delegator on its own; nothing has to be undone.
//
// This is different from the permanent "may sign clearance rows" flag on a
// unit registration: that is a standing arrangement inside one unit, this is
// "I am away from the 3rd to the 17th".
const clearanceDelegationSchema = new Schema(
    {
        delegator: { type: String, required: true, trim: true, lowercase: true, index: true },
        delegate: { type: String, required: true, trim: true, lowercase: true, index: true },
        valid_from: { type: Date, required: true },
        valid_to: { type: Date, required: true },
        reason: { type: String, trim: true, default: "" },
        active: { type: Boolean, default: true },
        created_by: { type: String, trim: true, lowercase: true },
        updated_by: { type: String, trim: true, lowercase: true },
    },
    { timestamps: true }
);

clearanceDelegationSchema.index({ delegator: 1, active: 1, valid_from: 1, valid_to: 1 });

const ClearanceDelegation = mongoose.model("ClearanceDelegation", clearanceDelegationSchema);
export default ClearanceDelegation;

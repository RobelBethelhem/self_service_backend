// import mongoose from "mongoose";
// const Schema = mongoose.Schema;

// const pushSubscriptionSchema = new Schema({
//     userId: { 
//         type: Schema.Types.ObjectId,
//         ref: 'User',
//         required: true,
//     },
//     userRole: {
//         type: String,
//         enum: ["user", "admin"],
//         required: true,
//     },
//     endpoint: {
//         type: String,
//         required: true,
//     },
//     p256dh: {
//         type: String,
//         required: true,
//     },
//     auth: {
//         type: String,
//         required: true,
//     },
//     isActive: {
//         type: Boolean,
//         default: true,
//     },
//     deviceInfo: {
//         type: String,
//         trim: true,
//     },
//     createdAt: {
//         type: Date,
//         default: Date.now,
//     },
//     lastUsed: {
//         type: Date,
//         default: Date.now,
//     }
// });

// // Compound index to prevent duplicate subscriptions per user per device
// pushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });

// const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
// export default PushSubscription;








import mongoose from "mongoose";

const pushSubscriptionSchema = new mongoose.Schema({
    endpoint: {
        type: String,
        required: true,
        unique: true
    },
    expirationTime: {
        type: Date,
        default: null
    },
    keys: {
        p256dh: {
            type: String,
            required: true
        },
        auth: {
            type: String,
            required: true
        }
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    deviceInfo: {
        type: String,
        default: 'Unknown Device'
    },
    active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for faster queries
pushSubscriptionSchema.index({ user: 1, active: 1 });
pushSubscriptionSchema.index({ endpoint: 1 });

const PushSubscription = mongoose.model("PushSubscription", pushSubscriptionSchema);

export default PushSubscription;


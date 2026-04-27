// import { Router } from "express";
// import webpush from 'web-push';
// import auth from "../../middleware/rms/auth.js";
// import roleCheck from "../../middleware/rms/roleCheck.js";
// import User from "../../models/rms/User.js";
// import PushSubscription from "../../models/rms/PushSubscription.js";

// const router = Router();

// // Configure web-push with your VAPID details
// webpush.setVapidDetails(
//     'mailto:admin@zemenbank.com', // Change to your email
//     'BCjhVW-IiwCl1sRwbNSinpoexhB0OZS0yisN80aPfTFSD0kjiCvYv0FP9tVhW-uu-2BtAr02QxHqWkweIbh5sys', // Your public key
//     'YOUR_PRIVATE_KEY_HERE' // Add your private key here
// );

// // Get VAPID public key
// router.get("/vapid-public-key", (req, res) => {
//     res.json({ 
//         publicKey: 'BCjhVW-IiwCl1sRwbNSinpoexhB0OZS0yisN80aPfTFSD0kjiCvYv0FP9tVhW-uu-2BtAr02QxHqWkweIbh5sys' 
//     });
// });

// // Subscribe to push notifications
// router.post("/subscribe", auth, async (req, res) => {
//     try {
//         const userId = req.user._id;
//         const { subscription, deviceInfo } = req.body;
        
//         console.log('[SUBSCRIBE] New subscription request from user:', userId);
        
//         // Validate subscription
//         if (!subscription || !subscription.endpoint) {
//             return res.status(400).json({ 
//                 error: true, 
//                 message: 'Invalid subscription data' 
//             });
//         }
        
//         // Check if subscription already exists
//         const existingSubscription = await PushSubscription.findOne({
//             endpoint: subscription.endpoint
//         });
        
//         if (existingSubscription) {
//             // Update existing
//             existingSubscription.keys = subscription.keys;
//             existingSubscription.user = userId;
//             existingSubscription.deviceInfo = deviceInfo;
//             existingSubscription.active = true;
//             await existingSubscription.save();
            
//             console.log('[SUBSCRIBE] Updated existing subscription');
//         } else {
//             // Create new subscription
//             const newSubscription = new PushSubscription({
//                 endpoint: subscription.endpoint,
//                 expirationTime: subscription.expirationTime,
//                 keys: subscription.keys,
//                 user: userId,
//                 deviceInfo: deviceInfo || 'Unknown Device',
//                 active: true
//             });
            
//             await newSubscription.save();
//             console.log('[SUBSCRIBE] Created new subscription:', newSubscription._id);
            
//             // Add to user's subscriptions array
//             await User.findByIdAndUpdate(userId, {
//                 $addToSet: { pushSubscriptions: newSubscription._id }
//             });
//         }
        
//         res.json({ 
//             error: false, 
//             message: 'Push subscription registered successfully' 
//         });
        
//     } catch (error) {
//         console.error('[SUBSCRIBE] Error:', error);
//         res.status(500).json({ 
//             error: true, 
//             message: error.message 
//         });
//     }
// });

// // Unsubscribe from push notifications
// router.post("/unsubscribe", auth, async (req, res) => {
//     try {
//         const userId = req.user._id;
//         const { endpoint } = req.body;
        
//         if (endpoint === 'CLEAR_ALL') {
//             // Clear all subscriptions for this user
//             await PushSubscription.deleteMany({ user: userId });
//             await User.findByIdAndUpdate(userId, {
//                 $set: { pushSubscriptions: [] }
//             });
            
//             console.log('[UNSUBSCRIBE] Cleared all subscriptions for user:', userId);
//         } else if (endpoint) {
//             // Remove specific subscription
//             const subscription = await PushSubscription.findOneAndDelete({
//                 endpoint: endpoint,
//                 user: userId
//             });
            
//             if (subscription) {
//                 await User.findByIdAndUpdate(userId, {
//                     $pull: { pushSubscriptions: subscription._id }
//                 });
//             }
//         }
        
//         res.json({ 
//             error: false, 
//             message: 'Unsubscribed successfully' 
//         });
        
//     } catch (error) {
//         console.error('[UNSUBSCRIBE] Error:', error);
//         res.status(500).json({ 
//             error: true, 
//             message: error.message 
//         });
//     }
// });

// // Get user's subscriptions (fixed to not populate)
// router.get("/subscriptions", auth, async (req, res) => {
//     try {
//         const userId = req.user._id;
        
//         // Find subscriptions directly without populating
//         const subscriptions = await PushSubscription.find({ 
//             user: userId,
//             active: true 
//         });
        
//         const formattedSubs = subscriptions.map(sub => ({
//             id: sub._id,
//             endpoint: sub.endpoint,
//             deviceInfo: sub.deviceInfo,
//             createdAt: sub.createdAt,
//             hasKeys: {
//                 p256dh: !!sub.keys?.p256dh,
//                 auth: !!sub.keys?.auth
//             }
//         }));
        
//         res.json({
//             error: false,
//             subscriptions: formattedSubs,
//             count: formattedSubs.length
//         });
        
//     } catch (error) {
//         console.error('Error fetching subscriptions:', error);
//         res.status(500).json({ 
//             error: true, 
//             message: error.message 
//         });
//     }
// });

// // Send push notification to all users with a specific role
// router.post("/send", auth, async (req, res) => {
//     try {
//         const { role, message } = req.body;
        
//         if (!role || !message) {
//             return res.status(400).json({ 
//                 error: true, 
//                 message: 'Role and message are required' 
//             });
//         }
        
//         console.log(`[PUSH SEND] Sending to role: ${role}`);
        
//         // Find all users with the specified role
//         const users = await User.find({ role: role });
//         console.log(`[PUSH SEND] Found ${users.length} users with role ${role}`);
        
//         let totalSent = 0;
//         let totalFailed = 0;
        
//         // For each user, find their subscriptions and send
//         for (const user of users) {
//             const subscriptions = await PushSubscription.find({ 
//                 user: user._id,
//                 active: true 
//             });
            
//             for (const subscription of subscriptions) {
//                 try {
//                     const payload = JSON.stringify({
//                         title: message.title,
//                         body: message.body,
//                         icon: message.icon || '/zbss/favicon.ico',
//                         badge: message.badge || '/zbss/favicon.ico',
//                         data: message.data || {}
//                     });
                    
//                     await webpush.sendNotification({
//                         endpoint: subscription.endpoint,
//                         keys: subscription.keys
//                     }, payload);
                    
//                     totalSent++;
//                     console.log(`[PUSH SEND] Sent to user ${user.user}`);
                    
//                 } catch (error) {
//                     console.error(`[PUSH SEND] Failed for user ${user.user}:`, error.message);
//                     totalFailed++;
                    
//                     // If subscription is invalid, mark it as inactive
//                     if (error.statusCode === 410) {
//                         subscription.active = false;
//                         await subscription.save();
//                     }
//                 }
//             }
//         }
        
//         res.json({ 
//             error: false,
//             message: `Push sent to ${totalSent} devices (${totalFailed} failed)`,
//             sentCount: totalSent,
//             failedCount: totalFailed
//         });
        
//     } catch (error) {
//         console.error('[PUSH SEND] Error:', error);
//         res.status(500).json({ 
//             error: true, 
//             message: error.message 
//         });
//     }
// });

// // Send push to specific user
// router.post("/send-to-user", auth, async (req, res) => {
//     try {
//         const { userId, message } = req.body;
//         const targetUserId = userId === 'me' ? req.user._id : userId;
        
//         console.log(`[PUSH USER] Sending to user: ${targetUserId}`);
        
//         const subscriptions = await PushSubscription.find({ 
//             user: targetUserId,
//             active: true 
//         });
        
//         if (subscriptions.length === 0) {
//             return res.status(404).json({ 
//                 error: true, 
//                 message: 'No active subscriptions found for user' 
//             });
//         }
        
//         let sent = 0;
//         for (const subscription of subscriptions) {
//             try {
//                 const payload = JSON.stringify({
//                     title: message.title,
//                     body: message.body,
//                     icon: message.icon || '/zbss/favicon.ico',
//                     badge: message.badge || '/zbss/favicon.ico',
//                     data: message.data || {}
//                 });
                
//                 await webpush.sendNotification({
//                     endpoint: subscription.endpoint,
//                     keys: subscription.keys
//                 }, payload);
                
//                 sent++;
//             } catch (error) {
//                 console.error('[PUSH USER] Send error:', error.message);
//             }
//         }
        
//         res.json({ 
//             error: false,
//             message: `Sent to ${sent} device(s)` 
//         });
        
//     } catch (error) {
//         console.error('[PUSH USER] Error:', error);
//         res.status(500).json({ 
//             error: true, 
//             message: error.message 
//         });
//     }
// });

// export default router;

import { Router } from "express";
import webpush from 'web-push';
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import PushSubscription from "../../models/rms/PushSubscription.js";

const router = Router();

// Configure web-push with your VAPID details
webpush.setVapidDetails(
    'mailto:admin@zemenbank.com', // Change to your email
    'BCjhVW-IiwCl1sRwbNSinpoexhB0OZS0yisN80aPfTFSD0kjiCvYv0FP9tVhW-uu-2BtAr02QxHqWkweIbh5sys', // Your public key
    'iCi908CO9PkGysvUuP8TFxiFrdjABOTjxKQ5hlbgiGQ' // Add your private key here
);

// Get VAPID public key
router.get("/vapid-public-key", (req, res) => {
    res.json({ 
        publicKey: 'BCjhVW-IiwCl1sRwbNSinpoexhB0OZS0yisN80aPfTFSD0kjiCvYv0FP9tVhW-uu-2BtAr02QxHqWkweIbh5sys' 
    });
});




// Debug endpoint to check users and their roles
router.get("/debug-users", auth, async (req, res) => {
    try {
        // Count users by role
        const adminCount = await User.countDocuments({ 
            roles: { $in: ['admin'] },
            status: true 
        });
        
        const userCount = await User.countDocuments({ 
            roles: { $in: ['user'] },
            status: true 
        });
        
        const inactiveCount = await User.countDocuments({ 
            status: false 
        });
        
        // Get sample users to see their structure
        const sampleAdmins = await User.find({ 
            roles: { $in: ['admin'] },
            status: true 
        })
        .limit(3)
        .select('first_name last_name user roles status pushSubscriptions');
        
        const sampleUsers = await User.find({ 
            roles: { $in: ['user'] },
            status: true 
        })
        .limit(3)
        .select('first_name last_name user roles status pushSubscriptions');
        
        // Count push subscriptions
        const totalSubscriptions = await PushSubscription.countDocuments({ active: true });
        
        // Get current user's info
        const currentUser = await User.findById(req.user._id)
            .select('first_name last_name user roles status pushSubscriptions');
        
        res.json({
            summary: {
                activeAdmins: adminCount,
                activeUsers: userCount,
                inactiveUsers: inactiveCount,
                totalActiveSubscriptions: totalSubscriptions
            },
            currentUser: {
                name: `${currentUser.first_name} ${currentUser.last_name}`,
                username: currentUser.user,
                roles: currentUser.roles,
                status: currentUser.status,
                subscriptionCount: currentUser.pushSubscriptions?.length || 0
            },
            sampleAdmins: sampleAdmins.map(u => ({
                name: `${u.first_name} ${u.last_name}`,
                username: u.user,
                roles: u.roles,
                status: u.status,
                subscriptions: u.pushSubscriptions?.length || 0
            })),
            sampleUsers: sampleUsers.map(u => ({
                name: `${u.first_name} ${u.last_name}`,
                username: u.user,
                roles: u.roles,
                status: u.status,
                subscriptions: u.pushSubscriptions?.length || 0
            })),
            message: 'Debug information retrieved successfully'
        });
        
    } catch (error) {
        console.error('[DEBUG] Error:', error);
        res.status(500).json({ 
            error: true, 
            message: error.message 
        });
    }
});


// Subscribe to push notifications
router.post("/subscribe", auth, async (req, res) => {
    try {
        const userId = req.user._id;
        const { subscription, deviceInfo } = req.body;
        
        console.log('[SUBSCRIBE] New subscription request from user:', userId);
        
        // Validate subscription
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ 
                error: true, 
                message: 'Invalid subscription data' 
            });
        }
        
        // Check if subscription already exists
        const existingSubscription = await PushSubscription.findOne({
            endpoint: subscription.endpoint
        });
        
        if (existingSubscription) {
            // Update existing
            existingSubscription.keys = subscription.keys;
            existingSubscription.user = userId;
            existingSubscription.deviceInfo = deviceInfo;
            existingSubscription.active = true;
            await existingSubscription.save();
            
            console.log('[SUBSCRIBE] Updated existing subscription');
        } else {
            // Create new subscription
            const newSubscription = new PushSubscription({
                endpoint: subscription.endpoint,
                expirationTime: subscription.expirationTime,
                keys: subscription.keys,
                user: userId,
                deviceInfo: deviceInfo || 'Unknown Device',
                active: true
            });
            
            await newSubscription.save();
            console.log('[SUBSCRIBE] Created new subscription:', newSubscription._id);
            
            // Add to user's subscriptions array
            await User.findByIdAndUpdate(userId, {
                $addToSet: { pushSubscriptions: newSubscription._id }
            });
        }
        
        res.json({ 
            error: false, 
            message: 'Push subscription registered successfully' 
        });
        
    } catch (error) {
        console.error('[SUBSCRIBE] Error:', error);
        res.status(500).json({ 
            error: true, 
            message: error.message 
        });
    }
});

// Unsubscribe from push notifications
router.post("/unsubscribe", auth, async (req, res) => {
    try {
        const userId = req.user._id;
        const { endpoint } = req.body;
        
        if (endpoint === 'CLEAR_ALL') {
            // Clear all subscriptions for this user
            await PushSubscription.deleteMany({ user: userId });
            await User.findByIdAndUpdate(userId, {
                $set: { pushSubscriptions: [] }
            });
            
            console.log('[UNSUBSCRIBE] Cleared all subscriptions for user:', userId);
        } else if (endpoint) {
            // Remove specific subscription
            const subscription = await PushSubscription.findOneAndDelete({
                endpoint: endpoint,
                user: userId
            });
            
            if (subscription) {
                await User.findByIdAndUpdate(userId, {
                    $pull: { pushSubscriptions: subscription._id }
                });
            }
        }
        
        res.json({ 
            error: false, 
            message: 'Unsubscribed successfully' 
        });
        
    } catch (error) {
        console.error('[UNSUBSCRIBE] Error:', error);
        res.status(500).json({ 
            error: true, 
            message: error.message 
        });
    }
});

// Get user's subscriptions (fixed to not populate)
router.get("/subscriptions", auth, async (req, res) => {
    try {
        const userId = req.user._id;
        
        // Find subscriptions directly without populating
        const subscriptions = await PushSubscription.find({ 
            user: userId,
            active: true 
        });
        
        const formattedSubs = subscriptions.map(sub => ({
            id: sub._id,
            endpoint: sub.endpoint,
            deviceInfo: sub.deviceInfo,
            createdAt: sub.createdAt,
            hasKeys: {
                p256dh: !!sub.keys?.p256dh,
                auth: !!sub.keys?.auth
            }
        }));
        
        res.json({
            error: false,
            subscriptions: formattedSubs,
            count: formattedSubs.length
        });
        
    } catch (error) {
        console.error('Error fetching subscriptions:', error);
        res.status(500).json({ 
            error: true, 
            message: error.message 
        });
    }
});

// Send push notification to all users with a specific role
router.post("/send", auth, async (req, res) => {
    try {
        const { role, message } = req.body;
        
        if (!role || !message) {
            return res.status(400).json({ 
                error: true, 
                message: 'Role and message are required' 
            });
        }
        
        console.log(`[PUSH SEND] Sending to role: ${role}`);
        
        // Find all users with the specified role
         const users = await User.find({ 
                        roles: { $in: [role] },  // Check if role exists in roles array
                    });
        // const users = await User.find({ role: role });
        console.log(`[PUSH SEND] Found ${users.length} users with role ${role}`);
        
        let totalSent = 0;
        let totalFailed = 0;
        
        // For each user, find their subscriptions and send
        for (const user of users) {
            const subscriptions = await PushSubscription.find({ 
                user: user._id,
                active: true 
            });
            
            for (const subscription of subscriptions) {
                try {
                    const payload = JSON.stringify({
                        title: message.title,
                        body: message.body,
                        icon: message.icon || '/zbss/favicon.ico',
                        badge: message.badge || '/zbss/favicon.ico',
                        data: message.data || {}
                    });
                    
                    await webpush.sendNotification({
                        endpoint: subscription.endpoint,
                        keys: subscription.keys
                    }, payload);
                    
                    totalSent++;
                    console.log(`[PUSH SEND] Sent to user ${user.user}`);
                    
                } catch (error) {
                    console.error(`[PUSH SEND] Failed for user ${user.user}:`, error.message);
                    totalFailed++;
                    
                    // If subscription is invalid, mark it as inactive
                    if (error.statusCode === 410) {
                        subscription.active = false;
                        await subscription.save();
                    }
                }
            }
        }
        
        res.json({ 
            error: false,
            message: `Push sent to ${totalSent} devices (${totalFailed} failed)`,
            sentCount: totalSent,
            failedCount: totalFailed
        });
        
    } catch (error) {
        console.error('[PUSH SEND] Error:', error);
        res.status(500).json({ 
            error: true, 
            message: error.message 
        });
    }
});

// Send push to specific user
router.post("/send-to-user", auth, async (req, res) => {
    try {
        const { userId, message } = req.body;
        const targetUserId = userId === 'me' ? req.user._id : userId;
        
        console.log(`[PUSH USER] Sending to user: ${targetUserId}`);
        
        const subscriptions = await PushSubscription.find({ 
            user: targetUserId,
            active: true 
        });
        
        if (subscriptions.length === 0) {
            return res.status(404).json({ 
                error: true, 
                message: 'No active subscriptions found for user' 
            });
        }
        
        console.log(`[PUSH USER] Found ${subscriptions.length} subscriptions`);
        
        let sent = 0;
        let errors = [];
        
        for (const subscription of subscriptions) {
            try {
                const payload = JSON.stringify({
                    title: message.title,
                    body: message.body,
                    icon: message.icon || '/zbss/favicon.ico',
                    badge: message.badge || '/zbss/favicon.ico',
                    data: message.data || {}
                });
                
                console.log(`[PUSH USER] Attempting to send to endpoint: ${subscription.endpoint.substring(0, 50)}...`);
                console.log(`[PUSH USER] Keys present: p256dh=${!!subscription.keys?.p256dh}, auth=${!!subscription.keys?.auth}`);
                console.log(`[PUSH USER] Payload:`, payload);
                
                // Log the exact subscription object being sent
                const pushSubscription = {
                    endpoint: subscription.endpoint,
                    keys: subscription.keys
                };
                console.log(`[PUSH USER] Full subscription object:`, JSON.stringify(pushSubscription, null, 2));
                
                const result = await webpush.sendNotification(pushSubscription, payload);
                
                console.log(`[PUSH USER] ✓ WebPush SUCCESS! Status: ${result.statusCode}`);
                console.log(`[PUSH USER] Response headers:`, result.headers);
                sent++;
                
            } catch (error) {
                console.error(`[PUSH USER] ✗ WebPush FAILED!`);
                console.error(`[PUSH USER] Error message: ${error.message}`);
                console.error(`[PUSH USER] Error code: ${error.statusCode}`);
                console.error(`[PUSH USER] Error body: ${error.body}`);
                console.error(`[PUSH USER] Full error:`, error);
                
                errors.push({
                    endpoint: subscription.endpoint.substring(0, 30),
                    error: error.message,
                    statusCode: error.statusCode
                });
                
                // If 401 or 400, likely VAPID key issue
                if (error.statusCode === 401 || error.statusCode === 400) {
                    console.error('[PUSH USER] VAPID KEY ERROR - Check your private key!');
                }
                
                // If 410, subscription expired
                if (error.statusCode === 410) {
                    console.log('[PUSH USER] Subscription expired, marking as inactive');
                    subscription.active = false;
                    await subscription.save();
                }
            }
        }
        
        console.log(`[PUSH USER] Final result: ${sent} sent, ${errors.length} errors`);
        
        res.json({ 
            error: false,
            message: `Sent to ${sent} device(s)`,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('[PUSH USER] Unexpected error:', error);
        res.status(500).json({ 
            error: true, 
            message: error.message 
        });
    }
});


export default router;
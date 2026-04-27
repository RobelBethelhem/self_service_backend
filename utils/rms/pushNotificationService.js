// import webpush from 'web-push';
// import PushSubscription from '../../models/rms/PushSubscription.js';

// import dotenv from 'dotenv';
// dotenv.config();

// // Configure web-push with your VAPID keys
// // Generate VAPID keys using: npx web-push generate-vapid-keys

// console.log('=== VAPID KEY DEBUG ===');
// console.log('Public Key from ENV:', process.env.VAPID_PUBLIC_KEY);
// console.log('Public Key Length:', process.env.VAPID_PUBLIC_KEY?.length);
// console.log('Private Key from ENV:', process.env.VAPID_PRIVATE_KEY);
// console.log('Private Key Length:', process.env.VAPID_PRIVATE_KEY?.length);
// console.log('=======================');



// const vapidKeys = {
//     publicKey: `${process.env.VAPID_PUBLIC_KEY}` || 'YOUR_VAPID_PUBLIC_KEY',
//     privateKey: `${ process.env.VAPID_PRIVATE_KEY}` || 'YOUR_VAPID_PRIVATE_KEY'
// };

// webpush.setVapidDetails(
//     'mailto:robel.asfaw@zemenbank.com', // Your email
//     vapidKeys.publicKey,
//     vapidKeys.privateKey
// );

// class PushNotificationService {
//     /**
//      * Send notification to all users with specific role
//      */
//     static async sendToRole(role, payload) {
//         try {
//             const subscriptions = await PushSubscription.find({
//                 userRole: role,
//                 isActive: true
//             }).populate('userId', 'first_name last_name');

//             console.log(`Found ${subscriptions.length} active subscriptions for role: ${role}`);

//             // LOG SUBSCRIPTIONS detail
//            subscriptions.forEach((sub,index)=>{
//             console.log(`Subscription ${index + 1}:`, {
//                 userId: sub.userId._id,
//                 userName: `${sub.userId.first_name} ${sub.userId.last_name}`,
//                 endpoint: sub.endpoint.substring(0, 50) + '...', // Truncate for brevity
//                 isActive: sub.isActive,
              
//                 lastUsed: sub.lastUsed
//             });
//         })

//             const sendPromises = subscriptions.map(async (subscription) => {
//                 try {

//                     console.log(`Sending notification to subscription ${subscription._id} for user ${subscription.userId.first_name}`);
//                     await webpush.sendNotification(
//                         {
//                             endpoint: subscription.endpoint,
//                             keys: {
//                                 p256dh: subscription.p256dh,
//                                 auth: subscription.auth
//                             }
//                         },
//                         JSON.stringify(payload)
//                     );

//                     console.log(`Notification sent to subscription ${subscription.userId.first_name}`);
                    
//                     // Update last used timestamp
//                     subscription.lastUsed = new Date();
//                     await subscription.save();
                    
//                 } catch (error) {
//                     console.error(`Push failed for subscription ${subscription.userId.first_name}:`, error);
                    
//                     console.error('Error details:',{
//                         message: error.message,
//                         statusCode: error.statusCode,
//                         headers: error.headers,
//                     })
//                     // Mark subscription as inactive if it's a permanent failure
//                     if (error.statusCode === 410 || error.statusCode === 404) {
//                         subscription.isActive = false;
//                         await subscription.save();
//                     }
//                 }
//             });

//             await Promise.all(sendPromises);
//             console.log(`Sent notifications to ${subscriptions.length} ${role}s`);
            
//         } catch (error) {
//             console.error('Error sending notifications to role:', error);
//         }
//     }

//     /**
//      * Send notification to specific user by userId
//      */
//     static async sendToUser(userId, payload) {
//         try {
//             const subscriptions = await PushSubscription.find({
//                 userId: userId,
//                 isActive: true
//             });

//             const sendPromises = subscriptions.map(async (subscription) => {
//                 try {
//                     await webpush.sendNotification(
//                         {
//                             endpoint: subscription.endpoint,
//                             keys: {
//                                 p256dh: subscription.p256dh,
//                                 auth: subscription.auth
//                             }
//                         },
//                         JSON.stringify(payload)
//                     );
                    
//                     subscription.lastUsed = new Date();
//                     await subscription.save();
                    
//                 } catch (error) {
//                     console.error(`Push failed for user ${userId}:`, error);
                    
//                     if (error.statusCode === 410 || error.statusCode === 404) {
//                         subscription.isActive = false;
//                         await subscription.save();
//                     }
//                 }
//             });

//             await Promise.all(sendPromises);
//             console.log(`Sent notifications to user ${userId} on ${subscriptions.length} devices`);
            
//         } catch (error) {
//             console.error('Error sending notifications to user:', error);
//         }
//     }

//     /**
//      * Send notification to multiple users by userIds array
//      */
//     static async sendToUsers(userIds, payload) {
//         const sendPromises = userIds.map(userId => this.sendToUser(userId, payload));
//         await Promise.all(sendPromises);
//     }

//     /**
//      * Create notification payload for new request
//      */
//     static createNewRequestPayload(requestType, requesterName, requestId) {
//         return {
//             title: `New ${requestType} Request`,
//             body: `${requesterName} submitted a new ${requestType.toLowerCase()} request`,
//             icon: '/favicon.ico',
//             badge: '/badge.png',
//             data: {
//                 requestId: requestId,
//                 requestType: requestType,
//                 type: 'new_request',
//                 url: `/admin/approval`
//             },
//             actions: [
//                 {
//                     action: 'view',
//                     title: 'View Request'
//                 },
//                 {
//                     action: 'dismiss',
//                     title: 'Dismiss'
//                 }
//             ]
//         };
//     }

//     /**
//      * Create notification payload for request status update
//      */
//     static createStatusUpdatePayload(requestType, status, requestId) {
//         const statusText = status === 'Viewed' ? 'reviewed' : status.toLowerCase();
        
//         return {
//             title: `Request ${statusText}`,
//             body: `Your ${requestType.toLowerCase()} request has been ${statusText}`,
//             icon: '/favicon.ico',
//             badge: '/badge.png',
//             data: {
//                 requestId: requestId,
//                 requestType: requestType,
//                 status: status,
//                 type: 'status_update',
//                 url: `/admin/candidate`
//             },
//             actions: [
//                 {
//                     action: 'view',
//                     title: 'View Details'
//                 },
//                 {
//                     action: 'dismiss',
//                     title: 'Dismiss'
//                 }
//             ]
//         };
//     }

//     /**
//      * Cleanup inactive subscriptions
//      */
//     static async cleanupInactiveSubscriptions() {
//         try {
//             const result = await PushSubscription.deleteMany({ isActive: false });
//             console.log(`Cleaned up ${result.deletedCount} inactive subscriptions`);
//         } catch (error) {
//             console.error('Error cleaning up subscriptions:', error);
//         }
//     }
// }

// export default PushNotificationService;




// Updated PushNotificationService.js to work with roles array

import webpush from 'web-push';
import User from '../../models/rms/User.js';
import PushSubscription from '../../models/rms/PushSubscription.js';

// Configure web-push
webpush.setVapidDetails(
    'mailto:admin@zemenbank.com',
    'BCjhVW-IiwCl1sRwbNSinpoexhB0OZS0yisN80aPfTFSD0kjiCvYv0FP9tVhW-uu-2BtAr02QxHqWkweIbh5sys',
    'iCi908CO9PkGysvUuP8TFxiFrdjABOTjxKQ5hlbgiGQ'
);

class PushNotificationService {
    /**
     * Create payload for new request notifications
     */
    static createNewRequestPayload(requestType, requesterName, requestId) {
        return {
            title: `New ${requestType} Request`,
            body: `${requesterName} has submitted a new ${requestType} request`,
            icon: '/zbss/favicon.ico',
            badge: '/zbss/favicon.ico',
            data: {
                type: 'new_request',
                requestType: requestType,
                requestId: requestId,
                url: '/admin/approval',
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Create payload for status update notifications
     */
    static createStatusUpdatePayload(requestType, status, requestId) {
        return {
            title: `${requestType} Request ${status}`,
            body: `Your ${requestType} request has been ${status.toLowerCase()}`,
            icon: '/zbss/favicon.ico',
            badge: '/zbss/favicon.ico',
            data: {
                type: 'status_update',
                requestType: requestType,
                status: status,
                requestId: requestId,
                url: '/admin/candidate',
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Send notification to all users with a specific role
     * FIXED: Now works with roles array instead of role string
     */
    static async sendToRole(role, notificationPayload) {
        try {
            console.log(`[PUSH SERVICE] Sending notification to role: ${role}`);
            
            // FIXED: Use 'roles' array field and $in operator
            // This finds all users where the roles array contains the specified role
            const users = await User.find({ 
                roles: { $in: [role] },  // Check if role exists in roles array
                status: true  // Only send to active users
            });
            
            console.log(`[PUSH SERVICE] Found ${users.length} active users with role "${role}"`);
            
            if (users.length === 0) {
                // Debug: Check what roles exist in database
                const sampleUsers = await User.find().limit(5).select('roles status');
                console.log('[PUSH SERVICE] Sample users roles:', sampleUsers.map(u => ({
                    roles: u.roles,
                    status: u.status
                })));
                
                return { 
                    success: 0, 
                    failed: 0, 
                    message: `No active users found with role "${role}"`,
                    usersFound: 0
                };
            }
            
            let successCount = 0;
            let failureCount = 0;
            let usersWithSubscriptions = 0;
            let usersWithoutSubscriptions = 0;
            
            for (const user of users) {
                // Get user's active push subscriptions
                const subscriptions = await PushSubscription.find({
                    user: user._id,
                    active: true
                });
                
                console.log(`[PUSH SERVICE] User ${user.user} (${user.first_name} ${user.last_name}) has ${subscriptions.length} active subscriptions`);
                
                if (subscriptions.length === 0) {
                    usersWithoutSubscriptions++;
                    continue;
                }
                
                usersWithSubscriptions++;
                
                for (const subscription of subscriptions) {
                    try {
                        const payload = JSON.stringify(notificationPayload);
                        
                        await webpush.sendNotification({
                            endpoint: subscription.endpoint,
                            keys: subscription.keys
                        }, payload);
                        
                        successCount++;
                        console.log(`[PUSH SERVICE] ✓ Successfully sent to ${user.user}'s device (${subscription.deviceInfo})`);
                        
                    } catch (error) {
                        failureCount++;
                        console.error(`[PUSH SERVICE] ✗ Failed to send to ${user.user}:`, error.message);
                        
                        // If subscription is expired (410 Gone), deactivate it
                        if (error.statusCode === 410) {
                            subscription.active = false;
                            await subscription.save();
                            
                            // Remove from user's pushSubscriptions array
                            await User.findByIdAndUpdate(user._id, {
                                $pull: { pushSubscriptions: subscription._id }
                            });
                            
                            console.log(`[PUSH SERVICE] Deactivated expired subscription for ${user.user}`);
                        }
                    }
                }
            }
            
            const summary = `[PUSH SERVICE] Notification summary for role "${role}":
                - Total users found: ${users.length}
                - Users with subscriptions: ${usersWithSubscriptions}
                - Users without subscriptions: ${usersWithoutSubscriptions}
                - Notifications sent: ${successCount}
                - Notifications failed: ${failureCount}`;
            
            console.log(summary);
            
            return { 
                success: successCount, 
                failed: failureCount,
                usersReached: usersWithSubscriptions,
                usersWithoutSubscriptions: usersWithoutSubscriptions,
                totalUsers: users.length
            };
            
        } catch (error) {
            console.error('[PUSH SERVICE] Error sending to role:', error);
            throw error;
        }
    }

    /**
     * Send notification to a specific user
     */
    static async sendToUser(userId, notificationPayload) {
        try {
            console.log(`[PUSH SERVICE] Sending notification to user: ${userId}`);
            
            // Get user details for logging
            const user = await User.findById(userId);
            if (user) {
                console.log(`[PUSH SERVICE] User: ${user.user} (${user.first_name} ${user.last_name}), Roles: ${user.roles.join(', ')}`);
            }
            
            // Get user's active push subscriptions
            const subscriptions = await PushSubscription.find({
                user: userId,
                active: true
            });
            
            if (subscriptions.length === 0) {
                console.log(`[PUSH SERVICE] No active subscriptions for user ${userId}`);
                return { 
                    success: 0, 
                    failed: 0,
                    message: 'User has no active push subscriptions'
                };
            }
            
            console.log(`[PUSH SERVICE] Found ${subscriptions.length} active subscriptions for user`);
            
            let successCount = 0;
            let failureCount = 0;
            
            for (const subscription of subscriptions) {
                try {
                    const payload = JSON.stringify(notificationPayload);
                    
                    await webpush.sendNotification({
                        endpoint: subscription.endpoint,
                        keys: subscription.keys
                    }, payload);
                    
                    successCount++;
                    console.log(`[PUSH SERVICE] ✓ Successfully sent to user's device (${subscription.deviceInfo})`);
                    
                } catch (error) {
                    failureCount++;
                    console.error(`[PUSH SERVICE] ✗ Failed to send:`, error.message);
                    
                    // If subscription is expired, deactivate it
                    if (error.statusCode === 410) {
                        subscription.active = false;
                        await subscription.save();
                        
                        // Remove from user's pushSubscriptions array
                        await User.findByIdAndUpdate(userId, {
                            $pull: { pushSubscriptions: subscription._id }
                        });
                        
                        console.log(`[PUSH SERVICE] Deactivated expired subscription`);
                    }
                }
            }
            
            console.log(`[PUSH SERVICE] User notification complete: ${successCount} sent, ${failureCount} failed`);
            return { success: successCount, failed: failureCount };
            
        } catch (error) {
            console.error('[PUSH SERVICE] Error sending to user:', error);
            throw error;
        }
    }

    /**
     * Send test notification
     */
    static async sendTest(userId) {
        const testPayload = {
            title: 'Test Notification',
            body: 'This is a test push notification',
            icon: '/zbss/favicon.ico',
            badge: '/zbss/favicon.ico',
            data: {
                type: 'test',
                timestamp: new Date().toISOString()
            }
        };
        
        return await this.sendToUser(userId, testPayload);
    }

    /**
     * Send notification to all admins (helper method)
     */
    static async sendToAdmins(notificationPayload) {
        return await this.sendToRole('admin', notificationPayload);
    }

    /**
     * Send notification to all regular users (helper method)
     */
    static async sendToUsers(notificationPayload) {
        return await this.sendToRole('user', notificationPayload);
    }
}

export default PushNotificationService;
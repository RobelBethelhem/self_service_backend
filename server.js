import express from "express";
import { config } from "dotenv";
import dbConnect from "./dbConnect.js";
import authRoutes from "./routes/rms/auth.js";
import refreshTokenRoutes from "./routes/rms/refreshToken.js";
import userRoutes from "./routes/rms/users.js";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import publicVerify from "./routes/rms/PublicVerify.js";


import Candidate from "./routes/rms/Candidate.js";

import Vote from "./routes/rms/Vote.js"
import Experinace from "./routes/rms/Experiance.js";
import Embassy from "./routes/rms/Embassy.js";
import Supportive from "./routes/rms/Supportive.js";
import Guaranty from "./routes/rms/Guaranty.js";
import pushNotificationRoutes from "./routes/rms/pushNotification.js";
import MedicalRoutes from "./routes/rms/Medical.js"
import MedicalProviderRoutes from "./routes/rms/MedicalProvider.js"
import SalaryIncrement from "./routes/rms/SalaryIncrement.js"









import Candidate_Landing from "./routes/rms/Admin/Landing/Candidate_Landing.js"



import cors from "cors"



const app = express();
app.use(cors())


// const corsOptions = {
//   origin: 'https://l9vrnplr-3000.uks1.devtunnels.ms',
//   optionsSuccessStatus: 200
// };

// app.use(cors(corsOptions));



app.use(express.urlencoded({ extended: true }));

app.use(express.json({
  verify: (req, res, buf) => {
    if (buf && buf.length) {
      try {
        JSON.parse(buf);
      } catch (error) {
        res.status(400).json({ message: 'Invalid JSON format' });
      }
    }
  },
}));

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFilePath);
const publicDirectory = `${currentDirectory}\\uploads`;
app.use(express.static(publicDirectory));




config();
dbConnect();

app.use(express.json()); // Parse incoming requests data

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Max-Age', '86400');
    return res.sendStatus(200);
  }
  next();
});

















app.get('/sw.js', (req, res) => {
    // Since process.env might not work, use your actual VAPID public key here
    // This should match the one in your pushNotificationRoutes file
    const vapidPublicKey = 'BCjhVW-IiwCl1sRwbNSinpoexhB0OZS0yisN80aPfTFSD0kjiCvYv0FP9tVhW-uu-2BtAr02QxHqWkweIbh5sys';
    
//     const serviceWorkerContent = `
// // Service Worker for Push Notifications
// const CACHE_NAME = 'push-notifications-v2';

// console.log('Service Worker script loaded and executing');

// // Install event - Force activation
// self.addEventListener('install', (event) => {
//     console.log('Service Worker: Installing...');
//     self.skipWaiting();
// });

// // Activate event - Take control immediately
// self.addEventListener('activate', (event) => {
//     console.log('Service Worker: Activating...');
//     event.waitUntil(
//         Promise.all([
//             // Clear old caches
//             caches.keys().then(cacheNames => {
//                 return Promise.all(
//                     cacheNames.map(cacheName => {
//                         if (cacheName !== CACHE_NAME) {
//                             console.log('Deleting old cache:', cacheName);
//                             return caches.delete(cacheName);
//                         }
//                     })
//                 );
//             }),
//             // Take control of all clients immediately
//             self.clients.claim()
//         ]).then(() => {
//             console.log('Service Worker: Activated and ready!');
            
//             // Send ready message to all clients
//             return self.clients.matchAll().then(clients => {
//                 clients.forEach(client => {
//                     client.postMessage({ type: 'SW_ACTIVATED' });
//                 });
//             });
//         })
//     );
// });

// // Message event - Handle messages from main thread
// self.addEventListener('message', (event) => {
//     console.log('Service Worker received message:', event.data);

//     if (event.data && event.data.type === 'TEST_PUSH') {
//         console.log('Test push message received, simulating push event');
//         // Simulate a push notification for testing
//         self.registration.showNotification('Test Push Notification', {
//             body: 'This is a test push notification from the service worker',
//             icon: '/zbss/favicon.ico',
//             badge: '/zbss/favicon.ico',
//             requireInteraction: true,
//             tag: 'test-push-' + Date.now()
//         });
//     }
    
//     if (event.data && event.data.type === 'SUBSCRIPTION_READY') {
//         console.log('Subscription ready message received');
//         event.ports[0]?.postMessage({ success: true });
//     }
// });

// // Push event - Handle incoming push notifications
// self.addEventListener('push', (event) => {
//     console.log('🔔 PUSH EVENT RECEIVED!', {
//         hasData: !!event.data,
//         timeStamp: new Date().toISOString()
//     });
    
//     if (!event.data) {
//         console.log('❌ Push event received but no data');
//         event.waitUntil(
//             self.registration.showNotification('Notification', {
//                 body: 'You have a new notification',
//                 icon: '/zbss/favicon.ico',
//                 badge: '/zbss/favicon.ico',
//                 tag: 'no-data-' + Date.now()
//             })
//         );
//         return;
//     }

//     let notificationData;
//     try {
//         const rawData = event.data.text();
//         console.log('📋 Raw push data:', rawData);
//         notificationData = JSON.parse(rawData);
//         console.log('✅ Parsed notification data:', notificationData);
//     } catch (error) {
//         console.error('❌ Error parsing push data:', error);
//         // Try to show something even if parsing fails
//         event.waitUntil(
//             self.registration.showNotification('New Notification', {
//                 body: 'You have received a new notification',
//                 icon: '/zbss/favicon.ico',
//                 badge: '/zbss/favicon.ico',
//                 tag: 'parse-error-' + Date.now()
//             })
//         );
//         return;
//     }

//     const { title = 'New Notification', body = 'No message content', icon, badge, data, actions } = notificationData;

//     const options = {
//         body: body,
//         icon: icon || '/zbss/favicon.ico',
//         badge: badge || '/zbss/favicon.ico',
//         data: data || {},
//         actions: actions || [
//             { action: 'view', title: 'View' },
//             { action: 'dismiss', title: 'Dismiss' }
//         ],
//         requireInteraction: true,
//         vibrate: [200, 100, 200],
//         timestamp: Date.now(),
//         tag: \`zbss-notification-\${Date.now()}\`
//     };

//     console.log('📢 Showing notification:', { title, options });

//     event.waitUntil(
//         self.registration.showNotification(title, options)
//             .then(() => {
//                 console.log('✅ Notification displayed successfully!');
                
//                 // Notify all clients that a notification was shown
//                 return self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
//                     clients.forEach(client => {
//                         client.postMessage({ 
//                             type: 'NOTIFICATION_SHOWN', 
//                             title: title,
//                             body: body,
//                             data: options.data,
//                             timestamp: new Date().toISOString()
//                         });
//                     });
//                 });
//             })
//             .catch(error => {
//                 console.error('❌ Failed to show notification:', error);
//             })
//     );
// });

// // Notification click event
// self.addEventListener('notificationclick', (event) => {
//     console.log('🔘 Notification clicked:', {
//         title: event.notification.title,
//         action: event.action,
//         data: event.notification.data
//     });
    
//     event.notification.close();
    
//     const notificationData = event.notification.data || {};
//     const action = event.action;

//     if (action === 'dismiss') {
//         console.log('Notification dismissed by user');
//         return;
//     }

//     // Determine URL based on notification data
//     let url = '/zbss/dashboard';
//     if (notificationData.url) {
//         url = '/zbss' + (notificationData.url.startsWith('/') ? notificationData.url : '/' + notificationData.url);
//     } else if (notificationData.type === 'new_request') {
//         url = '/zbss/admin/approval';
//     } else if (notificationData.type === 'status_update') {
//         url = '/zbss/admin/candidate';
//     }

//     console.log('🔗 Opening URL:', url);

//     event.waitUntil(
//         clients.matchAll({ type: 'window', includeUncontrolled: true })
//             .then((clientList) => {
//                 console.log('🪟 Found client windows:', clientList.length);
                
//                 // Check if there's already a window open with our app
//                 for (const client of clientList) {
//                     if (client.url.includes('zbss') && 'focus' in client) {
//                         console.log('📍 Focusing existing window:', client.url);
//                         return client.focus().then(() => {
//                             // Send navigation message
//                             client.postMessage({
//                                 type: 'NAVIGATE',
//                                 url: url
//                             });
//                         });
//                     }
//                 }
                
//                 // If no window is open, open a new one
//                 if (clients.openWindow) {
//                     console.log('🆕 Opening new window');
//                     return clients.openWindow(url);
//                 }
//             })
//             .catch(error => {
//                 console.error('❌ Error handling notification click:', error);
//             })
//     );
// });

// // Handle push subscription changes - DO NOT hardcode VAPID key here
// self.addEventListener('pushsubscriptionchange', (event) => {
//     console.log('🔄 Push subscription changed - resubscription needed');
//     // The client should handle resubscription with the correct VAPID key
//     event.waitUntil(
//         self.clients.matchAll().then(clients => {
//             clients.forEach(client => {
//                 client.postMessage({ 
//                     type: 'SUBSCRIPTION_EXPIRED',
//                     message: 'Push subscription expired, please resubscribe'
//                 });
//             });
//         })
//     );
// });

// // Keep service worker alive
// self.addEventListener('fetch', (event) => {
//     // We don't intercept fetches, but this keeps the SW active
// });

// console.log('🚀 Service Worker script fully loaded and ready!');
//     `;






const serviceWorkerContent = `
// Service Worker for Push Notifications
const CACHE_NAME = 'push-notifications-v3';

console.log('Service Worker script loaded and executing');

// Install event
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        Promise.all([
            // Clear old caches
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            // Take control of all clients immediately
            self.clients.claim()
        ]).then(() => {
            console.log('Service Worker: Activated and ready!');
            
            // Send ready message to all clients
            return self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'SW_ACTIVATED' });
                });
            });
        })
    );
});

// Message event - Handle messages from main thread
self.addEventListener('message', (event) => {
    console.log('Service Worker received message:', event.data);

    // Handle different message types
    if (event.data && event.data.type === 'SIMULATE_PUSH') {
        console.log('Simulating push notification...');
        
        const data = event.data.data || {};
        const title = data.title || 'Test Push';
        const options = {
            body: data.body || 'Test notification from service worker',
            icon: data.icon || '/zbss/favicon.ico',
            badge: data.badge || '/zbss/favicon.ico',
            requireInteraction: true,
            tag: 'test-' + Date.now()
        };
        
        self.registration.showNotification(title, options)
            .then(() => {
                console.log('Test notification shown successfully');
                // Send confirmation back to main thread
                event.ports[0]?.postMessage({ success: true });
            })
            .catch(err => {
                console.error('Failed to show test notification:', err);
                event.ports[0]?.postMessage({ success: false, error: err.message });
            });
    }
    
    if (event.data && event.data.type === 'TEST_PUSH') {
        console.log('Test push message received, showing notification...');
        self.registration.showNotification('Test Push Notification', {
            body: 'This is a test push notification from the service worker',
            icon: '/zbss/favicon.ico',
            badge: '/zbss/favicon.ico',
            requireInteraction: true,
            tag: 'test-push-' + Date.now()
        });
    }
    
    if (event.data && event.data.type === 'SUBSCRIPTION_READY') {
        console.log('Subscription ready message received');
        event.ports[0]?.postMessage({ success: true });
    }
});

// CRITICAL: Push event handler - This is what receives real push notifications
self.addEventListener('push', (event) => {
    console.log('🔔 REAL PUSH EVENT RECEIVED!', {
        hasData: !!event.data,
        timeStamp: new Date().toISOString()
    });
    
    let notificationData = {
        title: 'Notification',
        body: 'You have a new notification',
        icon: '/zbss/favicon.ico',
        badge: '/zbss/favicon.ico'
    };
    
    // Try to parse the push data
    if (event.data) {
        try {
            const rawData = event.data.text();
            console.log('📋 Raw push data received:', rawData);
            
            const data = JSON.parse(rawData);
            console.log('✅ Parsed push data:', data);
            
            // Use the data from the push message
            notificationData = {
                title: data.title || 'Notification',
                body: data.body || 'You have a new notification',
                icon: data.icon || '/zbss/favicon.ico',
                badge: data.badge || '/zbss/favicon.ico',
                data: data.data || {},
                actions: data.actions || [
                    { action: 'view', title: 'View' },
                    { action: 'dismiss', title: 'Dismiss' }
                ]
            };
        } catch (error) {
            console.error('❌ Error parsing push data:', error);
            console.error('Raw data that failed to parse:', event.data.text());
        }
    } else {
        console.log('⚠️ Push event has no data, showing default notification');
    }
    
    // Add timestamp and tag to prevent duplicate notifications
    const options = {
        body: notificationData.body,
        icon: notificationData.icon,
        badge: notificationData.badge,
        data: notificationData.data,
        actions: notificationData.actions,
        requireInteraction: true,
        timestamp: Date.now(),
        tag: 'push-' + Date.now(),
        vibrate: [200, 100, 200]
    };
    
    console.log('📢 Attempting to show notification:', notificationData.title, options);
    
    // IMPORTANT: Must use event.waitUntil to ensure the notification is shown
    event.waitUntil(
        self.registration.showNotification(notificationData.title, options)
            .then(() => {
                console.log('✅ Push notification displayed successfully!');
                
                // Notify all clients that a notification was shown
                return self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
                    clients.forEach(client => {
                        client.postMessage({ 
                            type: 'NOTIFICATION_SHOWN', 
                            title: notificationData.title,
                            body: notificationData.body,
                            timestamp: new Date().toISOString()
                        });
                    });
                });
            })
            .catch(error => {
                console.error('❌ Failed to show notification:', error);
                console.error('Error details:', error.message, error.stack);
            })
    );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
    console.log('🔘 Notification clicked:', {
        title: event.notification.title,
        action: event.action
    });
    
    event.notification.close();
    
    const notificationData = event.notification.data || {};
    
    if (event.action === 'dismiss') {
        console.log('Notification dismissed');
        return;
    }
    
    // Determine URL to open
    let url = '/zbss/dashboard';
    if (notificationData.url) {
        url = notificationData.url.startsWith('/zbss') ? notificationData.url : '/zbss' + notificationData.url;
    } else if (notificationData.type === 'new_request') {
        url = '/zbss/admin/approval';
    } else if (notificationData.type === 'status_update') {
        url = '/zbss/admin/candidate';
    }
    
    console.log('🔗 Opening URL:', url);
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // Try to focus an existing window
                for (const client of clientList) {
                    if (client.url.includes('zbss')) {
                        return client.focus().then(() => {
                            client.postMessage({
                                type: 'NAVIGATE',
                                url: url
                            });
                        });
                    }
                }
                
                // Open new window if none exists
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

// Fetch event - required for service worker to stay active
self.addEventListener('fetch', (event) => {
    // We don't intercept fetches, but this keeps the SW active
});

console.log('🚀 Service Worker fully loaded with push handlers ready!');
`;


    // Set appropriate headers for service worker
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Service-Worker-Allowed', '/zbss/');
    
    // Send the service worker content
    res.send(serviceWorkerContent);
});

// Alternative: Also serve from /api/sw.js if needed
app.get('/zbss/api/sw.js', (req, res) => {
    console.log('Serving service worker directly from API route');
    
    const serviceWorkerContent = `
// Service Worker for Push Notifications
const CACHE_NAME = 'push-notifications-v1';

console.log('Service Worker script loaded and executing');

// Install event - Force activation
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    self.skipWaiting();
});

// Activate event - Take control immediately
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        Promise.all([
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            self.clients.claim()
        ]).then(() => {
            console.log('Service Worker: Activated and ready!');
            return self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'SW_ACTIVATED' });
                });
            });
        })
    );
});

// Message event - Handle messages from main thread
self.addEventListener('message', (event) => {
    console.log('Service Worker received message:', event.data);

     if(event.data && event.data.type === 'SKIP_WAITING') {
    console.log('Received SKIP_WAITING message');
  }
    
    if (event.data && event.data.type === 'SUBSCRIPTION_READY') {
        console.log('Subscription ready message received');
        event.ports[0]?.postMessage({ success: true });
    }
    
    if (event.data && event.data.type === 'KEEP_ALIVE') {
        console.log('Keep alive ping received');
        event.ports[0]?.postMessage({ alive: true });
    }
});

// Push event - Handle incoming push notifications
self.addEventListener('push', (event) => {
    console.log('PUSH EVENT RECEIVED!', {
        hasData: !!event.data,
        timeStamp: event.timeStamp
    });
    
    if (!event.data) {
        console.log('Push event received but no data');
        event.waitUntil(
            self.registration.showNotification('Test Notification', {
                body: 'Push event received but no data',
                icon: '/zbss/favicon.ico',
                tag: 'no-data-notification'
            }).then(() => {
                console.log('No-data notification shown');
            })
        );
        return;
    }

    let notificationData;
    try {
        const rawData = event.data.text();
        console.log('Raw push data:', rawData);
        notificationData = JSON.parse(rawData);
        console.log('Parsed notification data:', notificationData);
    } catch (error) {
        console.error('Error parsing push data:', error);
        event.waitUntil(
            self.registration.showNotification('Notification Error', {
                body: 'Failed to parse notification data: ' + error.message,
                icon: '/zbss/favicon.ico',
                tag: 'parse-error-notification'
            })
        );
        return;
    }

    const { title, body, icon, badge, data, actions } = notificationData;

    const options = {
        body: body || 'No message content',
        icon: icon || '/zbss/favicon.ico',
        badge: badge || '/zbss/favicon.ico',
        data: data || {},
        actions: actions || [
            { action: 'view', title: 'View' },
            { action: 'dismiss', title: 'Dismiss' }
        ],
        requireInteraction: true,
        silent: false,
        timestamp: Date.now(),
        tag: 'zbss-notification-' + Date.now()
    };

    console.log('Showing notification:', { title, options });

    event.waitUntil(
        self.registration.showNotification(title || 'New Notification', options)
            .then(() => {
                console.log('Notification shown successfully!');
                return self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({ 
                            type: 'NOTIFICATION_SHOWN', 
                            title, 
                            data: options.data 
                        });
                    });
                });
            })
            .catch(error => {
                console.error('Failed to show notification:', error);
            })
    );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    console.log('Notification clicked:', {
        title: event.notification.title,
        action: event.action,
        data: event.notification.data
    });
    
    event.notification.close();
    
    const notificationData = event.notification.data;
    const action = event.action;

    if (action === 'dismiss') {
        console.log('Notification dismissed by user');
        return;
    }

    let url = '/zbss/dashboard';
    if (notificationData && notificationData.url) {
        url = '/zbss' + notificationData.url;
    } else if (notificationData && notificationData.type === 'new_request') {
        url = '/zbss/admin/approval';
    } else if (notificationData && notificationData.type === 'status_update') {
        url = '/zbss/admin/candidate';
    }

    console.log('Opening URL:', url);

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                console.log('Found client windows:', clientList.length);
                
                for (const client of clientList) {
                    if (client.url.includes('zbss') && 'focus' in client) {
                        console.log('Focusing existing window:', client.url);
                        return client.focus().then(() => {
                            return client.navigate ? client.navigate(url) : client.postMessage({
                                type: 'NAVIGATE',
                                url: url
                            });
                        });
                    }
                }
                
                if (clients.openWindow) {
                    console.log('Opening new window');
                    return clients.openWindow(url);
                }
            })
            .catch(error => {
                console.error('Error handling notification click:', error);
            })
    );
});

// Handle push subscription changes
self.addEventListener('pushsubscriptionchange', (event) => {
    console.log('Push subscription changed');
    
    event.waitUntil(
        self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: 'BCjhVW-IiwCl1sRwbNSinpoexhB0OZS0yisN80aPfTFSD0kjiCvYv0FP9tVhW-uu-2BtAr02QxHqWkweIbh5sys'
        }).then((subscription) => {
            console.log('New subscription created after change');
            return fetch('/zbss/api/push/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    subscription: subscription,
                    deviceInfo: navigator.userAgent
                })
            });
        }).catch(error => {
            console.error('Failed to resubscribe:', error);
        })
    );
});

// Fetch event - Keep service worker active
self.addEventListener('fetch', (event) => {
    // Don't handle fetch events, but having this listener keeps the SW active
});

// Periodic background sync to keep service worker alive
self.addEventListener('sync', (event) => {
    if (event.tag === 'keep-alive') {
        console.log('Keep-alive sync event');
    }
});

console.log('Service Worker script fully loaded and ready!');
    `;

    // Set appropriate headers for service worker
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Service-Worker-Allowed', '/zbss/');
    
    // Send the service worker content
    res.send(serviceWorkerContent);
});














 app.use("/zbss/api/public", publicVerify);








 app.use("/zbss/api/push", pushNotificationRoutes);

app.use("/zbss/api/refreshToken", refreshTokenRoutes);
app.use("/zbss/api/users", userRoutes);



  app.use("/zbss/api/zemen_vote_candidate",Vote);
  app.use("/zbss/api/candidates",Candidate);


  app.use("/zbss/api/experiance", Experinace);
  app.use("/zbss/api/guaranty", Guaranty);
  app.use("/zbss/api/supportive", Supportive);
  app.use("/zbss/api/embassy", Embassy);
  app.use("/zbss/api/medical", MedicalRoutes);
  app.use("/zbss/api/medical-provider", MedicalProviderRoutes);
  app.use("/zbss/api/salary-increment", SalaryIncrement);

 
  
 







app.use("/zbss/api/rms/admin/landing", 
    Candidate_Landing
  );

  app.use("/zbss/api/", authRoutes);



































const port = process.env.PORT || 8081;

app.listen(port, () => console.log(`Listening on Port ${port}...`));







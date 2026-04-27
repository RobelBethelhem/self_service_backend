// import { Router } from "express";
// import auth from "../../middleware/rms/auth.js";
// import roleCheck from "../../middleware/rms/roleCheck.js";
// import User from "../../models/rms/User.js";
// import Guaranty from "../../models/rms/Guaranty_Letter.js";
// import Experinace from "../../models/rms/Experiance_Letter.js";
// import Embassy from "../../models/rms/Letter_of_Embassy.js";
// import Supportive from "../../models/rms/Supportive_Letter.js";
// import { guaranty_letter_BodyValidation } from "../../utils/rms/serveService.js";
// import GuarantyCounter from "../../models/rms/GuarentyCounter.js";
// import SupportiveCounter from "../../models/rms/SupportiveCounter.js";
// import ExperianceCounter from "../../models/rms/ExperianceCounter.js";
// import GuarantyTrack from "../../models/rms/GuarantyTrack.js";
// import {test, guaranteCount, getAmharicNames, updateAmharicNames} from "../../utils/rms/test.js"
// import etdate from 'ethiopic-date';
// import mongoose from 'mongoose';
// import PushNotificationService from "../../utils/rms/pushNotificationService.js";


// const router = Router();

// router.post("/register_request_guaranty", auth, roleCheck(["user","admin"]), async (req, res, next) => {
//   try {

// console.log(",jbjkbkj", req.body);

// const getUser = await req.user;
// const user = await User.findOne({ _id: getUser._id });
// if (!user)
//   return res.status(400).json({ error: true, message: "The requester Can not found" });
// const guaranteeCountValue = await guaranteCount(user.user); 

//     // if(guaranteeCountValue >= 2){
//     //   return res.status(400).json({ error: true, message: "You have already reached the maximum limit of 2 guaranty requests" });
//     // }

//     await GuarantyTrack.findOneAndUpdate(
//       { domain_user: user.user },
//       { 
//         $setOnInsert: { guaranty_count: guaranteeCountValue, last_updated: Date.now() }
//       },
//       { upsert: true, new: true }
//     );

   

//     const employee_organization_location = req.body.employee_organization_location;
//     const guaranty_organazation_cities = req.body.guaranty_organazation_cities;
//     delete req.body.employee_organization_location;
//     delete req.body.guaranty_organazation_cities;

//     const { error } = guaranty_letter_BodyValidation(req.body);
//     if (error)
//       return res.status(400).json({ error: true, message: error.details[0].message });

//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;
//     req.body.request_day_amharic = modifiedEthiocal;


//     req.body.domain_user = user.user;
//     const hrInfo = await test(user.user);
//     console.log("hrInfo", hrInfo)
//     if (!hrInfo || hrInfo.length === 0) {
//       return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
//   }
//     const nofExperience = hrInfo.length;
//     req.body.salary = hrInfo[nofExperience-1].Salary;
//  req.body.employee_organization_location = employee_organization_location;
//  req.body.guaranty_organazation_cities = guaranty_organazation_cities;
//     const savedRequest = await new Guaranty({ ...req.body }).save();

//       try {
//       const requesterName = `${user.first_name} ${user.last_name}`;
//       const notificationPayload = PushNotificationService.createNewRequestPayload(
//         'Guaranty',
//         requesterName,
//         savedRequest._id
//       );
      
//       await PushNotificationService.sendToRole('admin', notificationPayload);
//     } catch (pushError) {
//       console.error('Push notification failed:', pushError);
//       // Don't fail the request if push notification fails
//     }


//     res.status(201).json({ error: false, message: "Guaranty Request Registered Successfully" });

//   }
//   catch (e) {
//     console.log(e)
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });



// // router.patch("/view_request", auth, roleCheck(["admin"]), async (req, res, next) => {
// //   try {
// //     console.log("view_request", req.body);

// //     const { id, request_type } = req.body;

// //     if (!id || !request_type) {
// //       return res.status(400).json({ error: true, message: "Missing id or request_type in the request body" });
// //     }

// //     const getUser = await req.user;
// //     const user = await User.findOne({ _id: getUser._id });
// //     if (!user) {
// //       return res.status(400).json({ error: true, message: "The requester cannot be found" });
// //     }

// //     console.log("useruseruser", user)

// //     const ethiocal = etdate.now().toString();
// //     const parts = ethiocal.split(' ');
// //     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

    

   

// //     let Model, referenceNumber;
// //     switch (request_type) {
// //       case 'Supportive':
// //         Model = Supportive;
// //         referenceNumber = await SupportiveCounter.getNextReference();
// //         break;
// //       case 'Experience':
// //         Model = Experinace;
// //         referenceNumber = await ExperianceCounter.getNextReference();
// //         break;
// //       case 'Guranty':
// //         Model = Guaranty;
// //         // Check if user has reached guaranty limit
// //         const userTrack = await GuarantyTrack.findOne({ domain_user: document.domain_user });
// //         if (userTrack && userTrack.guaranty_count >= 2) {
// //           return res.status(400).json({ 
// //             error: true, 
// //             message: "User has already reached the maximum limit of 2 guaranty requests" 
// //           });
// //         }
// //         referenceNumber = await GuarantyCounter.getNextReference();
// //         break;
// //       case 'Embassy':
// //         Model = Embassy;
// //         break;
// //       default:
// //         return res.status(400).json({ error: true, message: "Invalid request type" });
// //     }


// //     const updateData = {
// //       viewed_by: user.user,
// //       viewed_date: Date.now(),
// //       status: "Viewed",
// //       employee_count: 1,
// //       approved_day_amharic: modifiedEthiocal,
// //       reference_number: referenceNumber
// //     };

// //     const document = await Model.findOne({ _id: id });

// //     if (!document) {
// //       return res.status(404).json({ error: true, message: "Document not found" });
// //     }

// //     if (document.status === 'Pending') {
// //       Object.assign(document, updateData);

// //        // If it's a guaranty request, update the tracking
// //        if (request_type === 'Guranty') {
// //         await GuarantyTrack.findOneAndUpdate(
// //           { domain_user: document.domain_user },
// //           { 
// //             $inc: { guaranty_count: 1 },
// //             last_updated: Date.now()
// //           },
// //           { upsert: true }
// //         );
// //       }
      
// //       await document.save();
// //       res.status(200).json({ error: false, message: `Viewed ${request_type} Request Successful` });
// //     } else if (document.status === 'Viewed') {
// //       res.status(400).json({ error: true, message: `Already Viewed the ${request_type} Request` });
// //     } else {
// //       res.status(400).json({ error: true, message: "Error for the request status" });
// //     }
// //   } catch (e) {
// //     console.error(e);
// //     res.status(500).json({ error: true, message: "Internal Server Error" });
// //   }
// // });







// router.patch("/view_request", auth, roleCheck(["admin"]), async (req, res, next) => {
//   try {
//     const { id, request_type } = req.body;

//     if (!id || !request_type) {
//       return res.status(400).json({ error: true, message: "Missing id or request_type in the request body" });
//     }

//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user) {
//       return res.status(400).json({ error: true, message: "The requester cannot be found" });
//     }

//     let Model, referenceNumber;
    
//     // First set the Model based on request_type
//     switch (request_type) {
//       case 'Supportive':
//         Model = Supportive;
//         break;
//       case 'Experience':
//         Model = Experinace;
//         break;
//       case 'Guranty':
//         Model = Guaranty;
//         break;
//       case 'Embassy':
//         Model = Embassy;
//         break;
//       default:
//         return res.status(400).json({ error: true, message: "Invalid request type" });
//     }

//     // Then find the document
//     const doc = await Model.findOne({ _id: id });
//     if (!doc) {
//       return res.status(404).json({ error: true, message: "Document not found" });
//     }

//     // Then handle the reference numbers and guaranty tracking
//     if (request_type === 'Supportive') {
//       referenceNumber = await SupportiveCounter.getNextReference();
//     } else if (request_type === 'Experience') {
//       referenceNumber = await ExperianceCounter.getNextReference();
//     } else if (request_type === 'Guranty') {
//       const userTrack = await GuarantyTrack.findOne({ domain_user: doc.domain_user });
//       if (userTrack && userTrack.guaranty_count >= 2) {
//         return res.status(400).json({ 
//           error: true, 
//           message: "User has already reached the maximum limit of 2 guaranty requests" 
//         });
//       }
//       referenceNumber = await GuarantyCounter.getNextReference();
//     }

//     // Rest of your code remains the same
//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

//     const updateData = {
//       viewed_by: user.user,
//       viewed_date: Date.now(),
//       status: "Viewed",
//       employee_count: 1,
//       approved_day_amharic: modifiedEthiocal,
//       reference_number: referenceNumber
//     };

//     if((request_type === "Supportive" || request_type === "Guranty") && doc.domain_user) {
//       const amharicNames = await getAmharicNames(doc.domain_user);

//       const namesToUpdate = {};
//       if (doc.employee_first_name && (!amharicNames || !amharicNames.Name_am)) {
//         namesToUpdate.firstName = doc.employee_first_name;
//       }
//       if (doc.employee_middle_name && (!amharicNames || !amharicNames.FName_am)) {
//         namesToUpdate.middleName = doc.employee_middle_name;
//       }
//       if (doc.employee_last_name && (!amharicNames || !amharicNames.GFName_am)) {
//         namesToUpdate.lastName = doc.employee_last_name;
//       }

//       if (Object.keys(namesToUpdate).length > 0) {
//         await updateAmharicNames(doc.domain_user, namesToUpdate);
//       }
//     }

//     if (doc.status === 'Pending') {
//       Object.assign(doc, updateData);

//       if (request_type === 'Guranty') {
//         await GuarantyTrack.findOneAndUpdate(
//           { domain_user: doc.domain_user },
//           { 
//             $inc: { guaranty_count: 1 },
//             last_updated: Date.now()
//           },
//           { upsert: true }
//         );
//       }
      
//       await doc.save();
//       res.status(200).json({ error: false, message: `Viewed ${request_type} Request Successful` });
//     } else if (doc.status === 'Viewed') {
//       res.status(400).json({ error: true, message: `Already Viewed the ${request_type} Request` });
//     } else {
//       res.status(400).json({ error: true, message: "Error for the request status" });
//     }
//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });



// router.patch("/revoke_guaranties", auth, roleCheck(["admin"]), async (req, res, next) => {
//   try {
//     const { ids } = req.body;

//     if (!Array.isArray(ids) || ids.length === 0) {
//       return res.status(400).json({ 
//         error: true, 
//         message: "Please provide an array of guaranty IDs" 
//       });
//     }

//     // Rest of your code remains the same
//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

//     // Find all guaranties that are in 'Viewed' status
//     const guaranties = await Guaranty.find({
//       _id: { $in: ids },
//       status: "Viewed"
//     });

//     if (guaranties.length === 0) {
//       return res.status(404).json({ 
//         error: true, 
//         message: "No valid guaranties found to revoke" 
//       });
//     }

//     // Group guaranties by domain_user to update GuarantyTrack
//     const userGuaranties = {};
//     guaranties.forEach(guaranty => {
//       if (!userGuaranties[guaranty.domain_user]) {
//         userGuaranties[guaranty.domain_user] = 0;
//       }
//       userGuaranties[guaranty.domain_user]++;
//     });

//     // Update each guaranty and decrement GuarantyTrack counts
//     await Promise.all([
//       // Update all guaranties
//       ...guaranties.map(guaranty => 
//         Guaranty.findByIdAndUpdate(
//           guaranty._id,
//           {
//             status: "Revoked",
//             revoked_date: new Date(),
//             revoked_date_amharic: modifiedEthiocal
//           }
//         )
//       ),
//       // Update GuarantyTrack for each user
//       ...Object.entries(userGuaranties).map(([domain_user, count]) =>
//         GuarantyTrack.findOneAndUpdate(
//           { domain_user },
//           { 
//             $inc: { guaranty_count: -count },
//             last_updated: new Date()
//           }
//         )
//       )
//     ]);

//     res.status(200).json({ 
//       error: false, 
//       message: `Successfully revoked ${guaranties.length} guaranties`,
//       revoked_count: guaranties.length
//     });

//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });





// export default router;


// GUARANTY ROUTES - guarantyRoutes.js
// import { Router } from "express";
// import auth from "../../middleware/rms/auth.js";
// import roleCheck from "../../middleware/rms/roleCheck.js";
// import User from "../../models/rms/User.js";
// import Guaranty from "../../models/rms/Guaranty_Letter.js";
// import Experinace from "../../models/rms/Experiance_Letter.js";
// import Embassy from "../../models/rms/Letter_of_Embassy.js";
// import Supportive from "../../models/rms/Supportive_Letter.js";
// import { guaranty_letter_BodyValidation } from "../../utils/rms/serveService.js";
// import GuarantyCounter from "../../models/rms/GuarentyCounter.js";
// import SupportiveCounter from "../../models/rms/SupportiveCounter.js";
// import ExperianceCounter from "../../models/rms/ExperianceCounter.js";
// import GuarantyTrack from "../../models/rms/GuarantyTrack.js";
// import {test, guaranteCount, getAmharicNames, updateAmharicNames} from "../../utils/rms/test.js"
// import etdate from 'ethiopic-date';
// import mongoose from 'mongoose';
// import PushNotificationService from "../../utils/rms/pushNotificationService.js";

// const router = Router();

// router.post("/register_request_guaranty", auth, roleCheck(["user","admin"]), async (req, res, next) => {
//   try {
//     console.log(",jbjkbkj", req.body);

//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user)
//       return res.status(400).json({ error: true, message: "The requester Can not found" });
//     const guaranteeCountValue = await guaranteCount(user.user);

//     await GuarantyTrack.findOneAndUpdate(
//       { domain_user: user.user },
//       { 
//         $setOnInsert: { guaranty_count: guaranteeCountValue, last_updated: Date.now() }
//       },
//       { upsert: true, new: true }
//     );

//     const employee_organization_location = req.body.employee_organization_location;
//     const guaranty_organazation_cities = req.body.guaranty_organazation_cities;
//     delete req.body.employee_organization_location;
//     delete req.body.guaranty_organazation_cities;

//     const { error } = guaranty_letter_BodyValidation(req.body);
//     if (error)
//       return res.status(400).json({ error: true, message: error.details[0].message });

//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;
//     req.body.request_day_amharic = modifiedEthiocal;

//     req.body.domain_user = user.user;
//     const hrInfo = await test(user.user);
//     console.log("hrInfo", hrInfo)
//     if (!hrInfo || hrInfo.length === 0) {
//       return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
//     }
//     const nofExperience = hrInfo.length;
//     req.body.salary = hrInfo[nofExperience-1].Salary;
//     req.body.employee_organization_location = employee_organization_location;
//     req.body.guaranty_organazation_cities = guaranty_organazation_cities;
//     const savedRequest = await new Guaranty({ ...req.body }).save();

//     // Send push notification to all admins
//     try {
//       const requesterName = `${user.first_name} ${user.last_name}`;
//       const notificationPayload = PushNotificationService.createNewRequestPayload(
//         'Guaranty',
//         requesterName,
//         savedRequest._id
//       );
      
//       await PushNotificationService.sendToRole('admin', notificationPayload);
//     } catch (pushError) {
//       console.error('Push notification failed:', pushError);
//       // Don't fail the request if push notification fails
//     }

//     res.status(201).json({ error: false, message: "Guaranty Request Registered Successfully" });

//   } catch (e) {
//     console.log(e)
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });

// router.patch("/view_request", auth, roleCheck(["admin"]), async (req, res, next) => {
//   try {
//     const { id, request_type } = req.body;

//     if (!id || !request_type) {
//       return res.status(400).json({ error: true, message: "Missing id or request_type in the request body" });
//     }

//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user) {
//       return res.status(400).json({ error: true, message: "The requester cannot be found" });
//     }

//     let Model, referenceNumber;
    
//     // First set the Model based on request_type
//     switch (request_type) {
//       case 'Supportive':
//         Model = Supportive;
//         break;
//       case 'Experience':
//         Model = Experinace;
//         break;
//       case 'Guranty':
//         Model = Guaranty;
//         break;
//       case 'Embassy':
//         Model = Embassy;
//         break;
//       default:
//         return res.status(400).json({ error: true, message: "Invalid request type" });
//     }

//     // Then find the document
//     const doc = await Model.findOne({ _id: id });
//     if (!doc) {
//       return res.status(404).json({ error: true, message: "Document not found" });
//     }

//     // Get the original requester for push notification
//     const originalRequester = await User.findOne({ user: doc.domain_user });

//     // Then handle the reference numbers and guaranty tracking
//     if (request_type === 'Supportive') {
//       referenceNumber = await SupportiveCounter.getNextReference();
//     } else if (request_type === 'Experience') {
//       referenceNumber = await ExperianceCounter.getNextReference();
//     } else if (request_type === 'Guranty') {
//       const userTrack = await GuarantyTrack.findOne({ domain_user: doc.domain_user });
//       if (userTrack && userTrack.guaranty_count >= 2) {
//         return res.status(400).json({ 
//           error: true, 
//           message: "User has already reached the maximum limit of 2 guaranty requests" 
//         });
//       }
//       referenceNumber = await GuarantyCounter.getNextReference();
//     }

//     // Rest of your code remains the same
//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

//     const updateData = {
//       viewed_by: user.user,
//       viewed_date: Date.now(),
//       status: "Viewed",
//       employee_count: 1,
//       approved_day_amharic: modifiedEthiocal,
//       reference_number: referenceNumber
//     };

//     if((request_type === "Supportive" || request_type === "Guranty") && doc.domain_user) {
//       const amharicNames = await getAmharicNames(doc.domain_user);

//       const namesToUpdate = {};
//       if (doc.employee_first_name && (!amharicNames || !amharicNames.Name_am)) {
//         namesToUpdate.firstName = doc.employee_first_name;
//       }
//       if (doc.employee_middle_name && (!amharicNames || !amharicNames.FName_am)) {
//         namesToUpdate.middleName = doc.employee_middle_name;
//       }
//       if (doc.employee_last_name && (!amharicNames || !amharicNames.GFName_am)) {
//         namesToUpdate.lastName = doc.employee_last_name;
//       }

//       if (Object.keys(namesToUpdate).length > 0) {
//         await updateAmharicNames(doc.domain_user, namesToUpdate);
//       }
//     }

//     if (doc.status === 'Pending') {
//       Object.assign(doc, updateData);

//       if (request_type === 'Guranty') {
//         await GuarantyTrack.findOneAndUpdate(
//           { domain_user: doc.domain_user },
//           { 
//             $inc: { guaranty_count: 1 },
//             last_updated: Date.now()
//           },
//           { upsert: true }
//         );
//       }
      
//       await doc.save();

//       // Send push notification to the original requester
//       try {
//         if (originalRequester) {
//           const notificationPayload = PushNotificationService.createStatusUpdatePayload(
//             request_type,
//             'Viewed',
//             id
//           );
          
//           await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
//         }
//       } catch (pushError) {
//         console.error('Push notification failed:', pushError);
//       }

//       res.status(200).json({ error: false, message: `Viewed ${request_type} Request Successful` });
//     } else if (doc.status === 'Viewed') {
//       res.status(400).json({ error: true, message: `Already Viewed the ${request_type} Request` });
//     } else {
//       res.status(400).json({ error: true, message: "Error for the request status" });
//     }
//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });

// router.patch("/revoke_guaranties", auth, roleCheck(["admin"]), async (req, res, next) => {
//   try {
//     const { ids } = req.body;

//     if (!Array.isArray(ids) || ids.length === 0) {
//       return res.status(400).json({ 
//         error: true, 
//         message: "Please provide an array of guaranty IDs" 
//       });
//     }

//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

//     // Find all guaranties that are in 'Viewed' status
//     const guaranties = await Guaranty.find({
//       _id: { $in: ids },
//       status: "Viewed"
//     });

//     if (guaranties.length === 0) {
//       return res.status(404).json({ 
//         error: true, 
//         message: "No valid guaranties found to revoke" 
//       });
//     }

//     // Group guaranties by domain_user to update GuarantyTrack and send notifications
//     const userGuaranties = {};
//     guaranties.forEach(guaranty => {
//       if (!userGuaranties[guaranty.domain_user]) {
//         userGuaranties[guaranty.domain_user] = [];
//       }
//       userGuaranties[guaranty.domain_user].push(guaranty._id);
//     });

//     // Update each guaranty and decrement GuarantyTrack counts
//     await Promise.all([
//       // Update all guaranties
//       ...guaranties.map(guaranty => 
//         Guaranty.findByIdAndUpdate(
//           guaranty._id,
//           {
//             status: "Revoked",
//             revoked_date: new Date(),
//             revoked_date_amharic: modifiedEthiocal
//           }
//         )
//       ),
//       // Update GuarantyTrack for each user
//       ...Object.entries(userGuaranties).map(([domain_user, guarantyIds]) =>
//         GuarantyTrack.findOneAndUpdate(
//           { domain_user },
//           { 
//             $inc: { guaranty_count: -guarantyIds.length },
//             last_updated: new Date()
//           }
//         )
//       )
//     ]);

//     // Send push notifications to affected users
//     try {
//       for (const [domain_user, guarantyIds] of Object.entries(userGuaranties)) {
//         const affectedUser = await User.findOne({ user: domain_user });
//         if (affectedUser) {
//           for (const guarantyId of guarantyIds) {
//             const notificationPayload = PushNotificationService.createStatusUpdatePayload(
//               'Guaranty',
//               'Revoked',
//               guarantyId
//             );
            
//             await PushNotificationService.sendToUser(affectedUser._id, notificationPayload);
//           }
//         }
//       }
//     } catch (pushError) {
//       console.error('Push notification failed:', pushError);
//     }

//     res.status(200).json({ 
//       error: false, 
//       message: `Successfully revoked ${guaranties.length} guaranties`,
//       revoked_count: guaranties.length
//     });

//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });

// export default router;































import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import Guaranty from "../../models/rms/Guaranty_Letter.js";
import { guaranty_letter_BodyValidation } from "../../utils/rms/serveService.js";
import GuarantyCounter from "../../models/rms/GuarentyCounter.js";
import GuarantyTrack from "../../models/rms/GuarantyTrack.js";
import {test, guaranteCount, getAmharicNames, updateAmharicNames} from "../../utils/rms/test.js";
import etdate from 'ethiopic-date';
import mongoose from 'mongoose';
import PushNotificationService from "../../utils/rms/pushNotificationService.js";

const router = Router();

router.post("/register_request_guaranty", auth, roleCheck(["user","admin"]), async (req, res, next) => {
  try {
    console.log("req.body", req.body);

     if(req.body.employee_description.length > 100){
      return res.status(400).json({ error: true, message: "Description is too long" });
    }


    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester cannot be found" });


     const recentRequest = await Guaranty.findOne({

      domain_user: user.user,

      request_type: "Guranty",

      status: { $in: ["Pending"] },


    }).sort({ TimeStamp: -1 });

    if (recentRequest) {
      return res.status(400).json({ error: true, message: "A pending guaranty request already exists" });
    }

    // Get guarantee count from HRIS
    const guaranteeCountValue = await guaranteCount(user.user);

    // Initialize or update GuarantyTrack with HRIS count
    await GuarantyTrack.findOneAndUpdate(
      { domain_user: user.user },
      { 
        $setOnInsert: { guaranty_count: guaranteeCountValue, last_updated: Date.now() }
      },
      { upsert: true, new: true }
    );

    const employee_organization_location = req.body.employee_organization_location;
    const guaranty_organazation_cities = req.body.guaranty_organazation_cities;
    delete req.body.employee_organization_location;
    delete req.body.guaranty_organazation_cities;

    const { error } = guaranty_letter_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    const ethiocal = etdate.now().toString();
    const parts = ethiocal.split(' ');
    const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;
    req.body.request_day_amharic = modifiedEthiocal;

    req.body.domain_user = user.user;
    const hrInfo = await test(user.user);
    console.log("hrInfo", hrInfo);
    
    if (!hrInfo || hrInfo.length === 0) {
      return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
    }
    
    const nofExperience = hrInfo.length;
    req.body.salary = hrInfo[nofExperience-1].Salary;
    req.body.employee_organization_location = employee_organization_location;
    req.body.guaranty_organazation_cities = guaranty_organazation_cities;
    
    const savedRequest = await new Guaranty({ ...req.body }).save();

    // Send push notification to all admins
    try {
      const requesterName = `${user.first_name} ${user.last_name}`;
      const notificationPayload = PushNotificationService.createNewRequestPayload(
        'Guaranty',
        requesterName,
        savedRequest._id
      );
      
      await PushNotificationService.sendToRole('admin', notificationPayload);
    } catch (pushError) {
      console.error('Push notification failed:', pushError);
      // Don't fail the request if push notification fails
    }

    res.status(201).json({ error: false, message: "Guaranty Request Registered Successfully" });

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

router.patch("/view_request_guaranty", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    const id = req.body.id;
    
    if (!id) {
      return res.status(400).json({ error: true, message: "Request ID is required" });
    }

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester cannot be found" });

    delete req.body.id;

    // const { error } = guaranty_letter_BodyValidation(req.body);
    // if (error)
    //   return res.status(400).json({ error: true, message: error.details[0].message });

    // Get original request to find the requester
    const originalRequest = await Guaranty.findById(id);
    if (!originalRequest) {
      return res.status(404).json({ error: true, message: "Request not found" });
    }


    //     if(originalRequest.domain_user ===  user.user){
    //   return res.status(400).json({ error: true, message: "You cannot Approve your own request" });
    // }




    // CRITICAL: Check guarantee count from HRIS database (source of truth)
    const hrisGuaranteeCount = await guaranteCount(originalRequest.domain_user);
    console.log(`HRIS Guarantee Count for user ${originalRequest.domain_user}: ${hrisGuaranteeCount}`);

    // Also check our local tracking
    let userTrack = await GuarantyTrack.findOne({ domain_user: originalRequest.domain_user });
    
    // If no local track exists, create one with HRIS count
    if (!userTrack) {
      userTrack = await GuarantyTrack.create({
        domain_user: originalRequest.domain_user,
        guaranty_count: hrisGuaranteeCount,
        last_updated: new Date()
      });
    } else {
      // Sync with HRIS if there's a mismatch (HRIS is the source of truth)
      if (userTrack.guaranty_count !== hrisGuaranteeCount) {
        console.log(`Syncing guarantee count from HRIS: ${hrisGuaranteeCount} (was ${userTrack.guaranty_count})`);
        userTrack.guaranty_count = hrisGuaranteeCount;
        userTrack.last_updated = new Date();
        await userTrack.save();
      }
    }

    // Check if user has already reached the maximum limit (from HRIS)
    if (hrisGuaranteeCount >= 2) {
      return res.status(400).json({ 
        error: true, 
        message: `User has already reached the maximum limit of 2 guaranty requests. Current count in HRIS: ${hrisGuaranteeCount}` 
      });
    }

    // Get the original requester
    const originalRequester = await User.findOne({ user: originalRequest.domain_user });

    // Remove fields that shouldn't be updated
    delete req.body.employee_first_name;
    delete req.body.employee_middle_name;
    delete req.body.employee_last_name;
    delete req.body.employee_description;
    delete req.body.guaranty_first_name;
    delete req.body.guaranty_middle_name;
    delete req.body.guaranty_last_name;
    delete req.body.guaranty_organazation;

    const ethiocal = etdate.now().toString();
    const parts = ethiocal.split(' ');
    const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

    const reference_number = await GuarantyCounter.getNextReference();

    // Update Amharic names if they don't exist in HRIS
    if (originalRequest.domain_user) {
      const amharicNames = await getAmharicNames(originalRequest.domain_user);

      const namesToUpdate = {};
      if (originalRequest.employee_first_name && (!amharicNames || !amharicNames.Name_am)) {
        namesToUpdate.firstName = originalRequest.employee_first_name;
      }
      if (originalRequest.employee_middle_name && (!amharicNames || !amharicNames.FName_am)) {
        namesToUpdate.middleName = originalRequest.employee_middle_name;
      }
      if (originalRequest.employee_last_name && (!amharicNames || !amharicNames.GFName_am)) {
        namesToUpdate.lastName = originalRequest.employee_last_name;
      }

      if (Object.keys(namesToUpdate).length > 0) {
        await updateAmharicNames(originalRequest.domain_user, namesToUpdate);
      }
    }

    await Guaranty.findOne({ _id: id })
      .then((guaranty) => {
        if (!guaranty) {
          throw new Error("Guaranty request not found");
        }
        guaranty.viewed_by = user.user;
        guaranty.viewed_date = Date.now();
        guaranty.status = "Viewed";
        guaranty.employee_count = 1; // INCREMENT employee_count
        guaranty.approved_day_amharic = modifiedEthiocal;
        guaranty.reference_number = reference_number;
        return guaranty.save();
      })
      .then(async (updateResult) => {
        if (updateResult) {
          // INCREMENT the GuarantyTrack count when approving
          await GuarantyTrack.findOneAndUpdate(
            { domain_user: originalRequest.domain_user },
            { 
              $inc: { guaranty_count: 1 },
              last_updated: Date.now()
            },
            { upsert: true }
          );

          console.log(`Incremented guarantee count for user ${originalRequest.domain_user}. New count: ${hrisGuaranteeCount + 1}`);

          // Send push notification to the original requester
          try {
            if (originalRequester) {
              const notificationPayload = PushNotificationService.createStatusUpdatePayload(
                'Guaranty',
                'Viewed',
                id
              );
              
              await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
            }
          } catch (pushError) {
            console.error('Push notification failed:', pushError);
          }

          res.status(200).json({ error: false, message: "Viewed Guaranty Request Successful" });
        } else {
          res.status(404).json({ error: true, message: "Document not found" });
        }
      })
      .catch((error) => {
        console.error("Error finding/updating document:", error);
        res.status(500).json({ error: true, message: "An error occurred" });
      });

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

router.patch("/reject_request_guaranty", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { id } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: true, message: "Request ID is required" });
    }

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    
    if (!user) {
      return res.status(400).json({ error: true, message: "The requester cannot be found" });
    }

    // Get original request to find the requester
    const originalRequest = await Guaranty.findById(id);
    if (!originalRequest) {
      return res.status(404).json({ error: true, message: "Request not found" });
    }

    // ONLY allow rejection if status is "Pending"
    if (originalRequest.status !== 'Pending') {
      return res.status(400).json({ 
        error: true, 
        message: "Can only reject requests with 'Pending' status" 
      });
    }

    // Get the original requester
    const originalRequester = await User.findOne({ user: originalRequest.domain_user });

    // Update the request status to rejected
    // NO changes to GuarantyTrack count since it was never incremented
    const updateResult = await Guaranty.findByIdAndUpdate(id, {
      status: "Rejected",
      viewed_by: user.user,
      viewed_date: new Date()
    }, { new: true });

    if (updateResult) {
      console.log(`Rejected guaranty request ${id} for user ${originalRequest.domain_user}. No count changes.`);

      // Send push notification to the original requester
      try {
        if (originalRequester) {
          const notificationPayload = PushNotificationService.createStatusUpdatePayload(
            'Guaranty',
            'Rejected',
            id
          );
          
          await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
        }
      } catch (pushError) {
        console.error('Push notification failed:', pushError);
      }

      res.status(200).json({ error: false, message: "Guaranty Request Rejected Successfully" });
    } else {
      res.status(404).json({ error: true, message: "Document not found" });
    }

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

router.patch("/revoke_guaranties", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ 
        error: true, 
        message: "Please provide an array of guaranty IDs" 
      });
    }

    const ethiocal = etdate.now().toString();
    const parts = ethiocal.split(' ');
    const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

    // Find all guaranties that are in 'Viewed' status
    const guaranties = await Guaranty.find({
      _id: { $in: ids },
      status: "Viewed"
    });

    if (guaranties.length === 0) {
      return res.status(404).json({ 
        error: true, 
        message: "No valid guaranties found to revoke. Only 'Viewed' guaranties can be revoked." 
      });
    }

    // Group guaranties by domain_user for sending notifications
    const userGuaranties = {};
    guaranties.forEach(guaranty => {
      if (!userGuaranties[guaranty.domain_user]) {
        userGuaranties[guaranty.domain_user] = [];
      }
      userGuaranties[guaranty.domain_user].push(guaranty._id);
    });

    // Update each guaranty - ONLY decrement employee_count, DO NOT touch GuarantyTrack
    await Promise.all(
      guaranties.map(guaranty => 
        Guaranty.findByIdAndUpdate(
          guaranty._id,
          {
            status: "Revoked",
            employee_count: 0, // DECREMENT employee_count to 0
            revoked_date: new Date(),
            revoked_date_amharic: modifiedEthiocal
          }
        )
      )
    );
    
    console.log(`Revoked ${guaranties.length} guaranties. Employee counts set to 0. GuarantyTrack counts unchanged.`);
    // NOTE: GuarantyTrack.guaranty_count is NOT updated - it stays the same

    // Send push notifications to affected users
    try {
      for (const [domain_user, guarantyIds] of Object.entries(userGuaranties)) {
        const affectedUser = await User.findOne({ user: domain_user });
        if (affectedUser) {
          for (const guarantyId of guarantyIds) {
            const notificationPayload = PushNotificationService.createStatusUpdatePayload(
              'Guaranty',
              'Revoked',
              guarantyId
            );
            
            await PushNotificationService.sendToUser(affectedUser._id, notificationPayload);
          }
        }
      }
    } catch (pushError) {
      console.error('Push notification failed:', pushError);
    }

    res.status(200).json({ 
      error: false, 
      message: `Successfully revoked ${guaranties.length} guaranties`,
      revoked_count: guaranties.length
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

export default router;
// import { Router } from "express";
// import auth from "../../middleware/rms/auth.js";
// import roleCheck from "../../middleware/rms/roleCheck.js";
// import User from "../../models/rms/User.js";
// import Supportive from "../../models/rms/Supportive_Letter.js";
// import { supportive_letter_BodyValidation } from "../../utils/rms/serveService.js";
// import SupportiveCounter from "../../models/rms/SupportiveCounter.js";
// import {test} from "../../utils/rms/test.js"
// import etdate from 'ethiopic-date';
// import mongoose from 'mongoose';


// const router = Router();

// router.post("/register_request_supportive", auth, roleCheck(["user","admin"]), async (req, res, next) => {
//   try {

//     console.log("req.body", req.body)

//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user)
//       return res.status(400).json({ error: true, message: "The requester Can not found" });

//     const employee_organization_location = req.body.employee_organization_location;
//     delete req.body.employee_organization_location;

//     const { error } = supportive_letter_BodyValidation(req.body);
//     if (error)
//       return res.status(400).json({ error: true, message: error.details[0].message });

//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;
//     req.body.request_day_amharic = modifiedEthiocal;



//     req.body.domain_user = user.user;
//     const hrInfo = await test(user.user);

//     if (!hrInfo || hrInfo.length === 0) {
//       return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
//   }
//     const nofExperience = hrInfo.length;
//     req.body.salary = hrInfo[nofExperience-1].Salary;
//     req.body.employee_organization_location = employee_organization_location;
//     await new Supportive({ ...req.body }).save();
//     res.status(201).json({ error: false, message: "Supportive  Request Registered Successfully" });

//   }
//   catch (e) {
//     console.log(e)
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });



// router.patch("/view_request_experiance", auth, roleCheck(["admin"]), async (req, res, next) => {
//     try {
//         const id = req.body.id;
//       const getUser = await req.user;
//       const user = await User.findOne({ _id: getUser._id });
//       if (!user)
//         return res.status(400).json({ error: true, message: "The requester Can not found" });

//       delete req.body.id;
  
//       const { error } = supportive_letter_BodyValidation(req.body);
//       if (error)
//         return res.status(400).json({ error: true, message: error.details[0].message });


//     delete req.body.employee_first_name;
//     delete req.body.employee_middle_name;
//     delete req.body.employee_last_name;
//     delete req.body.employee_description;
//     delete req.body.employee_organazation;

   
//     req.body.viewed_by = user.user;
//     req.body.viewed_date = Date.now();
//     req.body.status = "Viewed";

//     req.body.employee_count = 1;


//     const reference_number = await SupportiveCounter.getNextReference();

//     await Supportive.findOne({ _id: id })
//     .then((supportive) => {
//         supportive.viewed_by =  req.body.viewed_by;
//         supportive.viewed_date = req.body.viewed_date;
//         supportive.status = req.body.status;
//         supportive.employee_count = req.body.employee_count;
//         supportive.reference_number = reference_number;
//       return supportive.save();
//     })
//     .then((updateResult) => {
//       if (updateResult) {
//         res.status(200).json({ error: false, message: "Viewed Supportive Request Successful" });
//       } else {
//         res.status(404).json({ error: true, message: "Document not found" });
//       }
//     })
//     .catch((error) => {
//       console.error("Error finding/updating document:", error);
//       res.status(500).json({ error: true, message: "An error occurred" });
//     });



    
  
//     }
//     catch (e) {
//       console.log(e)
//       res.status(500).json({ error: true, message: "Internal Server Error" });
//     }
//   });

// export default router;

































































































// SUPPORTIVE ROUTES - supportiveRoutes.js
// import { Router } from "express";
// import auth from "../../middleware/rms/auth.js";
// import roleCheck from "../../middleware/rms/roleCheck.js";
// import User from "../../models/rms/User.js";
// import Supportive from "../../models/rms/Supportive_Letter.js";
// import { supportive_letter_BodyValidation } from "../../utils/rms/serveService.js";
// import SupportiveCounter from "../../models/rms/SupportiveCounter.js";
// import PushNotificationService from "../../utils/rms/pushNotificationService.js";
// import {test, getEmploymentDate, getUserPhoto} from "../../utils/rms/test.js"
// import etdate from 'ethiopic-date';
// import mongoose from 'mongoose';

// const router = Router();


// router.get("/get_user_photo", auth, roleCheck(["user","admin"]), async (req, res) => {
//   try {
//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user)
//       return res.status(400).json({ error: true, message: "The requester cannot be found" });

//     const photoData = await getUserPhoto(user.user);
//     if (!photoData) {
//       return res.status(404).json({ error: true, message: "Photo not found in HRIS system" });
//     }
//     res.status(200).json({ error: false, photo: photoData.photo });
//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });

// router.post("/register_request_supportive", auth, roleCheck(["user","admin"]), async (req, res, next) => {
//   try {
//     console.log("req.body", req.body)


//      if(req.body.language !== "amharic" && req.body.language !== "english"){
//       return res.status(400).json({ error: true, message: "Language must be either 'amharic' or 'english'" });
//     }


//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user)
//       return res.status(400).json({ error: true, message: "The requester Can not found" });

//     const employee_organization_location = req.body.employee_organization_location;
//     delete req.body.employee_organization_location;

//     // const { error } = supportive_letter_BodyValidation(req.body);
//     // if (error)
//     //   return res.status(400).json({ error: true, message: error.details[0].message });

//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;
//     req.body.request_day_amharic = modifiedEthiocal;

//     req.body.domain_user = user.user;
//     const hrInfo = await test(user.user);

//     if (!hrInfo || hrInfo.length === 0) {
//       return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
//     }
//     const nofExperience = hrInfo.length;
//     req.body.salary = hrInfo[nofExperience-1].Salary;
//     req.body.employee_organization_location = employee_organization_location;

//     if(req.body.language === "english"){

//          if(hrInfo[0].Name.toLowerCase() !== req.body.employee_first_name.toLowerCase().trim()){
//           return res.status(400).json({
//             error: true,
//             message: `First name mismatch: HRIS shows '${hrInfo[0].Name}' but request contains '${req.body.employee_first_name}'. Please contact HR Team.`
//           });
//     }
    
//         if(hrInfo[0].FName.toLowerCase() !== req.body.employee_middle_name.toLowerCase().trim()){
//           return res.status(400).json({
//             error: true,
//             message: `Middle name mismatch: HRIS shows '${hrInfo[0].FName}' but request contains '${req.body.employee_middle_name}'. Please contact HR Team.`
//           });
//     }
    
//         if(hrInfo[0].GFName.toLowerCase() !== req.body.employee_last_name.toLowerCase().trim()){
//           return res.status(400).json({
//             error: true,
//             message: `Last name mismatch: HRIS shows '${hrInfo[0].GFName}' but request contains '${req.body.employee_last_name}'. Please contact HR Team.`
//           });
//     }

      
//     }

//      const hrEmployeeDate = await getEmploymentDate(user.user);
//     if (!hrEmployeeDate || !hrEmployeeDate.EmploymentDate) {
//       return res.status(400).json({ error: true, message: "Cannot find the Employment Date in HRIS System. Please Contact HR Team" });
//     }

//      var dateOnly = new Date(hrEmployeeDate.EmploymentDate).toISOString().split("T")[0]; 
//      var etDateOnly = etdate.convert(`${dateOnly}`);

//     const partsEmploymentDate = etDateOnly.toString().split(' ');
//     const modifiedEthiocalEmploymentDate = `${partsEmploymentDate[1]} ${partsEmploymentDate[2].replace('፣', '')} ቀን ${partsEmploymentDate[3]} ዓ.ም`;
//     req.body.date_of_employment_amharic = modifiedEthiocalEmploymentDate;
//     req.body.date_of_employment_english = new Date(hrEmployeeDate.EmploymentDate);



//     const savedRequest = await new Supportive({ ...req.body }).save();

//     // Send push notification to all admins
//     try {
//       const requesterName = `${user.first_name} ${user.last_name}`;
//       const notificationPayload = PushNotificationService.createNewRequestPayload(
//         'Supportive',
//         requesterName,
//         savedRequest._id
//       );
      
//       await PushNotificationService.sendToRole('admin', notificationPayload);
//     } catch (pushError) {
//       console.error('Push notification failed:', pushError);
//       // Don't fail the request if push notification fails
//     }

//     res.status(201).json({ error: false, message: "Supportive Request Registered Successfully" });

//   } catch (e) {
//     console.log(e)
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });

// router.patch("/view_request_supportive", auth, roleCheck(["admin"]), async (req, res, next) => {
//   try {
//     const id = req.body.id;
//     const getUser = await req.user;
    
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user)
//       return res.status(400).json({ error: true, message: "The requester Can not found" });

//     delete req.body.id;


   

//     // const { error } = supportive_letter_BodyValidation(req.body);
//     // if (error)
//     //   return res.status(400).json({ error: true, message: error.details[0].message });

//     // Get original request to find the requester
//     const originalRequest = await Supportive.findById(id);
//     if (!originalRequest) {
//       return res.status(404).json({ error: true, message: "Request not found" });
//     }


//     //  if(originalRequest.domain_user ===  user.user){
//     //   return res.status(400).json({ error: true, message: "You cannot Approve your own request" });
//     // }

//     // Get the original requester
//     const originalRequester = await User.findOne({ user: originalRequest.domain_user });

//     delete req.body.employee_first_name;
//     delete req.body.employee_middle_name;
//     delete req.body.employee_last_name;
//     delete req.body.employee_description;
//     delete req.body.employee_organazation;

//     req.body.viewed_by = user.user;
//     req.body.viewed_date = Date.now();
//     req.body.status = "Viewed";
//     req.body.employee_count = 1;


//     const ethiocal = etdate.now().toString();
//     const parts = ethiocal.split(' ');
//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;
   


//     const reference_number = await SupportiveCounter.getNextReference();

//     await Supportive.findOne({ _id: id })
//     .then((supportive) => {
//       supportive.viewed_by =  req.body.viewed_by;
//       supportive.viewed_date = req.body.viewed_date;
//       supportive.status = req.body.status;
//       supportive.employee_count = req.body.employee_count;
//       supportive.reference_number = reference_number;
//       supportive.approved_day_amharic = modifiedEthiocal;
//       return supportive.save();
//     })
//     .then(async (updateResult) => {
//       if (updateResult) {
//         // Send push notification to the original requester
//         try {
//           if (originalRequester) {
//             const notificationPayload = PushNotificationService.createStatusUpdatePayload(
//               'Supportive',
//               'Viewed',
//               id
//             );
            
//             await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
//           }
//         } catch (pushError) {
//           console.error('Push notification failed:', pushError);
//         }

//         res.status(200).json({ error: false, message: "Viewed Supportive Request Successful" });
//       } else {
//         res.status(404).json({ error: true, message: "Document not found" });
//       }
//     })
//     .catch((error) => {
//       console.error("Error finding/updating document:", error);
//       res.status(500).json({ error: true, message: "An error occurred" });
//     });

//   } catch (e) {
//     console.log(e)
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });

// // ADD REJECT ENDPOINT FOR SUPPORTIVE
// router.patch("/reject_request_supportive", auth, roleCheck(["admin"]), async (req, res) => {
//   try {
//     const { id, rejection_reason } = req.body;
//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
    
//     if (!user) {
//       return res.status(400).json({ error: true, message: "The requester cannot be found" });
//     }

//     // Get original request to find the requester
//     const originalRequest = await Supportive.findById(id);
//     if (!originalRequest) {
//       return res.status(404).json({ error: true, message: "Request not found" });
//     }

//     // Get the original requester
//     const originalRequester = await User.findOne({ user: originalRequest.domain_user });

//     // Update the request status to rejected
//     const updateResult = await Supportive.findByIdAndUpdate(id, {
//       status: "Rejected",
//       viewed_by: user.user,
//       viewed_date: new Date(),
//       rejection_reason: rejection_reason || "No reason provided"
//     }, { new: true });

//     if (updateResult) {
//       // Send push notification to the original requester
//       try {
//         if (originalRequester) {
//           const notificationPayload = PushNotificationService.createStatusUpdatePayload(
//             'Supportive',
//             'Rejected',
//             id
//           );
          
//           await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
//         }
//       } catch (pushError) {
//         console.error('Push notification failed:', pushError);
//       }

//       res.status(200).json({ error: false, message: "Supportive Request Rejected Successfully" });
//     } else {
//       res.status(404).json({ error: true, message: "Document not found" });
//     }

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

import Supportive from "../../models/rms/Supportive_Letter.js";

import { supportive_letter_BodyValidation } from "../../utils/rms/serveService.js";

import SupportiveCounter from "../../models/rms/SupportiveCounter.js";

import PushNotificationService from "../../utils/rms/pushNotificationService.js";

import {test, getEmploymentDate, getUserPhoto} from "../../utils/rms/test.js"

import etdate from 'ethiopic-date';

import mongoose from 'mongoose';



const router = Router();



// Format name to proper case: "ROBEL" -> "Robel", "robel" -> "Robel", "ROBEL ASFAW" -> "Robel Asfaw"
function formatName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}



router.get("/get_user_photo", auth, roleCheck(["user","admin"]), async (req, res) => {

  try {

    const getUser = await req.user;

    const user = await User.findOne({ _id: getUser._id });

    if (!user)

      return res.status(400).json({ error: true, message: "The requester cannot be found" });



    const photoData = await getUserPhoto(user.user);

    if (!photoData) {

      return res.status(404).json({ error: true, message: "Photo not found in HRIS system" });

    }

    res.status(200).json({ error: false, photo: photoData.photo });

  } catch (e) {

    console.error(e);

    res.status(500).json({ error: true, message: "Internal Server Error" });

  }

});



// router.post("/register_request_supportive", auth, roleCheck(["user","admin"]), async (req, res, next) => {

//   try {

//     console.log("req.body", req.body)

//      if(req.body.employee_description.length > 100){
//       return res.status(400).json({ error: true, message: "Description is too long" });
//     }





//      if(req.body.language !== "amharic" && req.body.language !== "english"){

//       return res.status(400).json({ error: true, message: "Language must be either 'amharic' or 'english'" });

//     }





//     const getUser = await req.user;

//     const user = await User.findOne({ _id: getUser._id });

//     if (!user)
//       return res.status(400).json({ error: true, message: "The requester Can not found" });


//      const recentRequest = await Supportive.findOne({

//       domain_user: user.user,

//       request_type: "Supportive",

//       status: { $in: ["Pending"] },


//     }).sort({ TimeStamp: -1 });

//     if (recentRequest) {
//       return res.status(400).json({ error: true, message: "A pending Embassy request already exists" });
//     }



//     const employee_organization_location = req.body.employee_organization_location;

//     delete req.body.employee_organization_location;



//     // const { error } = supportive_letter_BodyValidation(req.body);

//     // if (error)

//     //   return res.status(400).json({ error: true, message: error.details[0].message });



//     const ethiocal = etdate.now().toString();

//     const parts = ethiocal.split(' ');

//     const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

//     req.body.request_day_amharic = modifiedEthiocal;



//     req.body.domain_user = user.user;

//     const hrInfo = await test(user.user);



//     if (!hrInfo || hrInfo.length === 0) {

//       return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });

//     }

//     const nofExperience = hrInfo.length;

//     req.body.salary = hrInfo[nofExperience-1].Salary;

//     req.body.employee_organization_location = employee_organization_location;



//     if(req.body.language === "english"){



//          if(hrInfo[0].Name.toLowerCase() !== req.body.employee_first_name.toLowerCase().trim()){

//           return res.status(400).json({

//             error: true,

//             message: `First name mismatch: HRIS shows '${hrInfo[0].Name}' but request contains '${req.body.employee_first_name}'. Please contact HR Team.`

//           });

//     }

    

//         if(hrInfo[0].FName.toLowerCase() !== req.body.employee_middle_name.toLowerCase().trim()){

//           return res.status(400).json({

//             error: true,

//             message: `Middle name mismatch: HRIS shows '${hrInfo[0].FName}' but request contains '${req.body.employee_middle_name}'. Please contact HR Team.`

//           });

//     }

    

//         if(hrInfo[0].GFName.toLowerCase() !== req.body.employee_last_name.toLowerCase().trim()){

//           return res.status(400).json({

//             error: true,

//             message: `Last name mismatch: HRIS shows '${hrInfo[0].GFName}' but request contains '${req.body.employee_last_name}'. Please contact HR Team.`

//           });

//     }



      

//     }



//      const hrEmployeeDate = await getEmploymentDate(user.user);

//     if (!hrEmployeeDate || !hrEmployeeDate.EmploymentDate) {

//       return res.status(400).json({ error: true, message: "Cannot find the Employment Date in HRIS System. Please Contact HR Team" });

//     }



//      var dateOnly = new Date(hrEmployeeDate.EmploymentDate).toISOString().split("T")[0]; 

//      var etDateOnly = etdate.convert(`${dateOnly}`);



//     const partsEmploymentDate = etDateOnly.toString().split(' ');

//     const modifiedEthiocalEmploymentDate = `${partsEmploymentDate[1]} ${partsEmploymentDate[2].replace('፣', '')} ቀን ${partsEmploymentDate[3]} ዓ.ም`;

//     req.body.date_of_employment_amharic = modifiedEthiocalEmploymentDate;

//     req.body.date_of_employment_english = new Date(hrEmployeeDate.EmploymentDate);







//     const savedRequest = await new Supportive({ ...req.body }).save();



//     // Send push notification to all admins

//     try {

//       const requesterName = `${user.first_name} ${user.last_name}`;

//       const notificationPayload = PushNotificationService.createNewRequestPayload(

//         'Supportive',

//         requesterName,

//         savedRequest._id

//       );

      

//       await PushNotificationService.sendToRole('admin', notificationPayload);

//     } catch (pushError) {

//       console.error('Push notification failed:', pushError);

//       // Don't fail the request if push notification fails

//     }



//     res.status(201).json({ error: false, message: "Supportive Request Registered Successfully" });



//   } catch (e) {

//     console.log(e)

//     res.status(500).json({ error: true, message: "Internal Server Error" });

//   }

// });




router.post("/register_request_supportive", auth, roleCheck(["user","admin"]), async (req, res, next) => {

  try {

    console.log("req.body", req.body)

    if(req.body.employee_description.length > 100){
      return res.status(400).json({ error: true, message: "Description is too long" });
    }

    if(req.body.language !== "amharic" && req.body.language !== "english"){
      return res.status(400).json({ error: true, message: "Language must be either 'amharic' or 'english'" });
    }

    const getUser = await req.user;

    const user = await User.findOne({ _id: getUser._id });

    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });

    const recentRequest = await Supportive.findOne({
      domain_user: user.user,
      request_type: "Supportive",
      status: { $in: ["Pending"] },
    }).sort({ TimeStamp: -1 });
    
    if (recentRequest) {
      return res.status(400).json({ error: true, message: "A pending Embassy request already exists" });
    }

    const employee_organization_location = req.body.employee_organization_location;
    delete req.body.employee_organization_location;

    // const { error } = supportive_letter_BodyValidation(req.body);
    // if (error)
    //   return res.status(400).json({ error: true, message: error.details[0].message });

    const ethiocal = etdate.now().toString();
    const parts = ethiocal.split(' ');
    const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;
    req.body.request_day_amharic = modifiedEthiocal;

    req.body.domain_user = user.user;
    const hrInfo = await test(user.user);

    if (!hrInfo || hrInfo.length === 0) {
      return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
    }
    
    const nofExperience = hrInfo.length;
    req.body.salary = hrInfo[nofExperience-1].Salary;
    req.body.employee_organization_location = employee_organization_location;

    if(req.body.language === "english"){
      // Validate names against HRIS for English
      if(hrInfo[0].Name.toLowerCase() !== req.body.employee_first_name.toLowerCase().trim()){
        return res.status(400).json({
          error: true,
          message: `First name mismatch: HRIS shows '${hrInfo[0].Name}' but request contains '${req.body.employee_first_name}'. Please contact HR Team.`
        });
      }
      
      if(hrInfo[0].FName.toLowerCase() !== req.body.employee_middle_name.toLowerCase().trim()){
        return res.status(400).json({
          error: true,
          message: `Middle name mismatch: HRIS shows '${hrInfo[0].FName}' but request contains '${req.body.employee_middle_name}'. Please contact HR Team.`
        });
      }
      
      if(hrInfo[0].GFName.toLowerCase() !== req.body.employee_last_name.toLowerCase().trim()){
        return res.status(400).json({
          error: true,
          message: `Last name mismatch: HRIS shows '${hrInfo[0].GFName}' but request contains '${req.body.employee_last_name}'. Please contact HR Team.`
        });
      }
      
      // For English, use HRIS names to ensure consistency
      req.body.employee_first_name = hrInfo[0].Name;
      req.body.employee_middle_name = hrInfo[0].FName;
      req.body.employee_last_name = hrInfo[0].GFName;
      
    } else if(req.body.language === "amharic"){
      // For Amharic, keep the entered names as-is (preserve Amharic script)
      // No validation, no replacement - user's input is preserved
    }

    const hrEmployeeDate = await getEmploymentDate(user.user);
    if (!hrEmployeeDate || !hrEmployeeDate.EmploymentDate) {
      return res.status(400).json({ error: true, message: "Cannot find the Employment Date in HRIS System. Please Contact HR Team" });
    }

    var dateOnly = new Date(hrEmployeeDate.EmploymentDate).toISOString().split("T")[0]; 
    var etDateOnly = etdate.convert(`${dateOnly}`);

    const partsEmploymentDate = etDateOnly.toString().split(' ');
    const modifiedEthiocalEmploymentDate = `${partsEmploymentDate[1]} ${partsEmploymentDate[2].replace('፣', '')} ቀን ${partsEmploymentDate[3]} ዓ.ም`;
    req.body.date_of_employment_amharic = modifiedEthiocalEmploymentDate;
    req.body.date_of_employment_english = new Date(hrEmployeeDate.EmploymentDate);

    const savedRequest = await new Supportive({ ...req.body }).save();

    // Send push notification to all admins
    try {
      const requesterName = `${user.first_name} ${user.last_name}`;
      const notificationPayload = PushNotificationService.createNewRequestPayload(
        'Supportive',
        requesterName,
        savedRequest._id
      );
      
      await PushNotificationService.sendToRole('admin', notificationPayload);
    } catch (pushError) {
      console.error('Push notification failed:', pushError);
      // Don't fail the request if push notification fails
    }

    res.status(201).json({ error: false, message: "Supportive Request Registered Successfully" });

  } catch (e) {
    console.log(e)
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});



router.patch("/view_request_supportive", auth, roleCheck(["admin"]), async (req, res, next) => {

  try {

    const id = req.body.id;

    const getUser = await req.user;

    

    const user = await User.findOne({ _id: getUser._id });

    if (!user)

      return res.status(400).json({ error: true, message: "The requester Can not found" });



    delete req.body.id;



    // Get original request to find the requester

    const originalRequest = await Supportive.findById(id);

    if (!originalRequest) {

      return res.status(404).json({ error: true, message: "Request not found" });

    }



    //  if(originalRequest.domain_user ===  user.user){

    //   return res.status(400).json({ error: true, message: "You cannot Approve your own request" });

    // }



    // Get the original requester

    const originalRequester = await User.findOne({ user: originalRequest.domain_user });



    // ============ FETCH FRESH HRIS DATA BEFORE APPROVAL ============
    const hrInfo = await test(originalRequest.domain_user);
    console.log("Refreshing HRIS data before approval:", hrInfo);
    
    if (!hrInfo || hrInfo.length === 0) {
      return res.status(400).json({ 
        error: true, 
        message: "Cannot find the User in HRIS System. Please Contact HR Team" 
      });
    }
    
    // Get updated salary from the latest HRIS record
    const nofExperience = hrInfo.length;
    const updatedSalary = hrInfo[nofExperience - 1].Salary;
    
    
    // Get updated name fields from HRIS and format to proper case (Robel instead of ROBEL)
    const updatedFirstName = formatName(hrInfo[0].Name);
    const updatedMiddleName = formatName(hrInfo[0].FName);
    const updatedLastName = formatName(hrInfo[0].GFName);
    // ============ END OF HRIS DATA REFRESH ============



    delete req.body.employee_first_name;

    delete req.body.employee_middle_name;

    delete req.body.employee_last_name;

    delete req.body.employee_description;

    delete req.body.employee_organazation;



    req.body.viewed_by = user.user;

    req.body.viewed_date = Date.now();

    req.body.status = "Viewed";

    req.body.employee_count = 1;





    const ethiocal = etdate.now().toString();

    const parts = ethiocal.split(' ');

    const modifiedEthiocal = `${parts[1]} ${parts[2].replace('፣', '')} ቀን ${parts[3]} ዓ.ም`;

   





    const reference_number = await SupportiveCounter.getNextReference();



    await Supportive.findOne({ _id: id })

    .then((supportive) => {

      supportive.viewed_by =  req.body.viewed_by;

      supportive.viewed_date = req.body.viewed_date;

      supportive.status = req.body.status;

      supportive.employee_count = req.body.employee_count;

      supportive.reference_number = reference_number;

      supportive.approved_day_amharic = modifiedEthiocal;

      // Update HRIS data with fresh values (names formatted to proper case)

      if (originalRequest.language === "english") {
        supportive.employee_first_name = updatedFirstName;
        supportive.employee_middle_name = updatedMiddleName;
        supportive.employee_last_name = updatedLastName;
      }


      supportive.salary = updatedSalary;

      return supportive.save();

    })

    .then(async (updateResult) => {

      if (updateResult) {

        // Send push notification to the original requester

        try {

          if (originalRequester) {

            const notificationPayload = PushNotificationService.createStatusUpdatePayload(

              'Supportive',

              'Viewed',

              id

            );

            

            await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);

          }

        } catch (pushError) {

          console.error('Push notification failed:', pushError);

        }



        res.status(200).json({ 
          error: false, 
          message: "Viewed Supportive Request Successful",
          updatedData: {
            salary: updatedSalary,
            employee_first_name: updatedFirstName,
            employee_middle_name: updatedMiddleName,
            employee_last_name: updatedLastName
          }
        });

      } else {

        res.status(404).json({ error: true, message: "Document not found" });

      }

    })

    .catch((error) => {

      console.error("Error finding/updating document:", error);

      res.status(500).json({ error: true, message: "An error occurred" });

    });



  } catch (e) {

    console.log(e)

    res.status(500).json({ error: true, message: "Internal Server Error" });

  }

});



// ADD REJECT ENDPOINT FOR SUPPORTIVE

router.patch("/reject_request_supportive", auth, roleCheck(["admin"]), async (req, res) => {

  try {

    const { id, rejection_reason } = req.body;

    const getUser = await req.user;

    const user = await User.findOne({ _id: getUser._id });

    

    if (!user) {

      return res.status(400).json({ error: true, message: "The requester cannot be found" });

    }



    // Get original request to find the requester

    const originalRequest = await Supportive.findById(id);

    if (!originalRequest) {

      return res.status(404).json({ error: true, message: "Request not found" });

    }



    // Get the original requester

    const originalRequester = await User.findOne({ user: originalRequest.domain_user });



    // Update the request status to rejected

    const updateResult = await Supportive.findByIdAndUpdate(id, {

      status: "Rejected",

      viewed_by: user.user,

      viewed_date: new Date(),

      rejection_reason: rejection_reason || "No reason provided"

    }, { new: true });



    if (updateResult) {

      // Send push notification to the original requester

      try {

        if (originalRequester) {

          const notificationPayload = PushNotificationService.createStatusUpdatePayload(

            'Supportive',

            'Rejected',

            id

          );

          

          await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);

        }

      } catch (pushError) {

        console.error('Push notification failed:', pushError);

      }



      res.status(200).json({ error: false, message: "Supportive Request Rejected Successfully" });

    } else {

      res.status(404).json({ error: true, message: "Document not found" });

    }



  } catch (e) {

    console.error(e);

    res.status(500).json({ error: true, message: "Internal Server Error" });

  }

});



export default router;

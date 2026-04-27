// import { Router } from "express";
// import auth from "../../middleware/rms/auth.js";
// import roleCheck from "../../middleware/rms/roleCheck.js";
// import User from "../../models/rms/User.js";
// import Experinace from "../../models/rms/Experiance_Letter.js";
// import Guaranty from "../../models/rms/Guaranty_Letter.js";
// import Supportive from "../../models/rms/Supportive_Letter.js";
// import Embassy from "../../models/rms/Letter_of_Embassy.js";
// import { experiance_letter_BodyValidation } from "../../utils/rms/serveService.js";
// import ExperianceCounter from "../../models/rms/ExperianceCounter.js";
// import PushNotificationService from "../../utils/rms/pushNotificationService.js";
// import {test} from "../../utils/rms/test.js"
// import mongoose from 'mongoose';


// const router = Router();

// function formatDate(date) {
//   const options = { year: 'numeric', month: 'long', day: 'numeric' };
//   return new Date(date).toLocaleDateString('en-US', options);
// }

// function formatExperience(hrInfo) {
//   return hrInfo.map(job => {
//     const fromDate = formatDate(job.From);
//     const toDate = job.To ? formatDate(job.To) : 'date';
//     const position = job.Postion;

//     return {
//       period: `From ${fromDate} to ${toDate}`,
//       position: position,
//       isCurrent: job.To === null
//     };
//   });
// }



// router.post("/register_request_experiance", auth, roleCheck(["user","admin"]), async (req, res, next) => {
//   try {
//     console.log("register_request_experiance", req.body);
//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user)
//       return res.status(400).json({ error: true, message: "The requester cannot be found" });

//     // CHECK FOR RECENT REQUESTS - 90 DAY RESTRICTION
//     const ninetyDaysAgo = new Date();
//     ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
//     const recentRequest = await Experinace.findOne({
//       domain_user: user.user,
//       request_type: "Experience",
//       status: { $in: ["Pending", "Viewed"] },
//       TimeStamp: { $gte: ninetyDaysAgo }
//     }).sort({ TimeStamp: -1 });

//     if (recentRequest) {
//       const lastRequestDate = new Date(recentRequest.TimeStamp);
//       const daysSinceLastRequest = Math.floor((new Date() - lastRequestDate) / (1000 * 60 * 60 * 24));
//       const daysRemaining = 90 - daysSinceLastRequest;
      
//       return res.status(400).json({ 
//         error: true, 
//         message: `You cannot request an experience letter within 90 days of your last request. Please wait ${daysRemaining} more day${daysRemaining !== 1 ? 's' : ''} before submitting a new request. Your last request was on ${formatDate(lastRequestDate)}.`
//       });
//     }

//     const { error } = experiance_letter_BodyValidation(req.body);
//     if (error)
//       return res.status(400).json({ error: true, message: error.details[0].message });

//     req.body.domain_user = user.user;
//     const hrInfo = await test(user.user);
//     console.log("hrInfohrInfohrInfohrInfohrInfohrInfohrInfo", hrInfo)
    
//     if (!hrInfo || hrInfo.length === 0) {
//       return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
//     }
    
//     if(hrInfo[0].Name.toLowerCase() !== req.body.employee_first_name.toLowerCase()){
//       return res.status(400).json({
//         error: true,
//         message: `First name mismatch: HRIS shows '${hrInfo[0].Name}' but request contains '${req.body.employee_first_name}'. Please contact HR Team.`
//       });
//     }
    
//     if(hrInfo[0].FName.toLowerCase() !== req.body.employee_middle_name.toLowerCase()){
//       return res.status(400).json({
//         error: true,
//         message: `Middle name mismatch: HRIS shows '${hrInfo[0].FName}' but request contains '${req.body.employee_middle_name}'. Please contact HR Team.`
//       });
//     }
    
//     if(hrInfo[0].GFName.toLowerCase() !== req.body.employee_last_name.toLowerCase()){
//       return res.status(400).json({
//         error: true,
//         message: `Last name mismatch: HRIS shows '${hrInfo[0].GFName}' but request contains '${req.body.employee_last_name}'. Please contact HR Team.`
//       });
//     }
    
//     const formattedExperience = formatExperience(hrInfo);
//     console.log(JSON.stringify(formattedExperience, null, 2));
//     const nofExperience = hrInfo.length;
//     req.body.salary = hrInfo[nofExperience - 1].Salary;
//     req.body.job_grade = hrInfo[nofExperience - 1].Job_Grade;
    
//     const savedRequest = await new Experinace({ ...req.body, experiences: formattedExperience }).save();


//   try {
//       const requesterName = `${user.first_name} ${user.last_name}`;
//       const notificationPayload = PushNotificationService.createNewRequestPayload(
//         'Experienece',
//         requesterName,
//         savedRequest._id
//       );
      
//       await PushNotificationService.sendToRole('admin', notificationPayload);
//     } catch (pushError) {
//       console.error('Push notification failed:', pushError);
//       // Don't fail the request if push notification fails
//     }



   
//     res.status(201).json({ error: false, message: "Experience Request Registered Successfully" });
//   } catch (e) {
//     console.log(e);
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });



// // router.post("/register_request_experiance", auth, roleCheck(["user","admin"]), async (req, res, next) => {
// //   try {
// //     console.log("register_request_experiance", req.body);
// //     const getUser = await req.user;
// //     const user = await User.findOne({ _id: getUser._id });
// //     if (!user)
// //       return res.status(400).json({ error: true, message: "The requester cannot be found" });

// //     const { error } = experiance_letter_BodyValidation(req.body);
// //     if (error)
// //       return res.status(400).json({ error: true, message: error.details[0].message });

// //     req.body.domain_user = user.user;

// //     const hrInfo = await test(user.user);

// //     console.log("hrInfohrInfohrInfohrInfohrInfohrInfohrInfo", hrInfo)

// //     if (!hrInfo || hrInfo.length === 0) {
// //       return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
// //     }

// //     if(hrInfo[0].Name.toLowerCase() !== req.body.employee_first_name.toLowerCase()){
// //       return res.status(400).json({ 
// //         error: true, 
// //         message: `First name mismatch: HRIS shows '${hrInfo[0].Name}' but request contains '${req.body.employee_first_name}'. Please contact HR Team.`
// //       });
// //     }
// //     if(hrInfo[0].FName.toLowerCase() !== req.body.employee_middle_name.toLowerCase()){
// //       return res.status(400).json({ 
// //         error: true, 
// //         message: `Middle name mismatch: HRIS shows '${hrInfo[0].FName}' but request contains '${req.body.employee_middle_name}'. Please contact HR Team.`
// //       });
// //     }
// //     if(hrInfo[0].GFName.toLowerCase() !== req.body.employee_last_name.toLowerCase()){
// //       return res.status(400).json({ 
// //         error: true, 
// //         message: `Last name mismatch: HRIS shows '${hrInfo[0].GFName}' but request contains '${req.body.employee_last_name}'. Please contact HR Team.`
// //       });
// //     }

// //     const formattedExperience = formatExperience(hrInfo);
// //     console.log(JSON.stringify(formattedExperience, null, 2));

// //     const nofExperience = hrInfo.length;
// //     req.body.salary = hrInfo[nofExperience - 1].Salary;
// //     req.body.job_grade = hrInfo[nofExperience - 1].Job_Grade;
// //     await new Experinace({ ...req.body, experiences: formattedExperience }).save();
    
// //     res.status(201).json({ error: false, message: "Experience Request Registered Successfully" });

// //   } catch (e) {
// //     console.log(e);
// //     res.status(500).json({ error: true, message: "Internal Server Error" });
// //   }
// // });



// // router.patch("/view_request_experiance", auth, roleCheck(["admin"]), async (req, res, next) => {
// //   try {

// //     console.log("view_request_experianceview_request_experianceview_request_experiance", req.body)
// //       const id = req.body.id;
// //     const getUser = await req.user;
// //     const user = await User.findOne({ _id: getUser._id });
// //     if (!user)
// //       return res.status(400).json({ error: true, message: "The requester Can not found" });

// //     delete req.body.id;

// //     const { error } = experiance_letter_BodyValidation(req.body);
// //     if (error)
// //       return res.status(400).json({ error: true, message: error.details[0].message });


// //   delete req.body.employee_first_name;
// //   delete req.body.employee_middle_name;
// //   delete req.body.employee_last_name;
// //   delete req.body.employee_description;

 
// //   req.body.viewed_by = user.user;
// //   req.body.viewed_date = Date.now();
// //   req.body.status = "Viewed";

// //   req.body.employee_count = 1;


// //   const referenceNumber = await ExperianceCounter.getNextReference();

// //   await Experinace.findOne({ _id: id })
// //   .then((experiance) => {
// //       experiance.viewed_by =  req.body.viewed_by;
// //       experiance.viewed_date = req.body.viewed_date;
// //       experiance.status = req.body.status;
// //       experiance.employee_count = req.body.employee_count;
// //       experiance.reference_number = referenceNumber;
// //     return experiance.save();
// //   })
// //   .then(async (updateResult) => {

// //     if (updateResult) {
// //        try {
// //                     if (originalRequester) {
// //                         const notificationPayload = PushNotificationService.createStatusUpdatePayload(
// //                             'Experinence',
// //                             'Viewed',
// //                             id
// //                         );
                        
// //                         await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
// //                     }
// //                 } catch (pushError) {
// //                     console.error('Push notification failed:', pushError);
// //                 }

// // res.status(200).json({ error: false, message: "Viewed Experinace Request Successful" });
      
// //     } else {
// //       res.status(404).json({ error: true, message: "Document not found" });
// //     }
// //   })
// //   .catch((error) => {
// //     console.error("Error finding/updating document:", error);
// //     res.status(500).json({ error: true, message: "An error occurred" });
// //   });



// //   }
// //   catch (e) {
// //     console.log(e)
// //     res.status(500).json({ error: true, message: "Internal Server Error" });
// //   }
// // });




// router.patch("/view_request_experiance", auth, roleCheck(["admin"]), async (req, res, next) => {
//   try {
    
//     const id = req.body.id;
//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user)
//       return res.status(400).json({ error: true, message: "The requester Can not found" });

//     delete req.body.id;

//     // const { error } = experiance_letter_BodyValidation(req.body);
//     // if (error)
//     //   return res.status(400).json({ error: true, message: error.details[0].message });

//     // Get original request to find the requester
//     const originalRequest = await Experinace.findById(id);
//     if (!originalRequest) {
//       return res.status(404).json({ error: true, message: "Request not found" });
//     }

//        if(originalRequest.domain_user ===  user.user){
//       return res.status(400).json({ error: true, message: "You cannot Approve your own request" });
//     }

//     // Get the original requester
//     const originalRequester = await User.findOne({ user: originalRequest.domain_user });

//     delete req.body.employee_first_name;
//     delete req.body.employee_middle_name;
//     delete req.body.employee_last_name;
//     delete req.body.employee_description;

//     req.body.viewed_by = user.user;
//     req.body.viewed_date = Date.now();
//     req.body.status = "Viewed";
//     req.body.employee_count = 1;

//     const referenceNumber = await ExperianceCounter.getNextReference();

//     await Experinace.findOne({ _id: id })
//     .then((experiance) => {
//       experiance.viewed_by =  req.body.viewed_by;
//       experiance.viewed_date = req.body.viewed_date;
//       experiance.status = req.body.status;
//       experiance.employee_count = req.body.employee_count;
//       experiance.reference_number = referenceNumber;
//       return experiance.save();
//     })
//     .then(async (updateResult) => {
//       if (updateResult) {
//         // Send push notification to the original requester
//         try {
//           if (originalRequester) {
//             const notificationPayload = PushNotificationService.createStatusUpdatePayload(
//               'Experience',
//               'Viewed',
//               id
//             );
            
//             await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
//           }
//         } catch (pushError) {
//           console.error('Push notification failed:', pushError);
//         }

//         res.status(200).json({ error: false, message: "Viewed Experinace Request Successful" });
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





// router.patch("/reject_request_experiance", auth, roleCheck(["admin"]), async (req, res, next) => {
//     try {
//         console.log("reject_request", req.body);
//         const { id, request_type = 'Experience'} = req.body;
        
//         const getUser = await req.user;
//         const user = await User.findOne({ _id: getUser._id });
//         if (!user)
//             return res.status(400).json({ error: true, message: "The requester cannot be found" });

//         // Determine which model to use based on request_type
//         let RequestModel;
//         switch(request_type) {
//             case "Experience":
//                 RequestModel = Experinace;
//                 break;
//             case "Guranty":
//                 RequestModel = Guaranty;
//                 break;
//             case "Supportive":
//                 RequestModel = Supportive;
//                 break;
//             case "Embassy":
//                 RequestModel = Embassy;
//                 break;    
//             default:
//                 return res.status(400).json({ error: true, message: "Invalid request type" });
//         }

//         // First check if the request exists and is pending
//         const request = await RequestModel.findOne({ _id: id });
//         if (!request) {
//             return res.status(404).json({ error: true, message: `${request_type} request not found` });
//         }

//         if (request.status !== "Pending") {
//             return res.status(400).json({ 
//                 error: true, 
//                 message: "Only pending requests can be rejected" 
//             });
//         }

//         delete req.body.id;
//         delete req.body.request_type;
        

//         // Update the request status to Rejected
//         request.viewed_by = user.user;
//         request.viewed_date = Date.now();
//         request.status = "Rejected";
//         // request.rejection_reason = req.body.rejection_reason || "No reason provided";

//         await request.save();

//         res.status(200).json({ 
//             error: false, 
//             message: `${request_type} request rejected successfully` 
//         });
//     }
//     catch (e) {
//         console.log(e);
//         res.status(500).json({ error: true, message: "Internal Server Error" });
//     }
// });

// export default router;






































































import { Router } from "express";

import auth from "../../middleware/rms/auth.js";

import roleCheck from "../../middleware/rms/roleCheck.js";

import User from "../../models/rms/User.js";

import Experinace from "../../models/rms/Experiance_Letter.js";

import Guaranty from "../../models/rms/Guaranty_Letter.js";

import Supportive from "../../models/rms/Supportive_Letter.js";

import Embassy from "../../models/rms/Letter_of_Embassy.js";

import { experiance_letter_BodyValidation } from "../../utils/rms/serveService.js";

import ExperianceCounter from "../../models/rms/ExperianceCounter.js";

import PushNotificationService from "../../utils/rms/pushNotificationService.js";

import {test} from "../../utils/rms/test.js"

import mongoose from 'mongoose';





const router = Router();



function formatDate(date) {

  const options = { year: 'numeric', month: 'long', day: 'numeric' };

  return new Date(date).toLocaleDateString('en-US', options);

}



// Format name to proper case: "ROBEL" -> "Robel", "robel" -> "Robel", "ROBEL ASFAW" -> "Robel Asfaw"

function formatName(name) {

  if (!name) return '';

  return name

    .toLowerCase()

    .split(' ')

    .map(word => word.charAt(0).toUpperCase() + word.slice(1))

    .join(' ');

}



function formatExperience(hrInfo) {

  return hrInfo.map(job => {

    const fromDate = formatDate(job.From);

    const toDate = job.To ? formatDate(job.To) : 'date';

    const position = job.Postion;



    return {

      period: `From ${fromDate} to ${toDate}`,

      position: position,

      isCurrent: job.To === null

    };

  });

}







router.post("/register_request_experiance", auth, roleCheck(["user","admin"]), async (req, res, next) => {

  try {

    console.log("register_request_experiance", req.body);

    if(req.body.employee_description.length > 100){
      return res.status(400).json({ error: true, message: "Description is too long" });
    }

    const getUser = await req.user;

    const user = await User.findOne({ _id: getUser._id });

    if (!user)

      return res.status(400).json({ error: true, message: "The requester cannot be found" });



    // CHECK FOR RECENT REQUESTS - 90 DAY RESTRICTION

    const ninetyDaysAgo = new Date();

    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    

    const recentRequest = await Experinace.findOne({

      domain_user: user.user,

      request_type: "Experience",

      status: { $in: ["Pending", "Viewed"] },

      TimeStamp: { $gte: ninetyDaysAgo }

    }).sort({ TimeStamp: -1 });



    if (recentRequest) {

      const lastRequestDate = new Date(recentRequest.TimeStamp);

      const daysSinceLastRequest = Math.floor((new Date() - lastRequestDate) / (1000 * 60 * 60 * 24));

      const daysRemaining = 90 - daysSinceLastRequest;

      

      return res.status(400).json({ 

        error: true, 

        message: `You cannot request an experience letter within 90 days of your last request. Please wait ${daysRemaining} more day${daysRemaining !== 1 ? 's' : ''} before submitting a new request. Your last request was on ${formatDate(lastRequestDate)}.`

      });

    }



    const { error } = experiance_letter_BodyValidation(req.body);

    if (error)

      return res.status(400).json({ error: true, message: error.details[0].message });



    req.body.domain_user = user.user;

    const hrInfo = await test(user.user);

    console.log("hrInfohrInfohrInfohrInfohrInfohrInfohrInfo", hrInfo)

    

    if (!hrInfo || hrInfo.length === 0) {

      return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });

    }

    

    if(hrInfo[0].Name.toLowerCase() !== req.body.employee_first_name.toLowerCase()){

      return res.status(400).json({

        error: true,

        message: `First name mismatch: HRIS shows '${hrInfo[0].Name}' but request contains '${req.body.employee_first_name}'. Please contact HR Team.`

      });

    }

    

    if(hrInfo[0].FName.toLowerCase() !== req.body.employee_middle_name.toLowerCase()){

      return res.status(400).json({

        error: true,

        message: `Middle name mismatch: HRIS shows '${hrInfo[0].FName}' but request contains '${req.body.employee_middle_name}'. Please contact HR Team.`

      });

    }

    

    if(hrInfo[0].GFName.toLowerCase() !== req.body.employee_last_name.toLowerCase()){

      return res.status(400).json({

        error: true,

        message: `Last name mismatch: HRIS shows '${hrInfo[0].GFName}' but request contains '${req.body.employee_last_name}'. Please contact HR Team.`

      });

    }

    

    const formattedExperience = formatExperience(hrInfo);

    console.log(JSON.stringify(formattedExperience, null, 2));

    const nofExperience = hrInfo.length;

    req.body.salary = hrInfo[nofExperience - 1].Salary;

    req.body.job_grade = hrInfo[nofExperience - 1].Job_Grade;

    

    const savedRequest = await new Experinace({ ...req.body, experiences: formattedExperience }).save();





  try {

      const requesterName = `${user.first_name} ${user.last_name}`;

      const notificationPayload = PushNotificationService.createNewRequestPayload(

        'Experienece',

        requesterName,

        savedRequest._id

      );

      

      await PushNotificationService.sendToRole('admin', notificationPayload);

    } catch (pushError) {

      console.error('Push notification failed:', pushError);

      // Don't fail the request if push notification fails

    }







   

    res.status(201).json({ error: false, message: "Experience Request Registered Successfully" });

  } catch (e) {

    console.log(e);

    res.status(500).json({ error: true, message: "Internal Server Error" });

  }

});







router.patch("/view_request_experiance", auth, roleCheck(["admin"]), async (req, res, next) => {

  try {

    

    const id = req.body.id;

    const getUser = await req.user;

    const user = await User.findOne({ _id: getUser._id });

    if (!user)

      return res.status(400).json({ error: true, message: "The requester Can not found" });



    delete req.body.id;



    // Get original request to find the requester

    const originalRequest = await Experinace.findById(id);

    if (!originalRequest) {

      return res.status(404).json({ error: true, message: "Request not found" });

    }



    if(originalRequest.domain_user === user.user){

      return res.status(400).json({ error: true, message: "You cannot Approve your own request" });

    }



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

    

    // Format the updated experience data

    const formattedExperience = formatExperience(hrInfo);

    console.log("Updated experience data:", JSON.stringify(formattedExperience, null, 2));

    

    // Get updated salary and job grade from the latest HRIS record

    const nofExperience = hrInfo.length;

    const updatedSalary = hrInfo[nofExperience - 1].Salary;

    const updatedJobGrade = hrInfo[nofExperience - 1].Job_Grade;

    

    // Get updated name fields from HRIS and format to proper case (Robel instead of ROBEL)

    const updatedFirstName = formatName(hrInfo[0].Name);

    const updatedMiddleName = formatName(hrInfo[0].FName);

    const updatedLastName = formatName(hrInfo[0].GFName);

    // ============ END OF HRIS DATA REFRESH ============



    delete req.body.employee_first_name;

    delete req.body.employee_middle_name;

    delete req.body.employee_last_name;

    delete req.body.employee_description;



    req.body.viewed_by = user.user;

    req.body.viewed_date = Date.now();

    req.body.status = "Viewed";

    req.body.employee_count = 1;



    const referenceNumber = await ExperianceCounter.getNextReference();



    await Experinace.findOne({ _id: id })

    .then((experiance) => {

      // Update status and approval info

      experiance.viewed_by = req.body.viewed_by;

      experiance.viewed_date = req.body.viewed_date;

      experiance.status = req.body.status;

      experiance.employee_count = req.body.employee_count;

      experiance.reference_number = referenceNumber;

      

      // Update HRIS data with fresh values (names formatted to proper case)

      experiance.employee_first_name = updatedFirstName;

      experiance.employee_middle_name = updatedMiddleName;

      experiance.employee_last_name = updatedLastName;

      experiance.salary = updatedSalary;

      experiance.job_grade = updatedJobGrade;

      experiance.experiences = formattedExperience;

      
      return experiance.save();

    })

    .then(async (updateResult) => {

      if (updateResult) {

        // Send push notification to the original requester

        try {

          if (originalRequester) {

            const notificationPayload = PushNotificationService.createStatusUpdatePayload(

              'Experience',

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

          message: "Viewed Experinace Request Successful",

          updatedData: {

            salary: updatedSalary,

            job_grade: updatedJobGrade,

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











router.patch("/reject_request_experiance", auth, roleCheck(["admin"]), async (req, res, next) => {

    try {

        console.log("reject_request", req.body);

        const { id, request_type = 'Experience'} = req.body;

        

        const getUser = await req.user;

        const user = await User.findOne({ _id: getUser._id });

        if (!user)

            return res.status(400).json({ error: true, message: "The requester cannot be found" });



        // Determine which model to use based on request_type

        let RequestModel;

        switch(request_type) {

            case "Experience":

                RequestModel = Experinace;

                break;

            case "Guranty":

                RequestModel = Guaranty;

                break;

            case "Supportive":

                RequestModel = Supportive;

                break;

            case "Embassy":

                RequestModel = Embassy;

                break;    

            default:

                return res.status(400).json({ error: true, message: "Invalid request type" });

        }



        // First check if the request exists and is pending

        const request = await RequestModel.findOne({ _id: id });

        if (!request) {

            return res.status(404).json({ error: true, message: `${request_type} request not found` });

        }



        if (request.status !== "Pending") {

            return res.status(400).json({ 

                error: true, 

                message: "Only pending requests can be rejected" 

            });

        }



        delete req.body.id;

        delete req.body.request_type;

        



        // Update the request status to Rejected

        request.viewed_by = user.user;

        request.viewed_date = Date.now();

        request.status = "Rejected";

        // request.rejection_reason = req.body.rejection_reason || "No reason provided";



        await request.save();



        res.status(200).json({ 

            error: false, 

            message: `${request_type} request rejected successfully` 

        });

    }

    catch (e) {

        console.log(e);

        res.status(500).json({ error: true, message: "Internal Server Error" });

    }

});



export default router;

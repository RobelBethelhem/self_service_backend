// embassyRoutes.js
import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import Embassy from "../../models/rms/Letter_of_Embassy.js";
import { letter_of_embassy_BodyValidation } from "../../utils/rms/serveService.js";
import EmbassyCounter from "../../models/rms/EmbassyCounter.js";
import PushNotificationService from "../../utils/rms/pushNotificationService.js";
import { test, getEmploymentDate } from "../../utils/rms/test.js";
import mongoose from 'mongoose';

const router = Router();

router.post("/register_request_embassy", auth, roleCheck(["user","admin"]), async (req, res, next) => {
  try {
    console.log("req.body", req.body);
     if(req.body.employee_description.length > 100){
      return res.status(400).json({ error: true, message: "Description is too long" });
    }

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester cannot be found" });


    const recentRequest = await Embassy.findOne({

      domain_user: user.user,

      request_type: "Embassy",

      status: { $in: ["Pending"] },


    }).sort({ TimeStamp: -1 });

    if (recentRequest) {
      return res.status(400).json({ error: true, message: "A pending Embassy request already exists" });
    }


    // Validate with existing Joi schema (only validates fields sent in request)
    const { error } = letter_of_embassy_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    req.body.domain_user = user.user;
   
    // Fetch HR information
    const hrInfo = await test(user.user);
    if (!hrInfo || hrInfo.length === 0) {
      return res.status(400).json({ error: true, message: "Cannot find the User in HRIS System. Please Contact HR Team" });
    }

    const nofExperience = hrInfo.length;
    const latestHrInfo = hrInfo[nofExperience - 1];

    // Validate names against HRIS
    if (latestHrInfo.Name.toLowerCase() !== req.body.employee_first_name.toLowerCase().trim()) {
      return res.status(400).json({
        error: true,
        message: `First name mismatch: HRIS shows '${latestHrInfo.Name}' but request contains '${req.body.employee_first_name}'. Please contact HR Team.`
      });
    }
   
    if (latestHrInfo.FName.toLowerCase() !== req.body.employee_middle_name.toLowerCase().trim()) {
      return res.status(400).json({
        error: true,
        message: `Middle name mismatch: HRIS shows '${latestHrInfo.FName}' but request contains '${req.body.employee_middle_name}'. Please contact HR Team.`
      });
    }
   
    if (latestHrInfo.GFName.toLowerCase() !== req.body.employee_last_name.toLowerCase().trim()) {
      return res.status(400).json({
        error: true,
        message: `Last name mismatch: HRIS shows '${latestHrInfo.GFName}' but request contains '${req.body.employee_last_name}'. Please contact HR Team.`
      });
    }

    // Get employment date
    const hrEmployeeDate = await getEmploymentDate(user.user);
    if (!hrEmployeeDate || !hrEmployeeDate.EmploymentDate) {
      return res.status(400).json({ error: true, message: "Cannot find the Employment Date in HRIS System. Please Contact HR Team" });
    }

    // Add HRIS data to request body AFTER validation
    req.body.date_of_employment = new Date(hrEmployeeDate.EmploymentDate);
    req.body.employee_position = latestHrInfo.Postion;
   
    // Calculate annual salary (monthly salary * 12)
    const monthlySalary = parseFloat(latestHrInfo.Salary);
    req.body.annual_salary = monthlySalary * 12;

    const savedRequest = await new Embassy({ ...req.body }).save();

    // Send push notification to all admins
    try {
      const requesterName = `${user.first_name} ${user.last_name}`;
      const notificationPayload = PushNotificationService.createNewRequestPayload(
        'Embassy',
        requesterName,
        savedRequest._id
      );
     
      await PushNotificationService.sendToRole('admin', notificationPayload);
    } catch (pushError) {
      console.error('Push notification failed:', pushError);
      // Don't fail the request if push notification fails
    }

    res.status(201).json({ error: false, message: "Embassy Request Registered Successfully" });

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

router.patch("/view_request_embassy", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    const id = req.body.id;
   
    if (!id) {
      return res.status(400).json({ error: true, message: "Request ID is required" });
    }

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester cannot be found" });

    // Get original request to find the requester
    const originalRequest = await Embassy.findById(id);
    if (!originalRequest) {
      return res.status(404).json({ error: true, message: "Request not found" });
    }

       if(originalRequest.domain_user ===  user.user){
      return res.status(400).json({ error: true, message: "You cannot Approve your own request" });
    }

    // Get the original requester
    const originalRequester = await User.findOne({ user: originalRequest.domain_user });

    const reference_number = await EmbassyCounter.getNextReference();

    await Embassy.findOne({ _id: id })
      .then((embassy) => {
        if (!embassy) {
          throw new Error("Embassy request not found");
        }
        embassy.viewed_by = user.user;
        embassy.viewed_date = Date.now();
        embassy.status = "Viewed";
        embassy.reference_number = reference_number;
        return embassy.save();
      })
      .then(async (updateResult) => {
        if (updateResult) {
          // Send push notification to the original requester
          try {
            if (originalRequester) {
              const notificationPayload = PushNotificationService.createStatusUpdatePayload(
                'Embassy',
                'Viewed',
                id
              );
             
              await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
            }
          } catch (pushError) {
            console.error('Push notification failed:', pushError);
          }

          res.status(200).json({ error: false, message: "Viewed Embassy Request Successful" });
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


router.patch("/reject_request_embassy", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { id } = req.body;
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
   
    if (!user) {
      return res.status(400).json({ error: true, message: "The requester cannot be found" });
    }

    // Get original request to find the requester
    const originalRequest = await Embassy.findById(id);
    if (!originalRequest) {
      return res.status(404).json({ error: true, message: "Request not found" });
    }

    // Get the original requester
    const originalRequester = await User.findOne({ user: originalRequest.domain_user });

    // Update the request status to rejected
    const updateResult = await Embassy.findByIdAndUpdate(id, {
      status: "Rejected",
      viewed_by: user.user,
      viewed_date: new Date(),
      
    }, { new: true });

    if (updateResult) {
      // Send push notification to the original requester
      try {
        if (originalRequester) {
          const notificationPayload = PushNotificationService.createStatusUpdatePayload(
            'Embassy',
            'Rejected',
            id
          );
         
          await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
        }
      } catch (pushError) {
        console.error('Push notification failed:', pushError);
      }

      res.status(200).json({ error: false, message: "Embassy Request Rejected Successfully" });
    } else {
      res.status(404).json({ error: true, message: "Document not found" });
    }

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

export default router;
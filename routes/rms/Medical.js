// MEDICAL ROUTES - medicalRoutes.js
import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import Medical from "../../models/rms/Medical.js";
import { medical_BodyValidation } from "../../utils/rms/serveService.js";
import MedicalCounter from "../../models/rms/MedicalCounter.js";
import PushNotificationService from "../../utils/rms/pushNotificationService.js";
import { getEmploymentDate, getPlaceOfAssignment } from "../../utils/rms/test.js";
import mongoose from 'mongoose';

const router = Router();

// POST: Register Medical Request
router.post("/register_request_medical", auth, roleCheck(["user", "admin"]), async (req, res, next) => {
  try {
    console.log("req.body", req.body);

     if(req.body.employee_description.length > 100){
      return res.status(400).json({ error: true, message: "Description is too long" });
    }

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester cannot be found" });

    const { error } = medical_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    req.body.domain_user = user.user;

    // Get employee_id_no from HRIS system
    const hrEmployeeData = await getEmploymentDate(user.user);

    if (!hrEmployeeData || !hrEmployeeData.EmployeeId) {
      return res.status(400).json({ 
        error: true, 
        message: "Cannot find the Employee ID in HRIS System. Please Contact HR Team" 
      });
    }

    // Set employee_id_no from HRIS
    req.body.employee_id_no = hrEmployeeData.EmployeeId;

    // Get place_of_assignment from HRIS system
    const hrPlaceOfAssignment = await getPlaceOfAssignment(user.user);

    if (!hrPlaceOfAssignment || !hrPlaceOfAssignment.PositionName) {
      return res.status(400).json({ 
        error: true, 
        message: "Cannot find the Place of Assignment in HRIS System. Please Contact HR Team" 
      });
    }

    // Set place_of_assignment from HRIS
    req.body.place_of_assignment = hrPlaceOfAssignment.PositionName;

    // Validate is_Spouse logic
    if (req.body.is_Spouse) {
      // If is_Spouse is true, spouse fields should be provided
      if (!req.body.spouse_first_name || !req.body.spouse_middle_name || !req.body.spouse_last_name) {
        return res.status(400).json({
          error: true,
          message: "Spouse names are required when is_Spouse is true"
        });
      }
    }

    // Save the medical request
    const savedRequest = await new Medical({ ...req.body }).save();

    // Send push notification to all admins
    try {
      const requesterName = `${user.first_name} ${user.last_name}`;
      const notificationPayload = PushNotificationService.createNewRequestPayload(
        'Medical',
        requesterName,
        savedRequest._id
      );
      
      await PushNotificationService.sendToRole('admin', notificationPayload);
    } catch (pushError) {
      console.error('Push notification failed:', pushError);
      // Don't fail the request if push notification fails
    }

    res.status(201).json({ error: false, message: "Medical Request Registered Successfully" });

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

// PATCH: View/Approve Medical Request
// PATCH: View/Approve Medical Request - FIXED VERSION
router.patch("/view_request_medical", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    const id = req.body.id;
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester cannot be found" });

    // Get original request to find the requester
    const originalRequest = await Medical.findById(id);
    if (!originalRequest) {
      return res.status(404).json({ error: true, message: "Request not found" });
    }


       if(originalRequest.domain_user ===  user.user){
      return res.status(400).json({ error: true, message: "You cannot Approve your own request" });
    }
    

    // Get the original requester
    const originalRequester = await User.findOne({ user: originalRequest.domain_user });

    // Remove fields that shouldn't be updated by admin BEFORE validation
    delete req.body.id;
    const varIs_Spouse = originalRequest.is_Spouse;
    delete req.body.is_Spouse;
    delete req.body.medical_place;
    delete req.body.spouse_first_name;
    delete req.body.spouse_middle_name;
    delete req.body.spouse_last_name;
    delete req.body.child_first_name;
    delete req.body.chid_middle_name;
    delete req.body.child_last_name;
    delete req.body.employee_description;
    delete req.body.place_of_assignment;
    delete req.body.name_of_supervisor;

    // Now validate (should pass with empty object or minimal fields)
    // const { error } = medical_BodyValidation(req.body);
    // if (error)
    //   return res.status(400).json({ error: true, message: error.details[0].message });

    // Set approval fields
    req.body.viewed_by = user.user;
    req.body.viewed_date = Date.now();
    req.body.status = "Viewed";
    req.body.employee_count = 1;

    // Generate reference number using MedicalCounter
    const reference_number = await MedicalCounter.getNextReference(varIs_Spouse);

    await Medical.findOne({ _id: id })
      .then((medical) => {
        medical.viewed_by = req.body.viewed_by;
        medical.viewed_date = req.body.viewed_date;
        medical.status = req.body.status;
        medical.employee_count = req.body.employee_count;
        medical.reference_number = reference_number;
        return medical.save();
      })
      .then(async (updateResult) => {
        if (updateResult) {
          // Send push notification to the original requester
          try {
            if (originalRequester) {
              const notificationPayload = PushNotificationService.createStatusUpdatePayload(
                'Medical',
                'Viewed',
                id
              );
              
              await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
            }
          } catch (pushError) {
            console.error('Push notification failed:', pushError);
          }

          res.status(200).json({ error: false, message: "Viewed Medical Request Successful" });
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

// PATCH: Reject Medical Request
router.patch("/reject_request_medical", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { id, rejection_reason } = req.body;
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    
    if (!user) {
      return res.status(400).json({ error: true, message: "The requester cannot be found" });
    }

    // Get original request to find the requester
    const originalRequest = await Medical.findById(id);
    if (!originalRequest) {
      return res.status(404).json({ error: true, message: "Request not found" });
    }

    // Get the original requester
    const originalRequester = await User.findOne({ user: originalRequest.domain_user });

    // Update the request status to rejected
    const updateResult = await Medical.findByIdAndUpdate(id, {
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
            'Medical',
            'Rejected',
            id
          );
          
          await PushNotificationService.sendToUser(originalRequester._id, notificationPayload);
        }
      } catch (pushError) {
        console.error('Push notification failed:', pushError);
      }

      res.status(200).json({ error: false, message: "Medical Request Rejected Successfully" });
    } else {
      res.status(404).json({ error: true, message: "Document not found" });
    }

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

export default router;

// MEDICAL ROUTES - medicalRoutes.js
import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import Medical from "../../models/rms/Medical.js";
import { medical_BodyValidation } from "../../utils/rms/serveService.js";
import MedicalCounter from "../../models/rms/MedicalCounter.js";
import PushNotificationService from "../../utils/rms/pushNotificationService.js";
import { getEmploymentDate, getPlaceOfAssignment, getEmployeeIdentity } from "../../utils/rms/test.js";
import mongoose from 'mongoose';

const router = Router();

// Validates a hand-typed place of assignment — used when HRIS has no value for
// the employee and either the employee or the approver supplies one.
//
// The character check is not cosmetic: the candidate list endpoint
// (routes/rms/Admin/Landing/Candidate_Landing.js) DROPS any document whose
// string fields contain < > script iframe or alert. A value carrying one of
// those would make the request silently vanish from every list rather than
// merely look wrong, so it is rejected at the point of entry instead.
const sanitizePlaceOfAssignment = (raw) => {
  const value = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();

  if (!value) {
    return { ok: false, message: "Place of Assignment is required" };
  }
  if (value.length < 2 || value.length > 120) {
    return {
      ok: false,
      message: "Place of Assignment must be between 2 and 120 characters",
    };
  }
  if (/[<>]|script|iframe|alert/i.test(value)) {
    return {
      ok: false,
      message:
        "Place of Assignment contains characters that are not allowed. Please enter the branch or department name in plain text.",
    };
  }
  return { ok: true, value };
};

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

    // Place of assignment normally comes from HRIS. Some HRIS records are
    // incomplete, and dead-ending the employee there means they cannot request
    // a medical slip at all until someone fixes the source data. Instead the
    // client is told to prompt for it, the typed value is flagged, and the
    // approver verifies it while cleaning the HRIS record.
    //
    // HRIS ALWAYS wins when it has a value. The manual field is only consulted
    // when HRIS genuinely has nothing, so this cannot be used to override a
    // correct HRIS record.
    const hrPlaceOfAssignment = await getPlaceOfAssignment(user.user);
    const hrisPlace =
      hrPlaceOfAssignment && hrPlaceOfAssignment.PositionName
        ? String(hrPlaceOfAssignment.PositionName).trim()
        : "";

    if (hrisPlace) {
      req.body.place_of_assignment = hrisPlace;
      req.body.place_of_assignment_source = "hris";
    } else {
      const supplied = String(req.body.place_of_assignment || "").trim();

      if (!supplied) {
        return res.status(400).json({
          error: true,
          // Machine-readable so the client can open the "type it in" prompt
          // rather than showing the message as a dead end. The message text is
          // unchanged for any older client that only reads that.
          code: "PLACE_OF_ASSIGNMENT_REQUIRED",
          message:
            "Cannot find the Place of Assignment in HRIS System. Please Contact HR Team",
        });
      }

      const manual = sanitizePlaceOfAssignment(supplied);
      if (!manual.ok) {
        return res.status(400).json({
          error: true,
          code: "PLACE_OF_ASSIGNMENT_INVALID",
          message: manual.message,
        });
      }

      req.body.place_of_assignment = manual.value;
      req.body.place_of_assignment_source = "manual";
      console.warn(
        `[medical] HRIS has no place of assignment for '${user.user}' — ` +
          `employee supplied "${manual.value}" manually; flagged for approver verification`
      );
    }

    // Pull canonical name parts from HRIS so the slip prints the real
    // employee name regardless of how the AD username was assembled.
    // Best-effort: if HRIS is unreachable, fall back to splitting
    // domain_user (the legacy behavior) so we don't block submission.
    try {
      const hrIdentity = await getEmployeeIdentity(user.user);
      if (hrIdentity) {
        req.body.employee_first_name = hrIdentity.Name || '';
        req.body.employee_middle_name = hrIdentity.FName || '';
        req.body.employee_last_name = hrIdentity.GFName || '';
      } else {
        const parts = String(user.user || '').split('.');
        req.body.employee_first_name = parts[0] || '';
        req.body.employee_middle_name = parts[1] || '';
        req.body.employee_last_name = parts.slice(2).join(' ') || '';
      }
    } catch (idErr) {
      console.error('HRIS identity lookup failed (register medical):', idErr.message);
      const parts = String(user.user || '').split('.');
      req.body.employee_first_name = parts[0] || '';
      req.body.employee_middle_name = parts[1] || '';
      req.body.employee_last_name = parts.slice(2).join(' ') || '';
    }

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
    delete req.body.name_of_supervisor;

    // place_of_assignment is HRIS-owned and normally not the approver's to
    // change. The one exception is a request whose value was typed in by the
    // employee because HRIS had none — see the register handler. Captured
    // before the delete so the generic "admins cannot edit these" rule below
    // still holds for every other case.
    const adminPlaceOverride = req.body.place_of_assignment;
    delete req.body.place_of_assignment;

    // Accept an optional approval_date from the admin so they can back-date
    // a medical slip when the actual visit happened earlier. Future dates
    // are rejected; missing/invalid values fall back to now.
    let approvalDate = new Date();
    if (req.body.approval_date) {
      const parsed = new Date(req.body.approval_date);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: true, message: "Invalid approval date" });
      }
      // Compare end-of-day in case the picker sends a midnight ISO; today must be allowed.
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      if (parsed.getTime() > endOfToday.getTime()) {
        return res.status(400).json({ error: true, message: "Approval date cannot be in the future" });
      }
      approvalDate = parsed;
    }
    delete req.body.approval_date;

    // Re-fetch HRIS names at approval time so we capture the latest values
    // (employee may have had their record updated since submission). Falls
    // back to whatever the request was originally saved with.
    let approvalNames = {
      employee_first_name: originalRequest.employee_first_name,
      employee_middle_name: originalRequest.employee_middle_name,
      employee_last_name: originalRequest.employee_last_name,
    };
    try {
      const hrIdentity = await getEmployeeIdentity(originalRequest.domain_user);
      if (hrIdentity) {
        approvalNames = {
          employee_first_name: hrIdentity.Name || approvalNames.employee_first_name || '',
          employee_middle_name: hrIdentity.FName || approvalNames.employee_middle_name || '',
          employee_last_name: hrIdentity.GFName || approvalNames.employee_last_name || '',
        };
      }
    } catch (idErr) {
      console.error('HRIS identity lookup failed (approve medical):', idErr.message);
    }

    // Resolve the place of assignment for a request that was submitted with a
    // manually typed value.
    //
    // Order matters: the approver's correction is applied first, then HRIS is
    // re-checked and wins if it now has a value. That makes the flag
    // self-healing — once HR cleans the record, the slip picks up the real
    // value and the warning disappears on its own with no edit here.
    let resolvedPlace = {
      value: originalRequest.place_of_assignment,
      source: originalRequest.place_of_assignment_source || "hris",
    };

    if (resolvedPlace.source === "manual") {
      if (adminPlaceOverride !== undefined && String(adminPlaceOverride).trim()) {
        const corrected = sanitizePlaceOfAssignment(adminPlaceOverride);
        if (!corrected.ok) {
          return res.status(400).json({ error: true, message: corrected.message });
        }
        resolvedPlace = { value: corrected.value, source: "manual" };
      }

      try {
        const hrPlace = await getPlaceOfAssignment(originalRequest.domain_user);
        const hrisPlace =
          hrPlace && hrPlace.PositionName ? String(hrPlace.PositionName).trim() : "";
        if (hrisPlace) {
          resolvedPlace = { value: hrisPlace, source: "hris" };
          console.log(
            `[medical] HRIS now has a place of assignment for '${originalRequest.domain_user}' — ` +
              "manual value replaced at approval and the flag cleared"
          );
        }
      } catch (placeErr) {
        // Never block an approval on an HRIS hiccup — keep what we have.
        console.error(
          "HRIS place-of-assignment re-check failed (approve medical):",
          placeErr.message
        );
      }
    }

    // Set approval fields
    req.body.viewed_by = user.user;
    req.body.viewed_date = approvalDate;
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
        medical.employee_first_name = approvalNames.employee_first_name;
        medical.employee_middle_name = approvalNames.employee_middle_name;
        medical.employee_last_name = approvalNames.employee_last_name;
        medical.place_of_assignment = resolvedPlace.value;
        medical.place_of_assignment_source = resolvedPlace.source;
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

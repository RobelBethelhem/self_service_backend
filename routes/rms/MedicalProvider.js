import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import MedicalProvider from "../../models/rms/MedicalProvider.js";
import { medicalProvider_BodyValidation } from "../../utils/rms/serveService.js";

const router = Router();

// POST: Create Medical Provider
router.post("/register_medical_provider", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    console.log("req.body", req.body);

    // Validate request body
    const { error } = medicalProvider_BodyValidation(req.body);
    if (error) {
      return res.status(400).json({ 
        error: true, 
        message: error.details[0].message 
      });
    }

    // Check if short_code already exists
    const existingProvider = await MedicalProvider.findOne({ 
      short_code: req.body.short_code.toUpperCase() 
    });
    
    if (existingProvider) {
      return res.status(400).json({ 
        error: true, 
        message: "Medical Provider with this short code already exists" 
      });
    }

    // Save the medical provider
    const savedProvider = await new MedicalProvider({ ...req.body }).save();

    res.status(201).json({ 
      error: false, 
      message: "Medical Provider Registered Successfully",
      data: savedProvider
    });

  } catch (e) {
    console.log(e);
    if (e.code === 11000) {
      return res.status(400).json({ 
        error: true, 
        message: "Medical Provider with this short code already exists" 
      });
    }
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

// GET: Get All Medical Providers
router.get("/get_all_medical_providers", auth, roleCheck(["admin", "user"]), async (req, res) => {
  try {
    const providers = await MedicalProvider.find().sort({ TimeStamp: -1 });
    
    res.status(200).json({ 
      error: false, 
      message: "Medical Providers Retrieved Successfully",
      data: providers,
      count: providers.length
    });

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

// GET: Get Medical Provider by ID
router.get("/get_medical_provider/:id", auth, roleCheck(["admin", "user"]), async (req, res) => {
  try {
    const { id } = req.params;

    const provider = await MedicalProvider.findById(id);
    
    if (!provider) {
      return res.status(404).json({ 
        error: true, 
        message: "Medical Provider not found" 
      });
    }

    res.status(200).json({ 
      error: false, 
      message: "Medical Provider Retrieved Successfully",
      data: provider
    });

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

// PATCH: Update Medical Provider
router.patch("/update_medical_provider", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { id, ...updateData } = req.body;

    if (!id) {
      return res.status(400).json({ 
        error: true, 
        message: "Provider ID is required" 
      });
    }

    // Validate update data
    const { error } = medicalProvider_BodyValidation(updateData);
    if (error) {
      return res.status(400).json({ 
        error: true, 
        message: error.details[0].message 
      });
    }

    // Check if provider exists
    const existingProvider = await MedicalProvider.findById(id);
    if (!existingProvider) {
      return res.status(404).json({ 
        error: true, 
        message: "Medical Provider not found" 
      });
    }

    // Check if short_code is being updated and if it's already taken
    if (updateData.short_code && updateData.short_code.toUpperCase() !== existingProvider.short_code) {
      const duplicateProvider = await MedicalProvider.findOne({ 
        short_code: updateData.short_code.toUpperCase(),
        _id: { $ne: id }
      });
      
      if (duplicateProvider) {
        return res.status(400).json({ 
          error: true, 
          message: "Another Medical Provider with this short code already exists" 
        });
      }
    }

    // Update the provider
    const updatedProvider = await MedicalProvider.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({ 
      error: false, 
      message: "Medical Provider Updated Successfully",
      data: updatedProvider
    });

  } catch (e) {
    console.log(e);
    if (e.code === 11000) {
      return res.status(400).json({ 
        error: true, 
        message: "Medical Provider with this short code already exists" 
      });
    }
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

// DELETE: Delete Medical Provider
router.delete("/delete_medical_provider/:id", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;

    const deletedProvider = await MedicalProvider.findByIdAndDelete(id);
    
    if (!deletedProvider) {
      return res.status(404).json({ 
        error: true, 
        message: "Medical Provider not found" 
      });
    }

    res.status(200).json({ 
      error: false, 
      message: "Medical Provider Deleted Successfully",
      data: deletedProvider
    });

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

export default router;
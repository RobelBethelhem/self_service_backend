import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";
import Building from "../../../models/rms/Building.js";
import Site from "../../../models/rms/Site.js";
import User from "../../../models/rms/User.js";
import { buildingBodyValidation } from "../../../utils/rms/buildingBodyValidation.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/register_building", auth, roleCheck(["admin","site_manager"]), async (req, res, next) => {
  try {
    

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });
    delete req.body.id;
    delete req.body.Updated_At;
    delete req.body.Updated_By;
    delete req.body.site_name;
    delete req.body.description;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;

    const userRole = req.user.roles ;
    if(userRole[0].includes('site_manager')){
      req.body.site_id = user.site_id;
     }

    const Site_id = req.body.site_id;
  

    const site = await Site.findOne({_id:Site_id})
    if (!site)
      return res.status(400).json({ error: true, message: "Can not find the site with the site_id" });


    req.body.registered_By = user.name;
    req.body.Created_At = Date.now();
    

    console.log("Req.body", req.body);
    delete req.body.site_id;
    
    const { error } = buildingBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


    req.body.site_id = new mongoose.Types.ObjectId(Site_id);
    

    await new Building({ ...req.body }).save();
    res.status(201).json({ error: false, message: "Building Registered Successfully" });

  }
  catch (e) {
    console.log(e)
    if (e.code === 11000 && e.keyPattern && e.keyPattern.city) {
      return res.status(400).json({ error: true, message: "A Building with this city already exists" });
    }
    if (e.name === 'BSONError' && e.message.includes('input must be a 24 character hex string')) {
      
      return res.status(400).json({ error: true, message: 'Invalid place_id' });
    }
    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid place_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});





router.patch("/update_building", auth, roleCheck(["admin","site_manager"]), async (req, res, next) => {
  try {

    console.log("Robel Asfaw in the building ", req.body);

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });

    const id = req.body.id;
    delete req.body.id;
    delete req.body.site_name;
    delete req.body.description;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;
    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    const userRole = req.user.roles ;
    var Site_idd = '';
    if(userRole[0].includes('site_manager')){
      req.body.site_id = user.site_id;
      Site_idd = req.body.site_id
     }
     else {
      req.body.site_id = Site_idd;
     }


    



     
    console.log("hhhhhhh", req.body);
    delete req.body.site_id
    console.log("iiiiii", req.body);
    const { error } = buildingBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    if(userRole[0].includes('site_manager')){
      req.body.site_id = new mongoose.Types.ObjectId(Site_idd);
    }
   else{
    req.body.site_id = ''
   }

    


    Building.findOne({ _id: id })
      .then((building) => {
        building.building_name = req.body.building_name;
        building.total_floor = req.body.total_floor;
        building.special_feature = req.body.special_feature;
        if(userRole[0].includes('site_manager')){
          building.site_id = req.body.site_id
        }
       

        building.Updated_By = req.body.Updated_By;
        building.Updated_At = req.body.Updated_At;
        return building.save();
      })
      .then((updateResult) => {
        if (updateResult) {
          res.status(200).json({ error: false, message: "Updated Building Successful" });
        } else {
          res.status(404).json({ error: true, message: "Document not found" });
        }
      })
      .catch((error) => {
        console.error("Error finding/updating document:", error);
        res.status(500).json({ error: true, message: "An error occurred" });
      });

  }
  catch (e) {
 console.log(e)
    if (e.code === 11000 && e.keyPattern && e.keyPattern.city) {
      return res.status(400).json({ error: true, message: "A place with this city already exists" });
    }

    if (e.name === 'BSONError' && e.message.includes('input must be a 24 character hex string')) {
      
      return res.status(400).json({ error: true, message: 'Invalid site_id' });
    }

    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid site_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }

});




router.delete("/delete_building", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Building.findOneAndDelete({ _id: req.body.id })
      .then((removedSite) => {
        if (removedSite) {
          res.status(201).json({ error: false, message: "Building Deleted Successfully" });
        } else {
          res.status(404).json({ error: true, message: "Document Not Found" });
        }
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ error: true, message: "Internal Server Error" });
      });
  }
  catch (e) {
    console.log(e);
    res.status(500).json({ error: true, message: `Internal Server Error` });
  }
})


export default router;
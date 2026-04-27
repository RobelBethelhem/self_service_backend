import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";
import Building from "../../../models/rms/Building.js";
import Floor from "../../../models/rms/Floor.js";
import Site from "../../../models/rms/Site.js";
import User from "../../../models/rms/User.js";
import { floorBodyValidation } from "../../../utils/rms/floorBodyValidation.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/register_floor", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {
console.log("floor register", req.body);
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });
    delete req.body.id;
    delete req.body.Updated_At;
    delete req.body.Updated_By;
    delete req.body.total_floor;
    delete req.body.building_name;
    delete req.body.special_feature;
    delete req.body.site_name;
    delete req.body.description;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;

    const userRole = req.user.roles ;
    var Sitee_id = '';
    if(userRole[0].includes('site_manager')){
      req.body.site_id = user.site_id;
      Sitee_id = req.body.site_id
     }
     else{
      req.body.site_id = Sitee_id;
     }

    const Building_id = req.body.building_id;


  

    const building = await Building.findOne({_id:Building_id})
    if (!building)
      return res.status(400).json({ error: true, message: "Can not find the building with the building_id" });

    

    req.body.registered_By = user.name;
    req.body.Created_At = Date.now();
    

    console.log("Req.body", req.body);
    delete  req.body.site_id;

    const { error } = floorBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    if(userRole[0].includes('site_manager')){
      req.body.site_id = new mongoose.Types.ObjectId(Sitee_id);
    }

    
   
    delete req.body.building_id;
    req.body.building_id = new mongoose.Types.ObjectId(Building_id);

    await new Floor({ ...req.body }).save();
    res.status(201).json({ error: false, message: "Floor Registered Successfully" });

  }
  catch (e) {
    console.log(e)
    if (e.code === 11000 && e.keyPattern && e.keyPattern.city) {
      return res.status(400).json({ error: true, message: "A Floor with this Building already exists" });
    }
    if (e.name === 'BSONError' && e.message.includes('input must be a 24 character hex string')) {
      
      return res.status(400).json({ error: true, message: 'Invalid building_id' });
    }
    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid building_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});





router.patch("/update_floor", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {

    console.log("Robel Asfaw in the building ", req.body);

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });

    const id = req.body.id;
    delete req.body.id;
    delete req.body.total_floor;
    delete req.body.building_name;
    delete req.body.special_feature;
    delete req.body.site_name;
    delete req.body.description;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;
    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    const userRole = req.user.roles ;
    var Site_idd= '';
    if(userRole[0].includes('site_manager')){
      req.body.site_id = user.site_id;
      Site_idd =  req.body.site_id
     }
     else{
      req.body.site_id = Site_idd;
     }

    const Building_id = req.body.building_id;




    console.log("hhhhhhh", req.body);
    delete req.body.site_id
    const { error } = floorBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    if(userRole[0].includes('site_manager')){
      req.body.site_id = new mongoose.Types.ObjectId(Site_idd);
    }
    

    delete req.body.building_id;
    req.body.building_id = new mongoose.Types.ObjectId(Building_id);


    Floor.findOne({ _id: id })
      .then((floor) => {
        floor.floor = req.body.floor;
        floor.floor_description = req.body.floor_description;
        floor.building_id = req.body.building_id;

        floor.Updated_By = req.body.Updated_By;
        floor.Updated_At = req.body.Updated_At;
        return floor.save();
      })
      .then((updateResult) => {
        if (updateResult) {
          res.status(200).json({ error: false, message: "Updated Flor Successful" });
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
      
      return res.status(400).json({ error: true, message: 'Invalid building_id' });
    }

    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid building_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }

});




router.delete("/delete_floor", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Floor.findOneAndDelete({ _id: req.body.id })
      .then((removedFloor) => {
        if (removedFloor) {
          res.status(201).json({ error: false, message: "Floor Deleted Successfully" });
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
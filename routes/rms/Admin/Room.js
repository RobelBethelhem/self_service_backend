import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";
import Building from "../../../models/rms/Building.js";
import Floor from "../../../models/rms/Floor.js";
import Site from "../../../models/rms/Site.js";
import User from "../../../models/rms/User.js";
import Room from "../../../models/rms/Room.js";
import { roomBodyValidation } from "../../../utils/rms/roomBodyValidation.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/register_room", auth, roleCheck(["admin","site_manager"]), async (req, res, next) => {
  try {
console.log("Room register", req.body);
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });
    delete req.body.id;
    delete req.body.Updated_At;
    delete req.body.Updated_By;
    delete req.body.floor;
    delete req.body.room_status;
    delete req.body.floor_description;
    delete req.body.total_floor;
    delete req.body.building_name;
    delete req.body.special_feature;
    delete req.body.site_name;
    delete req.body.description;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;

    const userRole = req.user.roles ;
    var Site_idd = '';
    if(userRole[0].includes('site_manager')){
      req.body.site_id = user.site_id;
      Site_idd = req.body.site_id
     }
    else{
      req.body.site_id = Site_idd;
    }

    const Floor_id = req.body.floor_id;
  

    const floor = await Floor.findOne({_id:Floor_id})
    if (!floor)
      return res.status(400).json({ error: true, message: "Can not find the Floor with the floor_id" });


    req.body.registered_By = user.name;
    req.body.Created_At = Date.now();
    

    console.log("Req.body", req.body);
    delete req.body.site_id
    const { error } = roomBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


    if(userRole[0].includes('site_manager')){
      req.body.site_id = new mongoose.Types.ObjectId(Site_idd);
    }
    

    delete req.body.floor_id;
    req.body.floor_id = new mongoose.Types.ObjectId(Floor_id);

    await new Room({ ...req.body }).save();
    res.status(201).json({ error: false, message: "Room Registered Successfully" });

  }
  catch (e) {
    console.log(e)
    if (e.code === 11000 && e.keyPattern && e.keyPattern.city) {
      return res.status(400).json({ error: true, message: "A Floor with this Building already exists" });
    }
    if (e.name === 'BSONError' && e.message.includes('input must be a 24 character hex string')) {
      
      return res.status(400).json({ error: true, message: 'Invalid floor_id' });
    }
    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid floor_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});





router.patch("/update_room", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {

    console.log("Robel Asfaw in the building ", req.body);

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });

    const id = req.body.id;
    delete req.body.id;
    delete req.body.floor;
    delete req.body.floor_description;
    delete req.body.total_floor;
    delete req.body.building_name;
    delete req.body.room_status;
    delete req.body.special_feature;
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
      Site_idd =  req.body.site_id;
     }
     else{
      req.body.site_id = Site_idd;
     }

    const Floor_id = req.body.floor_id;




    console.log("hhhhhhh", req.body);
    delete req.body.site_id;
    const { error } = roomBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    if(userRole[0].includes('site_manager')){
      req.body.site_id = new mongoose.Types.ObjectId(Site_idd);
    }
    
    
    delete req.body.floor_id;
    req.body.floor_id = new mongoose.Types.ObjectId(Floor_id);


    Room.findOne({ _id: id })
      .then((room) => {
        room.Room_name = req.body.Room_name;
        room.sqrt = req.body.sqrt;
        room.room_description = req.body.room_description;
        room.floor_id = req.body.floor_id;

        room.Updated_By = req.body.Updated_By;
        room.Updated_At = req.body.Updated_At;
        return room.save();
      })
      .then((updateResult) => {
        if (updateResult) {
          res.status(200).json({ error: false, message: "Updated Room Successful" });
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
      
      return res.status(400).json({ error: true, message: 'Invalid floor_id' });
    }

    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid floor_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }

});




router.delete("/delete_room", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Room.findOneAndDelete({ _id: req.body.id })
      .then((removedRoom) => {
        if (removedRoom) {
          res.status(201).json({ error: false, message: "Room Deleted Successfully" });
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
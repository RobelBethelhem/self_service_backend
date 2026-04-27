import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";

import Site from "../../../models/rms/Site.js"
import Price_Per_Room from "../../../models/rms/Price_per_Room.js";
import Price_Per_Floor from "../../../models/rms/Price_per_floor.js";

import Price_Per_Building from "../../../models/rms/Price_per_building.js";
import User from "../../../models/rms/User.js";
import Place from "../../../models/rms/Place.js";
import Room from "../../../models/rms/Room.js";

import Floor from "../../../models/rms/Floor.js";

import Building from "../../../models/rms/Building.js";
import { price_per_room_BodyValidation } from "../../../utils/rms/price_per_room.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/set_price_per_room", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    
console.log("set_price_per_room", req.body);
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });
    delete req.body.id;
    delete req.body.Updated_At;
    delete req.body.Updated_By;

    delete req.body.Room_name;
    delete req.body.sqrt;
    delete req.body.room_description;

    delete req.body.site_name;
    delete req.body.description;
    delete req.body.floor;
    delete req.body.floor_description;

    delete req.body.building_name;
    delete req.body.total_floor;
    delete req.body.special_feature;

    delete req.body.min_selling_price_per_cube_for_floor;
    delete req.body.max_selling_price_per_cube_for_floor;


    delete req.body.min_selling_price_per_cube_for_building;
    delete req.body.max_selling_price_per_cube_for_building;

    delete req.body.min_selling_price_per_cube_for_site;
    delete req.body.max_selling_price_per_cube_for_site;
    delete req.body.min_selling_price_per_cube_for_place;
    delete req.body.max_selling_price_per_cube_for_place;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;
    delete req.body.Created_At;

    const Room_id = req.body.room_id;
  

    const room = await Room.findOne({_id:Room_id})
    if (!room)
      return res.status(400).json({ error: true, message: "Can not find the Room with the room_id" });


    const isPreviouslysSet = await Price_Per_Room.findOne({room_id: Room_id})
    if (isPreviouslysSet)
        return res.status(400).json({ error: true, message: "Already Set the Value for the above room" });

    const parent_floor_id = room.floor_id;

    const isParentSetValue = await Price_Per_Floor.findOne({floor_id: parent_floor_id});
    if (!isParentSetValue){
        return res.status(400).json({ error: true, message: "First Set Price Per Floor for this Room" });
    }

    const parent_floor_min_value = isParentSetValue.min_selling_price_per_cube_for_floor;
    const parent_floor_max_value = isParentSetValue.max_selling_price_per_cube_for_floor;


    if(!(parent_floor_min_value <= req.body.price_per_cube
         &&   req.body.price_per_cube <=  parent_floor_max_value )){
            return res.status(400).json({ error: true, message: `Room price per cube should be between ${parent_floor_min_value} and ${parent_floor_max_value}` });
    }


    req.body.selling_price = room.sqrt * req.body.price_per_cube;
 

    req.body.registered_By = user.name;
    
    const { error } = price_per_room_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


   
    delete req.body.room_id;
    req.body.room_id = new mongoose.Types.ObjectId(Room_id);

    await new Price_Per_Room({ ...req.body }).save();
    res.status(201).json({ error: false, message: "Registered Successfully" });

  }
  catch (e) {
    console.log(e)
    if (e.code === 11000 && e.keyPattern && e.keyPattern.city) {
      return res.status(400).json({ error: true, message: "A Floor with this Building already exists" });
    }
    if (e.name === 'BSONError' && e.message.includes('input must be a 24 character hex string')) {
      
      return res.status(400).json({ error: true, message: 'Invalid room_id' });
    }
    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid room_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});





router.patch("/update_set_price_per_room", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {



    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });

    const id = req.body.id;
    delete req.body.id;
    delete req.body.site_name;
    delete req.body.description;
    delete req.body.country;

    delete req.body.Room_name;
    delete req.body.sqrt;
    delete req.body.room_description;

    delete req.body.floor;
    delete req.body.floor_description;

    delete req.body.building_name;
    delete req.body.total_floor;
    delete req.body.special_feature;

    delete req.body.min_selling_price_per_cube_for_floor;
    delete req.body.max_selling_price_per_cube_for_floor;

    delete req.body.min_selling_price_per_cube_for_building;
    delete req.body.max_selling_price_per_cube_for_building;

    delete req.body.min_selling_price_per_cube_for_site;
    delete req.body.max_selling_price_per_cube_for_site;
    
    delete req.body.min_selling_price_per_cube_for_place;
    delete req.body.max_selling_price_per_cube_for_place;
    delete req.body.region;
    delete req.body.Created_At;
    delete req.body.city;
    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    const Room_id = req.body.room_id;
  

    const room = await Room.findOne({_id:Room_id})
    if (!room)
      return res.status(400).json({ error: true, message: "Can not find the Room with the room_id" });


    // const isPreviouslysSet = await Price_Per_Room.findOne({room_id: Room_id})
    // if (isPreviouslysSet)
    //     return res.status(400).json({ error: true, message: "Already Set the Value for the above room" });

    const parent_floor_id = room.floor_id;

    const isParentSetValue = await Price_Per_Floor.findOne({floor_id: parent_floor_id});
    if (!isParentSetValue){
        return res.status(400).json({ error: true, message: "First Set Price Per Floor for this Room" });
    }

    const parent_floor_min_value = isParentSetValue.min_selling_price_per_cube_for_floor;
    const parent_floor_max_value = isParentSetValue.max_selling_price_per_cube_for_floor;


    if(!(parent_floor_min_value <= req.body.price_per_cube
         &&   req.body.price_per_cube <=  parent_floor_max_value )){
            return res.status(400).json({ error: true, message: `Room price per cube should be between ${parent_floor_min_value} and ${parent_floor_max_value}` });
    }

    req.body.selling_price = room.sqrt * req.body.price_per_cube;
 

    
    const { error } = price_per_room_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    delete req.body.room_id;
    req.body.room_id = new mongoose.Types.ObjectId(Room_id);


    Price_Per_Room.findOne({ _id: id })
      .then((price_per_room) => {
        price_per_room.selling_price = req.body.selling_price;
        price_per_room.room_id = req.body.room_id;
        price_per_room.price_per_cube = req.body.price_per_cube;
        

        price_per_room.Updated_By = req.body.Updated_By;
        price_per_room.Updated_At = req.body.Updated_At;
        return price_per_room.save();
      })
      .then((updateResult) => {
        if (updateResult) {
          res.status(200).json({ error: false, message: "Updated Successful" });
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
      
      return res.status(400).json({ error: true, message: 'Invalid room_id' });
    }

    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid room_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }

});




router.delete("/delete_set_price_per_room", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Price_Per_Room.findOneAndDelete({ _id: req.body.id })
      .then((removedRoom) => {
        if (removedRoom) {
          res.status(201).json({ error: false, message: "Deleted Successfully" });
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
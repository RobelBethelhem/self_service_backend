import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";

import Place from "../../../models/rms/Place.js"
import Price_Per_Place from "../../../models/rms/Price_per_place.js";
import User from "../../../models/rms/User.js";
import Room from "../../../models/rms/Room.js";
import { price_per_place_BodyValidation } from "../../../utils/rms/price_per_place.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/set_price_per_place", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });
    delete req.body.id;
    delete req.body.Updated_At;
    delete req.body.Updated_By;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;
    delete req.body.Created_At;

    const Place_id = req.body.place_id;
  

    const place = await Place.findOne({_id:Place_id})
    if (!place)
      return res.status(400).json({ error: true, message: "Can not find the Place with the place_id" });


    const isPreviouslysSet = await Price_Per_Place.findOne({place_id: Place_id})
    if (isPreviouslysSet)
        return res.status(400).json({ error: true, message: "Already Set the Value for the above place" });

    req.body.registered_By = user.name;
    
    const { error } = price_per_place_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


   
    delete req.body.place_id;
    req.body.place_id = new mongoose.Types.ObjectId(Place_id);

    await new Price_Per_Place({ ...req.body }).save();
    res.status(201).json({ error: false, message: "Registered Successfully" });

  }
  catch (e) {
    console.log(e)
    if (e.code === 11000 && e.keyPattern && e.keyPattern.city) {
      return res.status(400).json({ error: true, message: "A Floor with this Building already exists" });
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





router.patch("/update_set_price_per_place", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {



    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });

    const id = req.body.id;
    delete req.body.id;
    delete req.body.country;
    delete req.body.region;
    delete req.body.Created_At;
    delete req.body.city;
    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    const Place_id = req.body.place_id;




    console.log("hhhhhhh", req.body);
    const { error } = price_per_place_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    delete req.body.place_id;
    req.body.place_id = new mongoose.Types.ObjectId(Place_id);


    Price_Per_Place.findOne({ _id: id })
      .then((price_per_place) => {
        price_per_place.min_selling_price_per_cube_for_place = req.body.min_selling_price_per_cube_for_place;
        price_per_place.max_selling_price_per_cube_for_place = req.body.max_selling_price_per_cube_for_place;
  
        price_per_place.place_id = req.body.place_id;

        price_per_place.Updated_By = req.body.Updated_By;
        price_per_place.Updated_At = req.body.Updated_At;
        return price_per_place.save();
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
      
      return res.status(400).json({ error: true, message: 'Invalid place_id' });
    }

    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid place_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }

});




router.delete("/delete_set_price_per_place", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Price_Per_Place.findOneAndDelete({ _id: req.body.id })
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
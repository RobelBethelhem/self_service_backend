import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";

import Site from "../../../models/rms/Site.js"
import Building from "../../../models/rms/Building.js"
import Price_Per_Site from "../../../models/rms/Price_per_site.js";
import Price_Per_Building from "../../../models/rms/Price_per_building.js";
import User from "../../../models/rms/User.js";
import Place from "../../../models/rms/Place.js";
import { price_per_building_BodyValidation } from "../../../utils/rms/price_per_building.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/set_price_per_building", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    
console.log("TTTGF", req.body);
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });
    delete req.body.id;
    delete req.body.Updated_At;
    delete req.body.Updated_By;
    delete req.body.site_name;
    delete req.body.description;

    delete req.body.building_name;
    delete req.body.total_floor;
    delete req.body.special_feature;

    delete req.body.min_selling_price_per_cube_for_site;
    delete req.body.max_selling_price_per_cube_for_site;
    delete req.body.min_selling_price_per_cube_for_place;
    delete req.body.max_selling_price_per_cube_for_place;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;
    delete req.body.Created_At;

    const Building_id = req.body.building_id;
  

    const building = await Building.findOne({_id:Building_id})
    if (!building)
      return res.status(400).json({ error: true, message: "Can not find the Building with the building_id" });


    const isPreviouslysSet = await Price_Per_Building.findOne({building_id: Building_id})
    if (isPreviouslysSet)
        return res.status(400).json({ error: true, message: "Already Set the Value for the above building" });

    const parent_site_id = building.site_id;

    const isParentSetValue = await Price_Per_Site.findOne({site_id: parent_site_id});
    if (!isParentSetValue){
        return res.status(400).json({ error: true, message: "First Set Price Per Site for this Building" });
    }

    const parent_site_min_value = isParentSetValue.min_selling_price_per_cube_for_site;
    const parent_site_max_value = isParentSetValue.max_selling_price_per_cube_for_site;

    if(!(parent_site_min_value <= req.body.min_selling_price_per_cube_for_building
         &&   req.body.max_selling_price_per_cube_for_building <=  parent_site_max_value )){
            return res.status(400).json({ error: true, message: `Building price per cube should be between ${parent_site_min_value} and ${parent_site_max_value}` });
    }
    if(!(req.body.min_selling_price_per_cube_for_building <= req.body.max_selling_price_per_cube_for_building)){
        return res.status(400).json({ error: true, message: "Min price should be less than Max price"});
    }



    req.body.registered_By = user.name;
    
    const { error } = price_per_building_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


   
    delete req.body.building_id;
    req.body.building_id = new mongoose.Types.ObjectId(Building_id);

    await new Price_Per_Building({ ...req.body }).save();
    res.status(201).json({ error: false, message: "Registered Successfully" });

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





router.patch("/update_set_price_per_building", auth, roleCheck(["admin"]), async (req, res, next) => {
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

    delete req.body.building_name;
    delete req.body.total_floor;
    delete req.body.special_feature;

    delete req.body.min_selling_price_per_cube_for_site;
    delete req.body.max_selling_price_per_cube_for_site;
    
    delete req.body.min_selling_price_per_cube_for_place;
    delete req.body.max_selling_price_per_cube_for_place;
    delete req.body.region;
    delete req.body.Created_At;
    delete req.body.city;
    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    const Building_id = req.body.building_id;

    const building = await Building.findOne({_id:Building_id})
    if (!building)
      return res.status(400).json({ error: true, message: "Can not find the Building with the building_id" });


    const parent_site_id = building.site_id;

    const isParentSetValue = await Price_Per_Site.findOne({site_id: parent_site_id});

    const parent_site_min_value = isParentSetValue.min_selling_price_per_cube_for_site;
    const parent_site_max_value = isParentSetValue.max_selling_price_per_cube_for_site;

    if(!(parent_site_min_value <= req.body.min_selling_price_per_cube_for_building
        &&   req.body.max_selling_price_per_cube_for_building <=  parent_site_max_value )){
           return res.status(400).json({ error: true, message: `Building price per cube should be between ${parent_site_min_value} and ${parent_site_max_value}` });
   }
   if(!(req.body.min_selling_price_per_cube_for_building <= req.body.max_selling_price_per_cube_for_building)){
       return res.status(400).json({ error: true, message: "Min price should be less than Max price"});
   }





    
    const { error } = price_per_building_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    delete req.body.building_id;
    req.body.building_id = new mongoose.Types.ObjectId(Building_id);


    Price_Per_Building.findOne({ _id: id })
      .then((price_per_building) => {
        price_per_building.min_selling_price_per_cube_for_building = req.body.min_selling_price_per_cube_for_building;
        price_per_building.max_selling_price_per_cube_for_building = req.body.max_selling_price_per_cube_for_building;
  
        price_per_building.building_id = req.body.building_id;

        price_per_building.Updated_By = req.body.Updated_By;
        price_per_building.Updated_At = req.body.Updated_At;
        return price_per_building.save();
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
      
      return res.status(400).json({ error: true, message: 'Invalid building_id' });
    }

    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid building_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }

});




router.delete("/delete_set_price_per_building", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Price_Per_Building.findOneAndDelete({ _id: req.body.id })
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
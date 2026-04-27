import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";

import Site from "../../../models/rms/Site.js"
import Price_Per_Site from "../../../models/rms/Price_per_site.js";
import Price_Per_Place from "../../../models/rms/Price_per_place.js";
import User from "../../../models/rms/User.js";
import Place from "../../../models/rms/Place.js";
import { price_per_site_BodyValidation } from "../../../utils/rms/price_per_site.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/set_price_per_site", auth, roleCheck(["admin"]), async (req, res, next) => {
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
    delete req.body.min_selling_price_per_cube_for_place;
    delete req.body.max_selling_price_per_cube_for_place;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;
    delete req.body.Created_At;

    const Site_id = req.body.site_id;
  

    const site = await Site.findOne({_id:Site_id})
    if (!site)
      return res.status(400).json({ error: true, message: "Can not find the Site with the site_id" });


    const isPreviouslysSet = await Price_Per_Site.findOne({site_id: Site_id})
    if (isPreviouslysSet)
        return res.status(400).json({ error: true, message: "Already Set the Value for the above site" });

    const parent_place_id = site.place_id;

    const isParentSetValue = await Price_Per_Place.findOne({place_id: parent_place_id});
    if (!isParentSetValue){
        return res.status(400).json({ error: true, message: "First Set Price Per Place for this Site" });
    }

    const parent_place_min_value = isParentSetValue.min_selling_price_per_cube_for_place;
    const parent_place_max_value = isParentSetValue.max_selling_price_per_cube_for_place;

    if(!(parent_place_min_value <= req.body.min_selling_price_per_cube_for_site
         &&   req.body.max_selling_price_per_cube_for_site <=  parent_place_max_value )){
            return res.status(400).json({ error: true, message: `Site price per cube should be between ${parent_place_min_value} and ${parent_place_max_value}` });
    }
    if(!(req.body.min_selling_price_per_cube_for_site <= req.body.max_selling_price_per_cube_for_site)){
        return res.status(400).json({ error: true, message: "Min price should be less than Max price"});
    }



    req.body.registered_By = user.name;
    
    const { error } = price_per_site_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


   
    delete req.body.site_id;
    req.body.site_id = new mongoose.Types.ObjectId(Site_id);

    await new Price_Per_Site({ ...req.body }).save();
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





router.patch("/update_set_price_per_site", auth, roleCheck(["admin"]), async (req, res, next) => {
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
    delete req.body.min_selling_price_per_cube_for_place;
    delete req.body.max_selling_price_per_cube_for_place;
    delete req.body.region;
    delete req.body.Created_At;
    delete req.body.city;
    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    const Site_id = req.body.site_id;

    const site = await Site.findOne({_id:Site_id})
    if (!site)
      return res.status(400).json({ error: true, message: "Can not find the Site with the site_id" });


    const parent_place_id = site.place_id;

    const isParentSetValue = await Price_Per_Place.findOne({place_id: parent_place_id});

    const parent_place_min_value = isParentSetValue.min_selling_price_per_cube_for_place;
    const parent_place_max_value = isParentSetValue.max_selling_price_per_cube_for_place;

    if(!(parent_place_min_value <= req.body.min_selling_price_per_cube_for_site
        &&   req.body.max_selling_price_per_cube_for_site <=  parent_place_max_value )){
           return res.status(400).json({ error: true, message: `Site price per cube should be between ${parent_place_min_value} and ${parent_place_max_value}` });
   }
   if(!(req.body.min_selling_price_per_cube_for_site <= req.body.max_selling_price_per_cube_for_site)){
       return res.status(400).json({ error: true, message: "Min price should be less than Max price"});
   }





    
    const { error } = price_per_site_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    delete req.body.site_id;
    req.body.site_id = new mongoose.Types.ObjectId(Site_id);


    Price_Per_Site.findOne({ _id: id })
      .then((price_per_site) => {
        price_per_site.min_selling_price_per_cube_for_site = req.body.min_selling_price_per_cube_for_site;
        price_per_site.max_selling_price_per_cube_for_site = req.body.max_selling_price_per_cube_for_site;
  
        price_per_site.site_id = req.body.site_id;

        price_per_site.Updated_By = req.body.Updated_By;
        price_per_site.Updated_At = req.body.Updated_At;
        return price_per_site.save();
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
      
      return res.status(400).json({ error: true, message: 'Invalid site_id' });
    }

    if (e instanceof mongoose.CastError && e.name === 'CastError') {
      return res.status(400).json({ error: true, message: 'Invalid site_id' });
    } 
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }

});




router.delete("/delete_set_price_per_site", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Price_Per_Site.findOneAndDelete({ _id: req.body.id })
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
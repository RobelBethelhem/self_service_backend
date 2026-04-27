import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";
import Site from "../../../models/rms/Site.js";
import Place from "../../../models/rms/Place.js";
import User from "../../../models/rms/User.js";
import { siteBodyValidation } from "../../../utils/rms/siteBodyValidation.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/register_site", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    console.log("Robel Asfaw")
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
    const Place_id = req.body.place_id;
  

    const place = await Place.findOne({_id:Place_id})
    if (!place)
      return res.status(400).json({ error: true, message: "Can not find the place with the place_id" });


    req.body.registered_By = user.name;
    req.body.Created_At = Date.now();
    

    console.log("Req.body", req.body);
    const { error } = siteBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


   
    delete req.body.place_id;
    req.body.place_id = new mongoose.Types.ObjectId(Place_id);

    await new Site({ ...req.body }).save();
    res.status(201).json({ error: false, message: "Site Registered Successfully" });

  }
  catch (e) {
    
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

router.patch("/update_register_site", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });

    const id = req.body.id;
    delete req.body.id;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;
    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    const Place_id = req.body.place_id;




    console.log("hhhhhhh", req.body);
    const { error } = siteBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });

    delete req.body.place_id;
    req.body.place_id = new mongoose.Types.ObjectId(Place_id);


    Site.findOne({ _id: id })
      .then((site) => {
        site.site_name = req.body.site_name;
        site.description = req.body.description;
        site.place_id = req.body.place_id;
        site.Updated_By = req.body.Updated_By;
        site.Updated_At = req.body.Updated_At;
        return site.save();
      })
      .then((updateResult) => {
        if (updateResult) {
          res.status(200).json({ error: false, message: "Updated Place Successful" });
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

router.delete("/delete_register_site", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Site.findOneAndDelete({ _id: req.body.id })
      .then((removedSite) => {
        if (removedSite) {
          res.status(201).json({ error: false, message: "Site Deleted Successfully" });
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
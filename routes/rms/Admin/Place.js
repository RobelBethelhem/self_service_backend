import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";
import Place from "../../../models/rms/Place.js";
import User from "../../../models/rms/User.js";
import {placeBodyValidation} from "../../../utils/rms/placeBodyValidation.js"
import open from "open"
const router = Router();

router.post("/register_place", auth, roleCheck(["admin"]), async(req,res, next)=>{
  try{

    // const filePath = 'D:\\IT_Function_Scorecard.xlsx';
    // open(filePath)
    // .then(() => res.status(200).send('File opened successfully'))
    // .catch((error) => res.status(500).send(`Error opening file: ${error.message}`));

    const getUser = await req.user;
    const user = await User.findOne({_id: getUser._id});
    if(!user)
        return res.status(400).json({error:true, message:"The requester Can not found"});
    delete req.body.id;
    delete req.body.Updated_At;
    delete req.body.Updated_By;
    req.body.registered_By = user.name;
    req.body.Created_At = Date.now();

    console.log("Req.body", req.body);
    const {error} = placeBodyValidation(req.body);
    if(error)
         return res.status(400).json({error:true, message:error.details[0].message});

    await new Place({ ...req.body}).save();     
    res.status(201).json({error: false, message:"Place Registered Successfully"});

  }
  catch(e){
    console.log(e);
    if (e.code === 11000 && e.keyPattern && e.keyPattern.city) {
      return res.status(400).json({error:true, message: "A place with this city already exists"});
    }
    res.status(500).json({error:true, message: "Internal Server Error"});
  }
});

router.patch("/update_register_place", auth, roleCheck(["admin"]), async(req,res, next)=>{
  try{
    const getUser = await req.user;
    const user = await User.findOne({_id: getUser._id});
    if(!user)
        return res.status(400).json({error:true, message:"The requester Can not found"});

    const id = req.body.id;
    delete req.body.id;
    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    console.log("hhhhhhh", req.body);
    const {error} = placeBodyValidation(req.body);
    if(error)
         return res.status(400).json({error:true, message:error.details[0].message});


    Place.findOne({_id:id})
    .then((place)=>{
      place.Updated_By = req.body.Updated_By;
      place.Updated_At = req.body.Updated_At;
      place.country = req.body.country;
      place.region = req.body.region;
      place.city = req.body.city;
      return place.save();
    })
    .then((updateResult) => {
      if (updateResult) {
        res.status(200).json({ error: false, message: "Updated Place Successful"});
      } else {
        res.status(404).json({ error: true, message: "Document not found" });
      }
    })
    .catch((error) => {
      console.error("Error finding/updating document:", error);
      res.status(500).json({ error: true, message: "An error occurred" });
    });

  }
  catch(err){
      console.log(err);
      res.status(500).json({error: true, message:"Internal Server Error"});
  }
    
});

router.delete("/delete_register_place", auth, roleCheck(["admin"]), async(req,res,next)=>{
  try{ 

    const getUser = await req.user;
    const user = await User.findOne({_id: getUser._id});
    if(!user)
        return res.status(400).json({error:true, message:"The requester Can not found"});


    await Place.findOneAndDelete({ _id: req.body.id })
    .then((removedPlace) => {
      if (removedPlace) {
        res.status(201).json({ error: false, message: "Place Deleted Successfully" });
      } else {
        res.status(404).json({ error: true, message: "Document Not Found" });
      }
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ error: true, message: "Internal Server Error" });
    });
   }
  catch(e){
    console.log(e);
    res.status(500).json({error:true, message: `Internal Server Error`});
  }
})


  export default router;
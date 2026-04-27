import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";

import Place from "../../../models/rms/Place.js"
import Price_Per_Place from "../../../models/rms/Price_per_place.js";
import User from "../../../models/rms/User.js";
import Customer from "../../../models/rms/Customer.js";
import { customerBodyValidation } from "../../../utils/rms/customerBodyValidation.js";
import mongoose from 'mongoose';


const router = Router();

router.post("/register_customer", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {
     
    console.log("register_customer", req.body);
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });
    const Id = req.body.id;
    delete req.body.id;
    delete req.body.Updated_At;
    delete req.body.Updated_By;
    delete req.body.Created_At;

    
  

    const customer = await Customer.findOne(
      {$or:
      [{customer_email:req.body.customer_email},
       {customer_phone_number:req.body.customer_phone_number}
      ]}).lean();

    if (customer)
      return res.status(400).json({ error: true, message: "Duplication either customer email or phone number" });


    req.body.registered_By = user.name;
    
    const { error } = customerBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


    await new Customer({ ...req.body }).save();
    res.status(201).json({ error: false, message: "Registered Successfully" });

  }
  catch (e) {
    console.log(e)
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});





router.patch("/update_customer", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {

    console.log("kjkjkjkj", req.body);

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });

    const id = req.body.id;
    delete req.body.id;
 
    delete req.body.Created_At;

    req.body.Updated_By = user.name;
    req.body.Updated_At = Date.now();

    const customer = await Customer.findOne({
      $or: [
        { customer_email: req.body.customer_email },
        { customer_phone_number: req.body.customer_phone_number }
      ],
      _id: { $ne: id }
    }).lean();

    
    if (customer)
      return res.status(400).json({ error: true, message: "Duplication either customer email or phone number" });



    const { error } = customerBodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });


    Customer.findOne({ _id: id })
      .then((customer) => {
        customer.customer_name = req.body.customer_name;
        customer.customer_email = req.body.customer_email;
  
        customer.customer_phone_number = req.body.customer_phone_number;
        customer.customer_address = req.body.customer_address;
        

        customer.Updated_By = req.body.Updated_By;
        customer.Updated_At = req.body.Updated_At;
        return customer.save();
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
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }

});




router.delete("/delete_customer", auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Customer.findOneAndDelete({ _id: req.body.id })
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
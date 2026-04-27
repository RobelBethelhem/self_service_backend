
import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";

import {Agreement} from "../../../models/rms/Aggrement.js"
import {Site_Manager_KPI} from "../../../models/rms/Site_manager_KPI.js";
import User from "../../../models/rms/User.js";
import { site_manager_kpi_BodyValidation } from "../../../utils/rms/site_manager_kpi.js";
import update_Site_Manager_Over_All_KPI from "../../../utils/rms/update_over_all_KPI.js"
import mongoose from 'mongoose';


const router = Router();

router.post("/register_KPI_for_site_manager", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user) {
      return res.status(400).json({ error: true, message: "The requester Can not found" });
    }
    const { site_manager_id } = req.body;

    console.log("site_manager_id", site_manager_id)

    const site_manager = await User.findOne({ _id: site_manager_id })

    if(!site_manager)
      return res.status(400).json({error: "true", message: "Can not find the site manager with the give site manager ID"})

    if(site_manager.roles[0] !== "site_manager")
      return res.status(400).json({error: "true", message: "The User should be Site Manager"})
   
    delete req.body.id;
    delete req.body.site_manager_name;
    delete req.body.site_name;
    delete req.body.description;
    delete req.body.country;
    delete req.body.region;
    delete req.body.city;
    delete req.body.over_all_target_amount;
    delete req.body.over_all_achieved_amount;
    delete req.body.over_all_KPI_percentage;
    delete req.body.createdAt;
    delete req.body.registered_By;
    delete req.body.Updated_At;
    delete req.body.Updated_By;

    

    req.body.registered_By = user.name;
    
    console.log("I am in KPI for Site Manager", req.body)

    const { error } = site_manager_kpi_BodyValidation(req.body);
    if (error)
      return res.status(400).json({ error: true, message: error.details[0].message });



  await new Site_Manager_KPI({... req.body}).save();
  res.status(201).json({ error: false, message: "Site manager KPI Registered Successfully" });

}
catch (e) {
    console.error(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
}
);


router.delete("/delete_KPI_for_site_manager", auth, roleCheck(["admin"]), async (req,res, next) =>{
 
  try{
    const {id} = req.body;
    const getUser = await req.user;
    const user = await User.findById(getUser._id);
    if (!user) {
      return res.status(404).json({ error: true, message: "Requester not found" });
    }

    const site_manager_kpi = await Site_Manager_KPI.findById(id);

    if(site_manager_kpi.KPI_installments.length > 0)
      return res.status(400).json({error: true, message: "First delete  Each KPI assciated with the user"})

    await Site_Manager_KPI.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: "Site KPI deleted successfully" });

  }
  catch (e) {
    console.error("Error in register_each_KPI_installment:", e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
})




router.post("/register_each_KPI_installment", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {

    const { siteManagerID, kpi_installemnt } = req.body;
    const userFeedKPI_startEnd = kpi_installemnt.KPI_start_date;
    const userFeedKPI_end_date = kpi_installemnt.KPI_end_date;

    if(!(userFeedKPI_end_date > userFeedKPI_startEnd) )
      return res.status(400).json({error: true, message: "KPI end date should be Greater than KPI start Day"})


    if (!siteManagerID || !kpi_installemnt) {
      return res.status(400).json({ error: true, message: "Missing required fields" });
    }

    const getUser = await req.user;
    const user = await User.findById(getUser._id);
    if (!user) {
      return res.status(404).json({ error: true, message: "Requester not found" });
    }

    const site_manager_kpi = await Site_Manager_KPI.findById(siteManagerID);

    
    if(site_manager_kpi.KPI_installments.length > 0){
      const { KPI_end_date } = site_manager_kpi.KPI_installments.at(-1);
     
      const Compare_KPI_end_date = new Date(KPI_end_date);
      const Compare_userFeedKPI_startEnd = new Date(userFeedKPI_startEnd);
     console.log(Compare_KPI_end_date,Compare_userFeedKPI_startEnd)
      if(!(Compare_KPI_end_date < Compare_userFeedKPI_startEnd)){
        return res.status(400).json({error: true, message: "Please Provide correct time"})
      }
      
    }



    

 
    
    
   
    if (!site_manager_kpi) {
      return res.status(404).json({ error: true, message: "Site manager KPI not found" });
    }

    // Remove unnecessary fields from the request body
    const cleanedInstallment = { ...kpi_installemnt };
    delete cleanedInstallment.id;
    delete cleanedInstallment.achieved_amount;
    delete cleanedInstallment.KPI_percentage;
    delete cleanedInstallment.createdAt;
    delete cleanedInstallment.updatedAt;
    delete cleanedInstallment.updated_By;
    cleanedInstallment.registered_By = user.name;



    // Add the new installment to the site manager's KPI
    site_manager_kpi.KPI_installments.push(cleanedInstallment);

    

    await site_manager_kpi.save();


    // var total_over_all_target_amount = 0
    // var total_over_all_achieved_amount = 0
    // var total_over_all_KPI_percentage = 0

    const {KPI_installments} = await Site_Manager_KPI.findById(siteManagerID);
  

    const getResponse = await update_Site_Manager_Over_All_KPI(KPI_installments, siteManagerID)
    if(!getResponse)
      return res.status(400).json({error: true, message:"something error happen"})
  
    // KPI_installments.forEach(KPI_installment =>{
    //   total_over_all_target_amount += KPI_installment.target_amount? KPI_installment.target_amount : 0 ;
    //   total_over_all_achieved_amount += KPI_installment.achieved_amount ? KPI_installment.achieved_amount: 0;
    //   total_over_all_KPI_percentage += KPI_installment.KPI_percentage ? KPI_installment.KPI_percentage: 0 ;
    // });


    // await Site_Manager_KPI.updateOne(
    //   {_id:siteManagerID},
    //   {
    //     $set: {
    //       "over_all_target_amount": total_over_all_target_amount,
    //       "over_all_achieved_amount":total_over_all_achieved_amount,
    //       "over_all_KPI_percentage": total_over_all_KPI_percentage,
    //     }
    //   }
    // )
  

    res.status(201).json({ error: false, message: "Site manager KPI installment registered successfully" });
  } catch (e) {
    console.error("Error in register_each_KPI_installment:", e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});
router.patch("/update_each_KPI_installement", auth, roleCheck(["admin"]), async (req , res, next) =>{
    try{
      

      const { siteManagerID, kpi_installemnt } = req.body;

    if (!siteManagerID || !kpi_installemnt) {
      return res.status(400).json({ error: true, message: "Missing required fields" });
    }

    const getUser = await req.user;
    const user = await User.findById(getUser._id);
    if (!user) {
      return res.status(404).json({ error: true, message: "Requester not found" });
    }

    const site_manager_kpi = await Site_Manager_KPI.findById(siteManagerID);
   
    if (!site_manager_kpi) {
      return res.status(404).json({ error: true, message: "Site manager KPI not found" });
    }

     


    // Remove unnecessary fields from the request body
    const cleanedInstallment = { ...kpi_installemnt };
    
    delete cleanedInstallment.createdAt;
    delete cleanedInstallment.registered_By;



    // cleanedInstallment.Updated_By = user.name;
    // cleanedInstallment.Updated_At = Date.now()

    const {id , target_amount, KPI_start_date, KPI_end_date} = cleanedInstallment

  
    const specific_edit_installement_KPI = await Site_Manager_KPI.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(siteManagerID) } },
      { $unwind: "$KPI_installments" },
      { $match: { "KPI_installments._id": new mongoose.Types.ObjectId(id) } },
      { $project: { 
          _id: 0, 
          installment: "$KPI_installments" 
        } 
      }
    ]);

   
    
    if("achieved_amount" in specific_edit_installement_KPI[0].installment)
      return res.status(400).json({ error: true, message: "Progressed Transaction Can not be Edited"})

     


    await Site_Manager_KPI.updateOne(
      {_id:siteManagerID, "KPI_installments._id":id},
      {
        $set: {
          "KPI_installments.$.paid": true,
          "KPI_installments.$.target_amount":target_amount,
          "KPI_installments.$.KPI_start_date": KPI_start_date,
          "KPI_installments.$.KPI_end_date": KPI_end_date,
          "KPI_installments.$.updatedAt": new Date(),
          "KPI_installments.$.updated_By": user.name
        }
      }
    )

    const {KPI_installments} = await Site_Manager_KPI.findById(siteManagerID);
  

    const getResponse = await update_Site_Manager_Over_All_KPI(KPI_installments, siteManagerID)

    if(!getResponse){
      return res.status(400).json({error: true, message:"something error happen"})
    }
     


    res.status(200).json({ success: true, message: "KPI Installments updated successfully" });
    }
    catch(e){
      console.error("Error in register_each_KPI_installment:", e);
      res.status(500).json({ error: true, message: "Internal Server Error" });
    }
})
router.delete("/delete_each_KPI_installement", auth, roleCheck(["admin"]), async (req , res, next) =>{
    try{

      const {kpi_installemnt_id , siteManagerID} = req.body;

      const specific_edit_installement_KPI = await Site_Manager_KPI.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(siteManagerID) } },
        { $unwind: "$KPI_installments" },
        { $match: { "KPI_installments._id": new mongoose.Types.ObjectId(kpi_installemnt_id) } },
        { $project: { 
            _id: 0, 
            installment: "$KPI_installments" 
          } 
        }
      ]);
  
     
      
      if("achieved_amount" in specific_edit_installement_KPI[0].installment)
        return res.status(400).json({ error: true, message: "Progressed Transaction Can not be Deleted"})


      await Site_Manager_KPI.updateOne(
        {_id: siteManagerID},
        {
          $pull: {
            KPI_installments: {_id:kpi_installemnt_id}
          }
        },
      )

      const {KPI_installments} = await Site_Manager_KPI.findById(siteManagerID);
  

      const getResponse = await update_Site_Manager_Over_All_KPI(KPI_installments, siteManagerID)

      if(!getResponse){
        return res.status(400).json({error: true, message:"something error happen"})
      }



      res.status(200).json({ success: true, message: "KPI Installments deleted successfully" });
      
    }
    catch(e){
      console.error("Error in register_each_KPI_installment:", e);
      res.status(500).json({ error: true, message: "Internal Server Error" });
    }
})


















// router.post("/paid_installement", auth, roleCheck(["admin","site_manager"]), async (req, res) => {
//   try {

//     const getUser = req.user;
//     const user = await User.findById(getUser._id);
//     if (!user) {
//       return res.status(400).json({ error: true, message: "The requester cannot be found" });
//     }

//     const { agreement_id, paid_aggrements } = req.body;
   
    
//     const agreement = await Agreement.findById(agreement_id);
//     if (!agreement) {
//       return res.status(400).json({ error: true, message: "Some unknown error occurred. Try again." });
//     }

//     if (agreement.aggerement_status === "Completed") {
//       return res.status(400).json({ error: true, message: "The installment payment is already completed for this agreement" });
//     }

//     const updatePromises = paid_aggrements.map(element => {

//       const customerDueDate = element.dueDate;
//       const nowTime = Date.now();
      
//         // Function to get date without time
//             function getDateWithoutTime(dateString) {
//                 const date = new Date(dateString);
//                 return new Date(date.getFullYear(), date.getMonth(), date.getDate());
//               }

//       // Get customer due date without time 2025-06-11T21:00:00.000Z
//      const dueDateWithoutTime = getDateWithoutTime(customerDueDate);
//       //const dueDateWithoutTime = getDateWithoutTime("2024-01-01T21:00:00.000Z");


//             // Get today's date without time
//       const todayWithoutTime = getDateWithoutTime(nowTime);

//             // Calculate the difference in milliseconds
//       const differenceMs = dueDateWithoutTime - todayWithoutTime;

//             // Convert milliseconds to days
//       const daysDifference = Math.floor(differenceMs / (1000 * 60 * 60 * 24));

    
//       let unpaid_date_difference = 0;
//       if(daysDifference < 0){
//         unpaid_date_difference = (daysDifference) * -1;
//       }
//       else {
//         unpaid_date_difference = 0;
//       }





//       return Agreement.updateOne(
//         { _id: agreement_id, "installments._id": element.id },
//         {
//           $set: {
//             "installments.$.paid": true,
//             "installments.$.status": "true",
//             "installments.$.paid_amount": element.amount,
//             "installments.$.unpaid_date_difference": unpaid_date_difference,
//             "installments.$.paidDate": new Date(),
//             "installments.$.registered_By": user.name,
//             "installments.$.updatedAt": new Date(),
//             "installments.$.updated_By": user.name
//           }
//         }
//       );
//     });



//     await Promise.all(updatePromises);


//     let TotalCustomerPaid = 0;
//     let InterestOverDue = 0; 
//     //interest_over_due
    
//     let unpaiedCurrentindex = -1;
//     let amountToPayInterestId = '';
//     let amountToPayInterestIndex = -2; 
//     let customerToPayAddedInterest = 0;


//     const updated_agreement = await Agreement.findById(agreement_id);
   
//     updated_agreement.installments.forEach((element, index) => {
     
//       if( element.status === "true"){
//         TotalCustomerPaid += Number(element.amount);
//       }
     
//       if(amountToPayInterestIndex == index){
      
//         amountToPayInterestId = element._id.toString();
//         customerToPayAddedInterest = Number(element.amount) + InterestOverDue;
//       }
//       if(element.unpaid_date_difference > 0 && element.status !== "true"){
       
//         unpaiedCurrentindex = index;
//         amountToPayInterestIndex = index + 1;
//         InterestOverDue += Number(element.unpaid_date_difference) * 0.07 * Number(element.amount);
//       }
      
//     });

//     let amount_receivable = updated_agreement.amount_receivable;
//     let income = updated_agreement.income;
//     let interest_over_due = updated_agreement.interest_over_due;

     
//     income = Number(income) + TotalCustomerPaid;
//     interest_over_due =  InterestOverDue;
//     if(interest_over_due > 0){
//       amount_receivable = (Number(amount_receivable) + interest_over_due) - TotalCustomerPaid;
//     }
//     else{
//       amount_receivable = Number(amount_receivable) - TotalCustomerPaid;
//     }
   


//     await Agreement.findByIdAndUpdate(agreement_id, 
//       {
//         amount_receivable:amount_receivable,
//         income:income ,
//         interest_over_due: interest_over_due,
//       }, {new: true})






//       if(unpaiedCurrentindex > -1){
//         await Agreement.updateOne(
//           { _id: agreement_id, "installments._id": amountToPayInterestId },
//           {
//             $set: {
//               "installments.$.amount":customerToPayAddedInterest,
//             }
//           }
//         );
//       }




//     res.status(200).json({ success: true, message: "Installments updated successfully" });
//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });



router.delete("/delete_aggrement", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {

    const getUser = await req.user;
    const user = await User.findOne({ _id: getUser._id });
    if (!user)
      return res.status(400).json({ error: true, message: "The requester Can not found" });


    await Agreement.findOneAndDelete({ _id: req.body.id })
      .then((removedAggrement) => {
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
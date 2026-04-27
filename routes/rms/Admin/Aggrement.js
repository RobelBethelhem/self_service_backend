import { Router } from "express";
import auth from "../../../middleware/rms/auth.js";
import roleCheck from "../../../middleware/rms/roleCheck.js";

import {Agreement} from "../../../models/rms/Aggrement.js"
import Price_Per_Room from "../../../models/rms/Price_per_Room.js";
import User from "../../../models/rms/User.js";
import Room from "../../../models/rms/Room.js";
import Customer from "../../../models/rms/Customer.js";
import { customerBodyValidation } from "../../../utils/rms/customerBodyValidation.js";
import {calculatePayments, calculatePenalities} from "../../../utils/rms/payment_calculation.js";
import mongoose from 'mongoose';
import {upload,mergePDFs } from "../../../middleware/rms/upload.js";


const router = Router();

router.post("/restructure_agreement", auth, roleCheck(["admin"]), async(req,res,next)=>{
  try{
    console.log("Asfaw Bogale",req.body)
    var sampleData = [
      {
        id: '006',
        name: req.body.name,
        principalPayment: '1625.00',
        interestPayment: '375.00',
        remainingBalance: '40125.00',
        amount: '2000.00',
        dueDate: '2024-02-01',
        unpaid_date_difference: '0',
        paid_amount: '2000.00',
        paid: true,
        status: 'Paid',
        paidDate: '2024-01-29',
        registered_By: 'Emma Watson',
        Created_At: '2023-08-15T10:30:00Z',
        Updated_At: '2024-01-29T11:05:00Z',
        updated_By: 'Frank Miller',
      },
      {
        id: '007',
        name: req.body.name,
        principalPayment: '1650.00',
        interestPayment: '350.00',
        remainingBalance: '38475.00',
        amount: '2000.00',
        dueDate: '2024-03-01',
        unpaid_date_difference: '10',
        paid_amount: '1500.00',
        paid: false,
        status: 'Partially Paid',
        paidDate: '2024-03-11',
        registered_By: 'Emma Watson',
        Created_At: '2023-08-15T10:30:00Z',
        Updated_At: '2024-03-11T14:30:00Z',
        updated_By: 'Grace Lee',
      },
      {
        id: '008',
        name: req.body.name,
        principalPayment: '1675.00',
        interestPayment: '325.00',
        remainingBalance: '36800.00',
        amount: '2000.00',
        dueDate: '2024-04-01',
        unpaid_date_difference: '',
        paid_amount: '2200.00',
        paid: true,
        status: 'Overpaid',
        paidDate: '2024-04-01',
        registered_By: 'Emma Watson',
        Created_At: '2023-08-15T10:30:00Z',
        Updated_At: '2024-04-01T09:45:00Z',
        updated_By: 'Henry Ford',
      },
      {
        id: '009',
        name: req.body.name,
        principalPayment: '1700.00',
        interestPayment: '300.00',
        remainingBalance: '35100.00',
        amount: '2000.00',
        dueDate: '2024-05-01',
        unpaid_date_difference: '30',
        paid_amount: '0.00',
        paid: false,
        status: 'Defaulted',
        paidDate: '',
        registered_By: 'Emma Watson',
        Created_At: '2023-08-15T10:30:00Z',
        Updated_At: '2024-05-31T16:20:00Z',
        updated_By: 'Iris Johnson',
      }
    ];
    res.json({error: false, data: sampleData})
  }
  catch(e){
    console.log("Error", e)
  }
})

router.post("/register_aggrement", auth, roleCheck(["admin", "site_manager"]), upload.array('attachments'), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(400).json({ error: true, message: "Requester not found" });

    const { room_id, customer_id, payment_period, payment_type, payment_duration, base_payment_percent, discount_rate, repayment_started } = req.body;

    // Validate input
    if (!payment_period || payment_type !== "Installment" || !payment_duration) {
      return res.status(400).json({ error: true, message: "Invalid payment details" });
    }

    const toBeSellRoom = await Room.findById(room_id);
    const sellerOwner = await Customer.findById(customer_id);
    const pricePerRoom = await Price_Per_Room.findOne({ room_id: room_id });

    if (!toBeSellRoom || !sellerOwner || !pricePerRoom || !pricePerRoom.selling_price) {
      return res.status(400).json({ error: true, message: "Invalid room, customer, or price data" });
    }

    const presentValuePrime = Math.abs((pricePerRoom.selling_price * Number(base_payment_percent) / 100) - pricePerRoom.selling_price);

    const data_ = { payment_period, payment_duration: Number(payment_duration), discount_rate: Number(discount_rate), repayment_started: new Date(repayment_started) };
    const pricePerRoom_ = { selling_price: presentValuePrime };

    const installments = calculatePayments(data_, pricePerRoom_);
    const penalities = calculatePenalities(Number(req.body.Percent_per_day_penality),Number(req.body.when_legal_case), Number(req.body.when_agreement_cancel), user.name, presentValuePrime )

    const newAgreement = new Agreement({
      ...req.body,
      site_id: user.roles.includes('site_manager') ? user.site_id : null,
      amount_receivable: presentValuePrime,
      customer_name: sellerOwner.customer_name,
      registered_By: user.name,
      repayment_end: installments[installments.length - 1].dueDate,
      installments,
      penalities,
      base_payment: pricePerRoom.selling_price -presentValuePrime ,  // Make sure this is included
      aggerement_status: 'Ongoing'  // Set a default value
    });

    await newAgreement.save();
    // await Room.findByIdAndUpdate(room_id, { room_status: "Sold" }, { new: true });
    res.status(201).json({ error: false, message: "Registered Successfully" });
  } catch (e) {
    console.error("Error", e);
    res.status(500).json({ error: true, message: e.message });
  }
});


router.post("/special_no_penality", auth, roleCheck(["admin"]), async (req, res, next) => {
  try {
    const getUser = req.user;
    const user = await User.findById(getUser._id);
    if (!user) {
      return res.status(400).json({ error: true, message: "The requester cannot be found" });
    }

    const { start_date, end_date, agreement_id } = req.body;
    const special_no_penality = {
      start_date: new Date(start_date),
      end_date: new Date(end_date),
      createdAt: Date.now(),
      registered_By: user.name
    };

    const result = await Agreement.updateOne(
      { _id: agreement_id },
      {
        $push: {
          special_case_no_penality: special_no_penality
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: true, message: "Agreement not found or not updated" });
    }

    res.status(200).json({ error: false, message: "Special no penalty period added successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

router.post("/paid_installment", auth, roleCheck(["admin", "site_manager"]), async (req, res) => {
  try {

    console.log("paid_installmentpaid_installmentpaid_installment", req.body)
    const currentDate = new Date();
    const { user_id } = req.user;
    const user = await User.findById(user_id);
    if (!user) {
      return res.status(400).json({ error: true, message: "The requester cannot be found" });
    }

    const { agreement_id, paid_installments, tab_name } = req.body;

    // Fetch the agreement
    const agreement = await Agreement.findById(agreement_id);
    if (!agreement) {
      return res.status(400).json({ error: true, message: "Agreement not found" });
    }

    const startInstallment = paid_installments[0].installment - 1; // Convert to 0-based index
    let remainingPayment = paid_installments[0].paid_amount;
    let updatedInstallments = [];

    for (let i = startInstallment; i < agreement.installments.length; i++) {
      let installment = agreement.installments[i];
      
      if (remainingPayment <= 0) break;

      if (!installment.paid) {
        let accrueLeftAmount = installment.accrue_left_amount;
        let amount = installment.amount;
        let payment = 0;
        let leftAmount = 0;
        let status = "Unpaid";

        // Pay accrue_left_amount first
        if (accrueLeftAmount > 0) {
          if (remainingPayment >= accrueLeftAmount) {
            payment += accrueLeftAmount;
            remainingPayment -= accrueLeftAmount;
            accrueLeftAmount = 0;
          } else {
            payment += remainingPayment;
            accrueLeftAmount -= remainingPayment;
            remainingPayment = 0;
          }
        }

        // Then pay the regular amount
        if (remainingPayment > 0) {
          if (remainingPayment >= amount) {
            payment += amount;
            remainingPayment -= amount;
            amount = 0;
          } else {
            payment += remainingPayment;
            amount -= remainingPayment;
            remainingPayment = 0;
          }
        }

        // Determine status and leftover amounts
        if (accrueLeftAmount === 0 && amount === 0) {
          status = currentDate > installment.dueDate ? "Paid Late" : "Paid";
        } else if (payment > 0) {
          status = "Partially Paid";
          leftAmount = amount;
        }

        // Update the installment
        updatedInstallments.push({
          updateOne: {
            filter: { _id: agreement_id, "installments._id": installment._id },
            update: {
              $set: {
                "installments.$.paid": status === "Paid" || status === "Paid Late",
                "installments.$.status": status,
                "installments.$.payment": payment,
                "installments.$.left_amount": leftAmount,
                "installments.$.accrue_left_amount": accrueLeftAmount,
                "installments.$.paidDate": currentDate,
                "installments.$.registered_By": user.name,
                "installments.$.updatedAt": currentDate,
                "installments.$.updated_By": user.name
              }
            }
          }
        });
      }
    }

    // Perform bulk update
    if (updatedInstallments.length > 0) {
      await Agreement.bulkWrite(updatedInstallments);
    }

    // Update agreement totals
    const updatedAgreement = await Agreement.findById(agreement_id);
    const totalPaid = updatedAgreement.installments.reduce((sum, inst) => sum + inst.payment, 0);
    const totalLeftAmount = updatedAgreement.installments.reduce((sum, inst) => sum + inst.left_amount, 0);
    const totalAccrueLeft = updatedAgreement.installments.reduce((sum, inst) => sum + inst.accrue_left_amount, 0);

    await Agreement.findByIdAndUpdate(agreement_id, {
      income: totalPaid,
      amount_receivable: totalLeftAmount + totalAccrueLeft,
      aggerement_status: totalLeftAmount + totalAccrueLeft === 0 ? "Completed" : "Ongoing"
    });

    res.status(200).json({ success: true, message: "Installments updated successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});














// const presentValue = 100000; 
// const payment = 2500; 
// const annualRate = 17; 
// const paymentFrequency = 12; 

// const numberOfInstallments = calculateNumberOfInstallments(presentValue, payment, annualRate, paymentFrequency);

// console.log(`Number of installments: ${numberOfInstallments}`);
// console.log(`Total duration in years: ${(numberOfInstallments / paymentFrequency).toFixed(2)}`);
// function calculateNumberOfInstallments(presentValue, payment, annualRate, paymentFrequency) {
   
//   const ratePerPeriod = (annualRate / 100) / paymentFrequency;
  
//   const n = Math.log(payment / (payment - ratePerPeriod * presentValue)) / Math.log(1 + ratePerPeriod);

//   return Math.ceil(n);
// }


// router.post("/register_aggrement", auth, roleCheck(["admin", "site_manager"]), upload.array('attachments'), async (req, res, next) => {
//   try {
 
//     console.log("hjgdhgwehghwegvhgwhegvchwge", req.body)
//     if (req.files && req.files.length > 0) {
//       const mergedFile = await mergePDFs(req.files);

 
//       console.log("mergedPathmergedPathmergedPathmergedPathmergedPath",mergedFile.filename)
//     }
//     const getUser = await req.user;
//     const user = await User.findOne({ _id: getUser._id });
//     if (!user) {
//       return res.status(400).json({ error: true, message: "The requester Can not found" });
//     }
//     const userRole = req.user.roles ;
//     if(userRole[0].includes('site_manager')){
//       req.body.site_id = new mongoose.Types.ObjectId(user.site_id);
     
//      }
//      else{
//       req.body.site_id = '';
//      }
    
   
//      console.log("rrrrrrrrrrrrrrrrrrrrrrrrrrr", req.body)

//     const { id, ...data } = req.body;
//     const toBeSellRoom = await Room.findById(data.room_id);
//     if (!toBeSellRoom) {
//       return res.status(400).json({ error: true, message: "Room Not found with given room_id" });
//     }

//     const toBeSellRoomStatus = toBeSellRoom.room_status;
//     if (toBeSellRoomStatus !== "Available") {
//       return res.status(400).json({ error: true, message: "Room is Already sold out" });
//     }

//     const sellerOwner = await Customer.findById(data.customer_id);
//     if (!sellerOwner) {
//       return res.status(400).json({ error: true, message: "Customer Not Found with given customer_id" });
//     }

//     const pricePerRoom = await Price_Per_Room.findOne({ room_id: toBeSellRoom._id });
//     if (!pricePerRoom || !pricePerRoom.selling_price) {
//       return res.status(400).json({ error: true, message: "Room Price is Not Given" });
//     }

//     if (!data.payment_period) {
//       return res.status(400).json({ error: true, message: "Payment period is Mandatory" });
//     }

//     // if (data.payment_period !== "monthly") {
//     //   return res.status(400).json({ error: true, message: "For Now The System Accept Monthly Payment Period" });
//     // }

//     if (!data.payment_type) {
//       return res.status(400).json({ error: true, message: "Payment period is Mandatory" });
//     }
//     if (data.payment_type !== "Installment") {
//       return res.status(400).json({ error: true, message: "For Now The System Accept Installment Payment Type" });
//     }
    
//     const { payment_duration, base_payment_percent } = data;
//     if (!payment_duration) {
//       return res.status(400).json({ error: true, message: "Specify payment duration" });
//     }

//     const income = (pricePerRoom.selling_price * base_payment_percent) / 100;
//     const base_payment = income;
//     const amount_receivable = pricePerRoom.selling_price - base_payment;

//     const installmentsArray = generateInstallments(payment_duration, amount_receivable, data.payment_period);
    
//     const installmentStartDate = installmentsArray[0].dueDate;
//     const installmentEndDate = installmentsArray[installmentsArray.length - 1].dueDate;










//     function generateInstallments(payment_duration, amount_receivable, payment_period) {

//       let total_installement = 0;
//       let currentDate = new Date();
//       if(payment_period === "monthly"){
//          total_installement = payment_duration * 12;
//          currentDate.setDate(currentDate.getDate() + 30); // Start from one month from now
//       }
//       else if (payment_period === "quarterly"){
//          total_installement = payment_duration * 4;
//          currentDate.setDate(currentDate.getDate() + 4*30); // Start from one month from now
//       }
//       else if (payment_period === "yearly"){
//         total_installement = payment_duration;
//         currentDate.setDate(currentDate.getDate() + 12*30); // Start from one month from now
//      }
//       const scheduled_payment_per_month = Number((amount_receivable / total_installement).toFixed(2));
    
//       const installments = [];
     

    
    
//       for (let i = 0; i < total_installement; i++) {
//         // Adjust for Sunday
//         while (currentDate.getDay() === 0) {
//           currentDate.setDate(currentDate.getDate() + 1);
//         }
    
//         installments.push({
//           amount: scheduled_payment_per_month,
//           dueDate: new Date(currentDate),
//           unpaid_date_difference: 0,
//           paid_amount: 0,
//           paid: false,
          
//           installment: i
//         });
    
//         // Move to next month, handling year change
//         let newMonth = currentDate.getMonth();
//         let newYear = currentDate.getFullYear();
//         if(payment_period === "monthly"){
//            newMonth = currentDate.getMonth() + 1;
//         }
//         else if (payment_period === "quarterly"){
          
//           newMonth = currentDate.getMonth() + 4;
//           if (newMonth > 11) {
//             newMonth = newMonth - 12;
//             newYear++;
//           }

//         }
//         else if (payment_period === "yearly"){
//           newMonth = currentDate.getMonth() + 12;
//         }
        
     
       
//         if (newMonth > 11) {  // If it's December (month 11), move to January of next year
//           newMonth = 0;  // January
//           newYear++;
//         }
//         currentDate = new Date(newYear, newMonth, currentDate.getDate());
    
//         // Adjust for months with fewer days
//         while (currentDate.getMonth() !== newMonth) {
//           currentDate.setDate(currentDate.getDate() - 1);
//         }
//       }
    
//       return installments;
//     }
    




//     var customerAggrement;
//     if(userRole[0].includes('site_manager')){
//       customerAggrement = {
//         room_id: data.room_id,
//         site_id: req.body.site_id,   
//         customer_id: data.customer_id,
//         payment_type: data.payment_type,
//         payment_period: data.payment_period,
//         base_payment: base_payment,
//         installments: installmentsArray,
//         base_payment_percent: base_payment_percent,
//         payment_duration: payment_duration,
//         repayment_started: installmentStartDate,
//         repayment_end: installmentEndDate,
//         interest_over_due: 0,
//         income: income,
//         amount_receivable: pricePerRoom.selling_price,
//         registered_By: user.name,
//         customer_name: sellerOwner.customer_name
//       };
//     }
//     else{
//       customerAggrement = {
//         room_id: data.room_id,
//         customer_id: data.customer_id,
//         payment_type: data.payment_type,
//         payment_period: data.payment_period,
//         base_payment: base_payment,
//         installments: installmentsArray,
//         base_payment_percent: base_payment_percent,
//         payment_duration: payment_duration,
//         repayment_started: installmentStartDate,
//         repayment_end: installmentEndDate,
//         interest_over_due: 0,
//         income: income,
//         amount_receivable: pricePerRoom.selling_price,
//         registered_By: user.name,
//         customer_name: sellerOwner.customer_name
//       };
//     }

     

//     await new Agreement(customerAggrement).save();
//     await Room.findByIdAndUpdate(data.room_id, { room_status: "Sold" }, { new: true });
//     return res.status(201).json({ error: false, message: "Registered Successfully" });
//   } catch (e) {
//     console.log(e);
//     return res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });



// router.post("/paid_installement", auth, roleCheck(["admin","site_manager"]), async (req, res) => {
//   try {

//     console.log("iiiiiiiiiiiiiiiiiiiiiiiiiiii", req.body)

//   //   const getUser = req.user;
//   //   const user = await User.findById(getUser._id);
//   //   if (!user) {
//   //     return res.status(400).json({ error: true, message: "The requester cannot be found" });
//   //   }

//   //   const { agreement_id, paid_aggrements } = req.body;
//   //   console.log("agreement_id",agreement_id)
//   //   console.log("paid_aggrements",paid_aggrements)

    
//   //   const agreement = await Agreement.findById(agreement_id);
//   //   if (!agreement) {
//   //     return res.status(400).json({ error: true, message: "Some unknown error occurred. Try again." });
//   //   }

//   //   if (agreement.aggerement_status === "Completed") {
//   //     return res.status(400).json({ error: true, message: "The installment payment is already completed for this agreement" });
//   //   }

//   //   const updatePromises = paid_aggrements.map(element => {

//   //     const customerDueDate = element.dueDate;
//   //     const nowTime = Date.now();
      
//   //       // Function to get date without time
//   //           function getDateWithoutTime(dateString) {
//   //               const date = new Date(dateString);
//   //               return new Date(date.getFullYear(), date.getMonth(), date.getDate());
//   //             }

//   //     // Get customer due date without time 2025-06-11T21:00:00.000Z
//   //    const dueDateWithoutTime = getDateWithoutTime(customerDueDate);
//   //     //const dueDateWithoutTime = getDateWithoutTime("2024-01-01T21:00:00.000Z");


//   //           // Get today's date without time
//   //     const todayWithoutTime = getDateWithoutTime(nowTime);

//   //           // Calculate the difference in milliseconds
//   //     const differenceMs = dueDateWithoutTime - todayWithoutTime;

//   //           // Convert milliseconds to days
//   //     const daysDifference = Math.floor(differenceMs / (1000 * 60 * 60 * 24));

    
//   //     let unpaid_date_difference = 0;
//   //     if(daysDifference < 0){
//   //       unpaid_date_difference = (daysDifference) * -1;
//   //     }
//   //     else {
//   //       unpaid_date_difference = 0;
//   //     }





//   //     return Agreement.updateOne(
//   //       { _id: agreement_id, "installments._id": element.id },
//   //       {
//   //         $set: {
//   //           "installments.$.paid": true,
//   //           "installments.$.status": "true",
//   //           "installments.$.paid_amount": element.amount,
//   //           "installments.$.unpaid_date_difference": unpaid_date_difference,
//   //           "installments.$.paidDate": new Date(),
//   //           "installments.$.registered_By": user.name,
//   //           "installments.$.updatedAt": new Date(),
//   //           "installments.$.updated_By": user.name
//   //         }
//   //       }
//   //     );
//   //   });



//   //   await Promise.all(updatePromises);


//   //   let TotalCustomerPaid = 0;
//   //   let InterestOverDue = 0; 
//   //   //interest_over_due
    
//   //   let unpaiedCurrentindex = -1;
//   //   let amountToPayInterestId = '';
//   //   let amountToPayInterestIndex = -2; 
//   //   let customerToPayAddedInterest = 0;


//   //   const updated_agreement = await Agreement.findById(agreement_id);
   
//   //   updated_agreement.installments.forEach((element, index) => {
     
//   //     if( element.status === "true"){
//   //       TotalCustomerPaid += Number(element.amount);
//   //     }
     
//   //     if(amountToPayInterestIndex == index){
      
//   //       amountToPayInterestId = element._id.toString();
//   //       customerToPayAddedInterest = Number(element.amount) + InterestOverDue;
//   //     }
//   //     if(element.unpaid_date_difference > 0 && element.status !== "true"){
       
//   //       unpaiedCurrentindex = index;
//   //       amountToPayInterestIndex = index + 1;
//   //       InterestOverDue += Number(element.unpaid_date_difference) * 0.07 * Number(element.amount);
//   //     }
      
//   //   });

//   //   let amount_receivable = updated_agreement.amount_receivable;
//   //   let income = updated_agreement.income;
//   //   let interest_over_due = updated_agreement.interest_over_due;

     
//   //   income = Number(income) + TotalCustomerPaid;
//   //   interest_over_due =  InterestOverDue;
//   //   if(interest_over_due > 0){
//   //     amount_receivable = (Number(amount_receivable) + interest_over_due) - TotalCustomerPaid;
//   //   }
//   //   else{
//   //     amount_receivable = Number(amount_receivable) - TotalCustomerPaid;
//   //   }
   


//   //   await Agreement.findByIdAndUpdate(agreement_id, 
//   //     {
//   //       amount_receivable:amount_receivable,
//   //       income:income ,
//   //       interest_over_due: interest_over_due,
//   //     }, {new: true})






//   //     if(unpaiedCurrentindex > -1){
//   //       await Agreement.updateOne(
//   //         { _id: agreement_id, "installments._id": amountToPayInterestId },
//   //         {
//   //           $set: {
//   //             "installments.$.amount":customerToPayAddedInterest,
//   //           }
//   //         }
//   //       );
//   //     }




//   //   res.status(200).json({ success: true, message: "Installments updated successfully" });
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
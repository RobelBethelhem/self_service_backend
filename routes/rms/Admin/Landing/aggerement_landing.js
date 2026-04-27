import { Router } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";
import { Agreement } from "../../../../models/rms/Aggrement.js";
import User from "../../../../models/rms/User.js";

const router = Router();

router.get('/get_aggerement', auth, roleCheck(["admin","site_manager"]), async (req, res, next) => {
  console.log("I am in the get_aggerement");

  const getUser = await req.user;
  const id = getUser._id;
  const specific_user = await User.findOne({ _id: id });
  const user = { ...specific_user._doc };
  delete user._id;
  delete user.__v;
  delete user.password;

  var template = {
    id: '',
    room_id: '',
    customer_id: '', 
    customer_name: '',
    payment_type: '',
    payment_period: '',

    base_payment: '',
    base_payment_percent: '',
    payment_duration: '',

    repayment_started: '',
    repayment_end: '',
    interest_over_due: '',

    income: '',
    amount_receivable: '',
    registered_By: '',
    createdAt: '',
    Updated_At: '',
    Updated_By: '',
  }

  const userRole = req.user.roles ;
  var dataa;

  if(userRole[0].includes('admin')){
     dataa = await Agreement.find();
    }
    else if(userRole[0].includes('site_manager')){
      dataa = await Agreement.find({site_id: user.site_id});
     }

 

  const newObj = dataa.map((item, index) => {
    const { __v, _id, installments, ...rest } = item._doc;
    const hasScriptProperty = Object.values(rest).some(propValue => 
      typeof propValue === 'string' &&
      (propValue.includes('script') || propValue.includes('iframe') || propValue.includes('<') || propValue.includes('>') || propValue.includes('alert'))
    );
  
    if (!hasScriptProperty) {
        return { ...template, id: _id.toString(), ...rest };
    }
    return null;
  }).filter(Boolean); 
    
  // Send response
  const sendUsers = {
    data: newObj,
    meta: { totalRowCount: dataa.length }
  };
  
  res.json(sendUsers)
});

export default router;
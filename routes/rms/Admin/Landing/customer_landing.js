import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";

import Place from "../../../../models/rms/Place.js"
import User from "../../../../models/rms/User.js"
import Customer from "../../../../models/rms/Customer.js"

const router = Router();

router.get('/get_customer', auth, roleCheck(["admin", "site_manager"]), async(req,res,next)=>{
  
  
    
    const getUser = await req.user;
    const id = getUser._id;
    const specific_user = await User.findOne({ _id: id });
    const user = { ...specific_user._doc };
    delete user._id;
    delete user.__v;
    delete user.password;


    var template = {
        id: '',
        customer_name: '',
        customer_email: '',
        customer_phone_number: '',
        customer_address: '',
        registered_By: '',
        Created_At: '',
        Updated_At: '',
        Updated_By: '',
      }

      const userRole = req.user.roles ;
       var dataa;
       if(userRole[0].includes('admin')){
         dataa = await Customer.find();
       }
       else if(userRole[0].includes('site_manager')){
        dataa = await Customer.find({registered_By: user.name})
       }
       
      

      

      var newObj = dataa.map(item => {
        var { _id, __v, password, ...rest } = item._doc;
        const hasScriptProperty = Object.values(rest).some(propValue => typeof propValue === 'string' && (propValue.includes('script') || propValue.includes('iframe') || propValue.includes('<') || propValue.includes('>') || propValue.includes('alert')));
        if (!hasScriptProperty) {
          return { ...template, id: _id.toString(), ...rest };
        }
        return null;
      }).filter(Boolean); 

     
      const sendUsers = {};
      const meta = {};
      sendUsers.data = newObj;
      meta.totalRowCount = dataa.length;
      sendUsers.meta = meta;

      res.json(sendUsers);

})


export default router;

import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";

import Place from "../../../../models/rms/Place.js"
import User from "../../../../models/rms/User.js"

const router = Router();

router.get('/get_place', auth, roleCheck(["admin"]), async(req,res,next)=>{
  console.log("I am in the landing Place")
    
    const getUser = await req.user;
    const id = getUser._id;
    const specific_user = await User.findOne({ _id: id });
    const user = { ...specific_user._doc };
    delete user._id;
    delete user.__v;
    delete user.password;


    var template = {
        id: '',
        country: '',
        region: '',
        city: '',
        registered_By: '',
        Created_At: '',
        Updated_At: '',
        Updated_By: '',
      }

      var dataa = await Place.find();

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

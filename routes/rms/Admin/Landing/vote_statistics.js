import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";

import Vote from "../../../../models/rms/Vote.js"
import User from "../../../../models/rms/User.js"

const router = Router();

router.get('/get_vote_stastics', auth, roleCheck(["admin"]), async(req,res,next)=>{
  console.log("I am in the landing get_vote_stastics")
    
    const getUser = await req.user;
    const id = getUser._id;
    const specific_user = await User.findOne({ _id: id });
    const user = { ...specific_user._doc };
    delete user._id;
    delete user.__v;
    delete user.password;


    var template = {
        id: '',

        voter_first_name: '',
        voter_last_name: '',
        voter_emp_id: '',

        voter_position: '',
        voter_department: '',

        candidate_first_name: '',
        candidate_last_name: '',
        candidate_emp_id: '',

        candidate_position: '',
        candidate_department: '',

        Dedication: '',
        Quality_of_Work: '',
        Collaboration_Or_Team_Work: '',
        Independence: '',
        Customer_Service: '',
        Time_Mgt: '',
        Proper_Office_Attire_and_Dress_Code: '',
        Flexibility: '',
        Total_Weight: '',
        Accrue_Weight: '',
        TimeStamp: '',
      }

      var dataa = await Vote.find();

      var newObj = dataa.map(item => {
        var { _id, __v, ...rest } = item._doc;
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

router.get('/get_vote_stasticss', auth, roleCheck(["admin"]), async(req,res,next)=>{
  console.log("I am in the landing get_vote_stastics")
    
    const getUser = await req.user;
    const id = getUser._id;
    const specific_user = await User.findOne({ _id: id });
    const user = { ...specific_user._doc };
    delete user._id;
    delete user.__v;
    delete user.password;


    var template = {
        id: '',

        voter_first_name: '',
        voter_last_name: '',
        voter_emp_id: '',

        voter_position: '',
        voter_department: '',

        candidate_first_name: '',
        candidate_last_name: '',
        candidate_emp_id: '',

        candidate_position: '',
        candidate_department: '',

        Dedication: '',
        Quality_of_Work: '',
        Collaboration_Or_Team_Work: '',
        Independence: '',
        Customer_Service: '',
        Time_Mgt: '',
        Proper_Office_Attire_and_Dress_Code: '',
        Flexibility: '',
        Total_Weight: '',
        Accrue_Weight: '',
        TimeStamp: '',
      }

      var dataa = await Vote.find();

      var newObj = dataa.map(item => {
        var { _id, __v, ...rest } = item._doc;
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

      res.json(newObj);

})


export default router;

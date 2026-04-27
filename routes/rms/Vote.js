import {Router} from "express";
import User from "../../models/rms/User.js";
import Vote from "../../models/rms/Vote.js"
import mongoose from 'mongoose';
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import Candidate from "../../models/rms/Candidate.js";



const router = Router();



router.post("/vote_candidate", auth, roleCheck(["admin","user"]), async(req,res,next)=>{
    try{

        const user = await User.findById(req.user._id).lean();
        if (!user) {
            return res.status(400).json({ error: true, message: "Requester not found" });
        }

        const {first_name, last_name, employee_id, position, department} = user
      
        const { employee, evaluations, totalScore } = req.body;
       
        const ratings = {};
        evaluations.forEach(item => {
            ratings[item.criteriaId] = item.rating;
        });
        const candidate_info = await Candidate.findOne({employee_id: employee.employee_id})
        if(!candidate_info) return res.status(400).json({ error: true, message: "Candidate not found" });

        const isDuplicate = await Vote.findOne({ voter_emp_id: employee_id }) 

        if(isDuplicate) return res.status(400).json({ error: true, message: "You Already Vote"});
        
       
        let Accrue_Weight = 0;
        const voted = await Vote.find({ candidate_emp_id: employee.employee_id })
        .sort({ $natural: -1 })
        .lean();


        console.log("votedvotedvoted", voted)
       
    

      
        if (!voted || voted.length === 0) {
            Accrue_Weight = totalScore;
        }
        else{
            Accrue_Weight = voted[0].Accrue_Weight + totalScore;
        }
       
     

        
        const saveVoter_ToDB = {
            voter_first_name: first_name,
            voter_last_name: last_name,
            voter_emp_id: employee_id,
            voter_position: position,
            voter_department: department,
            candidate_first_name: employee.first_name,
            candidate_last_name: employee.last_name,
            candidate_emp_id: employee.employee_id,
            candidate_position: candidate_info.position,
            candidate_department: candidate_info.department,
            Dedication: ratings[1] || null,
            Quality_of_Work: ratings[2] || null,
            Collaboration_Or_Team_Work: ratings[3] || null,
            Independence: ratings[4] || null,
            Customer_Service: ratings[5] || null,
            Time_Mgt: ratings[6] || null,
            Proper_Office_Attire_and_Dress_Code: ratings[7] || null,
            Flexibility: ratings[8] || null,
            Total_Weight: totalScore,
            Accrue_Weight: Accrue_Weight
        };
        
        
        const saveDB = new Vote(saveVoter_ToDB);
        await saveDB.save();
        

        const updatedData = {
            status: true,
        }
        const updatedUser = await User.findByIdAndUpdate(req.user._id,updatedData,{
            new: true
        })



        res.status(201).json({ error: false, message: "Your Vote Successfully Registered" });


    }
    catch(e){
      console.log("Error",e)
      res.status(400).json({ error: false, message: "Could Not Do the Operation " });
    }
  })




  export default router;



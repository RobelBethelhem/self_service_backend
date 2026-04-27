// import { Router, request } from "express";
// import auth from "../../../../middleware/rms/auth.js";
// import roleCheck from "../../../../middleware/rms/roleCheck.js";

// import Candidate from "../../../../models/rms/Candidate.js"
// import User from "../../../../models/rms/User.js"

// import Experinace from "../../../../models/rms/Experiance_Letter.js";
// import Supportive from "../../../../models/rms/Supportive_Letter.js";
// import Guaranty from "../../../../models/rms/Guaranty_Letter.js";
// import Embassy from "../../../../models/rms/Letter_of_Embassy.js";
// import GuarantyTrack from "../../../../models/rms/GuarantyTrack.js";

// const router = Router();

// router.get('/get_candidate', auth, roleCheck(["admin", "user"]), async(req,res,next)=>{
//   try {
//       const getUser = await req.user;
//       const id = getUser._id;
//       const specific_user = await User.findOne({ _id: id });
//       const user = { ...specific_user._doc };
//       delete user._id;
//       delete user.__v;
//       delete user.password;

//       var template = {
//           id: '',
//           employee_first_name: '',
//           employee_middle_name: '',
//           employee_last_name: '',
//           domain_user: '',
//           employee_description: '',
//           request_type: '',
//           status: '',
//           viewed_by: '',
//           TimeStamp: '',
//           viewed_date: '',
//           reference_number: '',
//       }

//       var dataa = await Candidate.find();

//       var experiance;
//       var supportive;
//       var guaranty;
//       var embassy;

//       if(user.roles[0] === 'user'){
//           experiance = await Experinace.find({domain_user: user.user});
//           supportive = await Supportive.find({domain_user: user.user});
//           guaranty = await Guaranty.find({domain_user: user.user});
//           embassy = await Embassy.find({domain_user: user.user});
//       }
//       else if(user.roles[0] === 'admin'){
//           experiance = await Experinace.find();
//           supportive = await Supportive.find();
//           guaranty = await Guaranty.find();
//           embassy = await Embassy.find();
//       }

//       let mergedArray = experiance.concat(supportive, guaranty, embassy);

//       // First, create the promises array
//       const promises = mergedArray.map(async item => {
//           var { _id, __v, ...rest } = item._doc;
//           const hasScriptProperty = Object.values(rest).some(propValue => 
//               typeof propValue === 'string' && (
//                   propValue.includes('script') || 
//                   propValue.includes('iframe') || 
//                   propValue.includes('<') || 
//                   propValue.includes('>') || 
//                   propValue.includes('alert')
//               )
//           );

//           if (!hasScriptProperty) {
//               let result = { ...template, id: _id.toString(), ...rest };
              
//               if (rest.request_type === 'Guranty') {
//                   const trackInfo = await GuarantyTrack.findOne({ domain_user: rest.domain_user }) || { guaranty_count: 0 };
//                   result.guaranty_count = trackInfo.guaranty_count;
//               }
              
//               return result;
//           }
//           return null;
//       });

//       // Then await Promise.all and filter the results
//       const newObj = (await Promise.all(promises)).filter(Boolean);

//       const sendUsers = {
//           data: newObj,
//           meta: {
//               totalRowCount: dataa.length
//           }
//       };

//       res.json(sendUsers);
//   } catch (error) {
//       console.error(error);
//       res.status(500).json({ error: true, message: "Internal Server Error" });
//   }
// });




// // router.get('/get_candidate', auth, roleCheck(["admin", "user"]), async(req,res,next)=>{
 
// //   const getUser = await req.user;
// //   const id = getUser._id;
// //   const specific_user = await User.findOne({ _id: id });
// //   const user = { ...specific_user._doc };
// //   delete user._id;
// //   delete user.__v;
// //   delete user.password;


// //   var template = {
// //       id: '',
// //       employee_first_name: '',
// //       employee_middle_name: '',
// //       employee_last_name: '',
// //       domain_user: '',
// //       employee_description: '',
// //       request_type: '',
// //       status: '',
// //       viewed_by: '',
// //       TimeStamp: '',
// //       viewed_date: '',
// //       reference_number: '',
    
     
// //     }

// //     var dataa = await Candidate.find();

// // console.log("useruseruser",user.roles[0])
// // var experiance;
// // var supportive;
// // var guaranty;
// // var embassy;

// //       if(user.roles[0] === 'user'){
// //          experiance = await Experinace.find({domain_user: user.user});
// //          supportive = await Supportive.find({domain_user: user.user});
// //          guaranty = await Guaranty.find({domain_user: user.user});
// //          embassy = await Embassy.find({domain_user: user.user});
// //       }
// //       else if(user.roles[0] === 'admin'){
// //          experiance = await Experinace.find();
// //          supportive = await Supportive.find();
// //          guaranty = await Guaranty.find();
// //          embassy = await Embassy.find();
// //       }
    

// //     let mergedArray = experiance.concat(supportive, guaranty, embassy);

// //     var newObj = mergedArray.map(item => {
// //       var { _id, __v, ...rest } = item._doc;
// //       const hasScriptProperty = Object.values(rest).some(propValue => typeof propValue === 'string' && (propValue.includes('script') || propValue.includes('iframe') || propValue.includes('<') || propValue.includes('>') || propValue.includes('alert')));
// //       if (!hasScriptProperty) {
// //         return { ...template, id: _id.toString(), ...rest };
// //       }
// //       return null;
// //     }).filter(Boolean); 

   
// //     const sendUsers = {};
// //     const meta = {};
// //     sendUsers.data = newObj;
// //     meta.totalRowCount = dataa.length;
// //     sendUsers.meta = meta;

// //     res.json(sendUsers);

// // })

// router.get('/get_candidate_by_department', auth, roleCheck(["user","admin"]), async(req,res,next) =>{

//   console.log("I am in the get_candidate")
    
//     const getUser = await req.user;
//     const id = getUser._id;
//     const specific_user = await User.findOne({ _id: id });
//     const user = { ...specific_user._doc };
//     delete user._id;
//     delete user.__v;
//     delete user.password;


//     var template = {
//         id: '',
//         first_name: '',
//         last_name: '',
//         employee_id: '',
//       }
//       var newObj = [];
//       if(!user.status){
//         var dataa = await Candidate.find({department: user.department, });

         
//        newObj = dataa.map(item => {
//         var { _id, __v, ...rest } = item._doc;
//         const hasScriptProperty = Object.values(rest).some(propValue => typeof propValue === 'string' && (propValue.includes('script') || propValue.includes('iframe') || propValue.includes('<') || propValue.includes('>') || propValue.includes('alert')));
//         if (!hasScriptProperty) {
//           return { ...template, id: _id.toString(), ...rest };
//         }
//         return null;
//       }).filter(Boolean); 

     
//       const sendUsers = {};
//       const meta = {};
//       sendUsers.data = newObj;
//       meta.totalRowCount = dataa.length;
//       sendUsers.meta = meta;
//       }
     


//       res.json(newObj);

// })


// export default router;























import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";

import Candidate from "../../../../models/rms/Candidate.js"
import User from "../../../../models/rms/User.js"

import Experinace from "../../../../models/rms/Experiance_Letter.js";
import Supportive from "../../../../models/rms/Supportive_Letter.js";
import Guaranty from "../../../../models/rms/Guaranty_Letter.js";
import Embassy from "../../../../models/rms/Letter_of_Embassy.js";
import Medical from "../../../../models/rms/Medical.js";
import GuarantyTrack from "../../../../models/rms/GuarantyTrack.js";

const router = Router();

router.get('/get_candidate', auth, roleCheck(["admin", "user"]), async(req,res,next)=>{
  try {
      const getUser = await req.user;
      const id = getUser._id;
      const specific_user = await User.findOne({ _id: id });
      const user = { ...specific_user._doc };
      delete user._id;
      delete user.__v;
      delete user.password;

      var template = {
          id: '',
          employee_first_name: '',
          employee_middle_name: '',
          employee_last_name: '',
          domain_user: '',
          employee_description: '',
          request_type: '',
          status: '',
          viewed_by: '',
          TimeStamp: '',
          viewed_date: '',
          reference_number: '',
      }

      var dataa = await Candidate.find();

      var experiance;
      var supportive;
      var guaranty;
      var embassy;
      var medical;

      if(user.roles[0] === 'user'){
          experiance = await Experinace.find({domain_user: user.user});
          supportive = await Supportive.find({domain_user: user.user});
          guaranty = await Guaranty.find({domain_user: user.user});
          embassy = await Embassy.find({domain_user: user.user});
          medical = await Medical.find({domain_user: user.user});
      }
      else if(user.roles[0] === 'admin'){
          experiance = await Experinace.find();
          supportive = await Supportive.find();
          guaranty = await Guaranty.find();
          embassy = await Embassy.find();
          medical = await Medical.find();
      }

      // Merge all arrays including medical
      let mergedArray = experiance.concat(supportive, guaranty, embassy, medical);

      // Create the promises array
      const promises = mergedArray.map(async item => {
          var { _id, __v, ...rest } = item._doc;
          const hasScriptProperty = Object.values(rest).some(propValue => 
              typeof propValue === 'string' && (
                  propValue.includes('script') || 
                  propValue.includes('iframe') || 
                  propValue.includes('<') || 
                  propValue.includes('>') || 
                  propValue.includes('alert')
              )
          );

          if (!hasScriptProperty) {
              let result = { ...template, id: _id.toString(), ...rest };
              
              // Special handling for Medical requests
              if (rest.request_type === 'Medical') {
                  // Use spouse or child names based on is_Spouse flag
                  if (rest.is_Spouse) {
                      result.employee_first_name = rest.spouse_first_name || '';
                      result.employee_middle_name = rest.spouse_middle_name || '';
                      result.employee_last_name = rest.spouse_last_name || '';
                  } else {
                      result.employee_first_name = rest.child_first_name || '';
                      result.employee_middle_name = rest.chid_middle_name || '';
                      result.employee_last_name = rest.child_last_name || '';
                  }
                  // Keep the original fields for the preview page
                  result.is_Spouse = rest.is_Spouse;
                  result.spouse_first_name = rest.spouse_first_name;
                  result.spouse_middle_name = rest.spouse_middle_name;
                  result.spouse_last_name = rest.spouse_last_name;
                  result.child_first_name = rest.child_first_name;
                  result.chid_middle_name = rest.chid_middle_name;
                  result.child_last_name = rest.child_last_name;
                  result.medical_place = rest.medical_place;
                  result.employee_id_no = rest.employee_id_no;
                  result.place_of_assignment = rest.place_of_assignment;
                  result.name_of_supervisor = rest.name_of_supervisor;
              }
              
              // Add guaranty_count for Guaranty type
              if (rest.request_type === 'Guranty') {
                  const trackInfo = await GuarantyTrack.findOne({ domain_user: rest.domain_user }) || { guaranty_count: 0 };
                  result.guaranty_count = trackInfo.guaranty_count;
              }
              
              return result;
          }
          return null;
      });

      // Await Promise.all and filter the results
      const newObj = (await Promise.all(promises)).filter(Boolean);

      const sendUsers = {
          data: newObj,
          meta: {
              totalRowCount: dataa.length
          }
      };

      res.json(sendUsers);
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});


// router.get('/get_candidate', auth, roleCheck(["admin", "user"]),
// async(req,res,next)=>{

//   try {

//       const getUser = await req.user;

//       const id = getUser._id;

//       const specific_user = await User.findOne({ _id: id });

//       const user = { ...specific_user._doc };

//       delete user._id;

//       delete user.__v;

//       delete user.password;

//       var template = {

//           id: '',

//           employee_first_name: '',

//           employee_middle_name: '',

//           employee_last_name: '',

//           domain_user: '',

//           employee_description: '',

//           request_type: '',

//           status: '',

//           viewed_by: '',

//           TimeStamp: '',

//           viewed_date: '',

//           reference_number: '',

//       }

//       var dataa = await Candidate.find();

//       var experiance;

//       var supportive;

//       var guaranty;

//       var embassy;

//       var medical;

//       // Both user and admin see only their own requests
//       experiance = await Experinace.find({domain_user: user.user});

//       supportive = await Supportive.find({domain_user: user.user});

//       guaranty = await Guaranty.find({domain_user: user.user});

//       embassy = await Embassy.find({domain_user: user.user});

//       medical = await Medical.find({domain_user: user.user});

//       // Merge all arrays including medical

//       let mergedArray = experiance.concat(supportive, guaranty, embassy, medical);

//       // Create the promises array

//       const promises = mergedArray.map(async item => {

//           var { _id, __v, ...rest } = item._doc;

//           const hasScriptProperty = Object.values(rest).some(propValue => 

//               typeof propValue === 'string' && (

//                   propValue.includes('script') || 

//                   propValue.includes('iframe') || 

//                   propValue.includes('<') || 

//                   propValue.includes('>') || 

//                   propValue.includes('alert')

//               )

//           );

//           if (!hasScriptProperty) {

//               let result = { ...template, id: _id.toString(), ...rest };

              

//               // Special handling for Medical requests

//               if (rest.request_type === 'Medical') {

//                   // Use spouse or child names based on is_Spouse flag

//                   if (rest.is_Spouse) {

//                       result.employee_first_name = rest.spouse_first_name || '';

//                       result.employee_middle_name = rest.spouse_middle_name || '';

//                       result.employee_last_name = rest.spouse_last_name || '';

//                   } else {

//                       result.employee_first_name = rest.child_first_name || '';

//                       result.employee_middle_name = rest.chid_middle_name || '';

//                       result.employee_last_name = rest.child_last_name || '';

//                   }

//                   // Keep the original fields for the preview page

//                   result.is_Spouse = rest.is_Spouse;

//                   result.spouse_first_name = rest.spouse_first_name;

//                   result.spouse_middle_name = rest.spouse_middle_name;

//                   result.spouse_last_name = rest.spouse_last_name;

//                   result.child_first_name = rest.child_first_name;

//                   result.chid_middle_name = rest.chid_middle_name;

//                   result.child_last_name = rest.child_last_name;

//                   result.medical_place = rest.medical_place;

//                   result.employee_id_no = rest.employee_id_no;

//                   result.place_of_assignment = rest.place_of_assignment;

//                   result.name_of_supervisor = rest.name_of_supervisor;

//               }

              

//               // Add guaranty_count for Guaranty type

//               if (rest.request_type === 'Guranty') {

//                   const trackInfo = await GuarantyTrack.findOne({ domain_user: rest.domain_user }) || { guaranty_count: 0 };

//                   result.guaranty_count = trackInfo.guaranty_count;

//               }

              

//               return result;

//           }

//           return null;

//       });

//       // Await Promise.all and filter the results

//       const newObj = (await Promise.all(promises)).filter(Boolean);

//       const sendUsers = {

//           data: newObj,

//           meta: {

//               totalRowCount: dataa.length

//           }

//       };

//       res.json(sendUsers);

//   } catch (error) {

//       console.error(error);

//       res.status(500).json({ error: true, message: "Internal Server Error" });

//   }

// });


export default router;

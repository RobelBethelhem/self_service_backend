import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";

import Site from "../../../../models/rms/Site.js";
import Place from "../../../../models/rms/Place.js"
import User from "../../../../models/rms/User.js"

const router = Router();

router.get('/get_site', auth, roleCheck(["admin"]), async(req,res,next)=>{
  console.log("I am in the landing site")
    
    const getUser = await req.user;
    const id = getUser._id;
    const specific_user = await User.findOne({ _id: id });
    const user = { ...specific_user._doc };
    delete user._id;
    delete user.__v;
    delete user.password;

    const template = {
      id: '',
      name: '',
      description: '',
      place_id: '',
      country: '',
      region: '',
      city: '',
      registered_By: '',
      Created_At: '',
      Updated_At: '',
      Updated_By: '',
    };
    
    async function getSitesWithPlaceData() {
      try {
        const sites = await Site.find().lean();
    
        const newObj = await Promise.all(sites.map(async (item) => {
          try {
            if (item.place_id) {
              const place = await Place.findById(item.place_id).lean();
              if (place) {
                item.country = place.country;
                item.region = place.region;
                item.city = place.city;
              }
            }
    
            const { _id, __v, password, ...rest } = item;
            
            const hasScriptProperty = Object.values(rest).some(propValue => 
              typeof propValue === 'string' && 
              (propValue.includes('script') || 
               propValue.includes('iframe') || 
               propValue.includes('<') || 
               propValue.includes('>') || 
               propValue.includes('alert'))
            );
    
            if (!hasScriptProperty) {
              return { ...template, id: _id.toString(), ...rest };
            }
            return null;
          } catch (err) {
            console.error(`Error processing site ${item._id}:`, err);
            return null;
          }
        }));
    
        return newObj.filter(Boolean);
      } catch (err) {
        console.error("Error fetching sites:", err);
        throw err;
      }
    }
    
    // Usage
    try {
      const result = await getSitesWithPlaceData();
    

      const sendUsers = {};
      const meta = {};
      sendUsers.data = result;
      meta.totalRowCount = 5;
      sendUsers.meta = meta;

      res.json(sendUsers);


    } catch (err) {
      console.error("Error:", err);
    }

     
   

})


export default router;

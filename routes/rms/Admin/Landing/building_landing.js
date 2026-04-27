import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";

import Site from "../../../../models/rms/Site.js";
import Place from "../../../../models/rms/Place.js"
import Building from "../../../../models/rms/Building.js"
import User from "../../../../models/rms/User.js"

const router = Router();

router.get('/get_building', auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  console.log("I am in the landing building");

  try {
    const getUser = await req.user;
    const id = getUser._id;
    const specific_user = await User.findOne({ _id: id });
    const user = { ...specific_user._doc };
    delete user._id;
    delete user.__v;
    delete user.password;



    const userRole = req.user.roles ;
    var buildings;







    async function getBuildingWithSiteAndPlaceData() {
      try {
      
        if(userRole[0].includes('admin')){
          buildings = await Building.find().lean();
        }
        else if(userRole[0].includes('site_manager')){


       
          buildings = await Building.find({site_id: user.site_id}).lean();
         }
        

        const newObj = await Promise.all(buildings.map(async (item) => {
          try {
            if (item.site_id) {
              const site = await Site.findById(item.site_id).lean();
              if (site) {
                const { site_name, description, place_id } = site;
                let place = {};
                if (place_id) {
                  place = await Place.findById(place_id).lean() || {};
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
                  return {
                    ...rest,
                    id: _id.toString(),
                    site_name,
                    description,
                    country: place.country,
                    region: place.region,
                    city: place.city
                  };
                }
              }
            }

            return null;
          } catch (err) {
            console.error(`Error processing building ${item._id}:`, err);
            return null;
          }
        }));

        return newObj.filter(Boolean);
      } catch (err) {
        console.error("Error fetching buildings:", err);
        throw err;
      }
    }

    // Usage
    try {
      const result = await getBuildingWithSiteAndPlaceData();
   

      res.json({
        data: result,
        meta: { totalRowCount: result.length }
      });
    } catch (err) {
      console.error("Error:", err);
      next(err);
    }
  } catch (err) {
    console.error("Error fetching user:", err);
    next(err);
  }
});


export default router;

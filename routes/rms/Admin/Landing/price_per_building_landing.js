import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";


import Place from "../../../../models/rms/Place.js"
import Site from "../../../../models/rms/Site.js"
import Building from "../../../../models/rms/Building.js"
import Price_Per_Place from "../../../../models/rms/Price_per_place.js"
import Price_Per_Site from "../../../../models/rms/Price_per_site.js"
import Price_Per_Building from "../../../../models/rms/Price_per_building.js"
import User from "../../../../models/rms/User.js"

const router = Router();

router.get('/get_price_per_building_data', auth, roleCheck(["admin"]), async (req, res, next) => {
   
  
    try {
      const getUser = await req.user;
      const id = getUser._id;
      const specific_user = await User.findOne({ _id: id });
      const user = { ...specific_user._doc };
      delete user._id;
      delete user.__v;
      delete user.password;
  
      async function getBuildingthenSitethenPlacedata() {
        try {
          const Price_Per_Buildings = await Price_Per_Building.find().lean();
          const newObj = await Promise.all(Price_Per_Buildings.map(async (item) => {
            try {
              if (item.building_id) {
                const building = await Building.findById(item.building_id).lean();
                if (building) {
                  const { building_name, total_floor, special_feature, site_id } = building;
  
                  let country, site_name, description, place_id,  region, city, min_selling_price_per_cube_for_site, max_selling_price_per_cube_for_site,  min_selling_price_per_cube_for_place, max_selling_price_per_cube_for_place;
  
                  if (site_id) {
                    const site = await Site.findById(site_id).lean();
                    if (site) {
                      const pps = await Price_Per_Site.findOne({site_id: site_id})
                      if(pps){
                        ({min_selling_price_per_cube_for_site, max_selling_price_per_cube_for_site} = pps)
                      }

                      ({ site_name, description, place_id } = site);
                      
                      if(place_id){
                        const place = await Place.findById(place_id).lean();
                        if (place) {
                          ({ country, region, city } = place);
                        }

                        const ppp = await Price_Per_Place.findOne({ place_id: place_id }).lean();
                        if (ppp) {
                          ({ min_selling_price_per_cube_for_place, max_selling_price_per_cube_for_place } = ppp);
                        }

                      }
                    }
  
                   
                  }
  
                  const { _id, __v, password, ...rest } = item;
                  const hasScriptProperty = Object.values(rest).some(propValue =>
                    typeof propValue === 'string' &&
                    (propValue.includes('<script') ||
                     propValue.includes('iframe') ||
                     propValue.includes('<') ||
                     propValue.includes('>') ||
                     propValue.includes('alert'))
                  );
  
                  if (!hasScriptProperty) {
                    return {
                      ...rest,
                      id: _id.toString(),
                      building_name,
                      total_floor,
                      special_feature,
                      min_selling_price_per_cube_for_site,
                      max_selling_price_per_cube_for_site,
                      site_name,
                      description,
                      min_selling_price_per_cube_for_place,
                      max_selling_price_per_cube_for_place,
                      country,
                      region,
                      city,
                    };
                  }
                }
              }
              return null;
            } catch (err) {
              console.error(`Error processing item ${item._id}:`, err);
              return null;
            }
          }));
          return newObj.filter(Boolean);
        } catch (err) {
          console.error("Error fetching Price_Per_Buildings:", err);
          throw err;
        }
      }
  
      // Usage
      try {
        const result = await getBuildingthenSitethenPlacedata();
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

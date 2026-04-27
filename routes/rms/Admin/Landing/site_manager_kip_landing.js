import { Router } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";
import { Site_Manager_KPI } from "../../../../models/rms/Site_manager_KPI.js";
import User from "../../../../models/rms/User.js";
import Site from "../../../../models/rms/Site.js";
import Place from "../../../../models/rms/Place.js";

const router = Router();

router.get('/get_site_manager_kpi', auth, roleCheck(["admin"]), async (req, res, next) => {
    console.log("I am in the get_site_manager_kpi");
  
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
        site_manager_id: '',
        site_manager_name: '',
        site_name: '',
        description: '',
        country: '',
        region: '',
        city: '',
        over_all_target_amount: '', 
        over_all_achieved_amount: '',
        over_all_KPI_percentage: '',
        registered_By: '',
        createdAt: '',
        Updated_At: '',
        Updated_By: '',
      };
  
      async function getSiteManagerKPIData() {
        try {
          const dataa = await Site_Manager_KPI.find().lean();
  
          const newObj = await Promise.all(dataa.map(async (item) => {
            try {
              const { __v, _id, KPI_installments, ...rest } = item;
  
              const site_manager = await User.findById(item.site_manager_id).lean();
  
              if (!site_manager) {
                throw new Error("Site manager not found");
              }
              const {name} = site_manager
  
              const site_id_for_manager = site_manager.site_id;
              const site = await Site.findById(site_id_for_manager).lean();
  
              if (!site) {
                throw new Error("Site not found");
              }
  
              const { site_name, description, place_id } = site;
              let place = {};
              if (place_id) {
                place = await Place.findById(place_id).lean() || {};
              }
  
              const { country, region, city } = place;
  
              const hasScriptProperty = Object.values(rest).some(propValue => 
                typeof propValue === 'string' &&
                (propValue.includes('script') || propValue.includes('iframe') || propValue.includes('<') || propValue.includes('>') || propValue.includes('alert'))
              );
  
              if (!hasScriptProperty) {
                return {
                  ...template,
                  id: _id.toString(),
                  ...rest,
                   site_manager_name: name,
                  site_name,
                  description,
                  country,
                  region,
                  city
                };
              }
              return null;
            } catch (err) {
              console.error(`Error processing KPI ${item._id}:`, err);
              return null;
            }
          }));
  
          return newObj.filter(Boolean);
        } catch (err) {
          console.error("Error fetching site manager KPI data:", err);
          throw err;
        }
      }
  
      try {
        const result = await getSiteManagerKPIData();
  
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
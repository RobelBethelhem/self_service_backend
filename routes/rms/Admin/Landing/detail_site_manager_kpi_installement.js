import { Router } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";
import { Site_Manager_KPI } from "../../../../models/rms/Site_manager_KPI.js";
import User from "../../../../models/rms/User.js";
import Site from "../../../../models/rms/Site.js";
import Place from "../../../../models/rms/Place.js";

const router = Router();

router.post('/get_site_manager_installements', auth, roleCheck(["admin"]), async (req, res, next) => {
    console.log("I am in the get_site_manager_installement");
  
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
        target_amount: '',
        achieved_amount: '',
        KPI_start_date: '',
        KPI_end_date: '',
        KPI_percentage: '',
        registered_By: '',
        createdAt: '',
        updatedAt: '',
        updated_By: '',
      };
  
      async function getSiteManagerKPIInstallementData() {
        try {
          const dataa = await Site_Manager_KPI.findById(req.body.id).lean();
          const installments = dataa.KPI_installments;
  
          const newObj = await Promise.all(installments.map(async (item) => {
            try {
              const { __v, _id, ...rest } = item;
              const hasScriptProperty = Object.values(rest).some(propValue => 
                typeof propValue === 'string' &&
                (propValue.includes('script') || propValue.includes('iframe') || propValue.includes('<') || propValue.includes('>') || propValue.includes('alert'))
              );
  
              if (!hasScriptProperty) {
                return {
                  ...template,
                  id: _id.toString(),
                  ...rest
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
        const result = await getSiteManagerKPIInstallementData();
  
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
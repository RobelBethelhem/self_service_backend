import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";


import Place from "../../../../models/rms/Place.js"
import Price_Per_Place from "../../../../models/rms/Price_per_place.js"
import User from "../../../../models/rms/User.js"

const router = Router();

router.get('/get_price_per_place_data', auth, roleCheck(["admin"]), async (req, res, next) => {
  console.log("I am in the landing get_price_per_place_data");

  try {
    const getUser = await req.user;
    const id = getUser._id;
    const specific_user = await User.findOne({ _id: id });
    const user = { ...specific_user._doc };
    delete user._id;
    delete user.__v;
    delete user.password;

    async function getPlacedata() {
      try {
        const Price_Per_Places = await Price_Per_Place.find().lean();
        const newObj = await Promise.all(Price_Per_Places.map(async (item) =>{
            try{

                if(item.place_id){
                    const place = await Place.findById(item.place_id).lean();
                    if(place){
                        const {country,region,city} = place;
                        const { _id, __v, password, ...rest } = item;
                        const hasScriptProperty = Object.values(rest).some(propValue => 
                            typeof propValue === 'string' && 
                            (propValue.includes('<script') || 
                             propValue.includes('iframe') || 
                             propValue.includes('<') || 
                             propValue.includes('>') || 
                             propValue.includes('alert'))
                          );

                          if(!hasScriptProperty) {
                            return{
                                ...rest,
                                id: _id.toString(),
                                country,
                                region,
                                city
                            }
                          }
                    }
                }
                return null;
            }
            catch (err) {
                console.error(`Error processing floors ${item._id}:`, err);
                return null;
              }
        }))
        return newObj.filter(Boolean);
      } 
      catch (err) {
        console.error("Error fetching floors:", err);
        throw err;
      }
    }

    // Usage
    try {
      const result = await getPlacedata();
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

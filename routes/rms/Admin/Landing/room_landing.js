import { Router, request } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";

import Site from "../../../../models/rms/Site.js";
import Place from "../../../../models/rms/Place.js"
import Building from "../../../../models/rms/Building.js"
import Floor from "../../../../models/rms/Floor.js";
import Room from "../../../../models/rms/Room.js";
import User from "../../../../models/rms/User.js"

const router = Router();

router.get('/get_room', auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {


  try {
    const getUser = await req.user;
    const id = getUser._id;
    const specific_user = await User.findOne({ _id: id });
    const user = { ...specific_user._doc };
    delete user._id;
    delete user.__v;
    delete user.password;

    const userRole = req.user.roles ;
    var rooms;

    async function getRoomWithFloorBuildingSiteAndPlaceData() {
      try {
        if(userRole[0].includes('admin')){
           rooms = await Room.find().lean();
       }
       else if(userRole[0].includes('site_manager')){
        rooms = await Room.find({site_id: user.site_id}).lean();
       }
       

       const newObj = await Promise.all(rooms.map(async (item) =>{
        try{
            if(item.floor_id) {
             
                const floors = await Floor.findById(item.floor_id).lean();
                if(floors) {
                
                    const {floor, floor_description, building_id} = floors;
                    const building = await Building.findById(building_id).lean();
                    if(building) {
                        const {building_name, total_floor,special_feature, site_id } = building;

                        let site = {};
                        let place = {};
                        if(site_id){
                          
                          site = await Site.findById(site_id).lean();
                          const {site_name, description, place_id} = site;
                          if(place_id){
                            place = await Place.findById(place_id).lean();
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
                              floor,
                              floor_description,
                              building_name,
                              total_floor,
                              special_feature,
                              site_name,
                              description,
                              country: place.country,
                              region: place.region,
                              city: place.city
                            };
                          }


                        }
                    }
                }
            }

            return null;
        }
        catch (err) {
            console.error(`Error processing rooms ${item._id}:`, err);
            return null;
          }
       }))
       return newObj.filter(Boolean);
      } catch (err) {
        console.error("Error fetching floors:", err);
        throw err;
      }
    }

    // Usage
    try {
      const result = await getRoomWithFloorBuildingSiteAndPlaceData();
     
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

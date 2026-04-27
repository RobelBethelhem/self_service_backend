import Joi from "joi";

const buildingBodyValidation = (body) =>{
    const schema = Joi.object({
        building_name: Joi.string().required().label("building_name"),
        total_floor: Joi.string().required().label("total_floor"),
        special_feature: Joi.string().required().label("special_feature"),
        site_id: Joi.string().label("site_id"),
        registered_By: Joi.string().required().label("registered_By"),
        Created_At: Joi.date().required().label("Created_At"),
        Updated_At: Joi.date().allow(null).label("Updated_At"),
        Updated_By: Joi.string().allow(null, '').label("Updated_By")
    })
    return schema.validate(body);
}

export {buildingBodyValidation};
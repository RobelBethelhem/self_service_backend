import Joi from "joi";

const floorBodyValidation = (body) =>{
    const schema = Joi.object({
        floor: Joi.string().required().label("floor"),
        floor_description: Joi.string().required().label("floor_description"),
        building_id: Joi.string().required().label("building_id"),
        site_id: Joi.string().label("site_id"),
        registered_By: Joi.string().required().label("registered_By"),
        Created_At: Joi.date().required().label("Created_At"),
        Updated_At: Joi.date().label("Updated_At"),
        Updated_By: Joi.string().label("Updated_By")
    })
    return schema.validate(body);
}

export {floorBodyValidation};
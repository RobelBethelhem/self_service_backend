import Joi from "joi";

const roomBodyValidation = (body) =>{
    const schema = Joi.object({
        Room_name: Joi.string().required().label("room_name"),
        sqrt: Joi.string().required().label("sqrt"),
        room_description: Joi.string().required().label("room_description"),
        site_id: Joi.string().label("site_id"),
        floor_id: Joi.string().required().label("floor_id"),
        registered_By: Joi.string().required().label("registered_By"),
        Created_At: Joi.date().required().label("Created_At"),
        Updated_At: Joi.date().label("Updated_At"),
        Updated_By: Joi.string().label("Updated_By"),
    })
    return schema.validate(body);
}

export {roomBodyValidation};
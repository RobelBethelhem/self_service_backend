import Joi from "joi";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const siteBodyValidation = (body) =>{
    const schema = Joi.object({
        site_name: Joi.string().required().label("site_name"),
        description: Joi.string().required().label("description"),
        place_id: Joi.string().required().label("place_id"),
        registered_By: Joi.string().required().label("registered_By"),
        Created_At: Joi.date().required().label("Created_At"),
        Updated_At: Joi.date().label("Updated_At"),
        Updated_By: Joi.string().label("Updated_By")
    })
    return schema.validate(body);
}

export {siteBodyValidation};
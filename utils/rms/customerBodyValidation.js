import Joi from "joi";

const customerBodyValidation = (body) =>{
    const schema = Joi.object({
        customer_name: Joi.string().required().label("name"),
        customer_email: Joi.string().email().required().label("email"),
        customer_phone_number: Joi.string().required().label("phone_number"),
        customer_address: Joi.string().required().label("address"),
        registered_By: Joi.string().required().label("registered_By"),
       // Created_At: Joi.date().required().label("Created_At"),
        Updated_At: Joi.date().allow(null).label("Updated_At"),
        Updated_By: Joi.string().allow(null, '').label("Updated_By")
    })
    return schema.validate(body);
}

export {customerBodyValidation};
import Joi from "joi";

const aggrementBodyValidation = (body) =>{
    const schema = Joi.object({
        room_id: Joi.string().required().label("floor_id"),
        customer_id: Joi.string().hex().length(24).required().label("customer_id"),
        site_id: Joi.string().label("site_id"),
        customer_name: Joi.string().required().label("customer_name"),
        future_payment: Joi.number().required().label("sqrt"),
        payment_type: Joi.array().items(
            Joi.string().valid("Onetime","Installament")
          ),
        customer_paid: Joi.string().required().label("customer_paid"),
        interest_over_due: Joi.number().required().label("interest_over_due"),
        Number_of_installment: Joi.number().required().label("Number_of_installment"),
        Created_At: Joi.date().required().label("Created_At"),
        Updated_At: Joi.date().allow(null).label("Updated_At"),
        Updated_By: Joi.string().allow(null, '').label("Updated_By"),
        roles: Joi.array().items(
            Joi.string().valid("site_manager","admin")
          ),
    })
    return schema.validate(body);
}

export {aggrementBodyValidation};
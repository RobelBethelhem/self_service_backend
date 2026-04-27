import Joi from "joi";

const price_per_room_BodyValidation = (body) => {
  const schema = Joi.object({
    selling_price: Joi.number().required().label("selling_price"),
    price_per_cube: Joi.number().required().label("price_per_cube"),
    
    room_id: Joi.string().required().label("room_id"),
    registered_By: Joi.string().required().label("registered_By"),
    //Created_At: Joi.date().required().label("Created_At"),
    Updated_At: Joi.date().label("Updated_At"),
    Updated_By: Joi.string().label("Updated_By"),
  });
  return schema.validate(body);
};

export { price_per_room_BodyValidation };
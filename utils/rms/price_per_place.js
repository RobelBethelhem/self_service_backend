import Joi from "joi";

const price_per_place_BodyValidation = (body) => {
  const schema = Joi.object({
    min_selling_price_per_cube_for_place: Joi.number().required().label("min_selling_price"),
    max_selling_price_per_cube_for_place: Joi.number().required().label("max_selling_price"),
    place_id: Joi.string().required().label("place_id"),
    registered_By: Joi.string().required().label("registered_By"),
    // Created_At: Joi.date().required().label("Created_At"),
    Updated_At: Joi.date().label("Updated_At"),
    Updated_By: Joi.string().label("Updated_By"),
  });
  return schema.validate(body);
};

export { price_per_place_BodyValidation };
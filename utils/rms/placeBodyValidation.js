import Joi from "joi";

const placeBodyValidation = (body) => {
  const schema = Joi.object({
    country: Joi.string().required().label("country"),
    region: Joi.string().required().label("region"),
    city: Joi.string().required().label("city"),
    registered_By: Joi.string().required().label("registered_By"),
    Created_At: Joi.date().required().label("Created_At"),
    Updated_At: Joi.date().label("Updated_At"),
    Updated_By: Joi.string().label("Updated_By"),
  });
  return schema.validate(body);
};

export { placeBodyValidation };
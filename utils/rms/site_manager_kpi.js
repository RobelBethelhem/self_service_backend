import Joi from "joi";

const site_manager_kpi_BodyValidation = (body) => {
  const schema = Joi.object({
    over_all_target_amount: Joi.number().label("over_all_target_amount"),
    over_all_achieved_amount: Joi.number().label("over_all_achieved_amount"),
    over_all_KPI_percentage: Joi.number().label("over_all_KPI_percentage"),
    site_manager_id: Joi.string().required().label("site_manager_id"),
    registered_By: Joi.string().required().label("registered_By"),
   // Created_At: Joi.date().required().label("Created_At"),
    Updated_At: Joi.date().label("Updated_At"),
    Updated_By: Joi.string().label("Updated_By"),
  });
  return schema.validate(body);
};

export { site_manager_kpi_BodyValidation };
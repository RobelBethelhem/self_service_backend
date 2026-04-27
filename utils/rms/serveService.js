import Joi from "joi";

const experiance_letter_BodyValidation = (body) => {
  const schema = Joi.object({
    employee_first_name: Joi.string().required().label("employee_first_name"),
    employee_middle_name: Joi.string().required().label("employee_middle_name"),
    employee_last_name: Joi.string().required().label("employee_last_name"),
    employee_description:Joi.string().label("employee_description"),
    status: Joi.array().items(
      Joi.string().valid("Pending", "Viewed")
    ),
  });
  return schema.validate(body);
};

const letter_of_embassy_BodyValidation = (body) => {
  const schema = Joi.object({
    employee_first_name: Joi.string().required().label("employee_first_name"),
    employee_middle_name: Joi.string().required().label("employee_middle_name"),
    employee_last_name: Joi.string().required().label("employee_last_name"),
    employee_embassy_name: Joi.string().required().label("employee_embassy_name"),
    employee_description:Joi.string().label("employee_description"),
    status: Joi.array().items(
      Joi.string().valid("Pending", "Viewed")
    ),
  });
  return schema.validate(body);
};

const guaranty_letter_BodyValidation = (body) => {
  const schema = Joi.object({
    employee_first_name: Joi.string().required().label("employee_first_name"),
    employee_middle_name: Joi.string().required().label("employee_middle_name"),
    employee_last_name: Joi.string().required().label("employee_last_name"),
    employee_description:Joi.string().label("employee_description"),

    guaranty_first_name: Joi.string().required().label("guaranty_first_name"),
    guaranty_middle_name: Joi.string().required().label("guaranty_middle_name"),
    guaranty_last_name: Joi.string().required().label("guaranty_last_name"),
    guaranty_organazation: Joi.string().required().label("guaranty_organazation"),
    status: Joi.array().items(
      Joi.string().valid("Pending", "Viewed")
    ),
  });
  return schema.validate(body);
};

const supportive_letter_BodyValidation = (body) => {
  const schema = Joi.object({
    medical_place: Joi.string().required().label("medical_place"),

    spouse_first_name: Joi.string().label("spouse_first_name"),
    spouse_middle_name: Joi.string().label("spouse_middle_name"),
    spouse_last_name: Joi.string().label("spouse_last_name"),
    employee_id_no: Joi.string().required().label("employee_id_no"),

    child_first_name: Joi.string().label("child_first_name"),
    chid_middle_name: Joi.string().label("chid_middle_name"),
    child_last_name: Joi.string().label("child_last_name"),
    place_of_assignment: Joi.string().required().label("place_of_assignment"),

    employee_description:Joi.string().label("employee_description"),
    
    language: Joi.string().valid("amharic", "english").label("language"),
    status: Joi.array().items(
      Joi.string().valid("Pending", "Viewed")
    ),
  });
  return schema.validate(body);
};

const medical_BodyValidation = (body) => {
  const schema = Joi.object({
    is_Spouse: Joi.boolean().required().label("is_Spouse"),
    medical_place: Joi.string().required().label("medical_place"),
    spouse_first_name: Joi.string().allow('', null).label("spouse_first_name"),
    spouse_middle_name: Joi.string().allow('', null).label("spouse_middle_name"),
    spouse_last_name: Joi.string().allow('', null).label("spouse_last_name"),
    child_first_name: Joi.string().allow('', null).label("child_first_name"),
    chid_middle_name: Joi.string().allow('', null).label("chid_middle_name"),
    child_last_name: Joi.string().allow('', null).label("child_last_name"),
    employee_description: Joi.string().allow('', null).label("employee_description"),
    // place_of_assignment is auto-fetched from HRIS, not required in request body
    place_of_assignment: Joi.string().label("place_of_assignment"),
    name_of_supervisor: Joi.string().label("name_of_supervisor"),
    status: Joi.array().items(
      Joi.string().valid("Pending", "Viewed", "Rejected")
    ),
  });
  return schema.validate(body);
};


const medicalProvider_BodyValidation = (body) => {
  const schema = Joi.object({
    short_code: Joi.string().required().label("short_code"),
    medical_institution: Joi.string().required().label("medical_institution"),
    location: Joi.string().required().label("location"),
    telephone_no: Joi.string().required().label("telephone_no")
  });
  return schema.validate(body);
};


export { 
  experiance_letter_BodyValidation,
  letter_of_embassy_BodyValidation,
  guaranty_letter_BodyValidation,
  supportive_letter_BodyValidation,
  medical_BodyValidation,
  medicalProvider_BodyValidation
};








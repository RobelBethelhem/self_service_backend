import Joi from "joi";
import passwordComplexity from "joi-password-complexity";


const signUpBodyValidation = (body) =>{
    const schema = Joi.object({
        name: Joi.string().required().label("name"),
        email: Joi.string().email().required().label("email"),
        password: passwordComplexity().required().label("password"),
        site_id: Joi.string().label("Site Id"),
        roles: Joi.array().items(
            Joi.string().valid("site_manager","admin")
          ),
    });
    return schema.validate(body); 
};

const loginBodyValidation = (body) =>{
    const schema = Joi.object({
        email: Joi.string().email().required().label("email"),
        password: Joi.string().required().label("password"),
    });
    return schema.validate(body);
}

const refreshTokenBodyValidation = (body) =>{
    const schema = Joi.object({
        refreshToken: Joi.string().required().label("Refresh Token")
    });
    return schema.validate(body);
}






export {signUpBodyValidation, loginBodyValidation, refreshTokenBodyValidation};
//export {signUpBodyValidation, loginBodyValidation, refreshTokenBodyValidation, newfxrequestValidation};
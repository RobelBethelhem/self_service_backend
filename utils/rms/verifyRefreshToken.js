import UserToken from "../../models/rms/UserToken.js";
import jwt from "jsonwebtoken";

const verifyRefreshToken = (refreshToken) =>{

    console.log("RefreshToken: ", refreshToken);
    const privateKey = process.env.REFRESH_TOKEN_PRIVATE_KEY;

    return new Promise((resolve, reject)=>{
        UserToken.findOne({token: refreshToken})
        .then((userToken) =>{
            if(!userToken)
                return reject({error: true, message: "Invalid refresh tokennnnn"});

            jwt.verify(refreshToken, privateKey, (err, tokenDetails) =>{
                if(err){
                    return reject({error: true, message: "Invalid refresh token"});
                }
                else{
                    resolve({
                        tokenDetails,
                        error: false,
                        message: "Valid refresh token",
                    })
                }
            })
        })
        .catch((err) =>{
            reject({error: true, message: "Invalid finding Refresh token"});
        })
    })
}

export default verifyRefreshToken;

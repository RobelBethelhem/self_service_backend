import {Router} from "express";
import UserToken from "../../models/rms/UserToken.js";
import jwt from "jsonwebtoken"
import { refreshTokenBodyValidation } from "../../utils/rms/validationSchema.js";
import verifyRefreshToken from "../../utils/rms/verifyRefreshToken.js";
import mongoose from "mongoose";

const router = Router();

//get new access token
router.post("/", async(req,res)=>{
    const refreshToken = req.header("x-refresh-token");
    const obj = {
        refreshToken: refreshToken
    }
    const {error} = refreshTokenBodyValidation(obj);
    if (error)
        return res.status(400).json({error: true, message: error.details[0].message});

    verifyRefreshToken(refreshToken)
    .then((tokenDetail)=>{
        const payload = {_id:tokenDetail._id, roles: tokenDetail.roles};
        const accessToken = jwt.sign(
            payload,
            process.env.ACCESS_TOKEN_PRIVATE_KEY,
            {expiresIn: "15m"}
        );
        res.status(200).json({error: false, accessToken, message: "Access token created successfully"})
    })
    .catch((err)=>{
        console.log(err);
        res.status(400).json(err)
    } );
})

// logout
router.delete("/", async(req,res)=>{
    try{
        const refreshToken = req.header("x-refresh-token");
        const obj = {
            refreshToken: refreshToken
        }
        const {error} = refreshTokenBodyValidation(obj);
        if (error)
            return res.status(400).json({error: true, message: error.details[0].message});
        const userToken = await UserToken.findOne({token: refreshToken});

        console.log("userToken", userToken)
        if (!userToken)
            return res.status(200).json({error: false, message: "Already Logged Out"});
        await userToken.deleteOne(({userId: userToken.userId}));
        return res.status(200).json({error: false, message: "Log Out Successfully"});

    }
    catch (err){
        console.error("error: ", err);
        res.status(500).json({error: true, message:"Internal Server Error"});
    }
})

export default router;
import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";

const router = Router();

router.get("/home", auth, roleCheck(["admin"]),(req,res)=>{
    res.status(200).json({message: "User Authenticated"});
});

export default router;
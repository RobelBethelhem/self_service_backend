import {Router} from "express";
import User from "../../models/rms/User.js";
import bcrypt from "bcrypt";
import {signUpBodyValidation , loginBodyValidation} from "../../utils/rms/validationSchema.js"
import generateTokens from "../../utils/rms/generateTokens.js";
import UsedToken from "../../models/rms/UsedToken.js";
import jwt from "jsonwebtoken";
import mongoose from 'mongoose';
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import { authentication } from "../../utils/rms/ldapConnect.js";
import { getEmployeeIdentity } from "../../utils/rms/test.js";

const router = Router();

//verify token
router.post("/verify-token", async(req,res)=>{
    try{
        const token = req.header("x-access-token");
        const accessToken = process.env.ACCESS_TOKEN_PRIVATE_KEY
        if(!token){
            res.status(401).json({error:true, message:"Error finding access token"})
        }
        const isUsedToken = await UsedToken.find({token:token});
        if(isUsedToken.length > 0)
            res.status(401).json({error:true, message:"Used Token"})

        jwt.verify(token,accessToken);

        res.status(200).json({error: false, message: "Correct"})
    }
    catch (err){
        console.error("Error: ", err);
        res.status(500).json({error:true, message: "Internal Server Error"});
    }
})

// GET /me — canonical profile of the authenticated user.
//
// Returns the Mongo User row enriched with HRIS canonical name parts
// (Name / FName / GFName) so mobile + web greeting cards can render the
// real employee's name rather than a domain-username split. HRIS is
// best-effort — if SQL Server is unreachable we fall back to the Mongo
// row alone so /me never 500s on transient HRIS outages.
//
// IMPORTANT: this route must come BEFORE the catch-all `/:id` further
// down the file, otherwise Express will treat "me" as a user id.
router.get("/me", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ error: true, message: "User not found" });
        }
        const hr = await getEmployeeIdentity(user.user).catch(() => null);
        const profile = {
            first_name: (hr && hr.Name) || user.first_name || "",
            middle_name: (hr && hr.FName) || "",
            last_name: (hr && hr.GFName) || user.last_name || "",
            user: user.user,
            email: user.email,
            // Prefer the latest internal HRIS position (which moves with
            // promotions / transfers). Fall back to the Mongo user.position
            // only if HRIS has no experience row yet — that field is static,
            // set at signup, and goes stale.
            position: (hr && hr.CurrentPosition) || user.position || "",
            department: user.department || "",
            employee_id: (hr && hr.EmployeeId)
                ? String(hr.EmployeeId)
                : (user.employee_id || ""),
            roles: user.roles || [],
            source: hr ? "hris" : "user_collection",
        };
        return res.json({ error: false, user: profile });
    } catch (e) {
        console.error("GET /me error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

//signup
router.post("/signUp", auth, roleCheck(["admin"]), async(req,res)=>{
    try{  
        delete req.body.id;
        req.body.password = "@Test1234";
        req.body.roles = [req.body.roles]

        console.log("hhhhhhhhhhh", req.body);
        const {error} = signUpBodyValidation(req.body);
        if(error)
            return res.status(400).json({error:true, message:error.details[0].message});

        const user = await User.findOne({email: req.body.email});
        if(user)
            return res.status(400).json({error:true, message:"User with given email already exist"});
          
        const salt = await bcrypt.genSalt(Number(process.env.SALT));
        const hashPassword = await bcrypt.hash(req.body.password, salt);

        await new User({ ...req.body, password: hashPassword}).save();
        
        res.status(201).json({error: false, message:"Account created Sucessfully"});
    }
    catch (e) {
        console.log(e)
        res.status(500).json({ error: true, message: "Internal Server Error" });
      }
});

//login
router.post("/login", async(req,res)=>{
    try{
        // console.log("RRRRReq.body", req.body)
        // const {error} = loginBodyValidation(req.body);
        // console.log("Error: ", error);
        // if(error)
        //     return res.status(400).json({error: true, message: error.details[0].message})

          var {email, password } = req.body;



          var userEmail;
        if (email.toLowerCase().includes('@zemenbank.com')) {
          email = email.replace('@zemenbank.com', '');
          userEmail = 'Zemenbank\\' + email.toLowerCase();
        }
        else{
          userEmail = 'Zemenbank\\' + email.toLowerCase();
        
        }

        const query = {
            $or: [
              { email: { $regex: new RegExp(email, 'i') } },
              { name: { $regex: new RegExp(email, 'i') } }
            ]
          };


           const user = await User.findOne(query);
          if(user){
            (async () => {
                try {
                     const users = await authentication(userEmail, password);
                     
                         const {accessToken, refreshToken} = await generateTokens(user);
                        res.status(200).json({error: false, accessToken, refreshToken, message: "Logged in Successfully"});
                    } catch(error){
                    console.log("Error:", error);
                    res.status(500).json({error:true, message: "Invalid email or Password"});
                }                   //generate access and refresh token
                    
              })();    
          }
          else{
            res.status(400).json({message: "Invalid email or Password"});
          }


       

        // const verifiedPassword = await bcrypt.compare(
        //     password, user.password
        // )
        // if(!verifiedPassword)
        //     return res.status(401).json({error: true, message: "Invalid Password"})

       

    }
     catch (err){
        console.log(err);
        res.status(500).json({error:true, message: `${err}`});
    }
   
})

//get users
router.get("/getUsers", auth, roleCheck(["admin"]), async(req,res)=>{
    try{
        const sendUsers = {};
        const meta = {};
        const users = await User.find();
        
        sendUsers.data = users.map((user) => ({
          id: user._id.toString(),
          first_name: user.first_name,
          last_name: user.last_name,
          employee_id: user.employee_id,
          user: user.user,
          email: user.email,
          position: user.position,
          department: user.department,
          roles: user.roles,
        }));
        
        meta.totalRowCount = users.length;
        sendUsers.meta = meta;
        
        res.json(sendUsers);
       
    }
    catch (err){
        console.error(err);
        res.status(500).json({error:true, message: "Internal Server Error"});
    }
});

// edit user
router.patch("/editUser", auth, roleCheck(["admin"]), async(req,res)=>{
    try{
        const {id, name, email, roles} = req.body;
      
        const updatedData = {
            name: name,
            email: email,
            roles: roles
        }
        const updatedUser = await User.findByIdAndUpdate(id,updatedData,{
            new: true
        })

        res.status(200).json({error: false, message: "User Edited Successfully", data:updatedUser });
    }
    catch (error){
        console.error("Error: ", error);
        res.status(500).json({error: true, message: "Internal Server Error"});
    }
})

//delete user
router.delete("/deleteUser", auth, roleCheck(["admin"]), async(req,res)=>{
    try{
        const userId = req.body.id;
        const deletedUser = await User.findByIdAndDelete(userId)
        res.json({message: "User Deleted Successfuly", user: deletedUser})
    }
    catch (error){
        console.error("Error: ", error);
        res.status(500)
    }
})

//get user by id
router.get("/:id", async(req,res)=>{
    try{
        const userId = req.params.id;
        const user = await User.findById(userId);
        res.json(user)
    }
    catch (err){
        console.error(err);
        res.status(500).json({error: true, message: "Internal Server Error"});
    }
})

//second login endpoint
router.post("/login", async(req,res)=>{
    try{
        const {error} = loginBodyValidation(req.body);
        console.log("error",error)
        if(error)
            return res.status(400).json({error:true, message:error.details[0].message});
        
        const user = await User.findOne({email: req.body.email});
        if(!user)
            return res.status(401).json({error:true, message: "Invalid email"});

        const verifiedPassword = await bcrypt.compare(
            req.body.password,
            user.password
        );

        if(!verifiedPassword)
            return res.status(401).json({error:true, message: "Inavlid password"});
          
        const {accessToken, refreshToken} = await generateTokens(user);

        res.status(200).json({  error: false, accessToken, refreshToken, message: "Logged in Successfully" });
    }
    catch (err){
        console.log(err);
        res.status(500).json({error:true, message: "Internal Server Error"});
    }
});

export default router;

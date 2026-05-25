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
import { getEmployeeIdentity, getEmployeeEducation, getEmployeeCertifications, getEmployeeAddress, getEmployeeTrainings, _sanitizeHris, test as hrisExperiences } from "../../utils/rms/test.js";

const router = Router();

/**
 * Server-side age computation from a DateOfBirth value. Centralized here
 * so every API consumer sees the same number on the same calendar day,
 * regardless of client clock skew or timezone. Returns null if the input
 * isn't a parseable date.
 */
function computeAge(dob) {
    if (!dob) return null;
    const d = new Date(dob);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - d.getFullYear();
    const m = today.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
    return age;
}

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
        // Two HRIS reads in parallel — identity + address. Address never
        // blocks the response (best-effort, see catch handler on the
        // helper) but it sits in /me so the Personal tab gets it without
        // a second round-trip.
        const [hr, addr] = await Promise.all([
            getEmployeeIdentity(user.user).catch(() => null),
            getEmployeeAddress(user.user, user.employee_id).catch(() => null),
        ]);
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
            department: (hr && hr.CurrentDepartment) || user.department || "",
            employee_id: (hr && hr.EmployeeId)
                ? String(hr.EmployeeId)
                : (user.employee_id || ""),
            roles: user.roles || [],
            // HRIS-sourced fields used by the profile screen.
            joined_date: hr && hr.EmploymentDate
                ? new Date(hr.EmploymentDate).toISOString()
                : null,
            net_salary: hr && hr.Salary != null ? Number(hr.Salary) : null,
            currency: "ETB",
            job_grade: (hr && hr.CurrentJobGrade) || "",
            // Personal block — every field is best-effort. NOT NULL
            // columns (Sex, MaritalStatus, DateOfBirth) only come back
            // when HRIS is reachable; if the lookup failed they're "".
            date_of_birth: hr && hr.DateOfBirth
                ? new Date(hr.DateOfBirth).toISOString()
                : null,
            age: computeAge(hr && hr.DateOfBirth),
            sex: (hr && hr.Sex) || "",
            marital_status: (hr && hr.MaritalStatus) || "",
            // Spouse row only renders when both flags are set — saves the
            // mobile a conditional and matches what the user expects to
            // see (married + has a recorded spouse name).
            spouse_name: hr && hr.MaritalStatus &&
                String(hr.MaritalStatus).toLowerCase() === "married"
                ? (hr.SpouseName || "")
                : "",
            tin_number: (hr && hr.TINNumber) || "",
            pension_number: (hr && hr.PensionNumber) || "",
            employment_type: (hr && hr.EmploymentType) || "",
            // Address — every field passed through _sanitizeHris so a
            // stored `***` placeholder collapses to "". Mobile renders
            // only non-empty fields.
            address: addr
                ? {
                      region: _sanitizeHris(addr.Region),
                      city: _sanitizeHris(addr.City),
                      zone: _sanitizeHris(addr.Zone),
                      woreda: _sanitizeHris(addr.Woreda),
                      kebele: _sanitizeHris(addr.Kebele),
                      subcity: _sanitizeHris(addr.SubCity),
                      house_number: _sanitizeHris(addr.HouseNumber),
                      po_box: _sanitizeHris(addr.POBox),
                      telephone: _sanitizeHris(addr.Telephone),
                  }
                : null,
            source: hr ? "hris" : "user_collection",
        };
        return res.json({ error: false, user: profile });
    } catch (e) {
        console.error("GET /me error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// GET /me/experiences — HRIS internal experience history for the caller.
//
// Powers the profile screen's Experience tab. Returns the same data the
// Experience letter consumes (test()), normalized to a clean shape and
// sorted active-first then by From DESC. Empty array when HRIS is
// unreachable or the employee has no experience rows.
//
// IMPORTANT: must be declared BEFORE the catch-all `/:id` route below;
// otherwise Express would treat "me" as a user id and 500 on CastError.
router.get("/me/experiences", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ error: true, message: "User not found" });
        }
        const rows = await hrisExperiences(user.user).catch(() => null);
        if (!rows || !Array.isArray(rows)) {
            return res.json({ error: false, experiences: [] });
        }
        const experiences = rows.map((r) => ({
            position: r.Postion || "",
            job_grade: r.Job_Grade || "",
            from: r.From ? new Date(r.From).toISOString() : null,
            to: r.To ? new Date(r.To).toISOString() : null,
        }));
        // Active (no To) rows first, then most recent start date.
        experiences.sort((a, b) => {
            if ((a.to == null) !== (b.to == null)) {
                return a.to == null ? -1 : 1;
            }
            const ad = a.from ? new Date(a.from).getTime() : 0;
            const bd = b.from ? new Date(b.from).getTime() : 0;
            return bd - ad;
        });
        return res.json({ error: false, experiences });
    } catch (e) {
        console.error("GET /me/experiences error:", e);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// GET /me/education — HRIS academic + certification rows for the caller.
//
// Powers the profile screen's Education tab. Returns two parallel arrays:
//   - education     → EmployeeEducation joined with luEducationLevel /
//                     luStudyField / luInstitution (sorted GraduationYear DESC)
//   - certifications → EmployeeCertification joined with luStudyField /
//                     luInstitution (sorted ToDate DESC)
//
// Both arrays are independent — an employee with no degrees but a stack
// of certifications still gets their certs rendered. Empty arrays when
// HRIS is unreachable or no rows.
//
// IMPORTANT: must be declared BEFORE the catch-all `/:id` route below;
// otherwise Express treats "me" as a user id and 500s on CastError.
router.get("/me/education", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ error: true, message: "User not found" });
        }
        console.log(
            `[GET /me/education] caller username='${user.user}' employeeId='${user.employee_id || '(none)'}' _id=${user._id}`
        );
        // Three HRIS reads in parallel — education + certifications +
        // trainings. All share the same UserId-resolution path inside
        // the helpers, so a successful identity resolve cascades to all
        // three. Each helper is independently best-effort.
        const [eduRows, certRows, trainingRows] = await Promise.all([
            getEmployeeEducation(user.user, user.employee_id).catch(() => []),
            getEmployeeCertifications(user.user, user.employee_id).catch(() => []),
            getEmployeeTrainings(user.user, user.employee_id).catch(() => []),
        ]);
        const education = (eduRows || []).map((r) => ({
            level: r.EducationLevel || "",
            field: r.FieldOfStudy || "",
            institution: r.Institution || "",
            cgpa: r.CGPA != null ? Number(r.CGPA) : null,
            graduation_year: r.GraduationYear != null ? Number(r.GraduationYear) : null,
            sponsorship: r.Sponsorship || "",
            commitment_level: r.CommitmentLevel || "",
            remark: r.Remark || "",
        }));
        const certifications = (certRows || []).map((r) => ({
            status: _sanitizeHris(r.Status),
            field: _sanitizeHris(r.Field),
            institution: _sanitizeHris(r.Institution),
            to_date: r.ToDate ? new Date(r.ToDate).toISOString() : null,
            date_interval: _sanitizeHris(r.DateInterval),
        }));
        const trainings = (trainingRows || []).map((r) => ({
            name: _sanitizeHris(r.TrainingName),
            type: _sanitizeHris(r.TrainingType),
            organizer: _sanitizeHris(r.Organizer),
            from: r.StartDate ? new Date(r.StartDate).toISOString() : null,
            to: r.EndDate ? new Date(r.EndDate).toISOString() : null,
            // `Other` often carries a fallback duration string ("for 3
            // months") when From/To weren't filled. Mobile renders it as
            // the duration line when both dates are null.
            other: _sanitizeHris(r.Other),
        }));
        console.log(
            `[GET /me/education] response: education=${education.length} certifications=${certifications.length} trainings=${trainings.length}`
        );
        return res.json({ error: false, education, certifications, trainings });
    } catch (e) {
        console.error("GET /me/education error:", e);
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

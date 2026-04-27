import {Router} from "express";
import User from "../../models/rms/User.js";
import Candidate from "../../models/rms/Candidate.js"
import mongoose from 'mongoose';
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import { validationResult } from "express-validator";
import XLSX from "xlsx"
import multer from "multer";



const router = Router();
const upload = multer({ dest: 'uploads/' });
// Validation middleware
const validateExcelUpload = (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    next();
  };

  router.post('/candidate_excel_upload', auth, roleCheck(["admin"]), upload.single('file'), validateExcelUpload, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).lean();
        if (!user) {
            return res.status(400).json({ error: true, message: "Requester not found" });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Validate Excel format
        const requiredHeaders = ['employee_id', 'first_name', 'last_name', 'department', 'position'];
        const headers = Object.keys(jsonData[0]);
        const isValidFormat = requiredHeaders.every(header => headers.includes(header));

        if (!isValidFormat) {
            return res.status(400).json({ message: 'Invalid Excel format' });
        }

        // Add registered_By field to each candidate
        const candidatesWithRegisteredBy = jsonData.map(candidate => ({
            ...candidate,
            registered_By: user.first_name + user.last_name, // Assuming the user object has a 'name' field
            Created_At: new Date()
        }));

        // Process and save data to MongoDB
        const savedCandidates = await Candidate.insertMany(candidatesWithRegisteredBy);

        res.status(200).json({
            message: 'Excel file imported successfully',
            savedCandidates: savedCandidates.length,
        });
    } catch (e) {
        console.log("Error", e);
        res.status(500).json({ message: 'Error processing Excel file', error: e.message });
    }
});



router.post('/employee_excel_upload', auth, roleCheck(["admin"]), upload.single('file'), validateExcelUpload, async (req,res) =>{
    try {
        const user = await User.findById(req.user._id).lean();
        if (!user) {
            return res.status(400).json({ error: true, message: "Requester not found" });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

       
        const requiredHeaders = [ 'first_name',  'last_name', 'employee_id', 'user', 'email', 'position', 'department', 'roles'];
        const headers = Object.keys(jsonData[0]);
        const isValidFormat = requiredHeaders.every(header => headers.includes(header));

        if (!isValidFormat) {
            return res.status(400).json({ message: 'Invalid Excel format' });
        }

   
        const employeesWithRegisteredBy = jsonData.map(employee => ({
            ...employee,
            registered_By: user.first_name + user.last_name,
            Created_At: new Date()
        }));


     
        const savedEmployees = await User.insertMany(employeesWithRegisteredBy);

        res.status(200).json({
            message: 'Excel file imported successfully',
            savedEmployees: savedEmployees.length,
        });
    } catch (e) {
        console.log("Error", e);
        res.status(500).json({ message: 'Error processing Excel file', error: e.message });
    }
})


// Add new employee
router.post('/employee', auth, roleCheck(["admin"]), async (req, res) => {
    try {

        console.log("jjjjjjjjjjjjjjjjjjjjj", req.body);
        const user = await User.findById(req.user._id).lean();
        if (!user) {
            return res.status(400).json({ error: true, message: "Requester not found" });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { first_name, last_name, employee_id, username, email, position, department, roles } = req.body;

        // Check if employee already exists
        const existingEmployee = await User.findOne({ email });
        if (existingEmployee) {
            return res.status(400).json({ message: 'Employee with this email already exists' });
        }

        const newEmployee = new User({
            first_name,
            last_name,
            employee_id,
            user: username,
            email,
            position,
            department,
            roles,
            registered_By: user.first_name + user.last_name,
            Created_At: new Date()
        });

        const savedEmployee = await newEmployee.save();

        res.status(201).json({
            message: 'Employee added successfully',
            employee: savedEmployee
        });
    } catch (e) {
        console.log("Error", e);
        res.status(500).json({ message: 'Error adding employee', error: e.message });
    }
});

// Edit employee
// router.put('/employee/:id', auth, roleCheck(["admin"]), async (req, res) => {
//     try {
//         const user = await User.findById(req.user._id).lean();
//         if (!user) {
//             return res.status(400).json({ error: true, message: "Requester not found" });
//         }

//         const errors = validationResult(req);
//         if (!errors.isEmpty()) {
//             return res.status(400).json({ errors: errors.array() });
//         }

//         const { first_name, last_name, employee_id, username, email, position, department, roles } = req.body;

//         // Check if employee exists
//         const employee = await User.findById(req.params.id);
//         if (!employee) {
//             return res.status(404).json({ message: 'Employee not found' });
//         }

//         // Update employee fields
//         employee.first_name = first_name || employee.first_name;
//         employee.last_name = last_name || employee.last_name;
//         employee.employee_id = employee_id || employee.employee_id;
//         employee.user = username || employee.user;
//         employee.email = email || employee.email;
//         employee.position = position || employee.position;
//         employee.department = department || employee.department;
//         employee.roles = roles || employee.roles;
//         employee.updated_By = user.first_name + user.last_name;
//         employee.Updated_At = new Date();

//         const updatedEmployee = await employee.save();

//         res.status(200).json({
//             message: 'Employee updated successfully',
//             employee: updatedEmployee
//         });
//     } catch (e) {
//         console.log("Error", e);
//         res.status(500).json({ message: 'Error updating employee', error: e.message });
//     }
// });




router.put('/employee/:id', auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const user = await User.findById(req.user._id).lean();
        if (!user) {
            return res.status(400).json({ error: true, message: "Requester not found" });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { first_name, last_name, employee_id, username, email, position, department, roles } = req.body;

        const employee = await User.findById(req.params.id);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        // Normalize roles: flatten nested arrays and ensure it's a flat string[]
        let normalizedRoles = employee.roles;
        if (roles !== undefined && roles !== null) {
            normalizedRoles = [roles].flat(Infinity).filter(r => ["user", "admin"].includes(r));
            if (normalizedRoles.length === 0) {
                return res.status(400).json({ message: 'Invalid roles provided. Allowed: "user", "admin"' });
            }
        }

        employee.first_name = first_name || employee.first_name;
        employee.last_name  = last_name  || employee.last_name;
        employee.employee_id = employee_id || employee.employee_id;
        employee.user       = username   || employee.user;
        employee.email      = email      || employee.email;
        employee.position   = position   || employee.position;
        employee.department = department || employee.department;
        employee.roles      = normalizedRoles;
        employee.updated_By = user.first_name + ' ' + user.last_name;
        employee.Updated_At = new Date();

        const updatedEmployee = await employee.save();

        res.status(200).json({
            message: 'Employee updated successfully',
            employee: updatedEmployee
        });
    } catch (e) {
        console.error("Error", e);
        res.status(500).json({ message: 'Error updating employee', error: e.message });
    }
});


router.delete('/employee/:id', auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const user = await User.findById(req.user._id).lean();
        if (!user) {
            return res.status(400).json({ error: true, message: "Requester not found" });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        // Check if employee exists
        const employee = await User.findById(req.params.id);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        // Delete the employee
        await User.findByIdAndDelete(req.params.id);

        res.status(200).json({
            message: 'Employee deleted successfully'
        });
    } catch (e) {
        console.log("Error", e);
        res.status(500).json({ message: 'Error deleting employee', error: e.message });
    }
});

router.post('/game_score', auth,roleCheck(["admin", "user"]), async(req,res)=>{
    console.log("game_scoregame_scoregame_scoregame_scoregame_score", req.body);
} )


 export default router;


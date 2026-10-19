import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import { getReportPool } from "../../utils/rms/hrisReportPool.js";
import {
    normalizeLogin,
    loadEmployeeProfile,
    loadEmployeePhoto,
} from "../../utils/rms/employeeProfile.js";

// My Profile — the signed-in employee's own HR record, read live from HRIS.
//
// Whose record is decided ONLY by the token: req.user._id -> User.user (the AD
// login) -> UserProfile.UserName. Nothing in the request can point it at
// someone else, so an admin sees their own profile here exactly like everyone
// else.
//
// Uses the reporting module's dedicated pool, not the global sql.connect()
// pool that utils/rms/test.js opens and closes per call, so a profile load can
// never be cut off by a letter flow (or cut one off).
//
// Independent module: removing this file, utils/rms/employeeProfile.js and
// the mount in server.js restores the previous behaviour 1:1.

const router = Router();

const loginOf = async (req) => {
    const user = await User.findById(req.user._id).select("user").lean();
    return user ? normalizeLogin(user.user) : "";
};

router.get("/me", auth, roleCheck(["user", "admin"]), async (req, res) => {
    // Salary, TIN and pension numbers: never let a proxy or the browser keep it.
    res.set("Cache-Control", "no-store");
    try {
        const login = await loginOf(req);
        if (!login) {
            return res.status(404).json({ error: true, message: "Your portal account has no domain user." });
        }

        let pool;
        try {
            pool = await getReportPool();
        } catch (e) {
            console.error("[profile] HRIS unreachable:", e.message);
            return res
                .status(503)
                .json({ error: true, message: "HRIS cannot be reached right now. Please try again shortly." });
        }

        const profile = await loadEmployeeProfile(pool, login);
        if (!profile) {
            return res.status(404).json({
                error: true,
                message: "We could not find your record in HRIS. Please contact the HR team.",
            });
        }
        return res.json({ error: false, data: profile });
    } catch (error) {
        console.error("[profile] GET /me error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// Served separately so the profile JSON stays small — photos in HRIS average
// ~125 KB but some are several MB.
router.get("/me/photo", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const login = await loginOf(req);
        if (!login) return res.status(404).end();

        const pool = await getReportPool();
        const photo = await loadEmployeePhoto(pool, login);
        if (!photo) return res.status(404).end();

        res.set("Content-Type", photo.mime);
        res.set("Cache-Control", "private, max-age=600");
        return res.send(photo.buffer);
    } catch (error) {
        console.error("[profile] GET /me/photo error:", error.message);
        return res.status(404).end();
    }
});

export default router;

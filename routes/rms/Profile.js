import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import ProfileEvent, { PROFILE_EVENTS, PROFILE_SECTIONS } from "../../models/rms/ProfileEvent.js";
import { getReportPool } from "../../utils/rms/hrisReportPool.js";
import {
    normalizeLogin,
    loadEmployeeProfile,
    loadEmployeePhoto,
} from "../../utils/rms/employeeProfile.js";

// My Profile — the signed-in employee's own HR record, read live from HRIS,
// plus the usage log behind the admin analytics screen.
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
// Independent module: removing this file, utils/rms/employeeProfile.js,
// models/rms/ProfileEvent.js and the mount in server.js restores the previous
// behaviour 1:1.

const router = Router();

const whoAmI = async (req) => {
    const user = await User.findById(req.user._id).select("user").lean();
    const login = user ? normalizeLogin(user.user) : "";
    return login ? { login, key: login.toLowerCase(), userId: user._id } : null;
};

// ---------------------------------------------------------------------------
// Usage log
// ---------------------------------------------------------------------------

// A reload, a double click or flicking between tabs should not count twice.
const DEDUPE_MS = {
    open: 60000,
    section: 30000,
    reveal: 30000,
    promo_shown: 60000,
    promo_click: 60000,
    promo_dismiss: 60000,
};

const recordEvent = async (me, event, section = null) => {
    const recent = await ProfileEvent.exists({
        domain_user: me.key,
        event,
        section,
        at: { $gte: new Date(Date.now() - DEDUPE_MS[event]) },
    });
    if (recent) return false;
    await ProfileEvent.create({ domain_user: me.key, user_id: me.userId, event, section, at: new Date() });
    return true;
};

// "open" is only ever written by GET /me itself, so it means the record really
// loaded, not that some client claimed it did.
const CLIENT_EVENTS = PROFILE_EVENTS.filter((e) => e !== "open");

router.post("/track", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const event = String(body.event || "");
        if (!CLIENT_EVENTS.includes(event)) {
            return res.status(400).json({ error: true, message: "Unknown event" });
        }
        let section = body.section == null || body.section === "" ? null : String(body.section);
        if (section !== null && !PROFILE_SECTIONS.includes(section)) {
            return res.status(400).json({ error: true, message: "Unknown section" });
        }
        if (event === "section" && !section) {
            return res.status(400).json({ error: true, message: "A section is required" });
        }
        if (event.startsWith("promo_")) section = null;

        const me = await whoAmI(req);
        if (!me) return res.status(404).json({ error: true, message: "Your portal account has no domain user." });

        const recorded = await recordEvent(me, event, section);
        return res.json({ error: false, recorded });
    } catch (error) {
        console.error("[profile] POST /track error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// Drives the blinking sidebar entry and the new-feature pop-up: both stay until
// the employee has opened My Profile once.
router.get("/promo", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoAmI(req);
        if (!me) return res.json({ error: false, opened: true });
        const opened = await ProfileEvent.exists({ domain_user: me.key, event: "open" });
        return res.json({ error: false, opened: !!opened });
    } catch (error) {
        console.error("[profile] GET /promo error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// The profile itself
// ---------------------------------------------------------------------------

router.get("/me", auth, roleCheck(["user", "admin"]), async (req, res) => {
    // TIN and pension numbers and the salary: never let a proxy or the browser keep it.
    res.set("Cache-Control", "no-store");
    try {
        const me = await whoAmI(req);
        if (!me) {
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

        const profile = await loadEmployeeProfile(pool, me.login);
        if (!profile) {
            return res.status(404).json({
                error: true,
                message: "We could not find your record in HRIS. Please contact the HR team.",
            });
        }

        // Usage logging must never cost the employee their profile.
        await recordEvent(me, "open").catch((e) => console.error("[profile] open not logged:", e.message));

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
        const me = await whoAmI(req);
        if (!me) return res.status(404).end();

        const pool = await getReportPool();
        const photo = await loadEmployeePhoto(pool, me.login);
        if (!photo) return res.status(404).end();

        res.set("Content-Type", photo.mime);
        res.set("Cache-Control", "private, max-age=600");
        return res.send(photo.buffer);
    } catch (error) {
        console.error("[profile] GET /me/photo error:", error.message);
        return res.status(404).end();
    }
});

// ---------------------------------------------------------------------------
// Admin analytics
// ---------------------------------------------------------------------------

// Days are Addis Ababa calendar days (UTC+3 all year, no daylight saving).
const EAT_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const RANGES = { 7: 7, 30: 30, 90: 90, all: null };
const MAX_DAILY_DAYS = 180;

const eatMidnight = (date) => {
    const eat = new Date(date.getTime() + EAT_OFFSET_MS);
    return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()) - EAT_OFFSET_MS);
};

const eatDay = (date) => new Date(date.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);

router.get("/admin/analytics", auth, roleCheck(["admin"]), async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        const rangeKey = Object.prototype.hasOwnProperty.call(RANGES, String(req.query.range))
            ? String(req.query.range)
            : "all";
        const days = RANGES[rangeKey];
        const today = eatMidnight(new Date());
        const since = days ? new Date(today.getTime() - (days - 1) * DAY_MS) : null;
        const match = since ? { at: { $gte: since } } : {};

        // The daily chart always has a start; for "all" it is the first event.
        let dailySince = since;
        if (!dailySince) {
            const first = await ProfileEvent.findOne({}, { at: 1 }).sort({ at: 1 }).lean();
            dailySince = first ? eatMidnight(first.at) : today;
        }
        const earliest = new Date(today.getTime() - (MAX_DAILY_DAYS - 1) * DAY_MS);
        if (dailySince < earliest) dailySince = earliest;

        const isEvent = (name) => ({ $eq: ["$event", name] });

        const [perUser, sectionRows, revealRows, promoRows, dailyRows, users] = await Promise.all([
            ProfileEvent.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: "$domain_user",
                        opens: { $sum: { $cond: [isEvent("open"), 1, 0] } },
                        reveals: { $sum: { $cond: [isEvent("reveal"), 1, 0] } },
                        sections: { $addToSet: { $cond: [isEvent("section"), "$section", null] } },
                        // $min / $max skip nulls, so these only see "open" rows.
                        first_open: { $min: { $cond: [isEvent("open"), "$at", null] } },
                        last_open: { $max: { $cond: [isEvent("open"), "$at", null] } },
                    },
                },
            ]),
            ProfileEvent.aggregate([
                { $match: { ...match, event: "section" } },
                { $group: { _id: "$section", views: { $sum: 1 }, users: { $addToSet: "$domain_user" } } },
                { $project: { views: 1, users: { $size: "$users" } } },
            ]),
            ProfileEvent.aggregate([
                { $match: { ...match, event: "reveal" } },
                { $group: { _id: null, events: { $sum: 1 }, users: { $addToSet: "$domain_user" } } },
                { $project: { events: 1, users: { $size: "$users" } } },
            ]),
            ProfileEvent.aggregate([
                { $match: { ...match, event: { $in: ["promo_shown", "promo_click", "promo_dismiss"] } } },
                { $group: { _id: "$event", events: { $sum: 1 }, users: { $addToSet: "$domain_user" } } },
                { $project: { events: 1, users: { $size: "$users" } } },
            ]),
            ProfileEvent.aggregate([
                { $match: { event: "open", at: { $gte: dailySince } } },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m-%d", date: "$at", timezone: "+03:00" } },
                        visits: { $sum: 1 },
                        users: { $addToSet: "$domain_user" },
                    },
                },
                { $project: { visits: 1, users: { $size: "$users" } } },
            ]),
            User.find({}, { first_name: 1, last_name: 1, user: 1, roles: 1 }).lean(),
        ]);

        const statsByLogin = new Map(perUser.map((row) => [row._id, row]));

        const shape = (stats) => ({
            opens: stats ? stats.opens : 0,
            reveals: stats ? stats.reveals : 0,
            sections: stats ? PROFILE_SECTIONS.filter((s) => stats.sections.includes(s)) : [],
            first_open: stats ? stats.first_open : null,
            last_open: stats ? stats.last_open : null,
        });

        const seen = new Set();
        const employees = users
            .filter((u) => normalizeLogin(u.user))
            .map((u) => {
                const login = normalizeLogin(u.user);
                const key = login.toLowerCase();
                seen.add(key);
                return {
                    name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
                    domain_user: login,
                    roles: u.roles || [],
                    ...shape(statsByLogin.get(key)),
                };
            });
        // Activity from logins no longer in the User collection still counts.
        perUser.forEach((row) => {
            if (!seen.has(row._id)) {
                employees.push({ name: null, domain_user: row._id, roles: [], ...shape(row) });
            }
        });

        const sectionsByKey = new Map(sectionRows.map((r) => [r._id, r]));
        const promoByEvent = new Map(promoRows.map((r) => [r._id, r]));
        const promo = (event) => promoByEvent.get(event) || { events: 0, users: 0 };

        const dailyByDay = new Map(dailyRows.map((r) => [r._id, r]));
        const daily = [];
        for (let t = dailySince.getTime(); t <= today.getTime(); t += DAY_MS) {
            const day = eatDay(new Date(t));
            const row = dailyByDay.get(day);
            daily.push({ day, users: row ? row.users : 0, visits: row ? row.visits : 0 });
        }

        const opened = employees.filter((e) => e.opens > 0);
        const salary = sectionsByKey.get("salary");
        const reveal = revealRows[0] || { events: 0, users: 0 };

        return res.json({
            error: false,
            data: {
                range: rangeKey,
                since: since ? eatDay(since) : null,
                generated_at: new Date().toISOString(),
                totals: {
                    portal_users: users.filter((u) => normalizeLogin(u.user)).length,
                    opened_users: opened.length,
                    visits: opened.reduce((sum, e) => sum + e.opens, 0),
                    salary_users: salary ? salary.users : 0,
                    reveal_users: reveal.users,
                },
                sections: PROFILE_SECTIONS.map((key) => {
                    const row = sectionsByKey.get(key);
                    return { key, users: row ? row.users : 0, views: row ? row.views : 0 };
                }),
                promo: {
                    shown_users: promo("promo_shown").users,
                    shown_events: promo("promo_shown").events,
                    click_users: promo("promo_click").users,
                    dismiss_users: promo("promo_dismiss").users,
                },
                daily,
                employees,
            },
        });
    } catch (error) {
        console.error("[profile] GET /admin/analytics error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

export default router;

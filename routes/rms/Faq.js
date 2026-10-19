import { Router } from "express";
import mongoose from "mongoose";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import Faq, { FAQ_TOPICS } from "../../models/rms/Faq.js";

// Frequently Asked Questions — HR writes them here, every employee reads them
// from the floating help button. Independent module: removing this file, the
// model and the mount in server.js restores the previous behaviour 1:1.

const router = Router();

const str = (v, max = 5000) => String(v == null ? "" : v).trim().slice(0, max);

const clampInt = (v, min, max, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, Math.round(n)));
};

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const topicOf = (v) => {
    const s = String(v == null ? "" : v).toLowerCase();
    return FAQ_TOPICS.includes(s) ? s : "general";
};

// Shared by create and update, so both refuse the same things.
const readBody = (body) => {
    const question = str(body.question, 300);
    const answer = str(body.answer, 5000);
    if (!question) return { message: "Please write the question" };
    if (!answer) return { message: "Please write the answer" };
    return {
        fields: {
            question,
            answer,
            topic: topicOf(body.topic),
            order: clampInt(body.order, -1000, 1000, 0),
            active: body.active === undefined ? true : !!body.active,
        },
    };
};

const actorOf = async (req) => {
    const user = await User.findOne({ _id: req.user._id });
    return (user && user.user) || "unknown";
};

// ---------------------------------------------------------------------------
// Employee side
// ---------------------------------------------------------------------------

router.get("/", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const rows = await Faq.find({ active: true })
            .select("question answer topic order")
            .sort({ order: 1, created_at: 1 })
            .lean();
        return res.json({ error: false, data: rows });
    } catch (error) {
        console.error("[faq] GET / error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

router.get("/admin", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const rows = await Faq.find().sort({ order: 1, created_at: 1 }).lean();
        return res.json({ error: false, data: rows });
    } catch (error) {
        console.error("[faq] GET /admin error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

router.post("/admin", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { fields, message } = readBody(req.body || {});
        if (!fields) return res.status(400).json({ error: true, message });

        const created = await Faq.create({
            ...fields,
            created_by: await actorOf(req),
            created_at: new Date(),
        });
        return res.json({ error: false, message: "Question added", data: created.toObject() });
    } catch (error) {
        console.error("[faq] POST /admin error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

router.put("/admin", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const id = str(body.id || body._id, 40);
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }
        const { fields, message } = readBody(body);
        if (!fields) return res.status(400).json({ error: true, message });

        const updated = await Faq.findByIdAndUpdate(
            id,
            { $set: { ...fields, updated_by: await actorOf(req), updated_at: new Date() } },
            { new: true }
        ).lean();
        if (!updated) {
            return res.status(404).json({ error: true, message: "Question not found" });
        }
        return res.json({ error: false, message: "Question updated", data: updated });
    } catch (error) {
        console.error("[faq] PUT /admin error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

router.delete("/admin/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { id } = req.params;
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }
        const removed = await Faq.findByIdAndDelete(id).lean();
        if (!removed) {
            return res.status(404).json({ error: true, message: "Question not found" });
        }
        return res.json({ error: false, message: "Question deleted" });
    } catch (error) {
        console.error("[faq] DELETE /admin error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

export default router;

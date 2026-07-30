import { Router } from "express";
import mongoose from "mongoose";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import Announcement, {
    ANNOUNCEMENT_MODES,
    ANNOUNCEMENT_STATUSES,
} from "../../models/rms/Announcement.js";
import AnnouncementCategory from "../../models/rms/AnnouncementCategory.js";
import AnnouncementAck from "../../models/rms/AnnouncementAck.js";

const router = Router();

// ---------------------------------------------------------------------------
// Primitive coercers
// ---------------------------------------------------------------------------
// Everything that reaches the database goes through these. Announcement
// content is authored by one admin and then rendered to every employee, so the
// server never trusts the shape it is handed.

const str = (v, max = 5000) => String(v == null ? "" : v).trim().slice(0, max);

const clampInt = (v, min, max, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, Math.round(n)));
};

const oneOf = (v, allowed, dflt) => {
    const s = String(v == null ? "" : v).toLowerCase();
    return allowed.includes(s) ? s : dflt;
};

const ALIGNS = ["left", "center", "right"];
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

// A data URI for a ~400 KB JPEG is roughly 540 KB of base64. This cap allows a
// generous single image while keeping the whole document well inside Mongo's
// 16 MB ceiling.
const MAX_IMAGE_CHARS = 3000000;
const MAX_DOC_BYTES = 12 * 1024 * 1024;

// Only inline base64 images and plain http(s) URLs survive. This is what stops
// `javascript:`, `data:text/html`, and friends reaching an href or src
// attribute in the employee-facing renderer.
const safeImageSrc = (v) => {
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) {
        return s.slice(0, MAX_IMAGE_CHARS);
    }
    if (/^https?:\/\//i.test(s)) return s.slice(0, 2000);
    return "";
};

// Videos are always referenced, never embedded — a base64 video would blow the
// document limit immediately.
const safeUrl = (v) => {
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s.slice(0, 2000);
    return "";
};

const safeHexColor = (v, dflt = "") => {
    const s = String(v || "").trim();
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s) ? s : dflt;
};

// ---------------------------------------------------------------------------
// Block whitelist
// ---------------------------------------------------------------------------
// The builder composes content out of these types. Anything else — including a
// block the frontend invents before the backend knows about it — is dropped
// rather than stored. Per-type field lists mean an attacker cannot smuggle
// extra keys through the Mixed array.
const sanitizeBlock = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const type = String(raw.type || "").toLowerCase();
    // Client-generated id is kept so React keys stay stable across a save.
    const id = str(raw.id, 60) || undefined;

    switch (type) {
        case "heading":
            return {
                id,
                type,
                text: str(raw.text, 300),
                level: clampInt(raw.level, 1, 4, 2),
                align: oneOf(raw.align, ALIGNS, "left"),
                color: safeHexColor(raw.color),
            };

        case "text":
            return {
                id,
                type,
                // Inline **bold**, *italic* and [label](url) are parsed into
                // React nodes on the client — never injected as HTML.
                content: str(raw.content, 20000),
                align: oneOf(raw.align, ALIGNS, "left"),
                size: oneOf(raw.size, ["sm", "md", "lg"], "md"),
            };

        case "image": {
            const src = safeImageSrc(raw.src);
            if (!src) return null;
            return {
                id,
                type,
                src,
                alt: str(raw.alt, 200),
                caption: str(raw.caption, 300),
                align: oneOf(raw.align, ALIGNS, "center"),
                width: clampInt(raw.width, 20, 100, 100),
                rounded: clampInt(raw.rounded, 0, 32, 12),
            };
        }

        case "gallery": {
            const images = (Array.isArray(raw.images) ? raw.images : [])
                .slice(0, 12)
                .map((img) => {
                    const src = safeImageSrc(img && img.src);
                    return src ? { src, alt: str(img && img.alt, 200) } : null;
                })
                .filter(Boolean);
            if (!images.length) return null;
            return {
                id,
                type,
                images,
                caption: str(raw.caption, 300),
                columns: clampInt(raw.columns, 2, 4, 3),
            };
        }

        case "video": {
            const url = safeUrl(raw.url);
            if (!url) return null;
            return {
                id,
                type,
                url,
                provider: oneOf(raw.provider, ["youtube", "vimeo", "file"], "youtube"),
                caption: str(raw.caption, 300),
                poster: safeImageSrc(raw.poster),
            };
        }

        case "button": {
            const href = safeUrl(raw.href);
            if (!href) return null;
            return {
                id,
                type,
                href,
                label: str(raw.label, 80) || "Open",
                style: oneOf(raw.style, ["primary", "secondary", "outline"], "primary"),
                align: oneOf(raw.align, ALIGNS, "left"),
            };
        }

        case "divider":
            return {
                id,
                type,
                style: oneOf(raw.style, ["solid", "dashed", "gradient"], "solid"),
            };

        case "spacer":
            return { id, type, size: clampInt(raw.size, 8, 160, 32) };

        case "quote":
            return {
                id,
                type,
                text: str(raw.text, 2000),
                author: str(raw.author, 120),
            };

        case "list": {
            const items = (Array.isArray(raw.items) ? raw.items : [])
                .slice(0, 40)
                .map((i) => str(i, 500))
                .filter((i) => i.length > 0);
            if (!items.length) return null;
            return { id, type, items, ordered: !!raw.ordered };
        }

        case "callout":
            return {
                id,
                type,
                title: str(raw.title, 160),
                text: str(raw.text, 2000),
                tone: oneOf(raw.tone, ["info", "success", "warning", "danger"], "info"),
            };

        default:
            // Unknown block type — dropped, not stored.
            return null;
    }
};

const sanitizeBlocks = (raw) =>
    (Array.isArray(raw) ? raw : []).slice(0, 120).map(sanitizeBlock).filter(Boolean);

const parseDate = (value, endOfDay) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    // A window ending "31 Mar" must cover all of 31 Mar.
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return d;
};

const clientIpOf = (req) => {
    const xff = req.headers["x-forwarded-for"];
    return (xff ? String(xff).split(",")[0].trim() : null) || req.ip || null;
};

const slugify = (name) =>
    String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "category";

// Appends -2, -3 … until the slug is free. `ignoreId` lets a rename keep its
// own slug instead of colliding with itself.
const uniqueSlug = async (name, ignoreId) => {
    const base = slugify(name);
    let candidate = base;
    let n = 1;
    /* eslint-disable no-await-in-loop */
    while (true) {
        const clash = await AnnouncementCategory.findOne({
            slug: candidate,
            ...(ignoreId ? { _id: { $ne: ignoreId } } : {}),
        }).lean();
        if (!clash) return candidate;
        n += 1;
        candidate = `${base}-${n}`;
        if (n > 50) return `${base}-${Date.now()}`;
    }
    /* eslint-enable no-await-in-loop */
};

// Visible right now: published, inside its window, and aimed at this role.
const visibilityMatch = (role, loginOnly) => {
    const now = new Date();
    const match = {
        status: "published",
        $and: [
            { $or: [{ publish_from: null }, { publish_from: { $lte: now } }] },
            { $or: [{ publish_until: null }, { publish_until: { $gte: now } }] },
        ],
    };
    if (role) match.target_roles = role;
    if (loginOnly) match.show_on_login = true;
    return match;
};

const FEED_SORT = { pinned: -1, priority: -1, created_at: -1 };

// ---------------------------------------------------------------------------
// GET /categories  (everyone)
// ---------------------------------------------------------------------------
router.get("/categories", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const categories = await AnnouncementCategory.find({ active: true })
            .sort({ order: 1, name: 1 })
            .lean();
        return res.json({ error: false, data: categories });
    } catch (error) {
        console.error("[announcement] /categories error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// GET /feed  (everyone)
// ---------------------------------------------------------------------------
// What the post-login overlay and the announcements page both read. Each row
// carries the caller's own engagement so the client can tell "required and not
// yet acknowledged" from "already confirmed" without a second call.
router.get("/feed", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res
                .status(400)
                .json({ error: true, message: "The requester cannot be found" });
        }

        const role = (req.user.roles && req.user.roles[0]) || "user";
        const loginOnly = String(req.query.login || "") === "1";

        // `blocks` is deliberately excluded. Announcement bodies carry inline
        // base64 images, so shipping every body here would make the post-login
        // screen download megabytes before it can paint. The deck only needs
        // the card face; GET /item/:id fetches the body when a card is opened.
        const rows = await Announcement.find(visibilityMatch(role, loginOnly))
            .populate("category_id")
            .sort(FEED_SORT)
            .limit(60)
            .select("-blocks -history")
            .lean();

        const ids = rows.map((r) => r._id);
        const acks = ids.length
            ? await AnnouncementAck.find({
                  announcement_id: { $in: ids },
                  domain_user: user.user,
              }).lean()
            : [];

        const ackByAnnouncement = {};
        acks.forEach((a) => {
            ackByAnnouncement[String(a.announcement_id)] = a;
        });

        const data = rows.map((r) => {
            const ack = ackByAnnouncement[String(r._id)];
            const category = r.category_id || null;
            return {
                ...r,
                // Flattened so the client never has to know it was a populate.
                category: category
                    ? {
                          _id: category._id,
                          name: category.name,
                          slug: category.slug,
                          color: category.color,
                      }
                    : null,
                category_id: category ? category._id : null,
                acknowledged: !!(ack && ack.acknowledged),
                acknowledged_at: (ack && ack.acknowledged_at) || null,
                seen_at: (ack && ack.seen_at) || null,
                open_count: (ack && ack.open_count) || 0,
                // History and audit noise is not needed by the reader.
                history: undefined,
            };
        });

        const mandatoryPending = data.filter(
            (d) => d.mode === "mandatory" && !d.acknowledged
        ).length;

        return res.json({
            error: false,
            data,
            meta: {
                total: data.length,
                mandatory_pending: mandatoryPending,
            },
        });
    } catch (error) {
        console.error("[announcement] /feed error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// GET /item/:id  (everyone) — the body of one announcement
// ---------------------------------------------------------------------------
// Loaded lazily when a card is opened, which is what keeps /feed light. The
// same visibility rules apply here, so an employee cannot read a draft, an
// expired notice, or one aimed at another role by guessing its id.
router.get("/item/:id", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const { id } = req.params;
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }

        const role = (req.user.roles && req.user.roles[0]) || "user";
        const row = await Announcement.findOne({
            _id: id,
            ...visibilityMatch(role, false),
        })
            .populate("category_id")
            .select("-history")
            .lean();

        if (!row) {
            return res
                .status(404)
                .json({ error: true, message: "Announcement not available" });
        }

        const category = row.category_id || null;
        return res.json({
            error: false,
            data: {
                ...row,
                category: category
                    ? {
                          _id: category._id,
                          name: category.name,
                          slug: category.slug,
                          color: category.color,
                      }
                    : null,
                category_id: category ? category._id : null,
            },
        });
    } catch (error) {
        console.error("[announcement] /item error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// POST /seen  (everyone) — detail view opened
// ---------------------------------------------------------------------------
// Best-effort telemetry. Deliberately NOT the same as acknowledging: opening a
// mandatory notice and closing it again must not satisfy the gate.
router.post("/seen", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const id = str((req.body || {}).id, 40);
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }

        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res
                .status(400)
                .json({ error: true, message: "The requester cannot be found" });
        }

        const now = new Date();
        const key = { announcement_id: id, domain_user: user.user };

        await AnnouncementAck.updateOne(
            key,
            {
                $inc: { open_count: 1 },
                // The filter's equality fields are placed into the new document
                // by the upsert itself, so announcement_id/domain_user are
                // deliberately not repeated here.
                $setOnInsert: {
                    employee_name: [user.first_name, user.last_name]
                        .filter(Boolean)
                        .join(" ")
                        .trim(),
                    seen_at: now,
                    acknowledged: false,
                    user_agent: req.headers["user-agent"] || "",
                    ip: clientIpOf(req),
                },
            },
            { upsert: true }
        );

        // A row can pre-exist with seen_at still null (created by an earlier
        // schema or an odd ordering), so backfill it rather than assume.
        await AnnouncementAck.updateOne(
            { ...key, seen_at: null },
            { $set: { seen_at: now } }
        );

        return res.json({ error: false });
    } catch (error) {
        console.error("[announcement] /seen error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// POST /ack  (everyone) — "I have read this"
// ---------------------------------------------------------------------------
router.post("/ack", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const id = str((req.body || {}).id, 40);
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }

        const announcement = await Announcement.findById(id).lean();
        if (!announcement) {
            return res.status(404).json({ error: true, message: "Announcement not found" });
        }

        const user = await User.findOne({ _id: req.user._id });
        if (!user) {
            return res
                .status(400)
                .json({ error: true, message: "The requester cannot be found" });
        }

        const now = new Date();
        const key = { announcement_id: id, domain_user: user.user };

        await AnnouncementAck.updateOne(
            key,
            {
                $set: { acknowledged: true, acknowledged_at: now },
                // The filter's equality fields are placed into the new document
                // by the upsert itself, so announcement_id/domain_user are
                // deliberately not repeated here.
                $setOnInsert: {
                    employee_name: [user.first_name, user.last_name]
                        .filter(Boolean)
                        .join(" ")
                        .trim(),
                    seen_at: now,
                    open_count: 1,
                    user_agent: req.headers["user-agent"] || "",
                    ip: clientIpOf(req),
                },
            },
            { upsert: true }
        );

        return res.json({ error: false, message: "Thank you", acknowledged_at: now });
    } catch (error) {
        console.error("[announcement] /ack error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// Admin: announcements
// ---------------------------------------------------------------------------

// GET /admin/list — material-react-table shaped
router.get("/admin/list", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const match = {};
        const status = oneOf(req.query.status, ANNOUNCEMENT_STATUSES, "");
        if (status) match.status = status;
        const mode = oneOf(req.query.mode, ANNOUNCEMENT_MODES, "");
        if (mode) match.mode = mode;
        if (req.query.category_id && isObjectId(req.query.category_id)) {
            match.category_id = req.query.category_id;
        }
        if (req.query.q) {
            const rx = new RegExp(
                String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "i"
            );
            match.$or = [{ title: rx }, { summary: rx }];
        }

        const page = Math.max(0, parseInt(req.query.page, 10) || 0);
        const size = Math.min(100, Math.max(1, parseInt(req.query.size, 10) || 25));

        const rows = await Announcement.find(match)
            .populate("category_id")
            .sort({ pinned: -1, priority: -1, updated_at: -1, created_at: -1 })
            .skip(page * size)
            .limit(size)
            // Cover images and block bodies are heavy and the list does not
            // render them; excluding them keeps this response small.
            .select("-blocks -cover_image -history")
            .lean();

        const totalRowCount = await Announcement.countDocuments(match);

        // Engagement counters for the list, in one aggregate rather than N+1.
        const ids = rows.map((r) => r._id);
        const stats = ids.length
            ? await AnnouncementAck.aggregate([
                  { $match: { announcement_id: { $in: ids } } },
                  {
                      $group: {
                          _id: "$announcement_id",
                          seen: { $sum: { $cond: [{ $ifNull: ["$seen_at", false] }, 1, 0] } },
                          acknowledged: {
                              $sum: { $cond: [{ $eq: ["$acknowledged", true] }, 1, 0] },
                          },
                      },
                  },
              ])
            : [];
        const statsById = {};
        stats.forEach((s) => {
            statsById[String(s._id)] = s;
        });

        const data = rows.map((r) => {
            const s = statsById[String(r._id)] || { seen: 0, acknowledged: 0 };
            const category = r.category_id || null;
            return {
                ...r,
                category: category
                    ? { _id: category._id, name: category.name, color: category.color }
                    : null,
                category_id: category ? category._id : null,
                seen_count: s.seen,
                acknowledged_count: s.acknowledged,
            };
        });

        return res.json({ error: false, data, meta: { totalRowCount } });
    } catch (error) {
        console.error("[announcement] /admin/list error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// GET /admin/item/:id — full document including blocks, for the builder
router.get("/admin/item/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { id } = req.params;
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }
        const row = await Announcement.findById(id).lean();
        if (!row) {
            return res.status(404).json({ error: true, message: "Announcement not found" });
        }
        return res.json({ error: false, data: row });
    } catch (error) {
        console.error("[announcement] /admin/item error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// POST /admin/save — create when no id is supplied, otherwise update.
// One endpoint because the builder does not care which it is.
router.post("/admin/save", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const title = str(body.title, 200);
        if (!title) {
            return res.status(400).json({ error: true, message: "A title is required" });
        }

        const blocks = sanitizeBlocks(body.blocks);
        const cover_image = safeImageSrc(body.cover_image);

        // Guard the document against Mongo's 16 MB ceiling before attempting
        // the write, so the admin gets a clear message instead of a driver
        // error after uploading a huge image.
        const approxBytes = Buffer.byteLength(
            JSON.stringify({ blocks, cover_image }),
            "utf8"
        );
        if (approxBytes > MAX_DOC_BYTES) {
            return res.status(400).json({
                error: true,
                message:
                    "This announcement is too large. Reduce the number or size of images " +
                    "(current content is about " +
                    Math.round(approxBytes / (1024 * 1024)) +
                    " MB, the limit is 12 MB).",
            });
        }

        const publish_from = parseDate(body.publish_from, false);
        const publish_until = parseDate(body.publish_until, true);
        if (publish_from && publish_until && publish_until < publish_from) {
            return res.status(400).json({
                error: true,
                message: "The end date cannot be earlier than the start date",
            });
        }

        const roles = (Array.isArray(body.target_roles) ? body.target_roles : [])
            .map((r) => oneOf(r, ["user", "admin"], ""))
            .filter(Boolean);

        const user = await User.findOne({ _id: req.user._id });
        const actor = (user && user.user) || "unknown";
        const now = new Date();

        const payload = {
            title,
            summary: str(body.summary, 400),
            category_id:
                body.category_id && isObjectId(body.category_id) ? body.category_id : null,
            cover_image,
            accent_color: safeHexColor(body.accent_color),
            blocks,
            mode: oneOf(body.mode, ANNOUNCEMENT_MODES, "optional"),
            status: oneOf(body.status, ANNOUNCEMENT_STATUSES, "draft"),
            publish_from,
            publish_until,
            pinned: !!body.pinned,
            priority: clampInt(body.priority, -100, 100, 0),
            target_roles: roles.length ? roles : ["user", "admin"],
            show_on_login: body.show_on_login === undefined ? true : !!body.show_on_login,
            updated_by: actor,
            updated_at: now,
        };

        const historyEntry = {
            status: payload.status,
            mode: payload.mode,
            publish_from,
            publish_until,
            block_count: blocks.length,
            note: str(body.note, 300),
            changed_by: actor,
            changed_at: now,
        };

        const id = str(body.id || body._id, 40);

        if (id && isObjectId(id)) {
            const updated = await Announcement.findByIdAndUpdate(
                id,
                { $set: payload, $push: { history: { ...historyEntry, action: "updated" } } },
                { new: true }
            ).lean();
            if (!updated) {
                return res
                    .status(404)
                    .json({ error: true, message: "Announcement not found" });
            }
            console.log(
                `[announcement] updated "${title}" (${updated._id}) status=${payload.status} by ${actor}`
            );
            return res.json({ error: false, message: "Announcement saved", data: updated });
        }

        const created = await Announcement.create({
            ...payload,
            created_by: actor,
            created_at: now,
            history: [{ ...historyEntry, action: "created" }],
        });
        console.log(
            `[announcement] created "${title}" (${created._id}) status=${payload.status} by ${actor}`
        );
        return res.json({
            error: false,
            message: "Announcement created",
            data: created.toObject(),
        });
    } catch (error) {
        console.error("[announcement] /admin/save error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// PATCH /admin/status — publish / unpublish / archive without opening the builder
router.patch("/admin/status", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const id = str(body.id, 40);
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }
        const status = oneOf(body.status, ANNOUNCEMENT_STATUSES, "");
        if (!status) {
            return res.status(400).json({
                error: true,
                message: `status must be one of: ${ANNOUNCEMENT_STATUSES.join(", ")}`,
            });
        }

        const user = await User.findOne({ _id: req.user._id });
        const actor = (user && user.user) || "unknown";
        const now = new Date();

        const updated = await Announcement.findByIdAndUpdate(
            id,
            {
                $set: { status, updated_by: actor, updated_at: now },
                $push: {
                    history: {
                        action: "status",
                        status,
                        note: str(body.note, 300),
                        changed_by: actor,
                        changed_at: now,
                    },
                },
            },
            { new: true }
        )
            .select("-blocks -cover_image")
            .lean();

        if (!updated) {
            return res.status(404).json({ error: true, message: "Announcement not found" });
        }
        return res.json({ error: false, message: `Announcement ${status}`, data: updated });
    } catch (error) {
        console.error("[announcement] /admin/status error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// DELETE /admin/item/:id — removes the announcement and its engagement rows.
router.delete("/admin/item/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { id } = req.params;
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }
        const removed = await Announcement.findByIdAndDelete(id).lean();
        if (!removed) {
            return res.status(404).json({ error: true, message: "Announcement not found" });
        }
        // Orphan acknowledgements would otherwise linger forever.
        await AnnouncementAck.deleteMany({ announcement_id: id });
        return res.json({ error: false, message: "Announcement deleted" });
    } catch (error) {
        console.error("[announcement] DELETE /admin/item error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// GET /admin/engagement/:id — who has seen and confirmed a notice
router.get("/admin/engagement/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { id } = req.params;
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }
        const announcement = await Announcement.findById(id)
            .select("title mode status target_roles")
            .lean();
        if (!announcement) {
            return res.status(404).json({ error: true, message: "Announcement not found" });
        }

        const rows = await AnnouncementAck.find({ announcement_id: id })
            .sort({ acknowledged_at: -1, seen_at: -1 })
            .limit(2000)
            .lean();

        // Denominator: everyone the notice is aimed at.
        const audience = await User.countDocuments({
            roles: { $in: announcement.target_roles || ["user", "admin"] },
        });

        const acknowledged = rows.filter((r) => r.acknowledged).length;
        const seen = rows.filter((r) => r.seen_at).length;

        return res.json({
            error: false,
            announcement,
            data: rows,
            meta: {
                audience,
                seen,
                acknowledged,
                ack_rate: audience ? Math.round((acknowledged / audience) * 100) : null,
            },
        });
    } catch (error) {
        console.error("[announcement] /admin/engagement error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// ---------------------------------------------------------------------------
// Admin: categories
// ---------------------------------------------------------------------------

router.get("/admin/categories", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const categories = await AnnouncementCategory.find()
            .sort({ order: 1, name: 1 })
            .lean();

        // Usage counts so the admin can see what a rename or delete affects.
        const counts = await Announcement.aggregate([
            { $match: { category_id: { $ne: null } } },
            { $group: { _id: "$category_id", count: { $sum: 1 } } },
        ]);
        const countById = {};
        counts.forEach((c) => {
            countById[String(c._id)] = c.count;
        });

        return res.json({
            error: false,
            data: categories.map((c) => ({
                ...c,
                announcement_count: countById[String(c._id)] || 0,
            })),
        });
    } catch (error) {
        console.error("[announcement] /admin/categories error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

router.post("/admin/categories", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const name = str(body.name, 60);
        if (!name) {
            return res.status(400).json({ error: true, message: "A category name is required" });
        }

        const clash = await AnnouncementCategory.findOne({
            name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        }).lean();
        if (clash) {
            return res
                .status(400)
                .json({ error: true, message: `A category named "${name}" already exists` });
        }

        const user = await User.findOne({ _id: req.user._id });
        const actor = (user && user.user) || "unknown";

        const created = await AnnouncementCategory.create({
            name,
            slug: await uniqueSlug(name),
            color: safeHexColor(body.color, "#0d6efd"),
            description: str(body.description, 240),
            order: clampInt(body.order, -100, 100, 0),
            active: body.active === undefined ? true : !!body.active,
            created_by: actor,
            created_at: new Date(),
        });

        return res.json({ error: false, message: "Category created", data: created.toObject() });
    } catch (error) {
        console.error("[announcement] POST /admin/categories error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

router.put("/admin/categories", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const body = req.body || {};
        const id = str(body.id || body._id, 40);
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }
        const name = str(body.name, 60);
        if (!name) {
            return res.status(400).json({ error: true, message: "A category name is required" });
        }

        const clash = await AnnouncementCategory.findOne({
            _id: { $ne: id },
            name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        }).lean();
        if (clash) {
            return res
                .status(400)
                .json({ error: true, message: `A category named "${name}" already exists` });
        }

        const user = await User.findOne({ _id: req.user._id });
        const actor = (user && user.user) || "unknown";

        const updated = await AnnouncementCategory.findByIdAndUpdate(
            id,
            {
                $set: {
                    name,
                    slug: await uniqueSlug(name, id),
                    color: safeHexColor(body.color, "#0d6efd"),
                    description: str(body.description, 240),
                    order: clampInt(body.order, -100, 100, 0),
                    active: body.active === undefined ? true : !!body.active,
                    updated_by: actor,
                    updated_at: new Date(),
                },
            },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ error: true, message: "Category not found" });
        }
        return res.json({ error: false, message: "Category updated", data: updated });
    } catch (error) {
        console.error("[announcement] PUT /admin/categories error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

// Refuses while announcements still reference the category. Silently detaching
// them would quietly change what employees see, so the admin is told the count
// and can reassign or deactivate instead.
router.delete("/admin/categories/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { id } = req.params;
        if (!isObjectId(id)) {
            return res.status(400).json({ error: true, message: "A valid id is required" });
        }

        const inUse = await Announcement.countDocuments({ category_id: id });
        if (inUse > 0) {
            return res.status(400).json({
                error: true,
                message:
                    `${inUse} announcement${inUse === 1 ? "" : "s"} still use this category. ` +
                    "Reassign them, or set the category inactive to hide it from new posts.",
            });
        }

        const removed = await AnnouncementCategory.findByIdAndDelete(id).lean();
        if (!removed) {
            return res.status(404).json({ error: true, message: "Category not found" });
        }
        return res.json({ error: false, message: "Category deleted" });
    } catch (error) {
        console.error("[announcement] DELETE /admin/categories error:", error);
        return res.status(500).json({ error: true, message: "Internal Server Error" });
    }
});

export default router;

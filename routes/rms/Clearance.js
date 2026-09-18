import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import Clearance, { TERMINATION_TYPES } from "../../models/rms/Clearance.js";
import ClearanceUnit from "../../models/rms/ClearanceUnit.js";
import ClearanceUnitMember from "../../models/rms/ClearanceUnitMember.js";
import ClearanceTemplate from "../../models/rms/ClearanceTemplate.js";
import ClearanceSettings from "../../models/rms/ClearanceSettings.js";
import {
    lc,
    inWindow,
    startOfDayEAT,
    loadOrg,
    resolveMembership,
    resolveSupervisor,
    resolveSignersForRule,
    isSigner,
    recompute,
    openClearance,
    refreshSnapshots,
    viewerCapabilities,
    snapshotEmployee,
    renderResignationLetter,
    userIndex,
    displayName,
    payload,
    notifyUsers,
    notifyAdmins,
    notifyNewlyPending,
    assignCertificate,
    ensureSeeded,
} from "../../utils/rms/clearanceService.js";

// Exit clearance — mounted at /zbss/api/clearance.
//
// Two audiences use these routes with two different kinds of authority:
//   - the existing global roles: `user` (any employee) and `admin` (HR);
//   - clearance-specific authority resolved LIVE from the unit hierarchy:
//     "is this caller the employee's supervisor?", "may this caller sign this
//     row?". Those checks are never taken from a stored list — see
//     clearanceService for why.

const router = Router();

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

const parseDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

const clientIp = (req) => {
    const xf = req.headers["x-forwarded-for"];
    if (xf) return String(xf).split(",")[0].trim();
    return req.ip || (req.connection && req.connection.remoteAddress) || "";
};

const bad = (res, message, extra = {}) => res.status(400).json({ error: true, message, ...extra });
const notFound = (res, message = "Not found") => res.status(404).json({ error: true, message });
const forbidden = (res, message = "You are not allowed to do that") =>
    res.status(403).json({ error: true, message });
const conflict = (res, message) => res.status(409).json({ error: true, message });
const fail = (res, where, e) => {
    console.error(`Clearance ${where} error:`, e);
    return res.status(500).json({ error: true, message: "Internal Server Error" });
};

// The caller, resolved once per request.
const whoami = async (req) => {
    const doc = await User.findById(req.user._id).lean();
    if (!doc) return null;
    return {
        doc,
        user: lc(doc.user),
        name: [doc.first_name, doc.last_name].filter(Boolean).join(" "),
        isAdmin: Array.isArray(doc.roles) && doc.roles.includes("admin"),
    };
};

const ACTIVE_STATUSES = ["Pending Supervisor", "Pending HR", "Approved", "Open", "Awaiting Final Approval"];

const activeClearanceFor = (domainUser) =>
    Clearance.findOne({ domain_user: lc(domainUser), status: { $in: ACTIVE_STATUSES } });

const ctx = async () => {
    const [org, settings] = [await loadOrg(), await ClearanceSettings.get()];
    return { org, settings };
};

// Attach the employee's unit from the hierarchy, if registered.
const applyMembership = (org, c, now) => {
    const m = resolveMembership(org, c.domain_user, now);
    if (m) {
        c.unit_id = m.unit._id;
        c.unit_kind = m.unit.kind;
        c.unit_name = m.unit.name;
    } else {
        const headed = org.units.find((u) => lc(u.head_user) === lc(c.domain_user) && u.active !== false);
        if (headed) {
            c.unit_id = headed._id;
            c.unit_kind = headed.kind;
            c.unit_name = headed.name;
        }
    }
};

// Opens the form now and sends the first wave of notifications.
const openNow = async (c, org, settings, now = new Date()) => {
    // A fresh database has no template yet; seed the paper form rather than fail.
    await ensureSeeded("system");
    const template = await ClearanceTemplate.findOne({ active: true }).lean();
    if (!template) throw new Error("No active clearance template");
    const r = openClearance(c, template, now);
    refreshSnapshots(org, settings, c, now);
    await c.save();
    await notifyNewlyPending(org, settings, c, r.newlyPending);
    await notifyUsers(
        [c.domain_user],
        payload("Your exit clearance is open", "Departments have been notified to sign.", "/user/clearance")
    );
    return r;
};

// Summary a list row or inbox item needs — never the whole document.
const summarize = (c) => {
    const tasks = c.tasks || [];
    return {
        _id: c._id,
        domain_user: c.domain_user,
        employee_name: c.employee_name,
        employee_id: c.employee_id,
        job_title: c.job_title,
        department: c.department,
        unit_name: c.unit_name,
        unit_kind: c.unit_kind,
        initiated_by: c.initiated_by,
        termination_type: c.termination_type,
        release_date: c.release_date,
        immediate: c.immediate,
        status: c.status,
        supervisor_user: c.supervisor_user,
        supervisor_unresolved: c.supervisor_unresolved,
        submitted_at: c.submitted_at,
        approved_at: c.approved_at,
        opened_at: c.opened_at,
        cleared_at: c.cleared_at,
        certificate_number: c.certificate_number,
        createdAt: c.createdAt,
        counts: {
            total: tasks.filter((t) => !t.auto).length,
            cleared: tasks.filter((t) => t.status === "Cleared").length,
            pending: tasks.filter((t) => t.status === "Pending").length,
            waiting: tasks.filter((t) => t.status === "Waiting").length,
            outstanding: tasks.filter((t) => t.status === "Outstanding").length,
            not_applicable: tasks.filter((t) => t.status === "Not Applicable").length,
        },
    };
};

// Validate the shared fields of a departure. Returns { ok, message, fields }.
const parseDeparture = (body, { requireReason }) => {
    const immediate = !!body.immediate;
    const reason = String(body.reason || "").trim();
    const additional_statement = String(body.additional_statement || "").trim();
    if (requireReason && !reason) return { ok: false, message: "Please give the reason." };
    if (reason.length > 2000) return { ok: false, message: "Reason is too long (max 2000 characters)." };
    if (additional_statement.length > 3000) {
        return { ok: false, message: "Additional statement is too long (max 3000 characters)." };
    }
    let release_date;
    if (immediate) {
        release_date = new Date();
    } else {
        const d = parseDate(body.release_date);
        if (!d) return { ok: false, message: "Please pick a valid release date, or choose Immediate." };
        release_date = startOfDayEAT(d);
        const today = startOfDayEAT(new Date());
        if (release_date < today) return { ok: false, message: "The release date cannot be in the past." };
    }
    return { ok: true, fields: { immediate, reason, additional_statement, release_date } };
};

// ------------------------------------------------------------------
// GET /me — what the sidebar and inbox need to know about the caller
// ------------------------------------------------------------------
router.get("/me", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const now = new Date();
        const { org, settings } = await ctx();

        const headsUnits = org.units
            .filter((u) => lc(u.head_user) === me.user && inWindow(u.head_valid_from, u.head_valid_to, now))
            .map((u) => ({ _id: u._id, name: u.name, code: u.code, kind: u.kind }));

        // Pending counts, computed the same way /inbox does.
        let approvals = await Clearance.countDocuments({
            status: "Pending Supervisor",
            supervisor_user: me.user,
        });
        if (me.isAdmin) {
            approvals += await Clearance.countDocuments({ status: "Pending HR" });
            approvals += await Clearance.countDocuments({ status: "Pending Supervisor", supervisor_unresolved: true });
        }
        const open = await Clearance.find(
            { status: { $in: ["Open", "Awaiting Final Approval"] }, "tasks.status": { $in: ["Pending", "Outstanding"] } },
            { tasks: 1, domain_user: 1, supervisor_user: 1 }
        ).lean();
        let tasks = 0;
        open.forEach((c) => {
            (c.tasks || []).forEach((t) => {
                if (t.status !== "Pending" && t.status !== "Outstanding") return;
                if (t.signature_mode === "manual") {
                    if (me.isAdmin) tasks += 1;
                } else if (isSigner(org, settings, c, t, me.user, now)) {
                    tasks += 1;
                }
            });
        });

        return res.json({
            domain_user: me.user,
            name: me.name,
            is_admin: me.isAdmin,
            heads_units: headsUnits,
            pending: { approvals, tasks },
        });
    } catch (e) {
        return fail(res, "/me", e);
    }
});

// ------------------------------------------------------------------
// employee: resignation
// ------------------------------------------------------------------

// Preview the formatted letter before submitting — nothing is saved.
router.post("/resign/preview", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const parsed = parseDeparture(req.body || {}, { requireReason: false });
        if (!parsed.ok) return bad(res, parsed.message);
        const snap = await snapshotEmployee(me.doc);
        const draft = { ...snap, domain_user: me.user, ...parsed.fields };
        return res.json({ letter: renderResignationLetter(draft), snapshot: snap, release_date: parsed.fields.release_date });
    } catch (e) {
        return fail(res, "/resign/preview", e);
    }
});

router.post("/resign", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");

        const existing = await activeClearanceFor(me.user);
        if (existing) {
            return conflict(res, `You already have an exit clearance in progress (status: ${existing.status}).`);
        }

        const parsed = parseDeparture(req.body || {}, { requireReason: true });
        if (!parsed.ok) return bad(res, parsed.message);

        await ensureSeeded(me.user);
        const now = new Date();
        const { org } = await ctx();
        const snap = await snapshotEmployee(me.doc);

        const c = new Clearance({
            ...snap,
            domain_user: me.user,
            initiated_by: "employee",
            termination_type: "Resignation",
            ...parsed.fields,
            submitted_at: now,
            created_by: me.user,
        });
        applyMembership(org, c, now);

        const supervisor = resolveSupervisor(org, me.user, now);
        c.supervisor_user = supervisor;
        c.supervisor_unresolved = !supervisor;
        c.status = supervisor ? "Pending Supervisor" : "Pending HR";
        c.resignation_letter = renderResignationLetter(c, now);
        await c.save();

        const body = `${c.employee_name} has submitted a resignation (release ${
            c.immediate ? "immediately" : c.release_date.toDateString()
        }).`;
        if (supervisor) {
            await notifyUsers([supervisor], payload("Resignation awaiting your approval", body, "/clearance/inbox"));
        } else {
            await notifyAdmins(
                payload("Resignation awaiting HR (no supervisor mapped)", body, "/admin/clearance/list")
            );
        }

        return res.status(201).json({ error: false, clearance: summarize(c), letter: c.resignation_letter });
    } catch (e) {
        return fail(res, "/resign", e);
    }
});

router.post("/resign/resubmit", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const c = await Clearance.findById(req.body && req.body.id);
        if (!c) return notFound(res, "Clearance not found");
        if (lc(c.domain_user) !== me.user) return forbidden(res, "Only the employee can resubmit their resignation");
        if (c.status !== "Rejected") return conflict(res, "Only a rejected resignation can be resubmitted");

        const parsed = parseDeparture(req.body || {}, { requireReason: true });
        if (!parsed.ok) return bad(res, parsed.message);

        const now = new Date();
        const { org } = await ctx();
        Object.assign(c, parsed.fields);
        c.submitted_at = now;
        c.supervisor_decision = undefined;
        c.hr_decision = undefined;

        const supervisor = resolveSupervisor(org, me.user, now);
        c.supervisor_user = supervisor;
        c.supervisor_unresolved = !supervisor;
        c.status = supervisor ? "Pending Supervisor" : "Pending HR";
        c.resignation_letter = renderResignationLetter(c, now);
        await c.save();

        const body = `${c.employee_name} has resubmitted their resignation.`;
        if (supervisor) await notifyUsers([supervisor], payload("Resignation resubmitted", body, "/clearance/inbox"));
        else await notifyAdmins(payload("Resignation resubmitted (no supervisor mapped)", body, "/admin/clearance/list"));

        return res.json({ error: false, clearance: summarize(c) });
    } catch (e) {
        return fail(res, "/resign/resubmit", e);
    }
});

router.post("/withdraw", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const c = await Clearance.findById(req.body && req.body.id);
        if (!c) return notFound(res, "Clearance not found");
        if (lc(c.domain_user) !== me.user) return forbidden(res, "Only the employee can withdraw");
        if (!["Pending Supervisor", "Pending HR", "Rejected", "Approved"].includes(c.status)) {
            return conflict(res, "A clearance that is already open cannot be withdrawn — ask HR to cancel it.");
        }
        c.status = "Cancelled";
        c.cancelled = { by: me.user, at: new Date(), reason: "Withdrawn by employee" };
        await c.save();
        await notifyAdmins(payload("Resignation withdrawn", `${c.employee_name} withdrew their resignation.`, "/admin/clearance/list"));
        return res.json({ error: false, clearance: summarize(c) });
    } catch (e) {
        return fail(res, "/withdraw", e);
    }
});

router.get("/my", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const all = await Clearance.find({ domain_user: me.user }).sort({ createdAt: -1 }).lean();
        const current = all.find((c) => c.status !== "Cancelled") || all[0] || null;
        return res.json({
            current: current ? current._id : null,
            history: all.map(summarize),
        });
    } catch (e) {
        return fail(res, "/my", e);
    }
});

// ------------------------------------------------------------------
// approvals: supervisor, then HR
// ------------------------------------------------------------------

router.post("/decide", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const { id, decision } = req.body || {};
        const reason = String((req.body && req.body.reason) || "").trim();
        if (!["approve", "reject"].includes(decision)) return bad(res, "decision must be approve or reject");
        if (decision === "reject" && !reason) return bad(res, "A rejection reason is required.");

        const c = await Clearance.findById(id);
        if (!c) return notFound(res, "Clearance not found");
        const now = new Date();
        const { org, settings } = await ctx();

        if (c.status === "Pending Supervisor") {
            const isSup = me.user === lc(c.supervisor_user);
            if (!isSup && !me.isAdmin) return forbidden(res, "Only the immediate supervisor (or HR) can decide this");
            const rec = {
                stage: "supervisor",
                decision,
                by: me.user,
                by_name: me.name,
                at: now,
                reason,
                on_behalf: !isSup,
            };
            c.supervisor_decision = rec;
            c.decision_history.push(rec);
            if (decision === "approve") {
                c.status = "Pending HR";
                await c.save();
                await notifyAdmins(
                    payload("Resignation awaiting HR approval", `${c.employee_name} — approved by supervisor.`, "/admin/clearance/list")
                );
                await notifyUsers(
                    [c.domain_user],
                    payload("Supervisor approved your resignation", "It is now with HR for final approval.", "/user/clearance")
                );
            } else {
                c.status = "Rejected";
                await c.save();
                await notifyUsers(
                    [c.domain_user],
                    payload("Your resignation was not approved", `Supervisor: ${reason}`, "/user/clearance")
                );
            }
            return res.json({ error: false, clearance: summarize(c) });
        }

        if (c.status === "Pending HR") {
            if (!me.isAdmin) return forbidden(res, "Only HR can decide at this stage");
            const rec = { stage: "hr", decision, by: me.user, by_name: me.name, at: now, reason, on_behalf: false };
            c.hr_decision = rec;
            c.decision_history.push(rec);
            if (decision === "approve") {
                c.status = "Approved";
                c.approved_at = now;
                await c.save();
                if (c.release_date <= now) {
                    await openNow(c, org, settings, now);
                } else {
                    await notifyUsers(
                        [c.domain_user],
                        payload(
                            "HR approved your resignation",
                            `Your exit clearance will open on ${c.release_date.toDateString()}.`,
                            "/user/clearance"
                        )
                    );
                }
            } else {
                c.status = "Rejected";
                await c.save();
                await notifyUsers([c.domain_user], payload("Your resignation was not approved", `HR: ${reason}`, "/user/clearance"));
                if (c.supervisor_user) {
                    await notifyUsers(
                        [c.supervisor_user],
                        payload("HR rejected a resignation you approved", `${c.employee_name}: ${reason}`, "/clearance/inbox")
                    );
                }
            }
            return res.json({ error: false, clearance: summarize(c) });
        }

        return conflict(res, `Nothing to decide — the clearance is ${c.status}`);
    } catch (e) {
        return fail(res, "/decide", e);
    }
});

// ------------------------------------------------------------------
// HR-initiated departure
// ------------------------------------------------------------------

router.post("/initiate", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const body = req.body || {};
        const domainUser = lc(body.domain_user);
        if (!domainUser) return bad(res, "domain_user is required");
        if (!TERMINATION_TYPES.includes(body.termination_type)) {
            return bad(res, `termination_type must be one of: ${TERMINATION_TYPES.join(", ")}`);
        }
        const idx = await userIndex();
        const target = idx.get(domainUser);
        if (!target) return notFound(res, `No portal user named "${domainUser}"`);
        const targetDoc = await User.findById(target._id).lean();

        const existing = await activeClearanceFor(domainUser);
        if (existing) return conflict(res, `${domainUser} already has a clearance in progress (${existing.status}).`);

        const parsed = parseDeparture(body, { requireReason: false });
        if (!parsed.ok) return bad(res, parsed.message);

        await ensureSeeded(me.user);
        const now = new Date();
        const { org, settings } = await ctx();
        const snap = await snapshotEmployee(targetDoc);

        const c = new Clearance({
            ...snap,
            domain_user: domainUser,
            initiated_by: "hr",
            termination_type: body.termination_type,
            ...parsed.fields,
            status: "Approved",
            submitted_at: now,
            approved_at: now,
            created_by: me.user,
        });
        applyMembership(org, c, now);
        c.supervisor_user = resolveSupervisor(org, domainUser, now);
        c.supervisor_unresolved = !c.supervisor_user;
        const rec = { stage: "hr", decision: "approve", by: me.user, by_name: me.name, at: now, reason: "", on_behalf: false };
        c.hr_decision = rec;
        c.decision_history.push(rec);
        await c.save();

        if (c.release_date <= now) {
            await openNow(c, org, settings, now);
        } else {
            await notifyUsers(
                [domainUser],
                payload(
                    "An exit clearance has been recorded for you",
                    `${c.termination_type}. The clearance form opens on ${c.release_date.toDateString()}.`,
                    "/user/clearance"
                )
            );
        }
        return res.status(201).json({ error: false, clearance: summarize(c) });
    } catch (e) {
        return fail(res, "/initiate", e);
    }
});

// ------------------------------------------------------------------
// inbox: everything waiting on the caller
// ------------------------------------------------------------------

router.get("/inbox", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const now = new Date();
        const { org, settings } = await ctx();

        const approvalFilter = me.isAdmin
            ? {
                  $or: [
                      { status: "Pending Supervisor", supervisor_user: me.user },
                      { status: "Pending Supervisor", supervisor_unresolved: true },
                      { status: "Pending HR" },
                  ],
              }
            : { status: "Pending Supervisor", supervisor_user: me.user };
        const approvals = (await Clearance.find(approvalFilter).sort({ submitted_at: 1 }).lean()).map((c) => ({
            ...summarize(c),
            stage: c.status === "Pending HR" ? "hr" : "supervisor",
            reason: c.reason,
            resignation_letter: c.resignation_letter,
        }));

        const open = await Clearance.find({
            status: { $in: ["Open", "Awaiting Final Approval"] },
            "tasks.status": { $in: ["Pending", "Outstanding"] },
        })
            .sort({ opened_at: 1 })
            .lean();

        const tasks = [];
        const manual = [];
        open.forEach((c) => {
            (c.tasks || []).forEach((t) => {
                if (t.status !== "Pending" && t.status !== "Outstanding") return;
                const row = {
                    clearance_id: c._id,
                    employee_name: c.employee_name,
                    domain_user: c.domain_user,
                    job_title: c.job_title,
                    department: c.department,
                    release_date: c.release_date,
                    termination_type: c.termination_type,
                    clearance_status: c.status,
                    task: {
                        code: t.code,
                        label: t.label,
                        status: t.status,
                        is_final: t.is_final,
                        signature_mode: t.signature_mode,
                        items: t.items,
                        note: t.note,
                        notified_at: t.notified_at,
                        due_at: t.notified_at ? new Date(new Date(t.notified_at).getTime() + settings.sla_days * 864e5) : null,
                    },
                };
                if (t.signature_mode === "manual") {
                    if (me.isAdmin) manual.push(row);
                } else if (isSigner(org, settings, c, t, me.user, now)) {
                    tasks.push(row);
                }
            });
        });

        return res.json({ approvals, tasks, manual, sla_days: settings.sla_days });
    } catch (e) {
        return fail(res, "/inbox", e);
    }
});

// ------------------------------------------------------------------
// detail
// ------------------------------------------------------------------

router.get("/detail/:id", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const c = await Clearance.findById(req.params.id);
        if (!c) return notFound(res, "Clearance not found");
        const now = new Date();
        const { org, settings } = await ctx();

        const caps = viewerCapabilities(org, settings, c, me.user, me.isAdmin, now);
        // Every department sees the whole form (HR's decision), but only
        // people with a part in it — not any employee who guesses an id.
        if (!(caps.is_admin || caps.is_owner || caps.is_supervisor || caps.is_signer)) {
            return forbidden(res, "You have no part in this clearance");
        }

        refreshSnapshots(org, settings, c, now);
        const obj = c.toObject();

        // Display names for every username that appears on the form.
        const names = {};
        const all = new Set([obj.domain_user, obj.supervisor_user, obj.cleared_by, obj.created_by]);
        (obj.tasks || []).forEach((t) => {
            (t.signers_snapshot || []).forEach((s) => all.add(s));
            if (t.acted_by) all.add(t.acted_by);
            if (t.manual && t.manual.verified_by) all.add(t.manual.verified_by);
            (t.history || []).forEach((h) => h.by && all.add(h.by));
        });
        (obj.decision_history || []).forEach((d) => d.by && all.add(d.by));
        for (const u of all) {
            if (!u) continue;
            // eslint-disable-next-line no-await-in-loop
            names[u] = await displayName(u);
        }

        return res.json({
            clearance: obj,
            viewer: caps,
            names,
            sla_days: settings.sla_days,
        });
    } catch (e) {
        return fail(res, "/detail", e);
    }
});

// ------------------------------------------------------------------
// tasks
// ------------------------------------------------------------------

const OUTCOMES = ["Cleared", "Outstanding", "Not Applicable"];
const ITEM_OUTCOMES = ["Pending", "Fulfilled", "Not Applicable", "Outstanding"];

const afterTaskChange = async (res, c, me, org, settings, r, extra = {}) => {
    if (r.becameCleared) await assignCertificate(c, me.user);
    c.markModified("tasks");
    await c.save();

    await notifyNewlyPending(org, settings, c, r.newlyPending);
    if (extra.outstandingLabel) {
        const p = payload(
            "Outstanding commitment recorded on your clearance",
            `${extra.outstandingLabel}: ${extra.note || "see details"}`,
            "/user/clearance",
            "clearance_outstanding"
        );
        await notifyUsers([c.domain_user], p);
        await notifyAdmins(payload("Clearance blocked", `${c.employee_name} — ${extra.outstandingLabel}`, "/admin/clearance/list"));
    }
    if (r.becameAwaitingFinal) {
        await notifyAdmins(
            payload("Clearance ready for final approval", `${c.employee_name} — all departments have signed.`, "/admin/clearance/list")
        );
        await notifyUsers([c.domain_user], payload("All departments have signed", "Awaiting final approval.", "/user/clearance"));
    }
    if (r.becameCleared) {
        await notifyUsers(
            [c.domain_user],
            payload("Your exit clearance is complete", `Certificate ${c.certificate_number}`, "/user/clearance")
        );
        await notifyAdmins(payload("Exit clearance completed", `${c.employee_name} — ${c.certificate_number}`, "/admin/clearance/list"));
    }
    return res.json({ error: false, clearance: summarize(c), status: c.status });
};

router.post("/task/act", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const { id, task_code, outcome } = req.body || {};
        const note = String((req.body && req.body.note) || "").trim();
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
        if (!OUTCOMES.includes(outcome)) return bad(res, `outcome must be one of ${OUTCOMES.join(", ")}`);

        const c = await Clearance.findById(id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status !== "Open" && c.status !== "Awaiting Final Approval") {
            return conflict(res, `The clearance is ${c.status}; rows cannot be signed now`);
        }
        const t = c.tasks.find((x) => x.code === task_code);
        if (!t) return notFound(res, "Row not found on this form");
        if (t.status !== "Pending" && t.status !== "Outstanding") return conflict(res, `This row is ${t.status}`);
        if (t.signature_mode === "manual") return conflict(res, "This row is signed by hand; HR records it after signature");

        const now = new Date();
        const { org, settings } = await ctx();
        if (!isSigner(org, settings, c, t, me.user, now)) {
            return forbidden(res, "You are not a signatory for this row");
        }

        // Apply sub-item outcomes, only for items that exist on the row.
        const byCode = new Map(t.items.map((it) => [it.code, it]));
        for (const it of items) {
            const target = byCode.get(it && it.code);
            if (!target) continue;
            if (ITEM_OUTCOMES.includes(it.outcome)) target.outcome = it.outcome;
            target.note = String(it.note || "").trim().slice(0, 1000);
            const amt = Number(it.amount);
            target.amount = Number.isFinite(amt) && amt >= 0 ? amt : undefined;
        }
        if (outcome === "Not Applicable") {
            t.items.forEach((it) => {
                it.outcome = "Not Applicable";
            });
        }

        const anyOutstanding = t.items.some((it) => it.outcome === "Outstanding");
        const anyPending = t.items.some((it) => it.outcome === "Pending");
        if (outcome === "Cleared" && (anyOutstanding || anyPending)) {
            return bad(res, "Every item must be Fulfilled or Not Applicable before the row can be cleared.");
        }
        if (outcome === "Outstanding" && !note && !anyOutstanding) {
            return bad(res, "Say what is outstanding — a note, or mark at least one item Outstanding.");
        }

        const from = t.status;
        t.status = outcome;
        t.note = note.slice(0, 2000);
        t.acted_by = me.user;
        t.acted_by_name = me.name;
        t.acted_at = now;
        t.acted_ip = clientIp(req);
        t.acted_user_agent = String(req.headers["user-agent"] || "").slice(0, 300);
        t.history.push({ at: now, by: me.user, action: "act", from, to: outcome, note: t.note });

        const r = recompute(c, now);
        refreshSnapshots(org, settings, c, now);
        return afterTaskChange(res, c, me, org, settings, r, {
            outstandingLabel: outcome === "Outstanding" ? t.label : "",
            note: t.note,
        });
    } catch (e) {
        return fail(res, "/task/act", e);
    }
});

// HR records a hand-signed row (the CEO's line, by default).
router.post("/task/verify-manual", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const { id, task_code } = req.body || {};
        const signedByName = String((req.body && req.body.signed_by_name) || "").trim();
        const signedOn = parseDate(req.body && req.body.signed_on) || new Date();
        if (!signedByName) return bad(res, "Enter the name of the person who signed.");

        const c = await Clearance.findById(id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status !== "Open" && c.status !== "Awaiting Final Approval") {
            return conflict(res, `The clearance is ${c.status}`);
        }
        const t = c.tasks.find((x) => x.code === task_code);
        if (!t) return notFound(res, "Row not found on this form");
        if (t.signature_mode !== "manual") return conflict(res, "This row is signed electronically, not by hand");
        if (t.status !== "Pending" && t.status !== "Outstanding") {
            return conflict(res, t.status === "Waiting" ? "The other rows are not all signed yet" : `This row is ${t.status}`);
        }

        const now = new Date();
        const { org, settings } = await ctx();
        const from = t.status;
        t.status = "Cleared";
        t.items.forEach((it) => {
            if (it.outcome === "Pending") it.outcome = "Fulfilled";
        });
        t.manual = { signed_by_name: signedByName, signed_on: signedOn, verified_by: me.user, verified_at: now };
        t.acted_by = me.user;
        t.acted_by_name = me.name;
        t.acted_at = now;
        t.acted_ip = clientIp(req);
        t.acted_user_agent = String(req.headers["user-agent"] || "").slice(0, 300);
        t.history.push({
            at: now,
            by: me.user,
            action: "verify_manual",
            from,
            to: "Cleared",
            note: `Signed by ${signedByName} on ${signedOn.toDateString()}`,
        });

        const r = recompute(c, now);
        refreshSnapshots(org, settings, c, now);
        return afterTaskChange(res, c, me, org, settings, r);
    } catch (e) {
        return fail(res, "/task/verify-manual", e);
    }
});

router.post("/task/reassign", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const { id, task_code } = req.body || {};
        const users = Array.isArray(req.body && req.body.users) ? req.body.users.map(lc).filter(Boolean) : [];
        if (!users.length) return bad(res, "Give at least one username to reassign to.");

        const c = await Clearance.findById(id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status !== "Open" && c.status !== "Awaiting Final Approval") return conflict(res, `The clearance is ${c.status}`);
        const t = c.tasks.find((x) => x.code === task_code);
        if (!t) return notFound(res, "Row not found on this form");

        const now = new Date();
        const { org, settings } = await ctx();
        const before = JSON.stringify(t.signer_rule);
        t.signer_rule = { mode: "users", users };
        t.history.push({ at: now, by: me.user, action: "reassign", from: before, to: users.join(", "), note: "" });
        refreshSnapshots(org, settings, c, now);
        c.markModified("tasks");
        await c.save();

        if (t.status === "Pending" || t.status === "Outstanding") {
            await notifyUsers(
                users,
                payload("Exit clearance row assigned to you", `${c.employee_name} — ${t.label}`, "/clearance/inbox", "clearance_task")
            );
        }
        return res.json({ error: false, clearance: summarize(c) });
    } catch (e) {
        return fail(res, "/task/reassign", e);
    }
});

// A signed row can be reopened while the form is still in progress — a
// department that finds something after signing must be able to say so.
router.post("/task/reopen", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const { id, task_code } = req.body || {};
        const note = String((req.body && req.body.note) || "").trim();
        if (!note) return bad(res, "Say why the row is being reopened.");

        const c = await Clearance.findById(id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status !== "Open" && c.status !== "Awaiting Final Approval") return conflict(res, `The clearance is ${c.status}`);
        const t = c.tasks.find((x) => x.code === task_code);
        if (!t) return notFound(res, "Row not found on this form");
        if (t.is_final) return conflict(res, "The final approval row cannot be reopened");
        if (t.status !== "Cleared") return conflict(res, `This row is ${t.status}, not Cleared`);

        const now = new Date();
        const { org, settings } = await ctx();
        if (!me.isAdmin && !isSigner(org, settings, c, t, me.user, now)) {
            return forbidden(res, "You are not a signatory for this row");
        }

        t.status = "Pending";
        t.notified_at = now;
        t.history.push({ at: now, by: me.user, action: "reopen", from: "Cleared", to: "Pending", note });
        const r = recompute(c, now);
        refreshSnapshots(org, settings, c, now);
        c.markModified("tasks");
        await c.save();

        await notifyUsers(
            [c.domain_user],
            payload("A clearance row was reopened", `${t.label}: ${note}`, "/user/clearance")
        );
        await notifyAdmins(payload("Clearance row reopened", `${c.employee_name} — ${t.label}: ${note}`, "/admin/clearance/list"));
        return res.json({ error: false, clearance: summarize(c), status: c.status, changed: r });
    } catch (e) {
        return fail(res, "/task/reopen", e);
    }
});

// ------------------------------------------------------------------
// HR oversight
// ------------------------------------------------------------------

router.get("/list", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const filter = {};
        if (req.query.status) filter.status = String(req.query.status);
        if (req.query.termination_type) filter.termination_type = String(req.query.termination_type);
        if (req.query.unit_id) filter.unit_id = String(req.query.unit_id);
        if (req.query.q) {
            const q = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filter.$or = [
                { domain_user: { $regex: q, $options: "i" } },
                { employee_name: { $regex: q, $options: "i" } },
                { employee_id: { $regex: q, $options: "i" } },
                { certificate_number: { $regex: q, $options: "i" } },
            ];
        }
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
        const [rows, total] = await Promise.all([
            Clearance.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Clearance.countDocuments(filter),
        ]);
        return res.json({ data: rows.map(summarize), meta: { totalRowCount: total } });
    } catch (e) {
        return fail(res, "/list", e);
    }
});

router.post("/cancel", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const reason = String((req.body && req.body.reason) || "").trim();
        if (!reason) return bad(res, "A cancellation reason is required.");
        const c = await Clearance.findById(req.body && req.body.id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status === "Cleared" || c.status === "Cancelled") return conflict(res, `The clearance is already ${c.status}`);
        c.status = "Cancelled";
        c.cancelled = { by: me.user, at: new Date(), reason };
        await c.save();
        await notifyUsers([c.domain_user], payload("Your exit clearance was cancelled", reason, "/user/clearance"));
        return res.json({ error: false, clearance: summarize(c) });
    } catch (e) {
        return fail(res, "/cancel", e);
    }
});

router.post("/open-now", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const c = await Clearance.findById(req.body && req.body.id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status !== "Approved") return conflict(res, `Only an Approved clearance can be opened early (this one is ${c.status})`);
        await ensureSeeded(me.user);
        const { org, settings } = await ctx();
        await openNow(c, org, settings, new Date());
        return res.json({ error: false, clearance: summarize(c) });
    } catch (e) {
        return fail(res, "/open-now", e);
    }
});

// ------------------------------------------------------------------
// org: units and members
// ------------------------------------------------------------------

const unitFromBody = (body, out = {}) => {
    if (body.name !== undefined) out.name = String(body.name || "").trim();
    if (body.code !== undefined) out.code = String(body.code || "").trim().toUpperCase();
    if (body.kind !== undefined) out.kind = body.kind;
    if (body.head_user !== undefined) out.head_user = lc(body.head_user);
    if (body.head_valid_from !== undefined) out.head_valid_from = parseDate(body.head_valid_from) || undefined;
    if (body.head_valid_to !== undefined) out.head_valid_to = parseDate(body.head_valid_to) || undefined;
    if (body.head_reports_to !== undefined) out.head_reports_to = lc(body.head_reports_to);
    if (body.active !== undefined) out.active = !!body.active;
    return out;
};

const decorateUnits = async (units) => {
    const counts = await ClearanceUnitMember.aggregate([
        { $match: { active: true } },
        { $group: { _id: "$unit_id", n: { $sum: 1 } } },
    ]);
    const byUnit = new Map(counts.map((c) => [String(c._id), c.n]));
    const out = [];
    for (const u of units) {
        out.push({
            ...u,
            member_count: byUnit.get(String(u._id)) || 0,
            head_name: u.head_user ? await displayName(u.head_user) : "",
            head_active: !!u.head_user && inWindow(u.head_valid_from, u.head_valid_to),
        });
    }
    return out;
};

router.get("/units", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        await ensureSeeded("system");
        const units = await ClearanceUnit.find({}).sort({ kind: 1, name: 1 }).lean();
        return res.json({ data: await decorateUnits(units) });
    } catch (e) {
        return fail(res, "/units", e);
    }
});

router.get("/units/mine", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const now = new Date();
        const units = (await ClearanceUnit.find({ head_user: me.user, active: true }).lean()).filter((u) =>
            inWindow(u.head_valid_from, u.head_valid_to, now)
        );
        return res.json({ data: await decorateUnits(units) });
    } catch (e) {
        return fail(res, "/units/mine", e);
    }
});

router.post("/units", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        const fields = unitFromBody(req.body || {});
        if (!fields.name) return bad(res, "Unit name is required");
        if (!fields.code) return bad(res, "Unit code is required");
        if (!["branch", "department"].includes(fields.kind)) return bad(res, "kind must be branch or department");
        if (await ClearanceUnit.findOne({ code: fields.code })) return conflict(res, `A unit with code ${fields.code} already exists`);
        const u = await ClearanceUnit.create({ ...fields, created_by: me.user, updated_by: me.user });
        return res.status(201).json({ error: false, unit: (await decorateUnits([u.toObject()]))[0] });
    } catch (e) {
        return fail(res, "POST /units", e);
    }
});

router.patch("/units/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        const u = await ClearanceUnit.findById(req.params.id);
        if (!u) return notFound(res, "Unit not found");
        const fields = unitFromBody(req.body || {});
        if (fields.code && fields.code !== u.code) {
            if (await ClearanceUnit.findOne({ code: fields.code, _id: { $ne: u._id } })) {
                return conflict(res, `A unit with code ${fields.code} already exists`);
            }
        }
        if (fields.kind && !["branch", "department"].includes(fields.kind)) return bad(res, "kind must be branch or department");
        Object.assign(u, fields, { updated_by: me.user });
        await u.save();
        return res.json({ error: false, unit: (await decorateUnits([u.toObject()]))[0] });
    } catch (e) {
        return fail(res, "PATCH /units/:id", e);
    }
});

// Admin, or the unit's head while their appointment is in force.
const canManageUnit = (me, unit, now = new Date()) =>
    me.isAdmin || (lc(unit.head_user) === me.user && unit.active !== false && inWindow(unit.head_valid_from, unit.head_valid_to, now));

router.get("/units/:id/members", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const u = await ClearanceUnit.findById(req.params.id).lean();
        if (!u) return notFound(res, "Unit not found");
        if (!canManageUnit(me, u)) return forbidden(res, "Only the unit head (while appointed) or HR can view members");
        const members = await ClearanceUnitMember.find({ unit_id: u._id }).sort({ role_in_unit: 1, domain_user: 1 }).lean();
        const out = [];
        for (const m of members) {
            out.push({
                ...m,
                name: await displayName(m.domain_user),
                reports_to_name: m.reports_to ? await displayName(m.reports_to) : "",
                in_window: inWindow(m.valid_from, m.valid_to),
            });
        }
        return res.json({ unit: (await decorateUnits([u]))[0], data: out });
    } catch (e) {
        return fail(res, "/units/:id/members", e);
    }
});

const memberFromBody = (body, out = {}) => {
    if (body.role_in_unit !== undefined) out.role_in_unit = body.role_in_unit;
    if (body.reports_to !== undefined) out.reports_to = lc(body.reports_to);
    if (body.can_sign_clearance !== undefined) out.can_sign_clearance = !!body.can_sign_clearance;
    if (body.valid_from !== undefined) out.valid_from = parseDate(body.valid_from) || undefined;
    if (body.valid_to !== undefined) out.valid_to = parseDate(body.valid_to) || undefined;
    if (body.active !== undefined) out.active = !!body.active;
    return out;
};

router.post("/units/:id/members", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const u = await ClearanceUnit.findById(req.params.id).lean();
        if (!u) return notFound(res, "Unit not found");
        if (!canManageUnit(me, u)) return forbidden(res, "Only the unit head (while appointed) or HR can register members");

        const domainUser = lc(req.body && req.body.domain_user);
        if (!domainUser) return bad(res, "domain_user is required");
        const idx = await userIndex();
        if (!idx.get(domainUser)) return notFound(res, `No portal user named "${domainUser}"`);
        const fields = memberFromBody(req.body || {});
        if (fields.role_in_unit && !["deputy", "manager", "staff"].includes(fields.role_in_unit)) {
            return bad(res, "role_in_unit must be deputy, manager or staff");
        }
        const m = await ClearanceUnitMember.findOneAndUpdate(
            { unit_id: u._id, domain_user: domainUser },
            { $set: { ...fields, active: fields.active !== undefined ? fields.active : true, updated_by: me.user }, $setOnInsert: { registered_by: me.user } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();
        return res.status(201).json({ error: false, member: { ...m, name: await displayName(m.domain_user) } });
    } catch (e) {
        return fail(res, "POST /units/:id/members", e);
    }
});

router.patch("/units/:id/members/:mid", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const u = await ClearanceUnit.findById(req.params.id).lean();
        if (!u) return notFound(res, "Unit not found");
        if (!canManageUnit(me, u)) return forbidden(res, "Only the unit head (while appointed) or HR can edit members");
        const m = await ClearanceUnitMember.findOne({ _id: req.params.mid, unit_id: u._id });
        if (!m) return notFound(res, "Member not found");
        const fields = memberFromBody(req.body || {});
        if (fields.role_in_unit && !["deputy", "manager", "staff"].includes(fields.role_in_unit)) {
            return bad(res, "role_in_unit must be deputy, manager or staff");
        }
        Object.assign(m, fields, { updated_by: me.user });
        await m.save();
        return res.json({ error: false, member: { ...m.toObject(), name: await displayName(m.domain_user) } });
    } catch (e) {
        return fail(res, "PATCH /units/:id/members/:mid", e);
    }
});

// Lightweight user lookup for pickers. Any signed-in user may search — a unit
// head needs it to register their staff.
router.get("/users/search", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const q = lc(req.query.q);
        if (q.length < 2) return res.json({ data: [] });
        const idx = await userIndex();
        const out = [];
        for (const u of idx.values()) {
            const hay = `${lc(u.user)} ${lc(u.first_name)} ${lc(u.last_name)}`;
            if (hay.includes(q)) {
                out.push({ user: lc(u.user), name: [u.first_name, u.last_name].filter(Boolean).join(" ") });
                if (out.length >= 20) break;
            }
        }
        return res.json({ data: out });
    } catch (e) {
        return fail(res, "/users/search", e);
    }
});

// ------------------------------------------------------------------
// template
// ------------------------------------------------------------------

router.get("/templates", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        await ensureSeeded("system");
        const all = await ClearanceTemplate.find({}, { rows: 0 }).sort({ version: -1 }).lean();
        return res.json({ data: all });
    } catch (e) {
        return fail(res, "/templates", e);
    }
});

router.get("/templates/active", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const t = await ensureSeeded("system");
        const units = await ClearanceUnit.find({}).sort({ kind: 1, name: 1 }).lean();
        return res.json({
            template: t,
            units: units.map((u) => ({ _id: u._id, name: u.name, code: u.code, kind: u.kind, active: u.active })),
            termination_types: TERMINATION_TYPES,
        });
    } catch (e) {
        return fail(res, "/templates/active", e);
    }
});

const validateRows = (rows, unitIds) => {
    if (!Array.isArray(rows) || !rows.length) return "The template needs at least one row.";
    const codes = new Set();
    let finals = 0;
    for (const r of rows) {
        const code = String(r.code || "").trim();
        if (!code) return "Every row needs a code.";
        if (codes.has(code)) return `Row code "${code}" is used twice.`;
        codes.add(code);
        if (!String(r.label || "").trim()) return `Row "${code}" needs a label.`;
        const s = r.signer || {};
        if (!["supervisor", "unit_head", "users", "ceo"].includes(s.mode)) return `Row "${code}": invalid signer mode.`;
        if (s.mode === "unit_head" && !(s.unit_id && unitIds.has(String(s.unit_id)))) {
            return `Row "${code}": pick the unit whose head signs it.`;
        }
        if (s.mode === "users" && !(Array.isArray(s.users) && s.users.filter(Boolean).length)) {
            return `Row "${code}": list at least one username.`;
        }
        if (r.signature_mode && !["electronic", "manual"].includes(r.signature_mode)) return `Row "${code}": invalid signature mode.`;
        if (r.is_final) finals += 1;
        const itemCodes = new Set();
        for (const it of r.items || []) {
            const ic = String(it.code || "").trim();
            if (!ic || !String(it.label || "").trim()) return `Row "${code}": every item needs a code and a label.`;
            if (itemCodes.has(ic)) return `Row "${code}": item code "${ic}" is used twice.`;
            itemCodes.add(ic);
        }
    }
    if (finals > 1) return "Only one row can be the final approval.";
    for (const r of rows) {
        for (const d of r.depends_on || []) {
            if (!codes.has(d)) return `Row "${r.code}" depends on unknown row "${d}".`;
            if (d === r.code) return `Row "${r.code}" cannot depend on itself.`;
        }
    }
    // Cycle check: a dependency loop would leave rows Waiting forever.
    const deps = new Map(rows.map((r) => [r.code, r.depends_on || []]));
    const state = new Map();
    const visit = (code) => {
        if (state.get(code) === 1) return true;
        if (state.get(code) === 2) return false;
        state.set(code, 1);
        for (const d of deps.get(code) || []) if (visit(d)) return true;
        state.set(code, 2);
        return false;
    };
    for (const code of deps.keys()) if (visit(code)) return "Row dependencies form a loop.";
    return "";
};

router.post("/templates", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        const body = req.body || {};
        const units = await ClearanceUnit.find({}, { _id: 1 }).lean();
        const unitIds = new Set(units.map((u) => String(u._id)));
        const rows = (body.rows || []).map((r, i) => ({
            code: String(r.code || "").trim(),
            label: String(r.label || "").trim(),
            order: Number.isFinite(Number(r.order)) ? Number(r.order) : i + 1,
            items: (r.items || []).map((it) => ({ code: String(it.code || "").trim(), label: String(it.label || "").trim() })),
            signer: {
                mode: (r.signer || {}).mode,
                unit_id: (r.signer || {}).unit_id || undefined,
                users: ((r.signer || {}).users || []).map(lc).filter(Boolean),
            },
            signature_mode: r.signature_mode || "electronic",
            applies_to: {
                unit_kinds: ((r.applies_to || {}).unit_kinds || []).filter((k) => ["branch", "department"].includes(k)),
                termination_types: ((r.applies_to || {}).termination_types || []).filter((k) => TERMINATION_TYPES.includes(k)),
                unit_ids: ((r.applies_to || {}).unit_ids || []).filter((id) => unitIds.has(String(id))),
            },
            depends_on: (r.depends_on || []).map((d) => String(d).trim()).filter(Boolean),
            is_final: !!r.is_final,
        }));
        const err = validateRows(rows, unitIds);
        if (err) return bad(res, err);

        const latest = await ClearanceTemplate.findOne({}).sort({ version: -1 }).lean();
        const version = latest ? latest.version + 1 : 1;
        await ClearanceTemplate.updateMany({ active: true }, { $set: { active: false } });
        const t = await ClearanceTemplate.create({
            version,
            name: String(body.name || "Exit Clearance").trim() || "Exit Clearance",
            active: true,
            rows,
            created_by: me.user,
        });
        return res.status(201).json({ error: false, template: t.toObject() });
    } catch (e) {
        return fail(res, "POST /templates", e);
    }
});

// ------------------------------------------------------------------
// settings
// ------------------------------------------------------------------

router.get("/settings", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const s = await ClearanceSettings.get();
        const obj = s.toObject();
        return res.json({
            settings: obj,
            ceo_name: obj.ceo_user ? await displayName(obj.ceo_user) : "",
            ceo_delegate_name: obj.ceo_delegate_user ? await displayName(obj.ceo_delegate_user) : "",
            delegate_active: !!obj.ceo_delegate_user && inWindow(obj.ceo_delegate_from, obj.ceo_delegate_to),
        });
    } catch (e) {
        return fail(res, "/settings", e);
    }
});

router.put("/settings", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        const s = await ClearanceSettings.get();
        const b = req.body || {};
        if (b.ceo_user !== undefined) s.ceo_user = lc(b.ceo_user);
        if (b.ceo_delegate_user !== undefined) s.ceo_delegate_user = lc(b.ceo_delegate_user);
        if (b.ceo_delegate_from !== undefined) s.ceo_delegate_from = parseDate(b.ceo_delegate_from) || undefined;
        if (b.ceo_delegate_to !== undefined) s.ceo_delegate_to = parseDate(b.ceo_delegate_to) || undefined;
        const num = (v, min, max) => {
            const n = Number(v);
            return Number.isFinite(n) && n >= min && n <= max ? n : null;
        };
        if (b.sla_days !== undefined) {
            const n = num(b.sla_days, 0, 60);
            if (n === null) return bad(res, "sla_days must be between 0 and 60");
            s.sla_days = n;
        }
        if (b.remind_every_days !== undefined) {
            const n = num(b.remind_every_days, 1, 30);
            if (n === null) return bad(res, "remind_every_days must be between 1 and 30");
            s.remind_every_days = n;
        }
        if (b.escalate_after_days !== undefined) {
            const n = num(b.escalate_after_days, 1, 90);
            if (n === null) return bad(res, "escalate_after_days must be between 1 and 90");
            s.escalate_after_days = n;
        }
        s.updated_by = me.user;
        await s.save();
        return res.json({ error: false, settings: s.toObject() });
    } catch (e) {
        return fail(res, "PUT /settings", e);
    }
});

export default router;

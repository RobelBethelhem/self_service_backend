import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import User from "../../models/rms/User.js";
import Clearance, { TERMINATION_TYPES } from "../../models/rms/Clearance.js";
import ClearanceUnit from "../../models/rms/ClearanceUnit.js";
import ClearanceUnitMember from "../../models/rms/ClearanceUnitMember.js";
import ClearanceDelegation from "../../models/rms/ClearanceDelegation.js";
import ClearanceMemo from "../../models/rms/ClearanceMemo.js";
import ClearanceMemoPreset from "../../models/rms/ClearanceMemoPreset.js";
import ClearanceTemplate from "../../models/rms/ClearanceTemplate.js";
import ClearanceSettings from "../../models/rms/ClearanceSettings.js";
import {
    lc,
    inWindow,
    startOfDayEAT,
    loadOrg,
    resolveMembership,
    resolveSupervisor,
    resolveSignerPrincipals,
    resolveSignersForRule,
    isSigner,
    recompute,
    openClearance,
    refreshSnapshots,
    viewerCapabilities,
    snapshotEmployee,
    renderResignationLetter,
    renderResignationLetterParts,
    userIndex,
    displayName,
    payload,
    notifyUsers,
    notifyAdmins,
    notifyNewlyPending,
    assignCertificate,
    ensureSeeded,
    DEFAULT_ROLES,
    roleInfo,
    headRoleFor,
    headsAnyUnit,
    chainOf,
    isManagerUser,
    canManageUser,
    canRegisterUnder,
    wouldCycle,
    summarizeNode,
    buildTree,
    actingFor,
    principalsOf,
    effectiveActors,
    actingMap,
    benefitsBranchUnit,
    benefitsFillers,
    buildBenefits,
    benefitsComplete,
    MEMO_KINDS,
    MEMO_FROM_DEFAULT,
    memoSubject,
    memoBodyRuns,
    memoUnitLabel,
    memoSuggestedAddressees,
    memoRecipientUsers,
    COMPLETION_STEPS,
    runCompletion,
} from "../../utils/rms/clearanceService.js";
import { getEmployeeTermination, getTerminationReasons } from "../../utils/rms/test.js";
import Experinace from "../../models/rms/Experiance_Letter.js";

// Exit clearance — mounted at /zbss/api/clearance.
//
// Two audiences use these routes with two different kinds of authority:
//   - the existing global roles: `user` (any employee) and `admin` (HR);
//   - clearance-specific authority resolved LIVE from the unit hierarchy and
//     the delegations in force today: "is this caller the employee's
//     supervisor, or standing in for them?", "may this caller sign this row?".
//     Those checks are never taken from a stored list — see clearanceService.

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

// HR opens the signatories: snapshot the form and the benefits statement,
// then tell everyone whose turn it now is.
const openSignatories = async (c, org, settings, by, now = new Date()) => {
    await ensureSeeded("system");
    const template = await ClearanceTemplate.findOne({ active: true }).lean();
    if (!template) throw new Error("No active clearance template");
    const r = openClearance(c, template, now);
    c.opened_by = lc(by);
    c.benefits = buildBenefits(settings, c, benefitsBranchUnit(org, settings, c));
    refreshSnapshots(org, settings, c, now);
    await c.save();

    await notifyNewlyPending(org, settings, c, r.newlyPending);
    await notifyUsers(
        [c.domain_user],
        payload("Your exit clearance is open", "Departments have been notified to sign.", "/user/clearance")
    );
    const fillers = benefitsFillers(org, settings, c, now);
    if (fillers.length) {
        await notifyUsers(
            fillers,
            payload(
                "Benefits statement to fill",
                `${c.employee_name} — the branch rows are yours to complete`,
                "/clearance/inbox",
                "clearance_benefits"
            )
        );
    } else {
        await notifyAdmins(
            payload(
                "No branch to fill the benefits statement",
                `${c.employee_name} — no branch manager resolved; HR may fill the branch rows`,
                "/admin/clearance/list",
                "clearance_benefits"
            )
        );
    }
    return r;
};

// Summary a list row or inbox item needs — never the whole document.
const summarize = (c) => {
    const tasks = c.tasks || [];
    const b = c.benefits || {};
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
        benefits_meta: {
            exists: !!(b.rows && b.rows.length),
            branch_unit_name: b.branch_unit_name || "",
            branch_unit_code: b.branch_unit_code || "",
            branch_submitted_at: b.branch_submitted_at || null,
            issued: !!b.issued,
            issued_at: b.issued_at || null,
        },
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

// Whether the caller may act as this clearance's supervisor today: the
// supervisor themselves, or whoever is standing in for them.
const supervisorActor = (org, c, me, now) => {
    const principal = lc(c.supervisor_user);
    if (!principal) return { allowed: false, actingFor: "" };
    const allowed = effectiveActors(org, [principal], now);
    if (!allowed.includes(me)) return { allowed: false, actingFor: "" };
    return { allowed: true, actingFor: me === principal ? "" : principal };
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

        const pendingSup = await Clearance.find({ status: "Pending Supervisor" }, { supervisor_user: 1, supervisor_unresolved: 1 }).lean();
        let approvals = pendingSup.filter((c) => supervisorActor(org, c, me.user, now).allowed).length;
        if (me.isAdmin) {
            approvals += await Clearance.countDocuments({ status: "Pending HR" });
            approvals += pendingSup.filter((c) => c.supervisor_unresolved).length;
        }

        const open = await Clearance.find(
            { status: { $in: ["Open", "Awaiting Final Approval"] } },
            { tasks: 1, domain_user: 1, supervisor_user: 1, benefits: 1, unit_kind: 1, unit_id: 1 }
        ).lean();
        let tasks = 0;
        let benefits = 0;
        open.forEach((c) => {
            (c.tasks || []).forEach((t) => {
                if (t.status !== "Pending" && t.status !== "Outstanding") return;
                if (t.signature_mode === "manual") {
                    if (me.isAdmin) tasks += 1;
                } else if (isSigner(org, settings, c, t, me.user, now)) {
                    tasks += 1;
                }
            });
            const b = c.benefits;
            if (b && b.rows && b.rows.length && !b.issued) {
                const fillers = benefitsFillers(org, settings, c, now);
                if (!b.branch_submitted_at && fillers.includes(me.user)) benefits += 1;
                else if (me.isAdmin && (b.branch_submitted_at || !fillers.length)) benefits += 1;
            }
        });

        return res.json({
            domain_user: me.user,
            name: me.name,
            is_admin: me.isAdmin,
            heads_units: headsUnits,
            manages: me.isAdmin || isManagerUser(org, settings, me.user, now),
            acting_for: principalsOf(org, me.user, now),
            pending: { approvals, tasks, benefits },
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
        return res.json({
            letter: renderResignationLetter(draft),
            parts: renderResignationLetterParts(draft),
            snapshot: snap,
            release_date: parsed.fields.release_date,
        });
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
        c.resignation_letter_parts = renderResignationLetterParts(c, now);
        await c.save();

        const body = `${c.employee_name} has submitted a resignation (release ${
            c.immediate ? "immediately" : c.release_date.toDateString()
        }).`;
        if (supervisor) {
            await notifyUsers(
                effectiveActors(org, [supervisor], now),
                payload("Resignation awaiting your approval", body, "/clearance/inbox")
            );
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
        c.resignation_letter_parts = renderResignationLetterParts(c, now);
        await c.save();

        const body = `${c.employee_name} has resubmitted their resignation.`;
        if (supervisor) {
            await notifyUsers(effectiveActors(org, [supervisor], now), payload("Resignation resubmitted", body, "/clearance/inbox"));
        } else {
            await notifyAdmins(payload("Resignation resubmitted (no supervisor mapped)", body, "/admin/clearance/list"));
        }

        return res.json({ error: false, clearance: summarize(c) });
    } catch (e) {
        return fail(res, "/resign/resubmit", e);
    }
});

// A resignation can be withdrawn right up until HR opens the signatories —
// supervisor and HR approval alone do not close the door.
router.post("/withdraw", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const c = await Clearance.findById(req.body && req.body.id);
        if (!c) return notFound(res, "Clearance not found");
        if (lc(c.domain_user) !== me.user) return forbidden(res, "Only the employee can withdraw");
        if (!["Pending Supervisor", "Pending HR", "Rejected", "Approved"].includes(c.status)) {
            return conflict(res, "The signatories are already open — ask HR to cancel the clearance instead.");
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
        const { org } = await ctx();

        if (c.status === "Pending Supervisor") {
            const sup = supervisorActor(org, c, me.user, now);
            if (!sup.allowed && !me.isAdmin) {
                return forbidden(res, "Only the immediate supervisor (or whoever stands in for them, or HR) can decide this");
            }
            const rec = {
                stage: "supervisor",
                decision,
                by: me.user,
                by_name: me.name,
                at: now,
                reason,
                on_behalf: !sup.allowed,
                acting_for: sup.actingFor,
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
                    payload("Supervisor approved your resignation", "It is now with HR for approval.", "/user/clearance")
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
            const rec = { stage: "hr", decision, by: me.user, by_name: me.name, at: now, reason, on_behalf: false, acting_for: "" };
            c.hr_decision = rec;
            c.decision_history.push(rec);
            if (decision === "approve") {
                // Approval does not open anything: HR opens the signatories
                // from the Open Signatories page, and until then the employee
                // may still withdraw.
                c.status = "Approved";
                c.approved_at = now;
                await c.save();
                await notifyUsers(
                    [c.domain_user],
                    payload(
                        "HR approved your resignation",
                        `Release ${c.immediate ? "immediately" : c.release_date.toDateString()}. HR will open the clearance signatories; until then you may still withdraw.`,
                        "/user/clearance"
                    )
                );
            } else {
                c.status = "Rejected";
                await c.save();
                await notifyUsers([c.domain_user], payload("Your resignation was not approved", `HR: ${reason}`, "/user/clearance"));
                if (c.supervisor_user) {
                    await notifyUsers(
                        effectiveActors(org, [c.supervisor_user], now),
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
        const { org } = await ctx();
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
        const rec = { stage: "hr", decision: "approve", by: me.user, by_name: me.name, at: now, reason: "", on_behalf: false, acting_for: "" };
        c.hr_decision = rec;
        c.decision_history.push(rec);
        await c.save();

        await notifyUsers(
            [domainUser],
            payload(
                "An exit clearance has been recorded for you",
                `${c.termination_type}. Release ${c.immediate ? "immediately" : c.release_date.toDateString()}. HR will open the signatories.`,
                "/user/clearance"
            )
        );
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

        const pendingSup = await Clearance.find({ status: "Pending Supervisor" }).sort({ submitted_at: 1 }).lean();
        const pendingHr = me.isAdmin ? await Clearance.find({ status: "Pending HR" }).sort({ submitted_at: 1 }).lean() : [];
        const approvals = [
            ...pendingSup.filter((c) => {
                const sup = supervisorActor(org, c, me.user, now);
                return sup.allowed || (me.isAdmin && c.supervisor_unresolved);
            }),
            ...pendingHr,
        ].map((c) => ({
            ...summarize(c),
            stage: c.status === "Pending HR" ? "hr" : "supervisor",
            acting_for: supervisorActor(org, c, me.user, now).actingFor,
            reason: c.reason,
            resignation_letter: c.resignation_letter,
            resignation_letter_parts: c.resignation_letter_parts || null,
        }));

        const open = await Clearance.find({ status: { $in: ["Open", "Awaiting Final Approval"] } })
            .sort({ opened_at: 1 })
            .lean();

        const tasks = [];
        const manual = [];
        const benefits = [];
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
                    // Which principal the caller acts for on this row, if any.
                    const principals = resolveSignerPrincipals(org, settings, c, t.signer_rule, now);
                    const map = actingMap(org, principals, now);
                    tasks.push({ ...row, acting_for: map[me.user] || "" });
                }
            });
            const b = c.benefits;
            if (b && b.rows && b.rows.length && !b.issued) {
                const fillers = benefitsFillers(org, settings, c, now);
                const item = {
                    clearance_id: c._id,
                    employee_name: c.employee_name,
                    domain_user: c.domain_user,
                    job_title: c.job_title,
                    release_date: c.release_date,
                    opened_at: c.opened_at,
                    branch_unit_name: b.branch_unit_name,
                    branch_unit_code: b.branch_unit_code,
                    branch_submitted_at: b.branch_submitted_at || null,
                };
                if (!b.branch_submitted_at && fillers.includes(me.user)) benefits.push({ ...item, stage: "branch" });
                else if (me.isAdmin && b.branch_submitted_at) benefits.push({ ...item, stage: "hr" });
                else if (me.isAdmin && !fillers.length) benefits.push({ ...item, stage: "branch", note: "no branch manager resolved — HR fills the branch rows" });
            }
        });

        const memos = (
            await ClearanceMemo.find({ status: "sent", recipients: me.user }).sort({ sent_at: -1 }).limit(50).lean()
        ).map(memoSummary);

        return res.json({ approvals, tasks, manual, benefits, memos, sla_days: settings.sla_days });
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
        if (!(caps.is_admin || caps.is_owner || caps.is_supervisor || caps.is_signer || caps.benefits.is_filler)) {
            return forbidden(res, "You have no part in this clearance");
        }

        refreshSnapshots(org, settings, c, now);
        const obj = c.toObject();

        // The benefits statement is the branch's and HR's until it is issued.
        if (obj.benefits && !caps.benefits.can_view) {
            obj.benefits = {
                rows: [],
                hidden: true,
                branch_unit_name: obj.benefits.branch_unit_name,
                branch_unit_code: obj.benefits.branch_unit_code,
                branch_submitted_at: obj.benefits.branch_submitted_at,
                issued: obj.benefits.issued,
                issued_at: obj.benefits.issued_at,
            };
        }

        // Display names for every username that appears on the form, and who
        // is standing in for whom today.
        const names = {};
        const acting = {};
        const all = new Set([obj.domain_user, obj.supervisor_user, obj.cleared_by, obj.created_by, obj.opened_by]);
        if (obj.supervisor_user) Object.assign(acting, actingMap(org, [obj.supervisor_user], now));
        (obj.tasks || []).forEach((t) => {
            (t.signers_snapshot || []).forEach((s) => all.add(s));
            Object.assign(acting, actingMap(org, resolveSignerPrincipals(org, settings, c, t.signer_rule, now), now));
            if (t.acted_by) all.add(t.acted_by);
            if (t.acted_for) all.add(t.acted_for);
            if (t.manual && t.manual.verified_by) all.add(t.manual.verified_by);
            (t.history || []).forEach((h) => h.by && all.add(h.by));
        });
        (obj.decision_history || []).forEach((d) => {
            if (d.by) all.add(d.by);
            if (d.acting_for) all.add(d.acting_for);
        });
        if (obj.benefits && obj.benefits.rows) {
            obj.benefits.rows.forEach((r) => r.filled_by_user && r.filled_by_user !== "system" && all.add(r.filled_by_user));
            [obj.benefits.branch_submitted_by, obj.benefits.hr_submitted_by, obj.benefits.issued_by].forEach((u) => u && all.add(u));
        }
        Object.keys(acting).forEach((d) => {
            all.add(d);
            all.add(acting[d]);
        });
        caps.benefits.fillers.forEach((u) => all.add(u));
        for (const u of all) {
            if (!u) continue;
            // eslint-disable-next-line no-await-in-loop
            names[u] = await displayName(u);
        }

        // Memos HR sent about this departure: HR sees all (drafts included);
        // recipients and the clearance's signatories see what was sent.
        const memoFilter = me.isAdmin
            ? { clearance_id: c._id }
            : caps.is_signer
              ? { clearance_id: c._id, status: "sent" }
              : { clearance_id: c._id, status: "sent", recipients: me.user };
        const memos = (await ClearanceMemo.find(memoFilter).sort({ createdAt: -1 }).lean()).map(memoSummary);

        // The generated experience letter, so the employee or HR can open it
        // in the ordinary letter view and print it.
        let experienceLetter = null;
        const expId = obj.completion && obj.completion.experience && obj.completion.experience.letter_id;
        if (expId && (caps.is_admin || caps.is_owner)) {
            experienceLetter = await Experinace.findById(expId).lean();
        }
        if (!(caps.is_admin || caps.is_owner)) obj.completion = undefined;

        return res.json({
            clearance: obj,
            viewer: caps,
            names,
            acting,
            memos,
            experience_letter: experienceLetter,
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
        // The last signature triggers the HRIS write, the guaranty
        // revocations and the experience letter. Each is recorded on the
        // clearance and can be retried from the detail page; none may fail
        // the response that just confirmed the signature.
        try {
            await runCompletion(c, me.user, settings);
            const failed = COMPLETION_STEPS.filter((k) => c.completion && c.completion[k] && c.completion[k].status === "failed");
            if (failed.length) {
                await notifyAdmins(
                    payload("Completion step needs attention", `${c.employee_name} — ${failed.join(", ")} did not complete`, "/admin/clearance/list", "clearance_completion")
                );
            }
        } catch (e) {
            console.error("[clearance] completion failed:", e);
        }
    }
    return res.json({ error: false, clearance: summarize(c), status: c.status, completion: c.completion || null });
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
        const principals = resolveSignerPrincipals(org, settings, c, t.signer_rule, now);
        const actedFor = actingMap(org, principals, now)[me.user] || "";

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
        t.acted_for = actedFor;
        t.acted_at = now;
        t.acted_ip = clientIp(req);
        t.acted_user_agent = String(req.headers["user-agent"] || "").slice(0, 300);
        t.history.push({
            at: now,
            by: me.user,
            action: "act",
            from,
            to: outcome,
            note: actedFor ? `${t.note} (acting for ${actedFor})`.trim() : t.note,
        });

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
                effectiveActors(org, users, now),
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
// the benefits statement
// ------------------------------------------------------------------

const benefitsGuard = async (req, res, me) => {
    const c = await Clearance.findById(req.body && req.body.id);
    if (!c) {
        notFound(res, "Clearance not found");
        return null;
    }
    if (c.status !== "Open" && c.status !== "Awaiting Final Approval") {
        conflict(res, `The clearance is ${c.status}`);
        return null;
    }
    if (!c.benefits || !c.benefits.rows || !c.benefits.rows.length) {
        conflict(res, "This clearance has no benefits statement");
        return null;
    }
    if (c.benefits.issued) {
        conflict(res, "The benefits statement has already been issued");
        return null;
    }
    const now = new Date();
    const { org, settings } = await ctx();
    const fillers = benefitsFillers(org, settings, c, now);
    return { c, now, org, settings, fillers, isFiller: fillers.includes(me.user) };
};

// The branch (or HR) fills rows: { id, values: { code: value } }.
router.post("/benefits/fill", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const g = await benefitsGuard(req, res, me);
        if (!g) return undefined;
        const values = (req.body && req.body.values) || {};
        if (!values || typeof values !== "object") return bad(res, "values must be an object of code → value");

        let touched = 0;
        for (const row of g.c.benefits.rows) {
            if (!(row.code in values)) continue;
            if (row.filled_by === "system") continue;
            if (row.filled_by === "branch" && !(g.isFiller || me.isAdmin)) {
                return forbidden(res, `"${row.label}" is the branch's to fill`);
            }
            if (row.filled_by === "hr" && !me.isAdmin) return forbidden(res, `"${row.label}" is HR's to fill`);
            const v = String(values[row.code] || "").trim().slice(0, 500);
            if (v !== row.value) {
                row.value = v;
                row.filled_by_user = me.user;
                row.filled_at = g.now;
                touched += 1;
            }
        }
        if (touched) {
            g.c.markModified("benefits");
            await g.c.save();
        }
        return res.json({ error: false, benefits: g.c.benefits, touched });
    } catch (e) {
        return fail(res, "/benefits/fill", e);
    }
});

// The branch hands its rows to HR.
router.post("/benefits/submit-branch", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const g = await benefitsGuard(req, res, me);
        if (!g) return undefined;
        if (!(g.isFiller || me.isAdmin)) return forbidden(res, "Only the branch manager (or HR) can submit the branch rows");
        if (!benefitsComplete(g.c.benefits, "branch")) return bad(res, "Fill every branch row first (write “None” where there is nothing).");
        g.c.benefits.branch_submitted_by = me.user;
        g.c.benefits.branch_submitted_at = g.now;
        g.c.markModified("benefits");
        await g.c.save();
        await notifyAdmins(
            payload("Benefits statement: branch rows submitted", `${g.c.employee_name} — HR rows are next`, "/clearance/inbox", "clearance_benefits")
        );
        return res.json({ error: false, benefits: g.c.benefits });
    } catch (e) {
        return fail(res, "/benefits/submit-branch", e);
    }
});

// HR issues the statement: from now on the signatories (and the employee) see it.
router.post("/benefits/issue", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const g = await benefitsGuard(req, res, me);
        if (!g) return undefined;
        if (!benefitsComplete(g.c.benefits, "branch") || !benefitsComplete(g.c.benefits, "hr")) {
            return bad(res, "Every branch and HR row must be filled before the statement is issued.");
        }
        const b = g.c.benefits;
        b.hr_submitted_by = me.user;
        b.hr_submitted_at = g.now;
        b.issued = true;
        b.issued_by = me.user;
        b.issued_at = g.now;
        g.c.markModified("benefits");
        await g.c.save();

        const signers = new Set();
        (g.c.tasks || []).forEach((t) => {
            if (t.status === "Pending" || t.status === "Outstanding") {
                resolveSignersForRule(g.org, g.settings, g.c, t.signer_rule, g.now).forEach((u) => signers.add(u));
            }
        });
        await notifyUsers(
            [...signers],
            payload("Benefits statement issued", `${g.c.employee_name} — the statement is now on the clearance form`, "/clearance/inbox", "clearance_benefits")
        );
        await notifyUsers([g.c.domain_user], payload("Your benefits statement has been issued", "It is now on your clearance.", "/user/clearance"));
        return res.json({ error: false, benefits: g.c.benefits });
    } catch (e) {
        return fail(res, "/benefits/issue", e);
    }
});

// ------------------------------------------------------------------
// inter-departmental memos
// ------------------------------------------------------------------

const cleanAddressees = (list) =>
    (Array.isArray(list) ? list : [])
        .map((e) => ({
            unit_id: e && e.unit_id ? e.unit_id : undefined,
            label: String((e && e.label) || "").trim().slice(0, 160),
        }))
        .filter((e) => e.label);

// Snapshot the parts of the memo that come from the clearance, so what was
// sent is what is kept even if the record changes afterwards.
const snapshotMemo = (memo, c) => {
    memo.body_runs = memoBodyRuns(memo.kind, c);
    memo.benefits_rows =
        memo.kind === "outstanding" && c.benefits && c.benefits.rows && c.benefits.rows.length
            ? c.benefits.rows.map((r) => ({ label: r.label, value: r.value || "" }))
            : [];
    memo.employee_name = c.employee_name;
    memo.domain_user = c.domain_user;
    memo.markModified("body_runs");
};

const memoSummary = (m) => ({
    _id: m._id,
    kind: m.kind,
    subject: m.subject,
    memo_date: m.memo_date,
    status: m.status,
    sent_at: m.sent_at || null,
    sent_by: m.sent_by || "",
    to_count: (m.to || []).length,
    cc_count: (m.cc || []).length,
    clearance_id: m.clearance_id,
    employee_name: m.employee_name,
    domain_user: m.domain_user,
});

// May this caller read this memo? HR always; the units it went to; anyone
// with a row on the clearance (the departments it concerns).
const canReadMemo = async (me, memo, now) => {
    if (me.isAdmin) return true;
    if (memo.status !== "sent") return false;
    if ((memo.recipients || []).includes(me.user)) return true;
    const c = await Clearance.findById(memo.clearance_id).lean();
    if (!c) return false;
    const { org, settings } = await ctx();
    return (c.tasks || []).some((t) => isSigner(org, settings, c, t, me.user, now));
};

router.get("/memo/presets", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const filter = MEMO_KINDS.includes(req.query.kind) ? { kind: req.query.kind } : {};
        const data = await ClearanceMemoPreset.find(filter).sort({ kind: 1, is_default: -1, name: 1 }).lean();
        return res.json({ data });
    } catch (e) {
        return fail(res, "/memo/presets", e);
    }
});

router.post("/memo/presets", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        const b = req.body || {};
        if (!MEMO_KINDS.includes(b.kind)) return bad(res, "kind must be resignation or outstanding");
        const name = String(b.name || "").trim().slice(0, 80);
        if (!name) return bad(res, "Give the preset a name");
        const to = cleanAddressees(b.to);
        if (!to.length) return bad(res, "A preset needs at least one To line");
        const isDefault = !!b.is_default;
        if (isDefault) await ClearanceMemoPreset.updateMany({ kind: b.kind, is_default: true }, { $set: { is_default: false } });
        const preset = await ClearanceMemoPreset.findOneAndUpdate(
            { kind: b.kind, name },
            {
                $set: { to, from_line: String(b.from_line || "").trim().slice(0, 200), cc: cleanAddressees(b.cc), is_default: isDefault, updated_by: me.user },
                $setOnInsert: { created_by: me.user },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();
        return res.status(201).json({ error: false, preset });
    } catch (e) {
        return fail(res, "POST /memo/presets", e);
    }
});

router.delete("/memo/presets/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const p = await ClearanceMemoPreset.findByIdAndDelete(req.params.id);
        if (!p) return notFound(res, "Preset not found");
        return res.json({ error: false });
    } catch (e) {
        return fail(res, "DELETE /memo/presets/:id", e);
    }
});

// Everything the composer needs to start: the generated body, a suggested
// (or default-preset) distribution list, the presets, and the unit registry.
router.get("/memo/compose/:clearanceId", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const kind = MEMO_KINDS.includes(req.query.kind) ? req.query.kind : "resignation";
        const c = await Clearance.findById(req.params.clearanceId).lean();
        if (!c) return notFound(res, "Clearance not found");
        const now = new Date();
        const { org } = await ctx();
        const presets = await ClearanceMemoPreset.find({ kind }).sort({ is_default: -1, name: 1 }).lean();
        const def = presets.find((p) => p.is_default);
        const suggested = memoSuggestedAddressees(kind, org, c);
        return res.json({
            clearance: summarize(c),
            kind,
            defaults: {
                memo_date: now,
                subject: memoSubject(kind, c),
                from_line: def && def.from_line ? def.from_line : MEMO_FROM_DEFAULT,
                to: def ? def.to : suggested.to,
                cc: def ? def.cc : suggested.cc,
                preset_id: def ? def._id : null,
            },
            body_runs: memoBodyRuns(kind, c),
            benefits_rows:
                kind === "outstanding" && c.benefits && c.benefits.rows
                    ? c.benefits.rows.map((r) => ({ label: r.label, value: r.value || "" }))
                    : [],
            benefits_issued: !!(c.benefits && c.benefits.issued),
            employee_name: c.employee_name,
            presets,
            units: unitsForPicker(org),
            unit_labels: {
                departments: org.units.filter((u) => u.kind === "department" && u.active !== false).map((u) => ({ _id: u._id, label: memoUnitLabel(kind, u) })),
                branches: org.units.filter((u) => u.kind === "branch" && u.active !== false).map((u) => ({ _id: u._id, label: memoUnitLabel(kind, u) })),
            },
        });
    } catch (e) {
        return fail(res, "/memo/compose", e);
    }
});

const applyMemoFields = (memo, b) => {
    if (b.memo_date !== undefined) {
        const d = parseDate(b.memo_date);
        if (d) memo.memo_date = d;
    }
    if (b.to !== undefined) memo.to = cleanAddressees(b.to);
    if (b.cc !== undefined) memo.cc = cleanAddressees(b.cc);
    if (b.from_line !== undefined) memo.from_line = String(b.from_line || "").trim().slice(0, 200);
    if (b.subject !== undefined) memo.subject = String(b.subject || "").trim().slice(0, 200);
};

const sendMemo = async (memo, c, me, org, now) => {
    snapshotMemo(memo, c);
    memo.recipients = memoRecipientUsers(org, [...(memo.to || []), ...(memo.cc || [])], now);
    memo.status = "sent";
    memo.sent_by = me.user;
    memo.sent_at = now;
    memo.updated_by = me.user;
    await memo.save();
    await notifyUsers(
        memo.recipients,
        payload(
            `Memo: ${memo.subject}`,
            `${memo.employee_name} — from ${memo.from_line || "HR"}`,
            "/clearance/inbox",
            "clearance_memo"
        )
    );
};

router.post("/memo", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const b = req.body || {};
        if (!MEMO_KINDS.includes(b.kind)) return bad(res, "kind must be resignation or outstanding");
        const c = await Clearance.findById(b.clearance_id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status === "Cancelled") return conflict(res, "The clearance is cancelled");
        const memo = new ClearanceMemo({
            clearance_id: c._id,
            kind: b.kind,
            memo_date: new Date(),
            subject: memoSubject(b.kind, c),
            from_line: MEMO_FROM_DEFAULT,
            created_by: me.user,
            updated_by: me.user,
        });
        applyMemoFields(memo, b);
        if (!memo.to.length) return bad(res, "Add at least one To line");
        if (!memo.subject) return bad(res, "The memo needs a subject");
        snapshotMemo(memo, c);
        const now = new Date();
        if (b.send) {
            const { org } = await ctx();
            await sendMemo(memo, c, me, org, now);
        } else {
            await memo.save();
        }
        return res.status(201).json({ error: false, memo: memo.toObject() });
    } catch (e) {
        return fail(res, "POST /memo", e);
    }
});

router.patch("/memo/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const memo = await ClearanceMemo.findById(req.params.id);
        if (!memo) return notFound(res, "Memo not found");
        if (memo.status !== "draft") return conflict(res, "A sent memo cannot be edited — compose a new one");
        applyMemoFields(memo, req.body || {});
        if (!memo.to.length) return bad(res, "Add at least one To line");
        if (!memo.subject) return bad(res, "The memo needs a subject");
        memo.updated_by = me.user;
        await memo.save();
        return res.json({ error: false, memo: memo.toObject() });
    } catch (e) {
        return fail(res, "PATCH /memo/:id", e);
    }
});

router.post("/memo/:id/send", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const memo = await ClearanceMemo.findById(req.params.id);
        if (!memo) return notFound(res, "Memo not found");
        if (memo.status === "sent") return conflict(res, "Already sent");
        const c = await Clearance.findById(memo.clearance_id);
        if (!c) return notFound(res, "Clearance not found");
        const { org } = await ctx();
        await sendMemo(memo, c, me, org, new Date());
        return res.json({ error: false, memo: memo.toObject() });
    } catch (e) {
        return fail(res, "POST /memo/:id/send", e);
    }
});

router.delete("/memo/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const memo = await ClearanceMemo.findById(req.params.id);
        if (!memo) return notFound(res, "Memo not found");
        if (memo.status !== "draft") return conflict(res, "Only a draft can be deleted");
        await memo.deleteOne();
        return res.json({ error: false });
    } catch (e) {
        return fail(res, "DELETE /memo/:id", e);
    }
});

router.get("/memo/:id", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const memo = await ClearanceMemo.findById(req.params.id).lean();
        if (!memo) return notFound(res, "Memo not found");
        if (!(await canReadMemo(me, memo, new Date()))) return forbidden(res, "This memo was not sent to you");
        const names = {};
        for (const u of [memo.sent_by, memo.created_by, ...(memo.recipients || [])]) {
            if (!u || names[u]) continue;
            // eslint-disable-next-line no-await-in-loop
            names[u] = await displayName(u);
        }
        return res.json({ memo, names });
    } catch (e) {
        return fail(res, "/memo/:id", e);
    }
});

// ------------------------------------------------------------------
// completion: HRIS, guaranties, experience letter
// ------------------------------------------------------------------

// Re-run one or all of the completion steps on a Cleared clearance. `force`
// lets the HRIS step overwrite a termination date HR had already recorded.
router.post("/completion/run", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const { id, step } = req.body || {};
        const c = await Clearance.findById(id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status !== "Cleared") return conflict(res, `Completion steps run only on a Cleared clearance (this one is ${c.status})`);
        if (step && !COMPLETION_STEPS.includes(step)) return bad(res, `step must be one of ${COMPLETION_STEPS.join(", ")}`);
        const settings = await ClearanceSettings.get();
        const completion = await runCompletion(c, me.user, settings, { only: step, force: !!(req.body && req.body.force) });
        return res.json({ error: false, completion });
    } catch (e) {
        return fail(res, "/completion/run", e);
    }
});

// What HRIS currently holds for this employee — to confirm the write landed.
router.get("/completion/hris/:clearanceId", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const c = await Clearance.findById(req.params.clearanceId).lean();
        if (!c) return notFound(res, "Clearance not found");
        const row = await getEmployeeTermination(c.domain_user, c.employee_id);
        return res.json({ hris: row });
    } catch (e) {
        return fail(res, "/completion/hris", e);
    }
});

// The termination reason codes HRIS knows, for the Settings screen.
router.get("/hris/termination-reasons", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        return res.json({ data: await getTerminationReasons() });
    } catch (e) {
        return fail(res, "/hris/termination-reasons", e);
    }
});

// ------------------------------------------------------------------
// delegations
// ------------------------------------------------------------------

const decorateDelegation = async (d, now) => ({
    ...d,
    delegator_name: await displayName(d.delegator),
    delegate_name: await displayName(d.delegate),
    in_window: d.active !== false && inWindow(d.valid_from, d.valid_to, now),
    expired: !!d.valid_to && new Date(d.valid_to) < now,
});

router.get("/delegations", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const now = new Date();
        const all = me.isAdmin && String(req.query.all) === "1";
        const filter = all ? {} : { $or: [{ delegator: me.user }, { delegate: me.user }] };
        const rows = await ClearanceDelegation.find(filter).sort({ valid_from: -1 }).lean();
        const out = [];
        for (const d of rows) {
            // eslint-disable-next-line no-await-in-loop
            out.push(await decorateDelegation(d, now));
        }
        return res.json({ data: out });
    } catch (e) {
        return fail(res, "/delegations", e);
    }
});

router.post("/delegations", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const b = req.body || {};
        const delegator = me.isAdmin && b.delegator ? lc(b.delegator) : me.user;
        const delegate = lc(b.delegate);
        if (!delegate) return bad(res, "Pick who will act for you");
        if (delegate === delegator) return bad(res, "You cannot delegate to yourself");
        const idx = await userIndex();
        if (!idx.get(delegate)) return notFound(res, `No portal user named "${delegate}"`);
        if (!idx.get(delegator)) return notFound(res, `No portal user named "${delegator}"`);
        const from = parseDate(b.valid_from);
        const to = parseDate(b.valid_to);
        if (!from || !to) return bad(res, "Give a start and an end date");
        if (to < from) return bad(res, "The end date is before the start date");
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);

        // One delegation in force at a time per person: overlapping ones would
        // make "who acts for me" ambiguous.
        const overlap = await ClearanceDelegation.findOne({
            delegator,
            active: true,
            valid_from: { $lte: end },
            valid_to: { $gte: from },
        }).lean();
        if (overlap) return conflict(res, "A delegation already covers part of that period. End it first.");

        const d = await ClearanceDelegation.create({
            delegator,
            delegate,
            valid_from: from,
            valid_to: end,
            reason: String(b.reason || "").trim().slice(0, 500),
            created_by: me.user,
        });
        await notifyUsers(
            [delegate],
            payload(
                "You have been delegated clearance authority",
                `${await displayName(delegator)} — ${from.toDateString()} to ${end.toDateString()}`,
                "/clearance/delegate",
                "clearance_delegation"
            )
        );
        return res.status(201).json({ error: false, delegation: await decorateDelegation(d.toObject(), new Date()) });
    } catch (e) {
        return fail(res, "POST /delegations", e);
    }
});

// Shorten, extend or end a delegation. Its holder, or HR.
router.patch("/delegations/:id", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const d = await ClearanceDelegation.findById(req.params.id);
        if (!d) return notFound(res, "Delegation not found");
        if (!me.isAdmin && lc(d.delegator) !== me.user) return forbidden(res, "Only the person who delegated (or HR) can change it");
        const b = req.body || {};
        if (b.valid_to !== undefined) {
            const to = parseDate(b.valid_to);
            if (!to) return bad(res, "Invalid end date");
            const end = new Date(to);
            end.setHours(23, 59, 59, 999);
            if (end < d.valid_from) return bad(res, "The end date is before the start date");
            d.valid_to = end;
        }
        if (b.active !== undefined) d.active = !!b.active;
        if (b.end_now) {
            d.valid_to = new Date();
            d.active = false;
        }
        d.updated_by = me.user;
        await d.save();
        return res.json({ error: false, delegation: await decorateDelegation(d.toObject(), new Date()) });
    } catch (e) {
        return fail(res, "PATCH /delegations/:id", e);
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
        const sort = req.query.status === "Approved" ? { release_date: 1 } : { createdAt: -1 };
        const [rows, total] = await Promise.all([
            Clearance.find(filter)
                .sort(sort)
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

// HR opens the signatories for an approved departure. This is the gate the
// clock never passes on its own.
router.post("/open-now", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const c = await Clearance.findById(req.body && req.body.id);
        if (!c) return notFound(res, "Clearance not found");
        if (c.status !== "Approved") return conflict(res, `Only an Approved clearance can be opened (this one is ${c.status})`);
        const { org, settings } = await ctx();
        await openSignatories(c, org, settings, me.user, new Date());
        return res.json({ error: false, clearance: summarize(c) });
    } catch (e) {
        return fail(res, "/open-now", e);
    }
});

// ------------------------------------------------------------------
// org: units (departments + the branch registry) and the reporting tree
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

// HR appointing a unit's head is also that head's node in the tree — a
// Director sits at the top of the department, a Branch Manager at the top of
// the branch. Kept in step here so the tree never disagrees with the unit.
const syncHeadNode = async (unit, settings, by) => {
    const label = headRoleFor(settings, unit.kind);
    if (unit.head_user) {
        await ClearanceUnitMember.findOneAndUpdate(
            { unit_id: unit._id, domain_user: lc(unit.head_user) },
            {
                $set: {
                    role_in_unit: label,
                    reports_to: lc(unit.head_reports_to),
                    valid_from: unit.head_valid_from,
                    valid_to: unit.head_valid_to,
                    active: unit.active !== false,
                    can_sign_clearance: true,
                    updated_by: by,
                },
                $setOnInsert: { registered_by: by },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }
    // A unit has one head: anyone else holding the head role there steps down.
    await ClearanceUnitMember.updateMany(
        { unit_id: unit._id, role_in_unit: label, active: true, domain_user: { $ne: lc(unit.head_user) } },
        { $set: { active: false, updated_by: by } }
    );
};

// The other direction: a manager registering a Branch Manager for a branch
// (or HR registering a Director) makes that person the unit's head.
const syncUnitHeadFromNode = async (node, settings, by) => {
    const info = roleInfo(settings, node.role_in_unit);
    if (!info.unit_head_for) return;
    const unit = await ClearanceUnit.findById(node.unit_id);
    if (!unit || unit.kind !== info.unit_head_for) return;
    if (node.active !== false) {
        unit.head_user = lc(node.domain_user);
        unit.head_valid_from = node.valid_from;
        unit.head_valid_to = node.valid_to;
        unit.head_reports_to = lc(node.reports_to);
        unit.updated_by = by;
        await unit.save();
        await ClearanceUnitMember.updateMany(
            { unit_id: unit._id, role_in_unit: node.role_in_unit, active: true, _id: { $ne: node._id } },
            { $set: { active: false, updated_by: by } }
        );
    } else if (lc(unit.head_user) === lc(node.domain_user)) {
        unit.head_user = "";
        unit.updated_by = by;
        await unit.save();
    }
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
        await syncHeadNode(u, await ClearanceSettings.get(), me.user);
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
        await syncHeadNode(u, await ClearanceSettings.get(), me.user);
        return res.json({ error: false, unit: (await decorateUnits([u.toObject()]))[0] });
    } catch (e) {
        return fail(res, "PATCH /units/:id", e);
    }
});

// Admin, or the unit's head while their appointment is in force.
const canManageUnit = (me, unit, now = new Date()) =>
    me.isAdmin || (lc(unit.head_user) === me.user && unit.active !== false && inWindow(unit.head_valid_from, unit.head_valid_to, now));

// Everyone registered in a unit, flat. The tree is the better view; this is
// for a unit that has no head yet.
router.get("/units/:id/members", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const u = await ClearanceUnit.findById(req.params.id).lean();
        if (!u) return notFound(res, "Unit not found");
        if (!canManageUnit(me, u)) return forbidden(res, "Only the unit head (while appointed) or HR can view members");
        const now = new Date();
        const { org } = await ctx();
        const members = (org.membersByUnit.get(String(u._id)) || []).sort((a, b) =>
            String(a.domain_user).localeCompare(String(b.domain_user))
        );
        const out = [];
        for (const m of members) {
            out.push({
                ...summarizeNode(org, m, now),
                name: await displayName(m.domain_user),
                reports_to_name: m.reports_to ? await displayName(m.reports_to) : "",
            });
        }
        return res.json({ unit: (await decorateUnits([u]))[0], data: out });
    } catch (e) {
        return fail(res, "/units/:id/members", e);
    }
});

// Lightweight user lookup for pickers. Any signed-in user may search — a
// manager needs it to register their staff.
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

// ---- the reporting tree ----

const unitsForPicker = (org) => ({
    departments: org.units
        .filter((u) => u.kind === "department" && u.active !== false)
        .map((u) => ({ _id: u._id, name: u.name, code: u.code, kind: u.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    branches: org.units
        .filter((u) => u.kind === "branch" && u.active !== false)
        .map((u) => ({ _id: u._id, name: u.name, code: u.code, kind: u.kind }))
        .sort((a, b) => a.code.localeCompare(b.code)),
});

const chainWithNames = async (org, settings, user, now) => {
    const out = [];
    for (const u of chainOf(org, user, now)) {
        const m = resolveMembership(org, u, now);
        out.push({
            user: u,
            name: await displayName(u),
            role: m ? m.member.role_in_unit : headsAnyUnit(org, u, now) ? "Unit head" : "",
            unit_name: m && m.unit ? m.unit.name : "",
            acting: actingFor(org, u, now),
        });
    }
    return out;
};

// Where I sit, who I report to (all the way up), what I may build beneath me.
router.get("/org/me", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const now = new Date();
        const { org, settings } = await ctx();
        const m = resolveMembership(org, me.user, now);
        const manages = me.isAdmin || isManagerUser(org, settings, me.user, now);
        return res.json({
            me: { user: me.user, name: me.name, is_admin: me.isAdmin, node: summarizeNode(org, m ? m.member : null, now) },
            supervisor: resolveSupervisor(org, me.user, now),
            chain: await chainWithNames(org, settings, me.user, now),
            manages,
            heads_units: org.units
                .filter((u) => lc(u.head_user) === me.user && u.active !== false && inWindow(u.head_valid_from, u.head_valid_to, now))
                .map((u) => ({ _id: u._id, name: u.name, code: u.code, kind: u.kind })),
            roles: settings.roles && settings.roles.length ? settings.roles : DEFAULT_ROLES,
            units: unitsForPicker(org),
            tree: manages ? await buildTree(org, settings, me.user, { me: me.user, isAdmin: me.isAdmin }, now) : null,
        });
    } catch (e) {
        return fail(res, "/org/me", e);
    }
});

// The tree beneath any person: HR anyone, otherwise myself or someone beneath me.
router.get("/org/tree/:user", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const target = lc(req.params.user);
        const now = new Date();
        const { org, settings } = await ctx();
        if (!me.isAdmin && target !== me.user && !canManageUser(org, settings, me.user, target, now)) {
            return forbidden(res, "You can only view the tree beneath yourself");
        }
        return res.json({
            tree: await buildTree(org, settings, target, { me: me.user, isAdmin: me.isAdmin }, now),
            chain: await chainWithNames(org, settings, target, now),
            roles: settings.roles && settings.roles.length ? settings.roles : DEFAULT_ROLES,
            units: unitsForPicker(org),
        });
    } catch (e) {
        return fail(res, "/org/tree/:user", e);
    }
});

// "Who is this person's supervisor?" — the reporting line, top to bottom.
router.get("/org/chain/:user", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const target = lc(req.params.user);
        const now = new Date();
        const { org, settings } = await ctx();
        if (!me.isAdmin && target !== me.user && !canManageUser(org, settings, me.user, target, now)) {
            return forbidden(res, "You can only look up people beneath yourself");
        }
        const m = resolveMembership(org, target, now);
        return res.json({
            user: target,
            name: await displayName(target),
            node: summarizeNode(org, m ? m.member : null, now),
            supervisor: resolveSupervisor(org, target, now),
            chain: await chainWithNames(org, settings, target, now),
        });
    } catch (e) {
        return fail(res, "/org/chain/:user", e);
    }
});

const nodeFromBody = (body, out = {}) => {
    if (body.role_in_unit !== undefined) out.role_in_unit = String(body.role_in_unit || "").trim();
    if (body.reports_to !== undefined) out.reports_to = lc(body.reports_to);
    if (body.unit_id !== undefined) out.unit_id = body.unit_id || undefined;
    if (body.can_sign_clearance !== undefined) out.can_sign_clearance = !!body.can_sign_clearance;
    if (body.valid_from !== undefined) out.valid_from = parseDate(body.valid_from) || undefined;
    if (body.valid_to !== undefined) out.valid_to = parseDate(body.valid_to) || undefined;
    if (body.active !== undefined) out.active = !!body.active;
    return out;
};

// Register a person in the tree (or move them). A person holds one position:
// registering them elsewhere retires the old one.
router.post("/org/node", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const body = req.body || {};
        const domainUser = lc(body.domain_user);
        if (!domainUser) return bad(res, "domain_user is required");
        const idx = await userIndex();
        if (!idx.get(domainUser)) return notFound(res, `No portal user named "${domainUser}"`);

        const fields = nodeFromBody(body);
        if (!fields.role_in_unit) return bad(res, "Pick a role");
        if (!fields.unit_id) return bad(res, "Pick the person's unit (department or branch)");
        const unit = await ClearanceUnit.findById(fields.unit_id).lean();
        if (!unit || unit.active === false) return notFound(res, "Unit not found");
        const reportsTo = fields.reports_to || "";
        if (reportsTo && !idx.get(reportsTo)) return notFound(res, `No portal user named "${reportsTo}"`);

        const now = new Date();
        const { org, settings } = await ctx();
        if (!me.isAdmin) {
            if (!reportsTo) return forbidden(res, "Only HR can register a person with no manager");
            if (!canRegisterUnder(org, settings, me.user, reportsTo, now)) {
                return forbidden(res, "You can register people under yourself, or under a manager beneath you");
            }
        }
        if (reportsTo && wouldCycle(org, domainUser, reportsTo, now)) {
            return bad(res, "That would make the person their own manager (a loop in the reporting line)");
        }

        // One position per person.
        await ClearanceUnitMember.updateMany(
            { domain_user: domainUser, unit_id: { $ne: unit._id }, active: true },
            { $set: { active: false, updated_by: me.user } }
        );
        const node = await ClearanceUnitMember.findOneAndUpdate(
            { unit_id: unit._id, domain_user: domainUser },
            {
                $set: {
                    ...fields,
                    unit_id: unit._id,
                    reports_to: reportsTo,
                    active: fields.active !== undefined ? fields.active : true,
                    updated_by: me.user,
                },
                $setOnInsert: { registered_by: me.user },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        await syncUnitHeadFromNode(node, settings, me.user);
        const fresh = await loadOrg();
        return res.status(201).json({
            error: false,
            node: { ...summarizeNode(fresh, node.toObject(), now), name: await displayName(domainUser) },
        });
    } catch (e) {
        return fail(res, "POST /org/node", e);
    }
});

router.patch("/org/node/:id", auth, roleCheck(["user", "admin"]), async (req, res) => {
    try {
        const me = await whoami(req);
        if (!me) return notFound(res, "User not found");
        const node = await ClearanceUnitMember.findById(req.params.id);
        if (!node) return notFound(res, "Registration not found");
        const now = new Date();
        const { org, settings } = await ctx();
        if (!me.isAdmin && !canManageUser(org, settings, me.user, node.domain_user, now)) {
            return forbidden(res, "You can only edit people beneath you");
        }
        const fields = nodeFromBody(req.body || {});
        if (fields.reports_to !== undefined && fields.reports_to !== lc(node.reports_to)) {
            const idx = await userIndex();
            if (fields.reports_to && !idx.get(fields.reports_to)) return notFound(res, `No portal user named "${fields.reports_to}"`);
            if (!me.isAdmin && !canRegisterUnder(org, settings, me.user, fields.reports_to, now)) {
                return forbidden(res, "You can only move people under yourself or under a manager beneath you");
            }
            if (fields.reports_to && wouldCycle(org, node.domain_user, fields.reports_to, now)) {
                return bad(res, "That would make the person their own manager (a loop in the reporting line)");
            }
        }
        if (fields.unit_id !== undefined && String(fields.unit_id) !== String(node.unit_id)) {
            const unit = await ClearanceUnit.findById(fields.unit_id).lean();
            if (!unit || unit.active === false) return notFound(res, "Unit not found");
            await ClearanceUnitMember.updateMany(
                { domain_user: node.domain_user, unit_id: { $ne: unit._id }, active: true, _id: { $ne: node._id } },
                { $set: { active: false, updated_by: me.user } }
            );
        }
        Object.assign(node, fields, { updated_by: me.user });
        await node.save();
        await syncUnitHeadFromNode(node, settings, me.user);
        const fresh = await loadOrg();
        return res.json({
            error: false,
            node: { ...summarizeNode(fresh, node.toObject(), now), name: await displayName(node.domain_user) },
        });
    } catch (e) {
        return fail(res, "PATCH /org/node/:id", e);
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
        const branches = await ClearanceUnit.find({ kind: "branch", active: true }, { name: 1, code: 1 }).sort({ code: 1 }).lean();
        const service = obj.service_branch_id ? branches.find((b) => String(b._id) === String(obj.service_branch_id)) : null;
        return res.json({
            settings: obj,
            ceo_name: obj.ceo_user ? await displayName(obj.ceo_user) : "",
            ceo_delegate_name: obj.ceo_delegate_user ? await displayName(obj.ceo_delegate_user) : "",
            delegate_active: !!obj.ceo_delegate_user && inWindow(obj.ceo_delegate_from, obj.ceo_delegate_to),
            branches,
            service_branch: service ? { _id: service._id, code: service.code, name: service.name } : null,
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
        if (b.roles !== undefined) {
            if (!Array.isArray(b.roles) || !b.roles.length) return bad(res, "At least one role is required");
            const seen = new Set();
            const roles = [];
            for (const r of b.roles) {
                const label = String((r && r.label) || "").trim();
                if (!label) return bad(res, "Every role needs a label");
                const k = label.toLowerCase();
                if (seen.has(k)) return bad(res, `Role "${label}" is listed twice`);
                seen.add(k);
                const uh = ["", "department", "branch"].includes(r.unit_head_for) ? r.unit_head_for : "";
                roles.push({ label, manages: !!r.manages, unit_head_for: uh });
            }
            if (
                roles.filter((r) => r.unit_head_for === "department").length > 1 ||
                roles.filter((r) => r.unit_head_for === "branch").length > 1
            ) {
                return bad(res, "Only one role can head a department, and only one a branch");
            }
            s.roles = roles;
        }
        if (b.benefits_rows !== undefined) {
            if (!Array.isArray(b.benefits_rows) || !b.benefits_rows.length) return bad(res, "The benefits statement needs at least one row");
            const seen = new Set();
            const rows = [];
            for (const r of b.benefits_rows) {
                const label = String((r && r.label) || "").trim();
                if (!label) return bad(res, "Every benefits row needs a label");
                const code = String((r && r.code) || "").trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
                if (seen.has(code)) return bad(res, `Benefits row code "${code}" is used twice`);
                seen.add(code);
                const filled_by = ["system", "branch", "hr"].includes(r.filled_by) ? r.filled_by : "hr";
                const system_source = filled_by === "system" && ["date_of_employment", "release_date"].includes(r.system_source) ? r.system_source : "";
                if (filled_by === "system" && !system_source) return bad(res, `Row "${label}": a system row needs a source (date of employment or release date)`);
                rows.push({ code, label, filled_by, system_source });
            }
            s.benefits_rows = rows;
        }
        if (b.completion !== undefined && b.completion && typeof b.completion === "object") {
            const cur = s.completion || {};
            const next = {
                hris_write: b.completion.hris_write !== undefined ? !!b.completion.hris_write : cur.hris_write !== false,
                hris_disable_login: b.completion.hris_disable_login !== undefined ? !!b.completion.hris_disable_login : cur.hris_disable_login !== false,
                revoke_guaranties: b.completion.revoke_guaranties !== undefined ? !!b.completion.revoke_guaranties : cur.revoke_guaranties !== false,
                experience_letter: b.completion.experience_letter !== undefined ? !!b.completion.experience_letter : cur.experience_letter !== false,
                reason_codes: { ...(cur.reason_codes || {}) },
            };
            if (b.completion.reason_codes && typeof b.completion.reason_codes === "object") {
                for (const t of TERMINATION_TYPES) {
                    if (!(t in b.completion.reason_codes)) continue;
                    const v = b.completion.reason_codes[t];
                    if (v === null || v === "" || v === undefined) next.reason_codes[t] = null;
                    else {
                        const n = Number(v);
                        if (!Number.isFinite(n)) return bad(res, `Reason code for ${t} must be a number`);
                        next.reason_codes[t] = n;
                    }
                }
            }
            s.completion = next;
            s.markModified("completion");
        }
        if (b.service_branch_id !== undefined) {
            if (!b.service_branch_id) {
                s.service_branch_id = undefined;
            } else {
                const branch = await ClearanceUnit.findById(b.service_branch_id).lean();
                if (!branch || branch.kind !== "branch") return bad(res, "The service branch must be a branch from the registry");
                s.service_branch_id = branch._id;
            }
        }
        s.updated_by = me.user;
        await s.save();
        return res.json({ error: false, settings: s.toObject() });
    } catch (e) {
        return fail(res, "PUT /settings", e);
    }
});

export default router;

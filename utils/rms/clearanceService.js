// Exit clearance: the logic behind the routes.
//
// Everything that decides *who* may act, *which* rows a form gets, *when* a
// row opens and *what* the overall status is lives here as functions that take
// plain data and return plain data. The routes fetch, call these, and save.
// That split is deliberate: the resolution and dependency rules are the part
// of this module most likely to be wrong in a subtle way, and functions with no
// database in them can be exercised exhaustively in a test.
//
// Terminology:
//   org      — every active ClearanceUnit and ClearanceUnitMember, indexed
//   rule     — a task's signer_rule { mode, unit_id, users }
//   window   — a from/to validity pair; "in window" means today is inside it

import User from "../../models/rms/User.js";
import Clearance from "../../models/rms/Clearance.js";
import ClearanceUnit from "../../models/rms/ClearanceUnit.js";
import ClearanceUnitMember from "../../models/rms/ClearanceUnitMember.js";
import ClearanceTemplate from "../../models/rms/ClearanceTemplate.js";
import ClearanceSettings, { DEFAULT_ROLES } from "../../models/rms/ClearanceSettings.js";
import ClearanceCounter from "../../models/rms/ClearanceCounter.js";
import PushNotificationService from "./pushNotificationService.js";
import { getEmployeeIdentity } from "./test.js";

// ------------------------------------------------------------------
// small helpers
// ------------------------------------------------------------------

export const lc = (s) => String(s || "").trim().toLowerCase();

export const inWindow = (from, to, now = new Date()) => {
    if (from && new Date(from) > now) return false;
    if (to && new Date(to) < now) return false;
    return true;
};

const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

const properCase = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/(^|[\s\-'/])([a-z])/g, (m, p, c) => p + c.toUpperCase())
        .trim();

export const fmtLongDate = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

// Start of the given calendar day in East Africa Time (UTC+3, no DST), as a
// UTC instant. Release dates are "a day", and a day in Addis starts at
// 21:00 UTC the evening before.
export const startOfDayEAT = (d) => {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const eat = new Date(dt.getTime() + 3 * 3600 * 1000);
    const y = eat.getUTCFullYear();
    const m = eat.getUTCMonth();
    const day = eat.getUTCDate();
    return new Date(Date.UTC(y, m, day, 0, 0, 0) - 3 * 3600 * 1000);
};

// ------------------------------------------------------------------
// org: the reporting tree, loaded once per request and resolved in memory
// ------------------------------------------------------------------
//
// Every registered person is a NODE: who they report to, the role they hold,
// and the unit (department or branch) they belong to, inside a validity
// window. A department's tree starts at its Director; beneath sit district
// managers, division managers, branch managers and heads, each with people
// beneath them in turn — Branch Management, for instance, has two district
// managers whose branch managers each register their own branch staff.
//
// Two rules make the tree maintainable without HR typing 2,500 names:
//   - anyone whose ROLE manages may register people under themselves, and may
//     edit anyone anywhere beneath them (a Director can fix a branch);
//   - HR may do anything.
//
// The Immediate Supervisor of a person is their node's reports_to. That is the
// whole reason the tree exists.

export { DEFAULT_ROLES };

const rolesOf = (settings) =>
    settings && Array.isArray(settings.roles) && settings.roles.length ? settings.roles : DEFAULT_ROLES;

export const roleInfo = (settings, label) => {
    const hit = rolesOf(settings).find((r) => lc(r.label) === lc(label));
    if (hit) return hit;
    // Values from the module's first cut, before roles were configurable.
    const l = lc(label);
    if (l === "manager" || l === "deputy") return { label, manages: true, unit_head_for: "" };
    return { label: label || "", manages: false, unit_head_for: "" };
};

export const roleManages = (settings, label) => !!roleInfo(settings, label).manages;

// The role that heads a unit of this kind ("Director" for a department,
// "Branch Manager" for a branch), as configured.
export const headRoleFor = (settings, kind) => {
    const r = rolesOf(settings).find((x) => x.unit_head_for === kind);
    return r ? r.label : kind === "branch" ? "Branch Manager" : "Director";
};

export const indexOrg = (units, members) => {
    const unitsById = new Map();
    units.forEach((u) => unitsById.set(String(u._id), u));

    const membersByUser = new Map();
    const membersByUnit = new Map();
    const childrenByManager = new Map();
    members.forEach((m) => {
        const u = lc(m.domain_user);
        if (!membersByUser.has(u)) membersByUser.set(u, []);
        membersByUser.get(u).push(m);
        const k = String(m.unit_id);
        if (!membersByUnit.has(k)) membersByUnit.set(k, []);
        membersByUnit.get(k).push(m);
        const boss = lc(m.reports_to);
        if (boss) {
            if (!childrenByManager.has(boss)) childrenByManager.set(boss, []);
            childrenByManager.get(boss).push(m);
        }
    });

    return { units, unitsById, membersByUser, membersByUnit, childrenByManager };
};

export const loadOrg = async () => {
    const [units, members] = await Promise.all([
        ClearanceUnit.find({ active: true }).lean(),
        ClearanceUnitMember.find({ active: true }).lean(),
    ]);
    return indexOrg(units, members);
};

// The person's current position: their in-window node and its unit. When a
// person has more than one active node, the most recently valid one wins.
export const resolveMembership = (org, user, now = new Date()) => {
    const list = org.membersByUser.get(lc(user)) || [];
    const candidates = list
        .filter((m) => m.active !== false && inWindow(m.valid_from, m.valid_to, now))
        .map((m) => ({ member: m, unit: org.unitsById.get(String(m.unit_id)) }))
        .filter((x) => x.unit && x.unit.active !== false);
    if (!candidates.length) return null;
    candidates.sort(
        (a, b) =>
            new Date(b.member.valid_from || b.member.createdAt || 0) -
            new Date(a.member.valid_from || a.member.createdAt || 0)
    );
    return candidates[0];
};

const unitHeadIfValid = (unit, now) =>
    unit && unit.head_user && inWindow(unit.head_valid_from, unit.head_valid_to, now)
        ? lc(unit.head_user)
        : "";

export const headsAnyUnit = (org, user, now = new Date()) =>
    org.units.some(
        (x) => lc(x.head_user) === lc(user) && x.active !== false && inWindow(x.head_valid_from, x.head_valid_to, now)
    );

// The people who report directly to `user`. For resolution only in-window
// nodes count; for editing (includeExpired) an expired subordinate still
// appears so their dates can be extended.
export const childrenOf = (org, user, now = new Date(), { includeExpired = false } = {}) =>
    (org.childrenByManager.get(lc(user)) || [])
        .filter((m) => m.active !== false && (includeExpired || inWindow(m.valid_from, m.valid_to, now)))
        .map((m) => ({ member: m, unit: org.unitsById.get(String(m.unit_id)) }));

// Everyone beneath `user`, at any depth. Cycle-safe.
export const subtreeUsers = (org, user, now = new Date(), opts = {}) => {
    const out = new Set();
    const queue = [lc(user)];
    const seen = new Set(queue);
    while (queue.length) {
        const u = queue.shift();
        for (const { member } of childrenOf(org, u, now, opts)) {
            const c = lc(member.domain_user);
            if (!seen.has(c)) {
                seen.add(c);
                out.add(c);
                queue.push(c);
            }
        }
    }
    return out;
};

// Who is this person's Immediate Supervisor?
//   - a registered person: their reports_to, else their unit's head
//   - a unit head with no node: whoever the unit says the head reports to
//   - nobody found: "" (HR steps in, and the form says so)
export const resolveSupervisor = (org, user, now = new Date()) => {
    const u = lc(user);
    const m = resolveMembership(org, u, now);
    if (m) {
        if (m.member.reports_to && lc(m.member.reports_to) !== u) return lc(m.member.reports_to);
        const head = unitHeadIfValid(m.unit, now);
        if (head && head !== u) return head;
    }
    const headed = org.units.find(
        (x) => lc(x.head_user) === u && x.active !== false && inWindow(x.head_valid_from, x.head_valid_to, now)
    );
    if (headed && headed.head_reports_to) return lc(headed.head_reports_to);
    return "";
};

// The supervisor, their supervisor, and so on up to the top. Cycle-safe.
export const chainOf = (org, user, now = new Date()) => {
    const chain = [];
    let cur = lc(user);
    const seen = new Set([cur]);
    for (let i = 0; i < 25; i += 1) {
        const s = resolveSupervisor(org, cur, now);
        if (!s || seen.has(s)) break;
        chain.push(s);
        seen.add(s);
        cur = s;
    }
    return chain;
};

// May this person register people beneath themselves? Their role must
// manage, or they must currently head a unit.
export const isManagerUser = (org, settings, user, now = new Date()) => {
    const m = resolveMembership(org, user, now);
    if (m && roleManages(settings, m.member.role_in_unit)) return true;
    return headsAnyUnit(org, user, now);
};

// May `me` edit `target`'s registration? Only if target is somewhere beneath
// me. (HR is handled by the caller.)
export const canManageUser = (org, settings, me, target, now = new Date()) =>
    lc(me) !== lc(target) && subtreeUsers(org, me, now, { includeExpired: true }).has(lc(target));

// May `me` register a person who will report to `manager`? Under myself if I
// manage; under someone beneath me if THEY manage — the hierarchy the user
// described, where a district manager registers branch managers who in turn
// register their staff.
export const canRegisterUnder = (org, settings, me, manager, now = new Date()) => {
    const i = lc(me);
    const m = lc(manager);
    if (!m) return false;
    if (m === i) return isManagerUser(org, settings, i, now);
    return subtreeUsers(org, i, now, { includeExpired: true }).has(m) && isManagerUser(org, settings, m, now);
};

// Would making `user` report to `newManager` create a loop?
export const wouldCycle = (org, user, newManager, now = new Date()) => {
    const u = lc(user);
    const m = lc(newManager);
    if (!m) return false;
    if (m === u) return true;
    return subtreeUsers(org, u, now, { includeExpired: true }).has(m);
};

// Everyone currently allowed to sign a task whose rule is `rule`.
export const resolveSignersForRule = (org, settings, clearance, rule, now = new Date()) => {
    if (!rule) return [];
    switch (rule.mode) {
        case "supervisor": {
            const live = resolveSupervisor(org, clearance.domain_user, now);
            return uniq([live || lc(clearance.supervisor_user)]);
        }
        case "unit_head": {
            const unit = rule.unit_id ? org.unitsById.get(String(rule.unit_id)) : null;
            if (!unit || unit.active === false) return [];
            const head = unitHeadIfValid(unit, now);
            const delegates = (org.membersByUnit.get(String(unit._id)) || [])
                .filter(
                    (m) => m.can_sign_clearance && m.active !== false && inWindow(m.valid_from, m.valid_to, now)
                )
                .map((m) => lc(m.domain_user));
            return uniq([head, ...delegates]);
        }
        case "users":
            return uniq((rule.users || []).map(lc));
        case "ceo": {
            const out = [lc(settings && settings.ceo_user)];
            if (
                settings &&
                settings.ceo_delegate_user &&
                inWindow(settings.ceo_delegate_from, settings.ceo_delegate_to, now)
            ) {
                out.push(lc(settings.ceo_delegate_user));
            }
            return uniq(out);
        }
        default:
            return [];
    }
};

export const isSigner = (org, settings, clearance, task, user, now = new Date()) =>
    resolveSignersForRule(org, settings, clearance, task.signer_rule, now).includes(lc(user));

// A node as the screens show it.
export const summarizeNode = (org, m, now = new Date()) => {
    if (!m) return null;
    const unit = org.unitsById.get(String(m.unit_id));
    return {
        _id: m._id,
        domain_user: lc(m.domain_user),
        role: m.role_in_unit || "",
        unit_id: m.unit_id,
        unit_name: unit ? unit.name : "",
        unit_code: unit ? unit.code : "",
        unit_kind: unit ? unit.kind : "",
        reports_to: lc(m.reports_to),
        valid_from: m.valid_from,
        valid_to: m.valid_to,
        active: m.active !== false,
        in_window: inWindow(m.valid_from, m.valid_to, now),
        can_sign_clearance: !!m.can_sign_clearance,
    };
};

// The tree beneath `rootUser`, with per-node permissions for `viewer` so the
// screen never has to guess who may edit what.
export const buildTree = async (org, settings, rootUser, viewer, now = new Date()) => {
    const me = lc(viewer.me);
    const isAdmin = !!viewer.isAdmin;
    const mySub = isAdmin ? null : subtreeUsers(org, me, now, { includeExpired: true });
    const idx = await userIndex();
    const nameOf = (u) => {
        const x = idx.get(lc(u));
        return x ? [x.first_name, x.last_name].filter(Boolean).join(" ") : u;
    };

    const visit = (user, depth, seen) => {
        const u = lc(user);
        if (seen.has(u) || depth > 15) return null;
        seen.add(u);
        const current = resolveMembership(org, u, now);
        const anyActive = (org.membersByUser.get(u) || [])
            .filter((x) => x.active !== false)
            .sort((a, b) => new Date(b.valid_from || 0) - new Date(a.valid_from || 0))[0];
        const node = summarizeNode(org, current ? current.member : anyActive, now);
        return {
            user: u,
            name: nameOf(u),
            node,
            supervisor: resolveSupervisor(org, u, now),
            manages: isManagerUser(org, settings, u, now),
            heads_units: org.units
                .filter((x) => lc(x.head_user) === u && x.active !== false)
                .map((x) => ({ _id: x._id, name: x.name, code: x.code, kind: x.kind })),
            can_edit: isAdmin || (mySub !== null && mySub.has(u)),
            can_add_under: isAdmin || canRegisterUnder(org, settings, me, u, now),
            children: childrenOf(org, u, now, { includeExpired: true })
                .map((k) => visit(k.member.domain_user, depth + 1, seen))
                .filter(Boolean),
        };
    };
    return visit(rootUser, 0, new Set());
};

// ------------------------------------------------------------------
// template → tasks
// ------------------------------------------------------------------

// Does this template row apply to this employee's departure? Empty lists in
// applies_to mean "everyone". An unknown unit kind (employee not registered in
// any unit) is treated as applicable: someone should confirm N/A rather than
// the system assuming it.
export const rowApplies = (row, clearance) => {
    const a = row.applies_to || {};
    const kinds = a.unit_kinds || [];
    if (kinds.length && clearance.unit_kind && !kinds.includes(clearance.unit_kind)) return false;
    const types = a.termination_types || [];
    if (types.length && clearance.termination_type && !types.includes(clearance.termination_type)) {
        return false;
    }
    const unitIds = (a.unit_ids || []).map(String);
    if (unitIds.length && clearance.unit_id && !unitIds.includes(String(clearance.unit_id))) return false;
    return true;
};

export const buildTasks = (template, clearance) => {
    const rows = [...(template.rows || [])].sort((x, y) => (x.order || 0) - (y.order || 0));
    return rows.map((row) => {
        const applies = rowApplies(row, clearance);
        return {
            code: row.code,
            label: row.label,
            order: row.order || 0,
            is_final: !!row.is_final,
            signer_rule: {
                mode: row.signer.mode,
                unit_id: row.signer.unit_id || undefined,
                users: (row.signer.users || []).map(lc),
            },
            signers_snapshot: [],
            signature_mode: row.signature_mode || "electronic",
            depends_on: [...(row.depends_on || [])],
            status: applies ? "Waiting" : "Not Applicable",
            auto: !applies,
            items: (row.items || []).map((it) => ({
                code: it.code,
                label: it.label,
                outcome: applies ? "Pending" : "Not Applicable",
                note: "",
            })),
            note: applies ? "" : "Not applicable to this departure (template rule).",
            history: [],
        };
    });
};

// ------------------------------------------------------------------
// dependency + status evaluation
// ------------------------------------------------------------------

const isDone = (t) => t.status === "Cleared" || t.status === "Not Applicable";

// Walks the tasks once and settles everything that follows from their
// current outcomes:
//   - Waiting rows whose dependencies are all done become Pending (and are
//     reported back so the caller can notify their signers);
//   - the final row becomes Pending only when every other row is done, and
//     drops back to Waiting if a row is reopened underneath it;
//   - the clearance status is derived from the rows, never set by hand.
// Mutates `clearance` and returns what changed.
export const recompute = (clearance, now = new Date()) => {
    const tasks = clearance.tasks || [];
    const byCode = new Map(tasks.map((t) => [t.code, t]));
    const newlyPending = [];

    tasks
        .filter((t) => !t.is_final && t.status === "Waiting")
        .forEach((t) => {
            const ok = (t.depends_on || []).every((code) => {
                const dep = byCode.get(code);
                return !dep || isDone(dep);
            });
            if (ok) {
                t.status = "Pending";
                t.notified_at = now;
                newlyPending.push(t.code);
            }
        });

    const nonFinal = tasks.filter((t) => !t.is_final);
    const allNonFinalDone = nonFinal.every(isDone);
    const finalTask = tasks.find((t) => t.is_final);

    if (finalTask && !isDone(finalTask)) {
        if (allNonFinalDone && finalTask.status === "Waiting") {
            finalTask.status = "Pending";
            finalTask.notified_at = now;
            newlyPending.push(finalTask.code);
        } else if (!allNonFinalDone && finalTask.status === "Pending") {
            finalTask.status = "Waiting";
        }
    }

    const before = clearance.status;
    if (before === "Open" || before === "Awaiting Final Approval") {
        if (finalTask ? isDone(finalTask) && allNonFinalDone : allNonFinalDone) {
            clearance.status = "Cleared";
        } else if (allNonFinalDone) {
            clearance.status = "Awaiting Final Approval";
        } else {
            clearance.status = "Open";
        }
    }

    return {
        newlyPending,
        becameCleared: before !== "Cleared" && clearance.status === "Cleared",
        becameAwaitingFinal: before !== "Awaiting Final Approval" && clearance.status === "Awaiting Final Approval",
    };
};

// Opens the form: snapshots the active template into tasks and evaluates.
export const openClearance = (clearance, template, now = new Date()) => {
    clearance.template_id = template._id;
    clearance.template_version = template.version;
    clearance.tasks = buildTasks(template, clearance);
    clearance.status = "Open";
    clearance.opened_at = now;
    return recompute(clearance, now);
};

// Refresh the informational signer snapshot on every task.
export const refreshSnapshots = (org, settings, clearance, now = new Date()) => {
    (clearance.tasks || []).forEach((t) => {
        t.signers_snapshot = resolveSignersForRule(org, settings, clearance, t.signer_rule, now);
    });
};

// What the current viewer may do with this clearance. Computed server-side so
// the UI never has to reimplement authorisation.
export const viewerCapabilities = (org, settings, clearance, me, isAdmin, now = new Date()) => {
    const user = lc(me);
    const isOwner = lc(clearance.domain_user) === user;
    const supervisor = lc(clearance.supervisor_user);
    const st = clearance.status;

    let decideStage = "";
    if (st === "Pending Supervisor" && (user === supervisor || isAdmin)) decideStage = "supervisor";
    if (st === "Pending HR" && isAdmin) decideStage = "hr";

    const canAct = [];
    const canVerify = [];
    const canReopen = [];
    let isSignerAnywhere = false;
    if (st === "Open" || st === "Awaiting Final Approval") {
        (clearance.tasks || []).forEach((t) => {
            const signer = isSigner(org, settings, clearance, t, user, now);
            if (signer) isSignerAnywhere = true;
            if (t.signature_mode === "manual") {
                if (isAdmin && (t.status === "Pending" || t.status === "Outstanding")) canVerify.push(t.code);
            } else if (signer && (t.status === "Pending" || t.status === "Outstanding")) {
                canAct.push(t.code);
            }
            if (!t.is_final && t.status === "Cleared" && (signer || isAdmin)) canReopen.push(t.code);
        });
    } else {
        isSignerAnywhere = (clearance.tasks || []).some((t) =>
            isSigner(org, settings, clearance, t, user, now)
        );
    }

    return {
        is_admin: isAdmin,
        is_owner: isOwner,
        is_supervisor: user === supervisor,
        is_signer: isSignerAnywhere,
        decide_stage: decideStage,
        can_act: canAct,
        can_verify_manual: canVerify,
        can_reopen: canReopen,
        can_reassign: isAdmin && (st === "Open" || st === "Awaiting Final Approval"),
        can_cancel: isAdmin && st !== "Cleared" && st !== "Cancelled",
        can_withdraw: isOwner && ["Pending Supervisor", "Pending HR", "Rejected", "Approved"].includes(st),
        can_resubmit: isOwner && st === "Rejected",
        can_open_now: isAdmin && st === "Approved",
        // The signature form (for the CEO's hand signature) exists once every
        // departmental row is done; the certificate only once the CEO's line is.
        can_print_form: st === "Awaiting Final Approval" || st === "Cleared",
        can_print_certificate: st === "Cleared",
    };
};

// ------------------------------------------------------------------
// employee snapshot (HRIS first, Mongo second, gaps flagged)
// ------------------------------------------------------------------

export const snapshotEmployee = async (userDoc) => {
    const gaps = [];
    let hris = null;
    try {
        hris = await getEmployeeIdentity(userDoc.user, userDoc.employee_id);
    } catch (e) {
        console.warn("[clearance] HRIS identity lookup failed:", e && e.message);
    }

    const threePart = hris ? [hris.Name, hris.FName, hris.GFName].filter(Boolean).map(properCase).join(" ") : "";
    const twoPart = [userDoc.first_name, userDoc.last_name].filter(Boolean).map(properCase).join(" ");
    const employee_name = threePart || twoPart;
    if (!threePart) gaps.push("employee_name");

    const first_name = properCase((hris && hris.Name) || userDoc.first_name || "");

    const employee_id = String((hris && hris.EmployeeId) || userDoc.employee_id || "").trim();
    if (!(hris && hris.EmployeeId)) gaps.push("employee_id");

    const job_title = String((hris && hris.CurrentPosition) || userDoc.position || "").trim();
    if (!(hris && hris.CurrentPosition)) gaps.push("job_title");

    const department = String((hris && hris.CurrentDepartment) || userDoc.department || "").trim();
    if (!(hris && hris.CurrentDepartment)) gaps.push("department");

    const date_of_employment = hris && hris.EmploymentDate ? new Date(hris.EmploymentDate) : undefined;
    if (!date_of_employment) gaps.push("date_of_employment");

    return { employee_name, first_name, employee_id, job_title, department, date_of_employment, hris_gaps: gaps };
};

// ------------------------------------------------------------------
// resignation letter
// ------------------------------------------------------------------

// The fixed format every employee-initiated resignation is written in. The
// employee supplies the reason, the date and an optional statement; the letter
// itself is generated so that every resignation on file reads the same way.
export const renderResignationLetter = (c, now = new Date()) => {
    const effective = c.immediate
        ? "take effect immediately"
        : `take effect on ${fmtLongDate(c.release_date)}, and I will serve the notice period until that date`;
    const lines = [
        `Date: ${fmtLongDate(now)}`,
        "",
        "To: Zemen Bank S.C.",
        "    Talent Acquisition, Development & Management Department",
        "    Addis Ababa",
        "",
        "Subject: Letter of Resignation",
        "",
        "Dear Sir/Madam,",
        "",
        `I, ${c.employee_name}${c.job_title ? `, ${c.job_title}` : ""}${
            c.department ? ` in the ${c.department}` : ""
        }, hereby tender my resignation from my position at Zemen Bank S.C.${
            c.date_of_employment ? ` I have been serving the Bank since ${fmtLongDate(c.date_of_employment)}.` : ""
        }`,
        "",
        `I request that my resignation ${effective}.`,
        "",
        `Reason for resignation: ${c.reason || "—"}`,
    ];
    if (c.additional_statement) lines.push("", c.additional_statement);
    lines.push(
        "",
        "I am committed to completing the exit clearance process and properly handing over my responsibilities before my release. I am grateful for the opportunities and support I have received during my time with the Bank.",
        "",
        "Sincerely,",
        "",
        c.employee_name,
        c.employee_id ? `Employee ID: ${c.employee_id}` : "",
        c.job_title || ""
    );
    return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
};

// ------------------------------------------------------------------
// notifications
// ------------------------------------------------------------------

// domain_user → Mongo _id, resolved against a short-lived cache of every user.
// The whole User collection is a few thousand small documents, and the push
// service needs _ids, so one indexed load per minute beats a regex per name.
let userCache = { at: 0, byLower: new Map() };
export const userIndex = async () => {
    if (Date.now() - userCache.at > 60 * 1000) {
        const all = await User.find({}, { _id: 1, user: 1, first_name: 1, last_name: 1, roles: 1 }).lean();
        const byLower = new Map();
        all.forEach((u) => byLower.set(lc(u.user), u));
        userCache = { at: Date.now(), byLower };
    }
    return userCache.byLower;
};

export const displayName = async (domainUser) => {
    const idx = await userIndex();
    const u = idx.get(lc(domainUser));
    return u ? [u.first_name, u.last_name].filter(Boolean).join(" ") : String(domainUser || "");
};

export const payload = (title, body, url, type = "clearance") => ({
    title,
    body,
    icon: "/zbss/favicon.ico",
    badge: "/zbss/favicon.ico",
    data: { type, url, timestamp: new Date().toISOString() },
});

export const notifyUsers = async (domainUsers, p) => {
    const idx = await userIndex();
    for (const du of uniq((domainUsers || []).map(lc))) {
        const u = idx.get(du);
        if (!u) continue;
        try {
            // eslint-disable-next-line no-await-in-loop
            await PushNotificationService.sendToUser(u._id, p);
        } catch (e) {
            console.warn(`[clearance] push to ${du} failed:`, e && e.message);
        }
    }
};

export const notifyAdmins = async (p) => {
    try {
        await PushNotificationService.sendToRole("admin", p);
    } catch (e) {
        console.warn("[clearance] push to admins failed:", e && e.message);
    }
};

// Tell the signers of every newly-pending task that it is waiting for them.
export const notifyNewlyPending = async (org, settings, clearance, codes) => {
    for (const code of codes) {
        const t = (clearance.tasks || []).find((x) => x.code === code);
        if (!t) continue;
        const signers = resolveSignersForRule(org, settings, clearance, t.signer_rule);
        const p = payload(
            "Exit clearance needs your sign-off",
            `${clearance.employee_name} — ${t.label}`,
            "/clearance/inbox",
            "clearance_task"
        );
        if (t.signature_mode === "manual" || !signers.length) {
            // eslint-disable-next-line no-await-in-loop
            await notifyAdmins(
                payload(
                    signers.length ? "Manual signature row is ready" : "Clearance row has no signer",
                    `${clearance.employee_name} — ${t.label}`,
                    "/admin/clearance/list",
                    "clearance_task"
                )
            );
        }
        if (signers.length && t.signature_mode !== "manual") {
            // eslint-disable-next-line no-await-in-loop
            await notifyUsers(signers, p);
        }
    }
};

// ------------------------------------------------------------------
// certificate
// ------------------------------------------------------------------

export const assignCertificate = async (clearance, by, now = new Date()) => {
    if (clearance.certificate_number) return clearance.certificate_number;
    const ref = await ClearanceCounter.getNextReference(now.getFullYear());
    clearance.certificate_number = ref;
    clearance.cleared_at = now;
    clearance.cleared_by = lc(by);
    return ref;
};

// ------------------------------------------------------------------
// seed
// ------------------------------------------------------------------

// The paper form, as data. Runs once, when no template exists: creates a unit
// per departmental row so the only thing HR has to do before the first
// clearance is appoint each unit's head.
const SEED_UNITS = [
    ["BMD", "Branch Mgt. Dep't"],
    ["LPM", "Logistics & Property Mgt. Dep't"],
    ["EAM", "Enterprise Application Mgt. Dep't"],
    ["DMA", "Database Mgt. & Analytics Dep't"],
    ["ITI", "IT Infrastructure Mgt. Dep't"],
    ["ISD", "Information Security Dep't"],
    ["ITS", "IT Support Service Division"],
    ["CPM", "Credit Portfolio Mgt. Dep't"],
    ["TAD", "Talent Acquisition, Dev't & Mgt. Dep't"],
    ["PME", "Performance Mgt. & Employee Service Dep't"],
    ["FIR", "Finance & Investor Relations Dep't"],
];

export const ensureSeeded = async (by = "system") => {
    const existing = await ClearanceTemplate.findOne({ active: true }).lean();
    if (existing) return existing;

    const unitIds = {};
    for (const [code, name] of SEED_UNITS) {
        // eslint-disable-next-line no-await-in-loop
        let u = await ClearanceUnit.findOne({ code });
        if (!u) {
            // eslint-disable-next-line no-await-in-loop
            u = await ClearanceUnit.create({ code, name, kind: "department", created_by: by });
        }
        unitIds[code] = u._id;
    }

    const unitRow = (code, label, order, items = []) => ({
        code: code.toLowerCase(),
        label,
        order,
        items,
        signer: { mode: "unit_head", unit_id: unitIds[code], users: [] },
        signature_mode: "electronic",
        applies_to: {},
        depends_on: [],
        is_final: false,
    });
    const item = (code, label) => ({ code, label });

    const rows = [
        {
            code: "immediate_supervisor",
            label: "Immediate Supervisor",
            order: 1,
            items: [item("fixed_asset", "Fixed Asset"), item("other", "Any Other Commitment")],
            signer: { mode: "supervisor", users: [] },
            signature_mode: "electronic",
            applies_to: {},
            depends_on: [],
            is_final: false,
        },
        unitRow("BMD", "Branch Mgt. Dep't", 2),
        unitRow("LPM", "Logistics & Property Mgt. Dep't", 3),
        unitRow("EAM", "Enterprise Application Mgt. Dep't", 4),
        unitRow("DMA", "Database Mgt. & Analytics Dep't", 5),
        unitRow("ITI", "IT Infrastructure Mgt. Dep't", 6),
        unitRow("ISD", "Information Security Dep't", 7),
        unitRow("ITS", "IT Support Service Division", 8),
        unitRow("CPM", "Credit Portfolio Mgt. Dep't", 9, [
            item("emergency_loan", "Emergency Staff Loan"),
            item("personal_loan", "Personal Loan"),
            item("housing_loan", "Housing Loan"),
            item("vehicle_loan", "Vehicle Loan"),
            item("other_loans", "Any Other Loans"),
        ]),
        unitRow("TAD", "Talent Acquisition, Dev't & Mgt. Dep't", 10, [
            item("training", "Training Commitment"),
            item("other", "Any Other Commitment"),
        ]),
        unitRow("PME", "Performance Mgt. & Employee Service Dep't", 11, [
            item("id_guarantee", "ID & Guarantee Letters"),
            item("attendance", "Attendance Clearance"),
            item("bonus", "Bonus Commitment"),
        ]),
        unitRow("FIR", "Finance & Investor Relations Dep't", 12),
        {
            code: "ceo_final",
            label: "Final Approval by the President/CEO",
            order: 99,
            items: [],
            signer: { mode: "ceo", users: [] },
            signature_mode: "manual",
            applies_to: {},
            depends_on: [],
            is_final: true,
        },
    ];

    const created = await ClearanceTemplate.create({
        version: 1,
        name: "Exit Clearance",
        active: true,
        rows,
        created_by: by,
    });
    await ClearanceSettings.get();
    console.log("[clearance] seeded template v1 and 11 departmental units");
    return created.toObject();
};

// ------------------------------------------------------------------
// scheduler: open on release date, remind, escalate
// ------------------------------------------------------------------

const DAY = 24 * 3600 * 1000;
let ticking = false;

export const tick = async () => {
    if (ticking) return;
    ticking = true;
    const now = new Date();
    try {
        // 1. Approved departures whose release date has arrived.
        const due = await Clearance.find({ status: "Approved", release_date: { $lte: now } });
        if (due.length) {
            await ensureSeeded("system");
            const template = await ClearanceTemplate.findOne({ active: true }).lean();
            const [org, settings] = [await loadOrg(), await ClearanceSettings.get()];
            for (const c of due) {
                if (!template) break;
                const r = openClearance(c, template, now);
                refreshSnapshots(org, settings, c, now);
                // eslint-disable-next-line no-await-in-loop
                await c.save();
                // eslint-disable-next-line no-await-in-loop
                await notifyNewlyPending(org, settings, c, r.newlyPending);
                // eslint-disable-next-line no-await-in-loop
                await notifyUsers(
                    [c.domain_user],
                    payload("Your exit clearance is open", "Departments have been notified.", "/user/clearance")
                );
                console.log(`[clearance] opened ${c._id} for ${c.domain_user} on release date`);
            }
        }

        // 2. Reminders and escalations for rows nobody has acted on.
        const settings = await ClearanceSettings.get();
        const open = await Clearance.find({
            status: { $in: ["Open", "Awaiting Final Approval"] },
            "tasks.status": "Pending",
        });
        if (open.length) {
            const org = await loadOrg();
            for (const c of open) {
                let dirty = false;
                for (const t of c.tasks) {
                    if (t.status !== "Pending" || !t.notified_at) continue;
                    const age = now - new Date(t.notified_at);
                    const since = now - new Date(t.last_reminded_at || t.notified_at);
                    if (age >= settings.sla_days * DAY && since >= settings.remind_every_days * DAY) {
                        const signers = resolveSignersForRule(org, settings, c, t.signer_rule, now);
                        const days = Math.floor(age / DAY);
                        const p = payload(
                            "Reminder: exit clearance waiting",
                            `${c.employee_name} — ${t.label} has been waiting ${days} day${days === 1 ? "" : "s"}`,
                            t.signature_mode === "manual" ? "/admin/clearance/list" : "/clearance/inbox",
                            "clearance_reminder"
                        );
                        if (t.signature_mode === "manual" || !signers.length) {
                            // eslint-disable-next-line no-await-in-loop
                            await notifyAdmins(p);
                        } else {
                            // eslint-disable-next-line no-await-in-loop
                            await notifyUsers(signers, p);
                        }
                        t.last_reminded_at = now;
                        t.reminder_count = (t.reminder_count || 0) + 1;
                        dirty = true;
                    }
                    if (age >= settings.escalate_after_days * DAY && !t.escalated_at) {
                        // eslint-disable-next-line no-await-in-loop
                        await notifyAdmins(
                            payload(
                                "Exit clearance row is stuck",
                                `${c.employee_name} — ${t.label} unsigned for ${Math.floor(age / DAY)} days`,
                                "/admin/clearance/list",
                                "clearance_escalation"
                            )
                        );
                        t.escalated_at = now;
                        dirty = true;
                    }
                }
                if (dirty) {
                    c.markModified("tasks");
                    // eslint-disable-next-line no-await-in-loop
                    await c.save();
                }
            }
        }
    } catch (e) {
        console.error("[clearance] scheduler tick failed:", e);
    } finally {
        ticking = false;
    }
};

let timer = null;
export const startScheduler = () => {
    if (timer) return;
    // First pass shortly after boot so a restart never delays a release-date
    // opening by a full interval; then every fifteen minutes. Every action in
    // tick() is idempotent, so an overlapping process would only repeat a
    // harmless read.
    setTimeout(() => tick().catch(() => {}), 45 * 1000);
    timer = setInterval(() => tick().catch(() => {}), 15 * 60 * 1000);
    if (typeof timer.unref === "function") timer.unref();
    console.log("[clearance] scheduler started (15 min)");
};

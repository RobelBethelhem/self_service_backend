import { Router } from "express";
import auth from "../../middleware/rms/auth.js";
import roleCheck from "../../middleware/rms/roleCheck.js";
import { getReportPool, sql } from "../../utils/rms/hrisReportPool.js";

const router = Router();

// ---------------------------------------------------------------------------
// HRIS reporting
// ---------------------------------------------------------------------------
// Thin, parameterised pass-through to the reporting pack installed in the HRIS
// database (HRIS_Reporting.sql + HRIS_StandardReports.sql). All of the domain
// logic — the data-quality gates, the education ladder, the movement
// derivation — lives in SQL where it was written and reviewed. This layer only
// validates, types and forwards.
//
// EVERY value reaches SQL Server through request.input(). Nothing is ever
// concatenated into a statement, so no filter value — including the free-text
// name and sub-city searches — can alter the query.
//
// The reports read SNAPSHOT tables. Without a nightly refresh they return
// whatever was last built, which is why /status exposes the snapshot age and
// the UI shows it next to every result.

class BadRequest extends Error {
    constructor(message) {
        super(message);
        this.status = 400;
    }
}

// --- coercion --------------------------------------------------------------
// Each returns the value to send, or null/'' to mean "do not send this one".
// Omitting a parameter matters: the procedures declare real defaults
// (@EmploymentStatus = 'Active', @Period = 'Year'), and passing an explicit
// NULL would override them with something different.

const asCsvInt = (raw, name) => {
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    const ids = list.map((v) => String(v).trim()).filter((v) => v !== "");
    ids.forEach((v) => {
        if (!/^-?\d+$/.test(v)) {
            throw new BadRequest(`"${name}" must be a list of numeric ids`);
        }
    });
    return ids.length ? ids.join(",") : null;
};

const asCsvText = (raw, name) => {
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    const items = list
        .map((v) => String(v).replace(/[\u0000-\u001f]/g, "").trim())
        .filter((v) => v !== "");
    if (!items.length) return null;
    const joined = items.join(",");
    if (joined.length > 2000) {
        throw new BadRequest(`"${name}" is too long`);
    }
    return joined;
};

const asText = (raw) => {
    const value = String(raw).replace(/[\u0000-\u001f]/g, "").trim();
    return value === "" ? null : value;
};

const asInt = (raw, name) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new BadRequest(`"${name}" must be a number`);
    return Math.trunc(n);
};

const asDec = (raw, name) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new BadRequest(`"${name}" must be a number`);
    return n;
};

const asDate = (raw, name) => {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new BadRequest(`"${name}" is not a valid date`);
    return d;
};

const asBit = (raw, name) => {
    if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
    if (raw === false || raw === 0 || raw === "0" || raw === "false") return false;
    throw new BadRequest(`"${name}" must be true or false`);
};

const COERCE = {
    csvInt: asCsvInt,
    csvText: asCsvText,
    text: asText,
    int: asInt,
    dec: asDec,
    date: asDate,
    bit: asBit,
};

// Spec entries are [kind, mssql type]. A parameter absent from the request body
// is never sent, so the procedure's own default applies.
const applyParams = (request, spec, values) => {
    const sent = [];
    Object.entries(spec).forEach(([name, [kind, type]]) => {
        const raw = values ? values[name] : undefined;
        // `false` and `0` are meaningful (HasDiscipline=false, MinTrainingCount=0),
        // so only genuinely absent values are skipped.
        if (raw === undefined || raw === null || raw === "") return;

        const value = COERCE[kind](raw, name);
        if (value === null || value === undefined || value === "") return;

        request.input(name, type, value);
        sent.push(name);
    });
    return sent;
};

// --- the 55 shared employee filters ----------------------------------------
// Mirrors dbo.usp_EmployeeFilterResolve exactly. The four core procedures
// (_Detail, _Summary, _Pivot) each accept this whole set.
const FILTERS = {
    UserIds: ["csvInt", sql.VarChar(sql.MAX)],
    EmployeeId: ["text", sql.VarChar(250)],
    NameLike: ["text", sql.NVarChar(300)],
    TIN: ["text", sql.VarChar(20)],

    Presidents: ["csvInt", sql.VarChar(sql.MAX)],
    Departments: ["csvInt", sql.VarChar(sql.MAX)],
    Divisions: ["csvInt", sql.VarChar(sql.MAX)],
    Sections: ["csvInt", sql.VarChar(sql.MAX)],
    Positions: ["csvInt", sql.VarChar(sql.MAX)],
    JobGrades: ["csvInt", sql.VarChar(sql.MAX)],
    JobCategories: ["csvInt", sql.VarChar(sql.MAX)],
    BankingCenters: ["csvInt", sql.VarChar(sql.MAX)],
    BranchGrade: ["text", sql.VarChar(10)],

    Gender: ["text", sql.VarChar(10)],
    MaritalStatus: ["text", sql.VarChar(30)],
    EmploymentType: ["text", sql.VarChar(50)],
    EmploymentStatus: ["text", sql.VarChar(20)],

    Cities: ["csvInt", sql.VarChar(sql.MAX)],
    Regions: ["csvInt", sql.VarChar(sql.MAX)],
    SubCityLike: ["text", sql.NVarChar(250)],

    EducationLevels: ["csvInt", sql.VarChar(sql.MAX)],
    HasEducationLevels: ["csvInt", sql.VarChar(sql.MAX)],
    StudyFields: ["csvInt", sql.VarChar(sql.MAX)],
    Institutions: ["csvInt", sql.VarChar(sql.MAX)],

    AgeFrom: ["int", sql.Int],
    AgeTo: ["int", sql.Int],
    AgeBands: ["csvText", sql.VarChar(sql.MAX)],

    ServiceFrom: ["dec", sql.Decimal(9, 2)],
    ServiceTo: ["dec", sql.Decimal(9, 2)],
    IntExpFrom: ["dec", sql.Decimal(9, 2)],
    IntExpTo: ["dec", sql.Decimal(9, 2)],
    ExtExpFrom: ["dec", sql.Decimal(9, 2)],
    ExtExpTo: ["dec", sql.Decimal(9, 2)],
    TotExpFrom: ["dec", sql.Decimal(9, 2)],
    TotExpTo: ["dec", sql.Decimal(9, 2)],
    PositionTenureFrom: ["dec", sql.Decimal(9, 2)],
    PositionTenureTo: ["dec", sql.Decimal(9, 2)],
    InternalMovesFrom: ["int", sql.Int],
    InternalMovesTo: ["int", sql.Int],

    SalaryFrom: ["dec", sql.Decimal(18, 2)],
    SalaryTo: ["dec", sql.Decimal(18, 2)],

    HiredFrom: ["date", sql.Date],
    HiredTo: ["date", sql.Date],
    TerminatedFrom: ["date", sql.Date],
    TerminatedTo: ["date", sql.Date],
    DobFrom: ["date", sql.Date],
    DobTo: ["date", sql.Date],
    TerminationReasons: ["csvInt", sql.VarChar(sql.MAX)],

    HasGuaranteeLetter: ["bit", sql.Bit],
    HasDiscipline: ["bit", sql.Bit],
    HasPhoto: ["bit", sql.Bit],
    IsOnProbation: ["bit", sql.Bit],
    HasTrainingIn: ["csvInt", sql.VarChar(sql.MAX)],
    MinTrainingCount: ["int", sql.Int],
    AgeDataValidOnly: ["bit", sql.Bit],
};

const DETAIL_EXTRA = {
    SortBy: ["text", sql.VarChar(50)],
    SortDir: ["text", sql.VarChar(4)],
    PageNumber: ["int", sql.Int],
    PageSize: ["int", sql.Int],
    RefreshFirst: ["bit", sql.Bit],
};

const SUMMARY_EXTRA = {
    GroupBy1: ["text", sql.VarChar(30)],
    GroupBy2: ["text", sql.VarChar(30)],
    OrderBy: ["text", sql.VarChar(20)],
    IncludePercentiles: ["bit", sql.Bit],
    RefreshFirst: ["bit", sql.Bit],
};

const PIVOT_EXTRA = {
    RowDimension: ["text", sql.VarChar(30)],
    ColDimension: ["text", sql.VarChar(30)],
    Metric: ["text", sql.VarChar(20)],
    RefreshFirst: ["bit", sql.Bit],
};

const MOVEMENT_PARAMS = {
    From: ["date", sql.Date],
    To: ["date", sql.Date],
    Period: ["text", sql.VarChar(10)],
    GroupBy: ["text", sql.VarChar(30)],
    Presidents: ["csvInt", sql.VarChar(sql.MAX)],
    Departments: ["csvInt", sql.VarChar(sql.MAX)],
    Divisions: ["csvInt", sql.VarChar(sql.MAX)],
    BankingCenters: ["csvInt", sql.VarChar(sql.MAX)],
    JobGrades: ["csvInt", sql.VarChar(sql.MAX)],
    JobCategories: ["csvInt", sql.VarChar(sql.MAX)],
    Gender: ["text", sql.VarChar(10)],
    EmploymentType: ["text", sql.VarChar(50)],
    Regions: ["csvInt", sql.VarChar(sql.MAX)],
    RefreshFirst: ["bit", sql.Bit],
};

// --- the eleven standard reports -------------------------------------------
// Keyed by the slug the frontend uses. `sets` names each result set the
// procedure returns, in order, so the client does not have to count.
const STANDARD_REPORTS = {
    promotion: {
        proc: "dbo.usp_Report_Promotion",
        label: "Promotion",
        sets: ["detail", "summary"],
        params: {
            From: ["date", sql.Date],
            To: ["date", sql.Date],
            Departments: ["csvInt", sql.VarChar(sql.MAX)],
            BankingCenters: ["csvInt", sql.VarChar(sql.MAX)],
            Gender: ["text", sql.VarChar(10)],
            MoveTypes: ["csvText", sql.VarChar(200)],
            IncludeSummary: ["bit", sql.Bit],
        },
    },
    transfer: {
        proc: "dbo.usp_Report_Transfer",
        label: "Transfer",
        sets: ["detail", "summary"],
        params: {
            From: ["date", sql.Date],
            To: ["date", sql.Date],
            FromDepartments: ["csvInt", sql.VarChar(sql.MAX)],
            ToDepartments: ["csvInt", sql.VarChar(sql.MAX)],
            Gender: ["text", sql.VarChar(10)],
            BranchOnly: ["bit", sql.Bit],
            IncludeSummary: ["bit", sql.Bit],
        },
    },
    terminated: {
        proc: "dbo.usp_Report_TerminatedStaff",
        label: "Terminated Staff",
        sets: ["detail", "summary"],
        params: {
            From: ["date", sql.Date],
            To: ["date", sql.Date],
            Departments: ["csvInt", sql.VarChar(sql.MAX)],
            TerminationReasons: ["csvInt", sql.VarChar(sql.MAX)],
            Gender: ["text", sql.VarChar(10)],
            IncludeSummary: ["bit", sql.Bit],
        },
    },
    monthly: {
        proc: "dbo.usp_Report_Monthly",
        label: "Monthly Return",
        sets: ["joiners", "leavers", "movements", "headcount", "byDepartment", "summary"],
        params: {
            Year: ["int", sql.Int],
            Month: ["int", sql.Int],
            Departments: ["csvInt", sql.VarChar(sql.MAX)],
        },
    },
    manpower: {
        proc: "dbo.usp_Report_ManpowerStructure",
        label: "Manpower Structure",
        sets: ["structure", "summary"],
        params: {
            Level: ["text", sql.VarChar(20)],
            Presidents: ["csvInt", sql.VarChar(sql.MAX)],
            Departments: ["csvInt", sql.VarChar(sql.MAX)],
            BankingCenters: ["csvInt", sql.VarChar(sql.MAX)],
            EmploymentStatus: ["text", sql.VarChar(20)],
        },
    },
    general: {
        proc: "dbo.usp_Report_GeneralPurpose",
        label: "General Purpose List",
        sets: ["detail"],
        params: {
            Departments: ["csvInt", sql.VarChar(sql.MAX)],
            Divisions: ["csvInt", sql.VarChar(sql.MAX)],
            JobGrades: ["csvInt", sql.VarChar(sql.MAX)],
            JobCategories: ["csvInt", sql.VarChar(sql.MAX)],
            BankingCenters: ["csvInt", sql.VarChar(sql.MAX)],
            EducationLevels: ["csvInt", sql.VarChar(sql.MAX)],
            Cities: ["csvInt", sql.VarChar(sql.MAX)],
            Gender: ["text", sql.VarChar(10)],
            MaritalStatus: ["text", sql.VarChar(30)],
            EmploymentStatus: ["text", sql.VarChar(20)],
            AgeFrom: ["int", sql.Int],
            AgeTo: ["int", sql.Int],
            ServiceFrom: ["dec", sql.Decimal(9, 2)],
            ServiceTo: ["dec", sql.Decimal(9, 2)],
            SalaryFrom: ["dec", sql.Decimal(18, 2)],
            SalaryTo: ["dec", sql.Decimal(18, 2)],
            HiredFrom: ["date", sql.Date],
            HiredTo: ["date", sql.Date],
            EmployeeId: ["text", sql.VarChar(250)],
            TIN: ["text", sql.VarChar(20)],
            HasGuaranteeLetter: ["bit", sql.Bit],
        },
    },
    "by-department": {
        proc: "dbo.usp_Report_EmployeesByDepartment",
        label: "Employees by Department",
        sets: ["groups", "total"],
        params: {
            EmploymentStatus: ["text", sql.VarChar(20)],
            Gender: ["text", sql.VarChar(10)],
            SplitBy: ["text", sql.VarChar(30)],
            IncludePercentiles: ["bit", sql.Bit],
        },
    },
    "by-job-category": {
        proc: "dbo.usp_Report_EmployeesByJobCategory",
        label: "Employees by Job Category",
        sets: ["groups", "total"],
        params: {
            EmploymentStatus: ["text", sql.VarChar(20)],
            Gender: ["text", sql.VarChar(10)],
            SplitBy: ["text", sql.VarChar(30)],
            IncludePercentiles: ["bit", sql.Bit],
        },
    },
    "by-marital-status": {
        proc: "dbo.usp_Report_EmployeesByMaritalStatus",
        label: "Employees by Marital Status",
        sets: ["groups", "total"],
        params: {
            EmploymentStatus: ["text", sql.VarChar(20)],
            Gender: ["text", sql.VarChar(10)],
            SplitBy: ["text", sql.VarChar(30)],
            IncludePercentiles: ["bit", sql.Bit],
        },
    },
    discipline: {
        proc: "dbo.usp_Report_Discipline",
        label: "Discipline",
        sets: ["detail", "summary"],
        params: {
            From: ["date", sql.Date],
            To: ["date", sql.Date],
            Departments: ["csvInt", sql.VarChar(sql.MAX)],
            ActiveOnly: ["bit", sql.Bit],
            IncludeSummary: ["bit", sql.Bit],
        },
    },
    turnover: {
        proc: "dbo.usp_Report_Turnover",
        label: "Turnover",
        sets: ["leavers", "byReason", "series"],
        params: {
            From: ["date", sql.Date],
            To: ["date", sql.Date],
            Period: ["text", sql.VarChar(10)],
            Departments: ["csvInt", sql.VarChar(sql.MAX)],
            GroupBy: ["text", sql.VarChar(30)],
        },
    },
};

// Named result sets, falling back to set0/set1/… for anything unexpected — a
// procedure that gains a result set must not break the client.
const shapeSets = (recordsets, names) => {
    const out = {};
    (recordsets || []).forEach((rows, i) => {
        out[(names && names[i]) || `set${i}`] = rows;
    });
    return out;
};

// SQL Server errors carry a `number`; surface the message rather than a bare
// 500, because "Unknown @GroupBy1" is something the admin can act on.
const fail = (res, error, where) => {
    if (error && error.status === 400) {
        return res.status(400).json({ error: true, message: error.message });
    }
    console.error(`[hris-report] ${where} error:`, error && error.message);
    const message =
        error && error.number
            ? `HRIS reporting error: ${error.message}`
            : "Could not reach the HRIS reporting database.";
    return res.status(500).json({ error: true, message });
};

const execProc = async (procName, spec, body) => {
    const pool = await getReportPool();
    const request = pool.request();
    applyParams(request, spec, body || {});
    return request.execute(procName);
};

// ---------------------------------------------------------------------------
// GET /status — is the pack installed, and how stale is the snapshot?
// ---------------------------------------------------------------------------
// OBJECT_ID never throws for a missing object, so this is safe to run against a
// database where the reporting pack has not been installed yet — which is the
// state every deployment starts in.
router.get("/status", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const pool = await getReportPool();

        const presence = await pool.request().query(`
            SELECT
                  CoreInstalled     = CASE WHEN OBJECT_ID('dbo.usp_EmployeeReport_Detail','P') IS NULL THEN 0 ELSE 1 END
                , ReportsInstalled  = CASE WHEN OBJECT_ID('dbo.usp_Report_Turnover','P')       IS NULL THEN 0 ELSE 1 END
                , SnapshotTable     = CASE WHEN OBJECT_ID('dbo.EmployeeReportSnapshot','U')    IS NULL THEN 0 ELSE 1 END
                , MovementTable     = CASE WHEN OBJECT_ID('dbo.EmployeeMovementSnapshot','U')  IS NULL THEN 0 ELSE 1 END
        `);
        const p = (presence.recordset && presence.recordset[0]) || {};

        const status = {
            core_installed: !!p.CoreInstalled,
            reports_installed: !!p.ReportsInstalled,
            snapshot_table: !!p.SnapshotTable,
            movement_table: !!p.MovementTable,
            employee_rows: null,
            snapshot_taken_at: null,
            movement_rows: null,
        };

        // Counted separately and defensively: referencing a table that does not
        // exist is a compile-time failure in an ad-hoc batch, so these cannot be
        // folded into the query above.
        if (status.snapshot_table) {
            const snap = await pool.request().query(
                "SELECT Rows = COUNT(*), TakenAt = MAX(TakenAt) FROM dbo.EmployeeReportSnapshot"
            );
            const row = (snap.recordset && snap.recordset[0]) || {};
            status.employee_rows = row.Rows == null ? null : Number(row.Rows);
            status.snapshot_taken_at = row.TakenAt || null;
        }
        if (status.movement_table) {
            const mv = await pool
                .request()
                .query("SELECT Rows = COUNT(*) FROM dbo.EmployeeMovementSnapshot");
            const row = (mv.recordset && mv.recordset[0]) || {};
            status.movement_rows = row.Rows == null ? null : Number(row.Rows);
        }

        return res.json({ error: false, status });
    } catch (error) {
        return fail(res, error, "/status");
    }
});

// ---------------------------------------------------------------------------
// GET /meta — every lookup dropdown in one round trip
// ---------------------------------------------------------------------------
const FILTER_OPTION_SETS = [
    "presidents",
    "departments",
    "divisions",
    "sections",
    "positions",
    "jobGrades",
    "jobCategories",
    "bankingCenters",
    "regions",
    "cities",
    "educationLevels",
    "studyFields",
    "institutions",
    "terminationReasons",
    "trainings",
    "employees",
];

router.get("/meta", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const pool = await getReportPool();

        const options = await pool.request().execute("dbo.usp_ReportFilterOptions");
        const shaped = shapeSets(options.recordsets, FILTER_OPTION_SETS);

        // The employee picker is every active employee — several thousand rows.
        // Only sent when asked for, so opening the filter panel stays cheap.
        if (String(req.query.includeEmployees || "") !== "1") {
            shaped.employees = [];
        }

        const dims = await pool.request().execute("dbo.usp_ReportDimensions");

        return res.json({
            error: false,
            options: shaped,
            dimensions: (dims.recordset || []).map((d) => ({
                dimension: d.Dimension,
                distinct_values: d.DistinctValues,
                employees: d.Employees,
            })),
        });
    } catch (error) {
        return fail(res, error, "/meta");
    }
});

// GET /dimensions?dimension=Department — the values of one dimension, with counts
router.get("/dimensions", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const pool = await getReportPool();
        const request = pool.request();
        const dimension = asText(req.query.dimension || "");
        if (dimension) request.input("Dimension", sql.VarChar(30), dimension);
        const result = await request.execute("dbo.usp_ReportDimensions");
        return res.json({ error: false, data: result.recordset || [] });
    } catch (error) {
        return fail(res, error, "/dimensions");
    }
});

// ---------------------------------------------------------------------------
// The four core shapes
// ---------------------------------------------------------------------------
// POST rather than GET: fifty-five filters do not belong in a query string, and
// a saved view is a JSON body the client can round-trip.

router.post("/detail", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const result = await execProc(
            "dbo.usp_EmployeeReport_Detail",
            { ...FILTERS, ...DETAIL_EXTRA },
            req.body
        );
        const rows = result.recordset || [];
        return res.json({
            error: false,
            data: rows,
            // TotalRows rides on every row for the server-side pager; lifted out
            // here so the client does not have to reach into row 0.
            meta: {
                totalRowCount: rows.length ? Number(rows[0].TotalRows) : 0,
                snapshot_taken_at: rows.length ? rows[0].SnapshotTakenAt : null,
            },
        });
    } catch (error) {
        return fail(res, error, "/detail");
    }
});

router.post("/summary", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const result = await execProc(
            "dbo.usp_EmployeeReport_Summary",
            { ...FILTERS, ...SUMMARY_EXTRA },
            req.body
        );
        const sets = shapeSets(result.recordsets, ["groups", "total"]);
        return res.json({ error: false, ...sets });
    } catch (error) {
        return fail(res, error, "/summary");
    }
});

router.post("/pivot", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const result = await execProc(
            "dbo.usp_EmployeeReport_Pivot",
            { ...FILTERS, ...PIVOT_EXTRA },
            req.body
        );
        const rows = (result.recordsets && result.recordsets[0]) || [];
        // The procedure returns a single NoData column when nothing matches,
        // rather than an empty grid.
        const noData = rows.length === 1 && Object.keys(rows[0]).length === 1 && "NoData" in rows[0];
        return res.json({
            error: false,
            data: noData ? [] : rows,
            columns: noData || !rows.length ? [] : Object.keys(rows[0]),
            message: noData ? rows[0].NoData : null,
        });
    } catch (error) {
        return fail(res, error, "/pivot");
    }
});

router.post("/movement", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const result = await execProc(
            "dbo.usp_HeadcountMovement",
            MOVEMENT_PARAMS,
            req.body
        );
        return res.json({ error: false, data: result.recordset || [] });
    } catch (error) {
        return fail(res, error, "/movement");
    }
});

// ---------------------------------------------------------------------------
// The eleven standard reports
// ---------------------------------------------------------------------------

router.get("/standard", auth, roleCheck(["admin"]), (req, res) => {
    return res.json({
        error: false,
        reports: Object.entries(STANDARD_REPORTS).map(([key, def]) => ({
            key,
            label: def.label,
            sets: def.sets,
            params: Object.keys(def.params),
        })),
    });
});

router.post("/standard/:report", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const def = STANDARD_REPORTS[String(req.params.report || "").toLowerCase()];
        if (!def) {
            return res.status(404).json({ error: true, message: "Unknown report" });
        }
        const result = await execProc(def.proc, def.params, req.body);
        return res.json({
            error: false,
            report: def.label,
            sets: shapeSets(result.recordsets, def.sets),
        });
    } catch (error) {
        return fail(res, error, `/standard/${req.params.report}`);
    }
});

// ---------------------------------------------------------------------------
// POST /refresh — rebuild the snapshots
// ---------------------------------------------------------------------------
// The real answer is a nightly SQL Agent job running both, in this order. This
// endpoint exists for the first run after installation and for the occasional
// "I just fixed a record and want to see it now".
router.post("/refresh", auth, roleCheck(["admin"]), async (req, res) => {
    const startedAt = Date.now();
    try {
        const pool = await getReportPool();

        // Order matters: the movement snapshot builds on the employee snapshot.
        await pool.request().execute("dbo.usp_RefreshEmployeeReportSnapshot");

        let movementRefreshed = false;
        try {
            await pool.request().execute("dbo.usp_RefreshMovementSnapshot");
            movementRefreshed = true;
        } catch (mvErr) {
            // The standard-reports pack may not be installed; the core layer is
            // still usable without it, so this is reported, not fatal.
            console.error("[hris-report] movement refresh failed:", mvErr.message);
        }

        const seconds = Math.round((Date.now() - startedAt) / 1000);
        return res.json({
            error: false,
            message: movementRefreshed
                ? `Snapshots rebuilt in ${seconds}s.`
                : `Employee snapshot rebuilt in ${seconds}s. The movement snapshot could not be refreshed — check that HRIS_StandardReports.sql is installed.`,
            movement_refreshed: movementRefreshed,
            seconds,
        });
    } catch (error) {
        return fail(res, error, "/refresh");
    }
});

export default router;

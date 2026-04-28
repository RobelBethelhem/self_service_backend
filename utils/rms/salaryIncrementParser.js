import XLSX from "xlsx";

// Normalize a column header for matching: trim, lowercase, collapse whitespace.
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Coerce a cell value to a positive number (decimals OK), or null on failure.
function coercePositiveNumber(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

// Coerce a cell to a percentage in (0, 1].
// Excel may store "75%" as 0.75 or as 75; accept either form.
function coercePct(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    let pct = n;
    if (pct > 1 && pct <= 100) pct = pct / 100;
    if (pct <= 0 || pct > 1) return null;
    return pct;
}

const coerceString = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length === 0 ? null : s;
};

// Per-category schema: which sheet name maps to which category, and which Excel
// columns map to which model fields. `col` is an array of accepted spellings
// (we honor existing typos like "Proportinate" so admins do not have to fix them).
const CATEGORY_SCHEMAS = {
    Full: {
        matchSheet: (name) => norm(name) === "full",
        fields: [
            { col: ["domain name"], key: "domain_user", required: true, coerce: coerceString },
            { col: ["employee name"], key: "employee_name", required: true, coerce: coerceString },
            { col: ["first name"], key: "first_name", required: false, coerce: coerceString },
            { col: ["job grade"], key: "job_grade", required: true, coerce: coerceString },
            { col: ["step"], key: "step", required: true, coerce: coerceString },
            { col: ["old salary"], key: "old_salary", required: true, coerce: coercePositiveNumber },
            { col: ["new salary"], key: "new_salary", required: true, coerce: coercePositiveNumber },
            { col: ["bonus amount"], key: "bonus_months", required: true, coerce: coercePositiveNumber },
        ],
    },
    Proportionate: {
        matchSheet: (name) => norm(name) === "proportionate",
        fields: [
            { col: ["domain name"], key: "domain_user", required: true, coerce: coerceString },
            { col: ["employee name"], key: "employee_name", required: true, coerce: coerceString },
            { col: ["first name"], key: "first_name", required: false, coerce: coerceString },
            { col: ["job grade"], key: "job_grade", required: true, coerce: coerceString },
            { col: ["step"], key: "step", required: true, coerce: coerceString },
            { col: ["old salary"], key: "old_salary", required: true, coerce: coercePositiveNumber },
            { col: ["new salary"], key: "new_salary", required: true, coerce: coercePositiveNumber },
            {
                col: ["proportionate amount of bonus", "proportinate amount of bonus"],
                key: "bonus_months",
                required: true,
                coerce: coercePositiveNumber,
            },
        ],
    },
    Discipline: {
        matchSheet: (name) => norm(name) === "discipline",
        fields: [
            { col: ["domain name"], key: "domain_user", required: true, coerce: coerceString },
            { col: ["employee name"], key: "employee_name", required: true, coerce: coerceString },
            { col: ["first name"], key: "first_name", required: false, coerce: coerceString },
            { col: ["job grade"], key: "job_grade", required: true, coerce: coerceString },
            { col: ["step"], key: "step", required: true, coerce: coerceString },
            { col: ["old salary"], key: "old_salary", required: true, coerce: coercePositiveNumber },
            { col: ["new salary"], key: "new_salary", required: true, coerce: coercePositiveNumber },
            { col: ["%age", "percentage"], key: "discipline_pct", required: true, coerce: coercePct },
            { col: ["bonus amount"], key: "bonus_months", required: true, coerce: coercePositiveNumber },
        ],
    },
    "Salary Only": {
        matchSheet: (name) => norm(name).startsWith("salary only"),
        fields: [
            { col: ["domain name"], key: "domain_user", required: true, coerce: coerceString },
            { col: ["employee name"], key: "employee_name", required: true, coerce: coerceString },
            { col: ["first name"], key: "first_name", required: false, coerce: coerceString },
            { col: ["job grade"], key: "job_grade", required: true, coerce: coerceString },
            { col: ["step"], key: "step", required: true, coerce: coerceString },
            // The "Salary Only" sheet uses "Salary" as the pre-increment column, not "Old Salary".
            { col: ["salary", "old salary"], key: "old_salary", required: true, coerce: coercePositiveNumber },
            { col: ["new salary"], key: "new_salary", required: true, coerce: coercePositiveNumber },
        ],
    },
    Promotion: {
        matchSheet: (name) => norm(name) === "promotion",
        fields: [
            { col: ["domain name"], key: "domain_user", required: true, coerce: coerceString },
            { col: ["employee name"], key: "employee_name", required: true, coerce: coerceString },
            { col: ["first name"], key: "first_name", required: false, coerce: coerceString },
            { col: ["old job position"], key: "old_job_position", required: false, coerce: coerceString },
            { col: ["old job grade"], key: "old_job_grade", required: false, coerce: coerceString },
            { col: ["old step"], key: "old_step", required: false, coerce: coerceString },
            { col: ["new job position"], key: "new_job_position", required: true, coerce: coerceString },
            { col: ["new job grade"], key: "new_job_grade", required: true, coerce: coerceString },
            { col: ["new step"], key: "new_step", required: true, coerce: coerceString },
            { col: ["old salary"], key: "old_salary", required: true, coerce: coercePositiveNumber },
            { col: ["new salary"], key: "new_salary", required: true, coerce: coercePositiveNumber },
            {
                col: ["salary after promotion and adjustment"],
                key: "salary_after_promotion_adjustment",
                required: true,
                coerce: coercePositiveNumber,
            },
            { col: ["bonus amount"], key: "bonus_months", required: true, coerce: coercePositiveNumber },
            { col: ["commitment"], key: "promotion_commitment_text", required: false, coerce: coerceString },
        ],
    },
};

function detectCategory(sheetName) {
    for (const [cat, spec] of Object.entries(CATEGORY_SCHEMAS)) {
        if (spec.matchSheet(sheetName)) return cat;
    }
    return null;
}

// Find the header row in an array-of-arrays. We look for the first row that
// contains a "Domain Name" or "Employee Name" cell — this skips section-header
// rows like "Salary Only" sitting above the actual column headers.
function findHeaderRow(aoa) {
    for (let r = 0; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const hasIdent = row.some((c) => {
            const s = norm(c);
            return s === "domain name" || s === "employee name";
        });
        if (hasIdent) return r;
    }
    return -1;
}

function buildHeaderIndex(headerRow) {
    const idx = new Map();
    headerRow.forEach((c, i) => {
        const k = norm(c);
        if (k && !idx.has(k)) idx.set(k, i);
    });
    return idx;
}

function resolveColumnIndex(index, candidates) {
    for (const c of candidates) {
        const i = index.get(norm(c));
        if (i !== undefined) return i;
    }
    return -1;
}

/**
 * Parse a salary-increment workbook buffer into structured rows.
 * Pure: no DB access. The route does the User/dedupe/insert logic on top.
 *
 * @param {Buffer} buffer
 * @returns {{
 *   rows: Array<Object>,
 *   sheet_warnings: Array<{sheet: string, reason: string, details?: string}>,
 *   row_errors: Array<{sheet: string, category: string, excel_row: number, domain_user: string|null, reason: string, details?: string}>
 * }}
 */
export function parseSalaryWorkbook(buffer) {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const rows = [];
    const sheet_warnings = [];
    const row_errors = [];

    for (const sheetName of wb.SheetNames) {
        const category = detectCategory(sheetName);
        if (!category) {
            sheet_warnings.push({ sheet: sheetName, reason: "unknown_sheet_name" });
            continue;
        }

        const ws = wb.Sheets[sheetName];
        if (!ws) {
            sheet_warnings.push({ sheet: sheetName, reason: "empty_or_missing_sheet" });
            continue;
        }

        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
        const headerRowIdx = findHeaderRow(aoa);
        if (headerRowIdx === -1) {
            sheet_warnings.push({ sheet: sheetName, reason: "header_row_not_found" });
            continue;
        }

        const headerIndex = buildHeaderIndex(aoa[headerRowIdx]);
        const spec = CATEGORY_SCHEMAS[category];

        // Resolve every field once and check required columns are present.
        const fieldResolution = [];
        const missingCols = [];
        for (const field of spec.fields) {
            const colIdx = resolveColumnIndex(headerIndex, field.col);
            if (colIdx === -1 && field.required) {
                missingCols.push(field.col[0]);
            }
            fieldResolution.push({ field, colIdx });
        }
        if (missingCols.length) {
            sheet_warnings.push({
                sheet: sheetName,
                reason: "missing_required_column",
                details: missingCols.join(", "),
            });
            continue;
        }

        for (let r = headerRowIdx + 1; r < aoa.length; r++) {
            const dataRow = aoa[r];
            if (!dataRow || dataRow.every((v) => v === null || v === undefined || String(v).trim() === "")) {
                continue;
            }

            const out = { category, excel_row: r + 1, sheet: sheetName };
            const errors = [];

            for (const { field, colIdx } of fieldResolution) {
                const raw = colIdx === -1 ? null : dataRow[colIdx];
                const coerced = field.coerce(raw);
                if (coerced === null && field.required) {
                    errors.push(`missing_or_invalid:${field.key}`);
                    continue;
                }
                if (coerced !== null) out[field.key] = coerced;
            }

            // Derive first_name from employee_name if not supplied.
            if (!out.first_name && out.employee_name) {
                out.first_name = String(out.employee_name).trim().split(/\s+/)[0];
            }

            if (errors.length) {
                row_errors.push({
                    sheet: sheetName,
                    category,
                    excel_row: r + 1,
                    domain_user: out.domain_user || null,
                    reason: errors[0],
                    details: errors.join(", "),
                });
                continue;
            }

            rows.push(out);
        }
    }

    return { rows, sheet_warnings, row_errors };
}

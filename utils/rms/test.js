import sql from "mssql";
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

const dbConfig = {
    server: process.env.SERVER,
    database: process.env.DATABASE,
    user: process.env.USER,
    password: process.env.PASSWORD,
    port: 1433,
    options: {
        trustServerCertificate: true,
        trustedConnection: true,
        encrypt: true,
    },
};



const updateAmharicNames = async (username, names) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

        // First get the UserId from UserProfile
        const userIdQuery = `
            SELECT UserId FROM UserProfile WHERE UserName = @username
        `;
        request.input('username', sql.NVarChar, username);
        const userResult = await request.query(userIdQuery);
        
        if (!userResult.recordset || userResult.recordset.length === 0) {
            console.error("User not found in SQL database");
            return false;
        }
        
        const userId = userResult.recordset[0].UserId;
        
        // Create a new request for the update
        const updateRequest = new sql.Request();
        updateRequest.input('userId', sql.Int, userId);
        
        // Add parameters for the names that need to be updated
        if (names.firstName) {
            updateRequest.input('firstName', sql.NVarChar, names.firstName);
        }
        if (names.middleName) {
            updateRequest.input('middleName', sql.NVarChar, names.middleName);
        }
        if (names.lastName) {
            updateRequest.input('lastName', sql.NVarChar, names.lastName);
        }
        
        // Build the update query dynamically based on which fields are provided
        let updateQuery = `UPDATE EmployeeDetail SET `;
        const updateParts = [];
        
        if (names.firstName) {
            updateParts.push(`Name_am = @firstName`);
        }
        if (names.middleName) {
            updateParts.push(`FName_am = @middleName`);
        }
        if (names.lastName) {
            updateParts.push(`GFName_am = @lastName`);
        }
        
        updateQuery += updateParts.join(', ');
        updateQuery += ` WHERE UserId = @userId`;
        
        // Only execute if there are fields to update
        if (updateParts.length > 0) {
            console.log("SQL Update Query:", updateQuery);
            await updateRequest.query(updateQuery);
            return true;
        }
        
        return false;
    } catch (e) {
        console.error("Error updating Amharic names: ", e.message);
        return false;
    } finally {
        await sql.close();
    }
};


const getAmharicNames = async (username) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

        const query = `
            select E.Name_am, E.FName_am, E.GFName_am 
            from UserProfile U
            join EmployeeDetail E on E.UserId = U.UserId 
            where U.UserName = @username
        `;

        // Add input parameter
        request.input('username', sql.NVarChar, username);
        console.log("Amharic names query:", query);
        const result = await request.query(query);
        
        return result.recordset[0] || null;
    } catch (e) {
        console.error("Error fetching Amharic names: ", e.message);
        return null;
    } finally {
        await sql.close();
    }
};


const guaranteCount = async (username) =>{
    try{
     await sql.connect(dbConfig);
     const request = new sql.Request();

     const currencyFetchQuery = `select count(*) as GuaranteeCount
                                from UserProfile U
                                join GuaranteeLetter G on G.UserId = U.UserId
                                where U.UserName = @username and G.status = 'Active'`;


      // Add input parameter
      request.input('username', sql.NVarChar, username);
      console.log("currencyFetchQuery", currencyFetchQuery)
      const rr = await request.query(currencyFetchQuery);
      
      // Return just the count value instead of the entire recordset
      return rr.recordset[0].GuaranteeCount;
    }
    catch (e) {
        console.error("Error: ", e.message);
        return 0; 
    } finally {
        await sql.close();
    }
}


const getEmploymentDate = async (username) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

        const query = `
            select E.EmploymentDate, E.EmployeeId
            from UserProfile U
            join EmployeeDetail E on E.UserId = U.UserId 
            where U.UserName = @username
        `;

        // Add input parameter
        request.input('username', sql.NVarChar, username);
        console.log("EMployment date names query:", query);
        const result = await request.query(query);
        
        return result.recordset[0] || null;
    } catch (e) {
        console.error("Error fetching Employment Date: ", e.message);
        return null;
    } finally {
        await sql.close();
    }
};

const test = async (username) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

        // Use parameterized query to prevent SQL injection
        // const currencyFetchQuery = `
        //     SELECT a.[Name] + ' ' + a.[FName] + ' ' + a.[GFName] AS [FullName],
        //            a.EmployeeId,
        //            b.[Postion],
        //            a.[Salary],
        //            e.[From],
        //            e.[To]
        //     FROM EmployeeDetail a
        //     JOIN UserProfile d ON d.UserId = a.UserId
        //     JOIN EmployeeExperience e ON e.UserId = a.UserId
        //     JOIN luPosition b ON b.Id = e.Position
        //     WHERE d.UserName = @username AND e.ExperienceType = 1
        // `;
    //     const currencyFetchQuery = `
    //    SELECT a.[Name] + ' ' + a.[FName] + ' ' + a.[GFName] AS [FullName],
    //                a.EmployeeId,
    //                b.[Postion],
    //                a.[Salary],
    //                e.[From],
    //                e.[To],
    //                             f.[Name] as [Job_Grade]
    //         FROM EmployeeDetail a
    //         JOIN UserProfile d ON d.UserId = a.UserId
    //         JOIN EmployeeExperience e ON e.UserId = a.UserId
    //         JOIN luPosition b ON b.Id = e.Position
    //         JOIN luJobGrade f ON f.Id = b.Grade
    //         WHERE d.UserName = @username AND e.ExperienceType = 1
    // `;

    const currencyFetchQuery = `
    SELECT a.[Name],
     a.[FName],
     a.[GFName],
                a.EmployeeId,
                b.[Postion],
                a.[Salary],
                e.[From],
                e.[To],
                             f.[Name] as [Job_Grade]
         FROM EmployeeDetail a
         JOIN UserProfile d ON d.UserId = a.UserId
         JOIN EmployeeExperience e ON e.UserId = a.UserId
         JOIN luPosition b ON b.Id = e.Position
         JOIN luJobGrade f ON f.Id = b.Grade
         WHERE d.UserName = @username AND e.ExperienceType = 1
 `;

        // Add input parameter
        request.input('username', sql.NVarChar, username);
        console.log("currencyFetchQuery", currencyFetchQuery)
        const rr = await request.query(currencyFetchQuery);
        return rr.recordset;
    } catch (e) {
        console.error("Error: ", e.message);
        return null;
    } finally {
        // Ensure the connection is closed
        await sql.close();
    }
};




const getUserPhoto = async (username) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

        const query = `
            select E.photo 
            from UserProfile U
            join EmployeeDetail E on E.UserId = U.UserId 
            where U.UserName = @username
        `;

        // Add input parameter
        request.input('username', sql.NVarChar, username);
        console.log("Amharic names query:", query);
        const result = await request.query(query);
        
        return result.recordset[0] || null;
    } catch (e) {
        console.error("Error fetching Amharic names: ", e.message);
        return null;
    } finally {
        await sql.close();
    }
};


const getPlaceOfAssignment = async (username) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

        const query = `
        SELECT TOP 1
    E.[Name],
    E.[FName],
    D.[Name] AS [PositionName]
FROM
    [EmployeeDetail] E
JOIN
    [UserProfile] U ON U.UserId = E.UserId
LEFT JOIN
    [EmployeeExperience] ET ON E.UserId = ET.UserId
LEFT JOIN
    [luPosition] b ON b.Id = ET.Position
LEFT JOIN
    [luDepartment] D ON D.Id = b.Department
WHERE
    U.UserName = @username
ORDER BY
    ET.[From] DESC
        `;

        // Add input parameter
        request.input('username', sql.NVarChar, username);
        console.log("Place of assignment query:", query);
        const result = await request.query(query);
        
        return result.recordset[0] || null;
    } catch (e) {
        console.error("Error fetching Place of Assignment: ", e.message);
        return null;
    } finally {
        await sql.close();
    }
};

// Lighter-weight HRIS lookup: canonical name parts, EmployeeId, and the
// CURRENT internal position. Used by the salary-increment agreement
// modal, the /me endpoint, and any caller that needs identity + current
// job title in a single round-trip.
//
// CurrentPosition is the position from the latest internal experience
// row, ordering by:
//   1. Active rows first (To IS NULL) — represents the currently-held role
//   2. Then by From DESC — most recently started among the rest
// Falls back to null if the employee has no EmployeeExperience row, so the
// caller can fall back to the Mongo user.position. We deliberately do NOT
// inner-join EmployeeExperience on the outer query — employees with no
// experience row should still resolve identity (name + EmployeeId).
const getEmployeeIdentity = async (username) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

        // OUTER APPLY pulls the latest internal experience's position +
        // grade + department in a single round-trip, so callers get
        // identity AND current job context without making a second query.
        // OUTER (not CROSS) APPLY: employees without an experience row
        // still resolve to identity columns with the apply columns NULL —
        // the caller picks the fallback.
        const query = `
            SELECT TOP 1
                a.[Name]           AS Name,
                a.[FName]          AS FName,
                a.[GFName]         AS GFName,
                a.[EmployeeId]     AS EmployeeId,
                a.[Salary]         AS Salary,
                a.[EmploymentDate] AS EmploymentDate,
                a.[DateOfBirth]    AS DateOfBirth,
                a.[Sex]            AS Sex,
                a.[MaritalStatus]  AS MaritalStatus,
                a.[SpouseName]     AS SpouseName,
                a.[TINNumber]      AS TINNumber,
                a.[PensionNumber]  AS PensionNumber,
                a.[EmploymentType] AS EmploymentType,
                le.[Postion]       AS CurrentPosition,
                le.GradeName       AS CurrentJobGrade,
                le.DeptName        AS CurrentDepartment
            FROM EmployeeDetail a
            JOIN UserProfile d ON d.UserId = a.UserId
            OUTER APPLY (
                SELECT TOP 1
                    p.[Postion],
                    g.[Name] AS GradeName,
                    dept.[Name] AS DeptName
                FROM EmployeeExperience e
                JOIN luPosition p ON p.Id = e.Position
                LEFT JOIN luJobGrade g ON g.Id = p.Grade
                LEFT JOIN luDepartment dept ON dept.Id = p.Department
                WHERE e.UserId = a.UserId
                  AND e.ExperienceType = 1
                ORDER BY
                    CASE WHEN e.[To] IS NULL THEN 0 ELSE 1 END,
                    e.[From] DESC
            ) le
            WHERE d.UserName = @username
        `;
        request.input('username', sql.NVarChar, username);
        const result = await request.query(query);
        return result.recordset[0] || null;
    } catch (e) {
        console.error("Error fetching employee identity:", e.message);
        return null;
    } finally {
        await sql.close();
    }
};

// Resolve HRIS UserId for a caller, preferring EmployeeId (stable,
// business-unique) over UserName (which can have duplicates from
// renames / re-onboarding in long-lived HR DBs).
//
// Returns the resolved UserId (int) or null. Logs which path won so the
// iisnode log shows whether we found via EmployeeId or fell back to the
// UserName join.
//
// IMPORTANT: assumes a live mssql connection is already open — caller
// owns sql.connect/sql.close so we don't churn the pool.
const _resolveHrisUserId = async (username, employeeId) => {
    // Primary: lookup via EmployeeDetail.EmployeeId.
    if (employeeId) {
        const r = new sql.Request();
        r.input('eid', sql.NVarChar, employeeId);
        const result = await r.query(
            'SELECT TOP 1 UserId FROM dbo.EmployeeDetail WHERE EmployeeId = @eid'
        );
        if (result.recordset && result.recordset.length > 0) {
            const uid = result.recordset[0].UserId;
            console.log(
                `[resolveHrisUserId] via EmployeeId='${employeeId}' -> UserId=${uid}`
            );
            return uid;
        }
        console.warn(
            `[resolveHrisUserId] EmployeeId='${employeeId}' NOT in EmployeeDetail; falling back to UserName`
        );
    }

    // Fallback: lookup via UserProfile.UserName JOIN-ed with EmployeeDetail.
    // Joining EmployeeDetail filters out orphan UserProfile rows (legacy
    // duplicates), so we get the same UserId getEmployeeIdentity finds.
    const r = new sql.Request();
    r.input('un', sql.NVarChar, username);
    const result = await r.query(`
        SELECT TOP 1 ed.UserId
        FROM dbo.EmployeeDetail ed
        JOIN dbo.UserProfile u ON u.UserId = ed.UserId
        WHERE u.UserName = @un
    `);
    if (result.recordset && result.recordset.length > 0) {
        const uid = result.recordset[0].UserId;
        console.log(
            `[resolveHrisUserId] via UserName='${username}' -> UserId=${uid}`
        );
        return uid;
    }
    console.warn(
        `[resolveHrisUserId] No HRIS UserId for username='${username}' employeeId='${employeeId || '(none)'}'`
    );
    return null;
};

// HRIS lookup: every EmployeeEducation row for the caller, with the FK
// lookup tables resolved. Empty array if HRIS is unreachable or no row.
// Sorted by GraduationYear DESC so the most recent / highest degree
// renders first (MSc above BSc).
//
// Resolves UserId via EmployeeId first (stable, business-unique key),
// falling back to UserName JOINed with EmployeeDetail. Avoids the
// orphan-UserProfile trap where two rows share a UserName and one has
// no EmployeeDetail — the legacy join-less SELECT would pick the wrong
// one, leaving education records invisible.
const getEmployeeEducation = async (username, employeeId) => {
    try {
        await sql.connect(dbConfig);

        const userId = await _resolveHrisUserId(username, employeeId);
        if (userId == null) {
            console.warn(
                `[getEmployeeEducation] no UserId resolved for username='${username}' employeeId='${employeeId || '(none)'}'`
            );
            return [];
        }

        const eduReq = new sql.Request();
        eduReq.input('userId', sql.Int, userId);
        const query = `
            SELECT
                lvl.Level             AS EducationLevel,
                fld.Field             AS FieldOfStudy,
                inst.Institution      AS Institution,
                ee.CGPA               AS CGPA,
                ee.GraduationYear     AS GraduationYear,
                ee.Sponsorship        AS Sponsorship,
                ee.CommitmentLevel    AS CommitmentLevel,
                ee.Remark             AS Remark
            FROM dbo.EmployeeEducation ee
            LEFT JOIN dbo.luEducationLevel lvl  ON lvl.Id  = ee.Level
            LEFT JOIN dbo.luStudyField     fld  ON fld.Id  = ee.FieldOfStudy
            LEFT JOIN dbo.luInstitution    inst ON inst.Id = ee.Institution
            WHERE ee.UserId = @userId
            ORDER BY ee.GraduationYear DESC
        `;
        console.log(
            '[getEmployeeEducation] SQL:',
            query.replace(/\s+/g, ' ').trim(),
            `(@userId=${userId})`
        );
        const result = await eduReq.query(query);
        const rows = result.recordset || [];
        console.log(
            `[getEmployeeEducation] UserId=${userId} rows=${rows.length}`
        );
        if (rows.length > 0) {
            console.log(
                '[getEmployeeEducation] sample:',
                JSON.stringify(rows[0])
            );
        }
        return rows;
    } catch (e) {
        console.error(
            '[getEmployeeEducation] Error:',
            e.message,
            e.stack
        );
        return [];
    } finally {
        await sql.close();
    }
};

// HRIS lookup: every EmployeeCertification row for the caller, with the
// FK lookup tables resolved. Same UserId-resolution strategy as
// getEmployeeEducation — EmployeeId first, UserName JOINed fallback.
const getEmployeeCertifications = async (username, employeeId) => {
    try {
        await sql.connect(dbConfig);

        const userId = await _resolveHrisUserId(username, employeeId);
        if (userId == null) {
            console.warn(
                `[getEmployeeCertifications] no UserId resolved for username='${username}' employeeId='${employeeId || '(none)'}'`
            );
            return [];
        }

        const certReq = new sql.Request();
        certReq.input('userId', sql.Int, userId);
        const query = `
            SELECT
                ec.Status        AS Status,
                fld.Field        AS Field,
                inst.Institution AS Institution,
                ec.[To]          AS ToDate,
                ec.DateInterval  AS DateInterval
            FROM dbo.EmployeeCertification ec
            LEFT JOIN dbo.luStudyField  fld  ON fld.Id  = ec.FieldOfStudy
            LEFT JOIN dbo.luInstitution inst ON inst.Id = ec.Institution
            WHERE ec.UserId = @userId
            ORDER BY ec.[To] DESC
        `;
        console.log(
            '[getEmployeeCertifications] SQL:',
            query.replace(/\s+/g, ' ').trim(),
            `(@userId=${userId})`
        );
        const result = await certReq.query(query);
        const rows = result.recordset || [];
        console.log(
            `[getEmployeeCertifications] UserId=${userId} rows=${rows.length}`
        );
        if (rows.length > 0) {
            console.log(
                '[getEmployeeCertifications] sample:',
                JSON.stringify(rows[0])
            );
        }
        return rows;
    } catch (e) {
        console.error(
            '[getEmployeeCertifications] Error:',
            e.message,
            e.stack
        );
        return [];
    } finally {
        await sql.close();
    }
};

// HRIS lookup: the caller's address row, with Region resolved via the
// luCity → luRegion chain. Returns a single object or null.
//
// `***` is a common form-placeholder in the legacy HR app for "skip this
// field" — we strip it server-side so mobile / web don't have to. Caller
// gets either a real value or "".
const _sanitizeHris = (v) => {
    if (v == null) return "";
    const s = String(v).trim();
    return s === '***' ? '' : s;
};

const getEmployeeAddress = async (username, employeeId) => {
    try {
        await sql.connect(dbConfig);

        const userId = await _resolveHrisUserId(username, employeeId);
        if (userId == null) {
            console.warn(
                `[getEmployeeAddress] no UserId resolved for username='${username}' employeeId='${employeeId || '(none)'}'`
            );
            return null;
        }

        const req = new sql.Request();
        req.input('userId', sql.Int, userId);
        const query = `
            SELECT TOP 1
                r.[Name]      AS Region,
                c.[Name]      AS City,
                a.Zone        AS Zone,
                a.Woreda      AS Woreda,
                a.Kebele      AS Kebele,
                a.SubCity     AS SubCity,
                a.HouseNumber AS HouseNumber,
                a.POBox       AS POBox,
                a.Telephone   AS Telephone
            FROM dbo.EmployeeAddress a
            LEFT JOIN dbo.luCity   c ON c.Id = a.City
            LEFT JOIN dbo.luRegion r ON r.Id = c.Region
            WHERE a.UserId = @userId
        `;
        console.log(
            '[getEmployeeAddress] SQL:',
            query.replace(/\s+/g, ' ').trim(),
            `(@userId=${userId})`
        );
        const result = await req.query(query);
        const row = result.recordset && result.recordset[0];
        console.log(
            `[getEmployeeAddress] UserId=${userId} found=${row ? 'yes' : 'no'}`
        );
        if (row) console.log('[getEmployeeAddress] sample:', JSON.stringify(row));
        return row || null;
    } catch (e) {
        console.error('[getEmployeeAddress] Error:', e.message, e.stack);
        return null;
    } finally {
        await sql.close();
    }
};

// HRIS lookup: every EmployeeTraining row for the caller, with the FK
// lookup tables resolved. Sorted by [From] DESC then Id DESC, so the
// most recent training appears first.
//
// `Documents` (varbinary cert blob) is deliberately not selected — the
// profile screen doesn't need it and pulling MB-sized blobs over HTTP
// for every Education-tab open would be wasteful.
const getEmployeeTrainings = async (username, employeeId) => {
    try {
        await sql.connect(dbConfig);

        const userId = await _resolveHrisUserId(username, employeeId);
        if (userId == null) {
            console.warn(
                `[getEmployeeTrainings] no UserId resolved for username='${username}' employeeId='${employeeId || '(none)'}'`
            );
            return [];
        }

        const req = new sql.Request();
        req.input('userId', sql.Int, userId);
        const query = `
            SELECT
                tn.[Name]    AS TrainingName,
                tt.[Type]    AS TrainingType,
                et.Organizer AS Organizer,
                et.[From]    AS StartDate,
                et.[To]      AS EndDate,
                et.Other     AS Other
            FROM dbo.EmployeeTraining et
            LEFT JOIN dbo.luTrainingName tn ON tn.Id = et.TrainingName
            LEFT JOIN dbo.luTrainingType tt ON tt.Id = et.TrainingType
            WHERE et.UserId = @userId
            ORDER BY et.[From] DESC, et.Id DESC
        `;
        console.log(
            '[getEmployeeTrainings] SQL:',
            query.replace(/\s+/g, ' ').trim(),
            `(@userId=${userId})`
        );
        const result = await req.query(query);
        const rows = result.recordset || [];
        console.log(
            `[getEmployeeTrainings] UserId=${userId} rows=${rows.length}`
        );
        if (rows.length > 0) {
            console.log(
                '[getEmployeeTrainings] sample:',
                JSON.stringify(rows[0])
            );
        }
        return rows;
    } catch (e) {
        console.error('[getEmployeeTrainings] Error:', e.message, e.stack);
        return [];
    } finally {
        await sql.close();
    }
};

// ---------------------------------------------------------------------------
// Service-rating demographics
// ---------------------------------------------------------------------------
// Snapshot of the rater's HRIS profile, captured at the moment a service
// rating is submitted. HR slices satisfaction by gender / age / job grade /
// department / tenure, and the snapshot means those reports stay stable even
// after the employee is promoted or transferred.
//
// Both queries run inside ONE connect/close on purpose. Every helper in this
// file owns its own sql.connect + sql.close, so firing them concurrently
// (Promise.all) exhausts the mssql pool — the same trap that forced the
// serialization fix in routes/rms/auth.js. Two sequential requests on one
// open connection is both faster and safer.

// Internal-experience span, expressed as years + months + days.
//
// Measures MIN([From]) .. MAX([To]) across the employee's internal
// experience rows — i.e. continuous tenure at the bank, NOT the sum of each
// position's day count. An employee who held four positions back-to-back
// since 1 Feb 2024 reads "2 years, 5 months and 26 days", not the 904 days
// those four rows add up to. Tenure is what HR wants here.
//
// `useLookupTable` picks how "Internal" is identified:
//   true  -> JOIN luExperienceType ON t.ExpType = 'Internal'  (preferred)
//   false -> e.ExperienceType = 1                             (fallback)
// The rest of this file hardcodes the magic number 1; the lookup-table join
// is more robust but assumes luExperienceType exists in this HRIS instance.
// The caller tries the join first and falls back on SQL error.
const _internalExperienceSpan = async (userId, useLookupTable) => {
    const source = useLookupTable
        ? `FROM dbo.EmployeeExperience e
           JOIN dbo.luExperienceType t ON t.Id = e.ExperienceType
           WHERE e.UserId = @userId AND t.ExpType = 'Internal'`
        : `FROM dbo.EmployeeExperience e
           WHERE e.UserId = @userId AND e.ExperienceType = 1`;

    const query = `
        WITH ex AS (
            SELECT e.[From] AS StartDate,
                   COALESCE(e.[To], CAST(GETDATE() AS date)) AS EndDate
            ${source}
        ),
        span AS (
            SELECT MIN(StartDate) AS S, MAX(EndDate) AS E FROM ex
        ),
        y AS (
            SELECT S, E,
                   DATEDIFF(YEAR, S, E)
                     - CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, S, E), S) > E THEN 1 ELSE 0 END AS Yrs
            FROM span
            WHERE S IS NOT NULL AND E IS NOT NULL
        ),
        m AS (
            SELECT S, E, Yrs, DATEADD(YEAR, Yrs, S) AS A1 FROM y
        ),
        m2 AS (
            SELECT S, E, Yrs, A1,
                   DATEDIFF(MONTH, A1, E)
                     - CASE WHEN DATEADD(MONTH, DATEDIFF(MONTH, A1, E), A1) > E THEN 1 ELSE 0 END AS Mons
            FROM m
        )
        SELECT Yrs                                          AS Years,
               Mons                                         AS Months,
               DATEDIFF(DAY, DATEADD(MONTH, Mons, A1), E)   AS Days,
               DATEDIFF(DAY, S, E)                          AS TotalDays,
               S                                            AS FirstStart,
               E                                            AS LastEnd
        FROM m2
    `;

    const req = new sql.Request();
    req.input('userId', sql.Int, userId);
    const result = await req.query(query);
    return (result.recordset && result.recordset[0]) || null;
};

// Human-readable tenure, matching the phrasing HR uses in reports.
const _formatExperience = (span) => {
    if (!span) return "";
    const y = Number(span.Years) || 0;
    const m = Number(span.Months) || 0;
    const d = Number(span.Days) || 0;
    const parts = [];
    if (y > 0) parts.push(`${y} year${y === 1 ? "" : "s"}`);
    if (m > 0) parts.push(`${m} month${m === 1 ? "" : "s"}`);
    parts.push(`${d} day${d === 1 ? "" : "s"}`);
    if (parts.length === 1) return parts[0];
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

const getRatingProfile = async (username, employeeId) => {
    const empty = {
        gender: "",
        age: null,
        job_grade: "",
        department: "",
        place_of_assignment: "",
        current_position: "",
        employee_id: _sanitizeHris(employeeId),
        experience_years: null,
        experience_months: null,
        experience_days: null,
        experience_total_days: null,
        experience_text: "",
        employment_date: null,
    };

    try {
        await sql.connect(dbConfig);

        const userId = await _resolveHrisUserId(username, employeeId);
        if (userId == null) {
            console.warn(
                `[getRatingProfile] no UserId resolved for username='${username}' employeeId='${employeeId || '(none)'}'`
            );
            return empty;
        }

        // --- Query 1: gender, age, job grade, department -------------------
        // Age uses the birthday-adjusted DATEDIFF form so someone whose
        // birthday has not landed yet this year is not aged up a year early.
        const demoReq = new sql.Request();
        demoReq.input('userId', sql.Int, userId);
        const demoResult = await demoReq.query(`
            SELECT TOP 1
                a.[Sex]            AS Sex,
                a.[DateOfBirth]    AS DateOfBirth,
                a.[EmployeeId]     AS EmployeeId,
                a.[EmploymentDate] AS EmploymentDate,
                CASE WHEN a.[DateOfBirth] IS NULL THEN NULL ELSE
                    DATEDIFF(YEAR, a.[DateOfBirth], GETDATE())
                      - CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, a.[DateOfBirth], GETDATE()), a.[DateOfBirth]) > GETDATE()
                             THEN 1 ELSE 0 END
                END                AS Age,
                le.[Postion]       AS CurrentPosition,
                le.GradeName       AS JobGrade,
                le.DeptName        AS Department
            FROM dbo.EmployeeDetail a
            OUTER APPLY (
                SELECT TOP 1
                    p.[Postion],
                    g.[Name]    AS GradeName,
                    dept.[Name] AS DeptName
                FROM dbo.EmployeeExperience e
                JOIN dbo.luPosition p ON p.Id = e.Position
                LEFT JOIN dbo.luJobGrade g ON g.Id = p.Grade
                LEFT JOIN dbo.luDepartment dept ON dept.Id = p.Department
                WHERE e.UserId = a.UserId
                  AND e.ExperienceType = 1
                ORDER BY
                    CASE WHEN e.[To] IS NULL THEN 0 ELSE 1 END,
                    e.[From] DESC
            ) le
            WHERE a.UserId = @userId
        `);
        const demo = (demoResult.recordset && demoResult.recordset[0]) || {};

        // --- Query 2: internal experience span -----------------------------
        // Preferred form joins luExperienceType; fall back to the magic
        // number the rest of this file uses if that table is absent.
        let span = null;
        try {
            span = await _internalExperienceSpan(userId, true);
        } catch (e) {
            console.warn(
                '[getRatingProfile] luExperienceType join failed, falling back to ExperienceType=1:',
                e.message
            );
            try {
                span = await _internalExperienceSpan(userId, false);
            } catch (e2) {
                console.error('[getRatingProfile] experience span failed:', e2.message);
            }
        }

        // luDepartment is what getPlaceOfAssignment already surfaces (it
        // aliases the department name as "PositionName"), so department and
        // place of assignment resolve to the same HRIS value. Both are stored
        // so reports can group by either label without a migration later.
        const department = _sanitizeHris(demo.Department);

        const profile = {
            gender: _sanitizeHris(demo.Sex),
            age: demo.Age == null ? null : Number(demo.Age),
            job_grade: _sanitizeHris(demo.JobGrade),
            department,
            place_of_assignment: department,
            current_position: _sanitizeHris(demo.CurrentPosition),
            employee_id: _sanitizeHris(demo.EmployeeId) || _sanitizeHris(employeeId),
            experience_years: span ? Number(span.Years) : null,
            experience_months: span ? Number(span.Months) : null,
            experience_days: span ? Number(span.Days) : null,
            experience_total_days: span ? Number(span.TotalDays) : null,
            experience_text: _formatExperience(span),
            employment_date: demo.EmploymentDate || null,
        };

        console.log(
            `[getRatingProfile] UserId=${userId} sex='${profile.gender}' age=${profile.age} ` +
            `grade='${profile.job_grade}' dept='${profile.department}' exp='${profile.experience_text}'`
        );
        return profile;
    } catch (e) {
        console.error('[getRatingProfile] Error:', e.message, e.stack);
        return empty;
    } finally {
        await sql.close();
    }
};

export { test, guaranteCount, getEmploymentDate, getAmharicNames, updateAmharicNames, getUserPhoto, getPlaceOfAssignment, getEmployeeIdentity, getEmployeeEducation, getEmployeeCertifications, getEmployeeAddress, getEmployeeTrainings, getRatingProfile, _sanitizeHris };
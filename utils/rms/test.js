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

// HRIS lookup: every EmployeeEducation row for the caller, with the FK
// lookup tables resolved. Empty array if HRIS is unreachable or the row
// just isn't there yet. Sorted by GraduationYear DESC so the latest
// (highest) degree renders first — that's the order people expect on a
// profile (MSc above BSc, not the other way around).
const getEmployeeEducation = async (username) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

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
            JOIN dbo.UserProfile u ON u.UserId = ee.UserId
            LEFT JOIN dbo.luEducationLevel lvl  ON lvl.Id  = ee.Level
            LEFT JOIN dbo.luStudyField     fld  ON fld.Id  = ee.FieldOfStudy
            LEFT JOIN dbo.luInstitution    inst ON inst.Id = ee.Institution
            WHERE u.UserName = @username
            ORDER BY ee.GraduationYear DESC
        `;
        request.input('username', sql.NVarChar, username);
        const result = await request.query(query);
        return result.recordset || [];
    } catch (e) {
        console.error("Error fetching employee education:", e.message);
        return [];
    } finally {
        await sql.close();
    }
};

// HRIS lookup: every EmployeeCertification row for the caller, with the
// FK lookup tables resolved. Empty array on failure or no rows. Sorted
// by [To] DESC so the most-recent / still-valid certification appears
// first. Sibling of getEmployeeEducation — both feed the profile
// screen's Education tab.
const getEmployeeCertifications = async (username) => {
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();

        const query = `
            SELECT
                ec.Status        AS Status,
                fld.Field        AS Field,
                inst.Institution AS Institution,
                ec.[To]          AS ToDate,
                ec.DateInterval  AS DateInterval
            FROM dbo.EmployeeCertification ec
            JOIN dbo.UserProfile u ON u.UserId = ec.UserId
            LEFT JOIN dbo.luStudyField  fld  ON fld.Id  = ec.FieldOfStudy
            LEFT JOIN dbo.luInstitution inst ON inst.Id = ec.Institution
            WHERE u.UserName = @username
            ORDER BY ec.[To] DESC
        `;
        request.input('username', sql.NVarChar, username);
        const result = await request.query(query);
        return result.recordset || [];
    } catch (e) {
        console.error("Error fetching employee certifications:", e.message);
        return [];
    } finally {
        await sql.close();
    }
};

export { test, guaranteCount, getEmploymentDate, getAmharicNames, updateAmharicNames, getUserPhoto, getPlaceOfAssignment, getEmployeeIdentity, getEmployeeEducation, getEmployeeCertifications };
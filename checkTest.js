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
        const currencyFetchQuery = `
       SELECT a.[Name] + ' ' + a.[FName] + ' ' + a.[GFName] AS [FullName],
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

export { test };
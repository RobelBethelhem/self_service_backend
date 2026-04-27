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

export { test, guaranteCount, getEmploymentDate, getAmharicNames, updateAmharicNames, getUserPhoto, getPlaceOfAssignment };
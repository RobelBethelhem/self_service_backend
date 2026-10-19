// Employee profile — the signed-in employee's own HR record, read live from
// HRIS. Adapted from HRIS_Admin/Models/HRIS_EmployeeProfile.sql (same joins,
// same current-posting and org back-fill rules as vEmployeeMaster), reshaped
// so section 1 is one row of named columns the portal can lay out, and every
// date comes back as a 'YYYY-MM-DD' string so no timezone can shift it.
//
// Pure helpers: the caller supplies the mssql pool (routes/rms/Profile.js uses
// the dedicated reporting pool) and has already decided whose record this is.
// Nothing here ever accepts a login from the request body.

// Accept the login however it is stored: 'DOMAIN\Robel.Asfaw',
// 'robel.asfaw@...' and stray spaces all resolve to 'robel.asfaw'.
// UserProfile.UserName is case-insensitive.
export const normalizeLogin = (value) => {
    let login = String(value == null ? "" : value).trim();
    if (login.includes("\\")) login = login.slice(login.indexOf("\\") + 1);
    if (login.includes("@")) login = login.slice(0, login.indexOf("@"));
    return login.slice(0, 250);
};

// Result sets, in order:
//   0  person      one row; empty when the login has no HRIS account
//   1  education   degrees (latest first), then certifications
//   2  training    newest first, undated last
//   3  jobs        internal postings (current first), then previous employers
//   4  salary      pre-adjustment backup -> adjustment upload -> current
//   5  history     when the EmployeeDetail row was created / edited, and by whom
export const PROFILE_SQL = `
SET NOCOUNT ON;

DECLARE @UserId int, @UserName varchar(250), @Today date = CAST(GETDATE() AS date),
        @AsOf date, @CurrentPostingId int;

SELECT @UserId = UserId, @UserName = UserName FROM dbo.UserProfile WHERE UserName = @Login;

IF @UserId IS NULL
BEGIN
    SELECT HrisUserId = CAST(NULL AS int) WHERE 1 = 0;
    RETURN;
END;

/*  Age, service and time-in-post run to today for active staff and to the
    termination date for leavers, whose posting is then their last one.  */
SELECT @AsOf = TerminationDate FROM dbo.EmployeeDetail WHERE UserId = @UserId;
SET @AsOf = COALESCE(@AsOf, @Today);

/*  EmployeeDetail has no position column; the posting is the open internal
    EmployeeExperience row. Open rows first, then latest From, then highest Id.  */
SELECT TOP (1) @CurrentPostingId = Id
FROM dbo.EmployeeExperience
WHERE UserId = @UserId AND ExperienceType = 1
ORDER BY CASE WHEN [To] IS NULL THEN 0 ELSE 1 END, [From] DESC, Id DESC;

/* 0  PERSON */
SELECT  DomainUser        = up.UserName,
        HrisUserId        = up.UserId,
        EmployeeId        = d.EmployeeId,
        FirstName         = d.Name,
        FatherName        = d.FName,
        GrandfatherName   = d.GFName,
        FirstNameAm       = d.Name_am,
        FatherNameAm      = d.FName_am,
        GrandfatherNameAm = d.GFName_am,
        PreviousName      = NULLIF(d.NameChanged, ''),
        SystemRole        = ug.UserGroupName,
        Gender            = d.Sex,
        DateOfBirth       = CONVERT(char(10), d.DateOfBirth, 23),
        AgeMonths         = m.AgeM,
        MaritalStatus     = d.MaritalStatus,
        SpouseName        = NULLIF(d.SpouseName, ''),
        SpouseMedCoverage = d.SpouseMedCoverage,
        SpouseMedExpiry   = CONVERT(char(10), d.spousemedexpirydate, 23),
        TINNumber         = d.TINNumber,
        PensionNumber     = d.PensionNumber,
        HasDetail         = CASE WHEN d.UserId IS NULL THEN 0 ELSE 1 END,
        HasPhoto          = CASE WHEN d.Photo IS NULL THEN 0 ELSE 1 END,
        EmploymentType    = d.EmploymentType,
        EmploymentDate    = CONVERT(char(10), d.EmploymentDate, 23),
        ProbationDays     = d.ProbationDays,
        ProbationEnd      = CONVERT(char(10), DATEADD(DAY, d.ProbationDays, d.EmploymentDate), 23),
        TerminationDate   = CONVERT(char(10), d.TerminationDate, 23),
        TerminationReason = tr.Reason,
        ServiceMonths     = m.SvcM,
        CostSharing       = d.CostSharing,
        AppraisalResult   = d.AppraisalResult,
        Salary            = d.Salary,
        Position          = RTRIM(p.Postion),
        JobGrade          = g.Name,
        JobCategory       = jc.Category,
        Department        = dp.Name,
        Division          = dv.Name,
        Section           = sc.Name,
        BankingCenter     = bc.Name,
        InPositionSince   = CONVERT(char(10), cr.[From], 23),
        InPositionMonths  = m.PosM,
        Region            = rg.Name,
        City              = ct.Name,
        Zone              = NULLIF(ad.Zone,        N'***'),   -- '***' is the entry
        SubCity           = NULLIF(ad.SubCity,     N'***'),   -- screen's "not given"
        Woreda            = NULLIF(ad.Woreda,      N'***'),
        Kebele            = NULLIF(ad.Kebele,      N'***'),
        HouseNumber       = NULLIF(ad.HouseNumber, N'***'),
        POBox             = NULLIF(ad.POBox,       N'***'),
        Telephone         = NULLIF(ad.Telephone,   N'***'),
        AsOf              = CONVERT(char(10), @AsOf, 23)
FROM dbo.UserProfile up
LEFT JOIN dbo.EmployeeDetail d          ON d.UserId = up.UserId
LEFT JOIN dbo.luUserGroup ug            ON ug.UserGroupId = up.UserGroup
LEFT JOIN dbo.luTerminationReason tr    ON tr.Id = d.TerminationReason
OUTER APPLY (SELECT TOP (1) a.City, a.Zone, a.SubCity, a.Woreda, a.Kebele, a.HouseNumber, a.POBox, a.Telephone
             FROM dbo.EmployeeAddress a WHERE a.UserId = up.UserId ORDER BY a.Id DESC) ad
LEFT JOIN dbo.luCity ct                 ON ct.Id = ad.City
LEFT JOIN dbo.luRegion rg               ON rg.Id = ct.Region
LEFT JOIN dbo.EmployeeExperience cr     ON cr.Id = @CurrentPostingId
LEFT JOIN dbo.luPosition p              ON p.Id = cr.Position
CROSS APPLY (SELECT SectionId    = COALESCE(cr.Section,  p.Section)) s0
LEFT JOIN dbo.luSection sc              ON sc.Id = s0.SectionId
CROSS APPLY (SELECT DivisionId   = COALESCE(cr.Division, p.Division, sc.Division)) d0
LEFT JOIN dbo.luDivision dv             ON dv.Id = d0.DivisionId
CROSS APPLY (SELECT DepartmentId = COALESCE(cr.Department, p.Department, dv.Department, sc.Department)) dp0
LEFT JOIN dbo.luDepartment dp           ON dp.Id = dp0.DepartmentId
LEFT JOIN dbo.luJobGrade g              ON g.Id  = p.Grade
LEFT JOIN dbo.luJobCategory jc          ON jc.Id = p.Category
LEFT JOIN dbo.luBankingCenter bc        ON bc.Id = cr.BankingCenter
/*  Whole months between two dates.  */
CROSS APPLY (SELECT AgeM = DATEDIFF(MONTH, d.DateOfBirth,    @AsOf) - CASE WHEN DATEADD(MONTH, DATEDIFF(MONTH, d.DateOfBirth,    @AsOf), d.DateOfBirth)    > @AsOf THEN 1 ELSE 0 END
                  , SvcM = DATEDIFF(MONTH, d.EmploymentDate, @AsOf) - CASE WHEN DATEADD(MONTH, DATEDIFF(MONTH, d.EmploymentDate, @AsOf), d.EmploymentDate) > @AsOf THEN 1 ELSE 0 END
                  , PosM = DATEDIFF(MONTH, cr.[From],        @AsOf) - CASE WHEN DATEADD(MONTH, DATEDIFF(MONTH, cr.[From],        @AsOf), cr.[From])        > @AsOf THEN 1 ELSE 0 END) m
WHERE up.UserId = @UserId;

/* 1  EDUCATION - degrees first (latest graduation first), then certifications.
      Commitment is CommitmentLevel: 1 = Yes, 0 = No on both screens.  */
SELECT x.RecordType, x.Qualification, x.FieldOfStudy, x.Institution, x.YearOrPeriod,
       x.Result, x.Commitment, x.Sponsorship, x.Remark, x.DocumentOnFile
FROM (
    SELECT  Grp = 1, SortYear = ed.GraduationYear, SortId = ed.Id,
            RecordType     = 'Education',
            Qualification  = lv.[Level],
            FieldOfStudy   = sf.Field,
            Institution    = i.Institution,
            YearOrPeriod   = CAST(ed.GraduationYear AS nvarchar(100)),
            Result         = N'CGPA ' + NULLIF(LTRIM(RTRIM(ed.CGPA)), N''),
            Commitment     = CASE ed.CommitmentLevel WHEN 1 THEN 'Yes' WHEN 0 THEN 'No' END,
            Sponsorship    = NULLIF(ed.Sponsorship, N''),
            Remark         = NULLIF(ed.Remark, N''),
            DocumentOnFile = CASE WHEN ed.Documents IS NULL THEN 'No' ELSE 'Yes' END
    FROM dbo.EmployeeEducation ed
    LEFT JOIN dbo.luEducationLevel lv ON lv.Id = ed.[Level]
    LEFT JOIN dbo.luStudyField     sf ON sf.Id = ed.FieldOfStudy
    LEFT JOIN dbo.luInstitution    i  ON i.Id  = ed.Institution
    WHERE ed.UserId = @UserId

    UNION ALL

    SELECT  2, YEAR(COALESCE(c.[To], c.[From])), c.Id,
            'Certification',
            N'Certification',
            sf.Field,
            i.Institution,
            CASE WHEN c.[From] IS NOT NULL
                 THEN CONVERT(nvarchar(10), c.[From], 23) + N' to ' + ISNULL(CONVERT(nvarchar(10), c.[To], 23), N'?')
                 ELSE NULLIF(c.Other, N'') END,      -- no date interval: duration is free text
            NULLIF(c.Status, N''),
            CASE c.CommitmentLevel WHEN 1 THEN 'Yes' WHEN 0 THEN 'No' END,
            NULL,
            NULL,
            CASE WHEN c.Documents IS NULL THEN 'No' ELSE 'Yes' END
    FROM dbo.EmployeeCertification c
    LEFT JOIN dbo.luStudyField  sf ON sf.Id = c.FieldOfStudy
    LEFT JOIN dbo.luInstitution i  ON i.Id  = c.Institution
    WHERE c.UserId = @UserId
) x
ORDER BY x.Grp, x.SortYear DESC, x.SortId DESC;

/* 2  TRAINING - newest first; undated last. With no date interval the
      duration was typed into Other.  */
SELECT  Training       = RTRIM(tn.Name),
        TrainingType   = tt.[Type],
        t.Organizer,
        [From]         = CONVERT(char(10), t.[From], 23),
        [To]           = CONVERT(char(10), t.[To], 23),
        Duration       = CASE WHEN t.[From] IS NOT NULL AND t.[To] >= t.[From]
                              THEN CAST(DATEDIFF(DAY, t.[From], t.[To]) + 1 AS nvarchar(10)) + N' day(s)'
                              ELSE NULLIF(LTRIM(RTRIM(t.Other)), N'') END,
        DocumentOnFile = CASE WHEN t.Documents IS NULL THEN 'No' ELSE 'Yes' END
FROM dbo.EmployeeTraining t
LEFT JOIN dbo.luTrainingName tn ON tn.Id = t.TrainingName
LEFT JOIN dbo.luTrainingType tt ON tt.Id = t.TrainingType
WHERE t.UserId = @UserId
ORDER BY CASE WHEN t.[From] IS NULL THEN 1 ELSE 0 END, t.[From] DESC, t.Id DESC;

/* 3  JOB HISTORY - internal postings (current first), then previous employers.
      To dates are inclusive, so 1 Feb - 30 Jun counts as 5 months.  */
SELECT  TypeId         = e.ExperienceType,
        [Type]         = et.ExpType,
        Position       = COALESCE(RTRIM(p.Postion), NULLIF(e.Title, N'') COLLATE DATABASE_DEFAULT),   -- Title alone is _CS_AS
        JobGrade       = g.Name,
        Department     = dp.Name,
        Division       = dv.Name,
        Section        = sc.Name,
        BankingCenter  = bc.Name,
        Employer       = NULLIF(e.Institution, ''),
        WorkPlace      = NULLIF(e.WorkPLace, ''),
        [From]         = CONVERT(char(10), e.[From], 23),
        [To]           = CONVERT(char(10), e.[To], 23),
        DurationMonths = m.M,
        EndReason      = tr.Reason,
        DateOfRelease  = CONVERT(char(10), e.DateOfRelease, 23),
        IsCurrent      = CASE WHEN e.Id = @CurrentPostingId THEN 1 ELSE 0 END
FROM dbo.EmployeeExperience e
LEFT JOIN dbo.luExperienceType et       ON et.Id = e.ExperienceType
LEFT JOIN dbo.luPosition p              ON p.Id  = e.Position
CROSS APPLY (SELECT SectionId    = COALESCE(e.Section,  p.Section)) s0
LEFT JOIN dbo.luSection sc              ON sc.Id = s0.SectionId
CROSS APPLY (SELECT DivisionId   = COALESCE(e.Division, p.Division, sc.Division)) d0
LEFT JOIN dbo.luDivision dv             ON dv.Id = d0.DivisionId
CROSS APPLY (SELECT DepartmentId = COALESCE(e.Department, p.Department, dv.Department, sc.Department)) dp0
LEFT JOIN dbo.luDepartment dp           ON dp.Id = dp0.DepartmentId
LEFT JOIN dbo.luJobGrade g              ON g.Id  = p.Grade
LEFT JOIN dbo.luBankingCenter bc        ON bc.Id = e.BankingCenter
LEFT JOIN dbo.luTerminationReason tr    ON tr.Id = e.Reasonn
CROSS APPLY (SELECT S = e.[From],
                    X = CASE WHEN e.[To] IS NOT NULL THEN DATEADD(DAY, 1, e.[To]) ELSE @AsOf END) pr
CROSS APPLY (SELECT M = CASE WHEN pr.S IS NULL OR pr.X <= pr.S THEN NULL   -- missing or inverted dates
                             ELSE DATEDIFF(MONTH, pr.S, pr.X)
                                  - CASE WHEN DATEADD(MONTH, DATEDIFF(MONTH, pr.S, pr.X), pr.S) > pr.X THEN 1 ELSE 0 END
                        END) m
WHERE e.UserId = @UserId
ORDER BY e.ExperienceType, CASE WHEN e.[To] IS NULL THEN 0 ELSE 1 END, e.[From] DESC, e.Id DESC;

/* 4  SALARY - HRIS keeps ONE live salary and no dated history. Two side
      tables keep earlier figures: EmployeeDetailbk (copy taken before an
      adjustment) and empupload (the adjustment file). Each is read only if it
      exists, and a read the portal's login is not allowed is skipped, so the
      current salary always comes back.  */
DECLARE @Stages TABLE (Seq int, Stage nvarchar(60), Amount decimal(18, 2));

IF OBJECT_ID('dbo.EmployeeDetailbk', 'U') IS NOT NULL
BEGIN
    BEGIN TRY
        INSERT @Stages (Seq, Stage, Amount)
        SELECT 1, N'Before salary adjustment', b.Salary
        FROM dbo.EmployeeDetailbk b
        WHERE b.UserId = @UserId AND b.Salary IS NOT NULL;
    END TRY
    BEGIN CATCH
    END CATCH
END;

IF OBJECT_ID('dbo.empupload', 'U') IS NOT NULL
BEGIN
    BEGIN TRY
        INSERT @Stages (Seq, Stage, Amount)
        SELECT 2, N'Salary adjustment', u.salnew
        FROM dbo.EmployeeDetail d
        JOIN dbo.empupload u ON u.empid = d.EmployeeId
        WHERE d.UserId = @UserId AND u.salnew IS NOT NULL;
    END TRY
    BEGIN CATCH
    END CATCH
END;

INSERT @Stages (Seq, Stage, Amount)
SELECT 3, N'Current salary', d.Salary
FROM dbo.EmployeeDetail d
WHERE d.UserId = @UserId AND d.Salary IS NOT NULL;

SELECT  Stage,
        Amount,
        ChangeFromPrevious = Amount - LAG(Amount) OVER (ORDER BY Seq, Amount),
        ChangePct          = CAST(100.0 * (Amount - LAG(Amount) OVER (ORDER BY Seq, Amount))
                                  / NULLIF(LAG(Amount) OVER (ORDER BY Seq, Amount), 0) AS decimal(9, 1)),
        IsCurrent          = CASE WHEN Seq = 3 THEN 1 ELSE 0 END
FROM @Stages
ORDER BY Seq, Amount;

/* 5  RECORD HISTORY - every create / edit of this person's EmployeeDetail row.
      ActivityLog.UserName is the HR officer; the employee is named inside
      Activity, so the match is on the exact phrase. Skipped (empty) rather
      than failing the whole profile if the log cannot be read.  */
DECLARE @History TABLE (ChangedOn char(16), ChangedBy varchar(250), Action varchar(10),
                        LogDate datetime, LogId int);
BEGIN TRY
    INSERT @History (ChangedOn, ChangedBy, Action, LogDate, LogId)
    SELECT  CONVERT(char(16), l.logdate, 120),
            l.UserName,
            CASE WHEN l.Activity LIKE N'Created%' THEN 'created' ELSE 'edited' END,
            l.logdate,
            l.Id
    FROM dbo.ActivityLog l
    WHERE l.TableName = 'EmployeeDetail'
      AND l.Activity IN (N'Created new employee detail for ' + @UserName,
                         N'Edited employee detail of '       + @UserName);
END TRY
BEGIN CATCH
END CATCH;

SELECT ChangedOn, ChangedBy, Action FROM @History ORDER BY LogDate, LogId;
`;

// HRIS lookup names carry trailing and doubled spaces ("Technical ",
// "Risk &  Compliance"); tidy every string once here rather than in each view.
const tidyRow = (row) => {
    const out = {};
    Object.keys(row).forEach((key) => {
        const value = row[key];
        out[key] = typeof value === "string" ? value.replace(/\s+/g, " ").trim() || null : value;
    });
    return out;
};

const tidySet = (set) => (set || []).map(tidyRow);

export const loadEmployeeProfile = async (pool, login) => {
    const result = await pool.request().input("Login", login).query(PROFILE_SQL);
    const sets = result.recordsets || [];
    const person = sets[0] && sets[0][0];
    if (!person) return null;
    return {
        person: tidyRow(person),
        education: tidySet(sets[1]),
        training: tidySet(sets[2]),
        jobs: tidySet(sets[3]),
        salary: tidySet(sets[4]),
        history: tidySet(sets[5]),
    };
};

// EmployeeDetail.Photo holds whatever the HRIS entry screen was given: JPEG
// for almost everyone, a few PNG/BMP, and at least one PDF. Only real image
// formats are served; anything else is treated as "no photo".
export const photoMime = (buffer) => {
    if (!buffer || buffer.length < 4) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/gif";
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
    return null;
};

export const loadEmployeePhoto = async (pool, login) => {
    const result = await pool
        .request()
        .input("Login", login)
        .query(`
            SELECT d.Photo
            FROM dbo.UserProfile up
            JOIN dbo.EmployeeDetail d ON d.UserId = up.UserId
            WHERE up.UserName = @Login
        `);
    const row = result.recordset && result.recordset[0];
    const buffer = row && row.Photo;
    const mime = photoMime(buffer);
    return mime ? { buffer, mime } : null;
};

import sql from "mssql";

// ---------------------------------------------------------------------------
// Live HRIS reporting — no installed objects required
// ---------------------------------------------------------------------------
// The reporting pack (HRIS_Reporting.sql) installs a view, two snapshot tables,
// two scalar functions and a set of procedures. Installing them needs CREATE
// rights in HRIS, which the portal's SQL login does not have, and the snapshot
// means figures are only as fresh as the last nightly refresh.
//
// This module reproduces the same definitions as an inline CTE sent with every
// query, so the module works against a completely untouched HRIS database and
// always reads live data.
//
// The cost is what the pack's own notes measured: recomputing vEmployeeMaster
// is ~23 ms regardless of how many employees you ask for, against ~0.7 ms for
// reading the snapshot. For a reporting screen used by a handful of HR staff
// that is not a trade worth an install and a nightly job.
//
// WHAT IS REPRODUCED, and why each rule exists — the reasoning is the SQL
// author's, kept here so the two versions cannot silently diverge:
//
//   * CURRENT ASSIGNMENT. EmployeeDetail has no department or position column.
//     The current posting is the open internal row in EmployeeExperience; ten
//     employees have more than one, so the pick is deterministic — open rows
//     first, then latest From, then highest Id.
//   * ORG ATTRIBUTES ARE COALESCED. Division is null on 4,398 of 5,850 internal
//     rows and Section on 5,552, so they back-fill from the position's own place
//     in the org chart. A recorded assignment always beats the org-chart default.
//   * THE EDUCATION LADDER IS A HAND-WRITTEN CASE. luEducationLevel has no
//     usable order of its own — id 1 is PHD but id 4 is BA — so "highest
//     qualification" cannot be MAX(Level).
//   * AGE AND SERVICE ARE MEASURED AT THE EFFECTIVE DATE: today for active
//     staff, the termination date for leavers. Average age over leavers is
//     therefore average age AT EXIT, which is what turnover analysis needs.
//   * DATA-QUALITY GATES. Five unusable birth dates and four unusable
//     hire/termination dates are excluded from averages but still shown on
//     detail rows, so the record can be found and corrected.

// --- fn_YMD / fn_DaysToYMD, expanded inline --------------------------------
// Both are inline table-valued functions in the pack. Reproduced as OUTER APPLY
// blocks so no function has to exist in the database.

const ymdApply = (alias, from, to) => `
OUTER APPLY (
    SELECT Yrs = y.Yrs, Mons = m.Mons, Dys = dd.Dys,
           Text = CASE WHEN ${from} IS NULL OR ${to} IS NULL OR ${to} < ${from} THEN NULL
                       ELSE CAST(y.Yrs  AS varchar(10)) + ' year'  + CASE WHEN y.Yrs  = 1 THEN '' ELSE 's' END + ', '
                          + CAST(m.Mons AS varchar(10)) + ' month' + CASE WHEN m.Mons = 1 THEN '' ELSE 's' END + ' and '
                          + CAST(dd.Dys AS varchar(10)) + ' day'   + CASE WHEN dd.Dys = 1 THEN '' ELSE 's' END END
    FROM (SELECT Yrs = CASE WHEN ${from} IS NULL OR ${to} IS NULL OR ${to} < ${from} THEN NULL
                            ELSE DATEDIFF(YEAR, ${from}, ${to})
                                 - CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, ${from}, ${to}), ${from}) > ${to}
                                        THEN 1 ELSE 0 END END) y
    CROSS APPLY (SELECT A1 = DATEADD(YEAR, y.Yrs, ${from})) a
    CROSS APPLY (SELECT Mons = CASE WHEN y.Yrs IS NULL THEN NULL
                                    ELSE DATEDIFF(MONTH, a.A1, ${to})
                                         - CASE WHEN DATEADD(MONTH, DATEDIFF(MONTH, a.A1, ${to}), a.A1) > ${to}
                                                THEN 1 ELSE 0 END END) m
    CROSS APPLY (SELECT Dys = CASE WHEN m.Mons IS NULL THEN NULL
                                   ELSE DATEDIFF(DAY, DATEADD(MONTH, m.Mons, a.A1), ${to}) END) dd
) ${alias}`;

// Summed non-contiguous periods have no single start/end pair to walk, so this
// uses the conventional 365-day year / 30-day month approximation. It can
// differ from the calendar-exact form by a few days.
const daysYmdApply = (alias, days) => `
OUTER APPLY (
    SELECT Yrs = y.Yrs, Mons = m.Mons, Dys = m.Rem % 30,
           Text = CASE WHEN (${days}) IS NULL THEN NULL
                       ELSE CAST(y.Yrs AS varchar(10))      + ' year'  + CASE WHEN y.Yrs = 1      THEN '' ELSE 's' END + ', '
                          + CAST(m.Mons AS varchar(10))     + ' month' + CASE WHEN m.Mons = 1     THEN '' ELSE 's' END + ' and '
                          + CAST(m.Rem % 30 AS varchar(10)) + ' day'   + CASE WHEN m.Rem % 30 = 1 THEN '' ELSE 's' END END
    FROM (SELECT Yrs = (${days}) / 365, Rem0 = (${days}) % 365) y
    CROSS APPLY (SELECT Mons = y.Rem0 / 30, Rem = y.Rem0) m
) ${alias}`;

// Repeated three times in the original; named once here.
const TOT_DAYS = "(ISNULL(DATEDIFF(DAY, ie.FirstStart, ie.LastEnd),0) + ISNULL(ex.SumDays,0))";

// --- the master CTE --------------------------------------------------------

export const MASTER_CTE = `
WITH CurRow AS (
    SELECT e.UserId, e.Department, e.Division, e.Section, e.Position, e.BankingCenter,
           e.[From] AS AssignmentStart, e.[To] AS AssignmentEnd,
           ROW_NUMBER() OVER (PARTITION BY e.UserId
                              ORDER BY CASE WHEN e.[To] IS NULL THEN 0 ELSE 1 END,
                                       e.[From] DESC, e.Id DESC) AS rn
    FROM dbo.EmployeeExperience e
    WHERE e.ExperienceType = 1
),
IntExp AS (
    SELECT UserId,
           FirstStart = MIN([From]),
           LastEnd    = MAX(COALESCE([To], CAST(GETDATE() AS date))),
           Postings   = COUNT(*),
           SumDays    = SUM(CASE WHEN DATEDIFF(DAY, [From], COALESCE([To], CAST(GETDATE() AS date))) > 0
                                 THEN DATEDIFF(DAY, [From], COALESCE([To], CAST(GETDATE() AS date)))
                                 ELSE 0 END)
    FROM dbo.EmployeeExperience
    WHERE ExperienceType = 1 AND [From] IS NOT NULL
    GROUP BY UserId
),
ExtExp AS (
    SELECT UserId,
           SumDays = SUM(CASE WHEN [From] IS NOT NULL AND [To] IS NOT NULL AND [To] > [From]
                               AND DATEDIFF(DAY, [From], [To]) / 365.25 <= 45
                              THEN DATEDIFF(DAY, [From], [To]) ELSE 0 END)
    FROM dbo.EmployeeExperience
    WHERE ExperienceType = 2
    GROUP BY UserId
),
EduRanked AS (
    SELECT ed.UserId, ed.[Level] AS LevelId, ed.FieldOfStudy, ed.Institution,
           ed.GraduationYear, ed.CGPA, r.n AS EduRank,
           ROW_NUMBER() OVER (PARTITION BY ed.UserId
                              ORDER BY r.n DESC, ed.GraduationYear DESC, ed.Id DESC) AS rn
    FROM dbo.EmployeeEducation ed
    CROSS APPLY (SELECT n = CASE ed.[Level]
                    WHEN 1    THEN 100 WHEN 2    THEN  90 WHEN 4018 THEN  90
                    WHEN 1015 THEN  90 WHEN 2014 THEN  90 WHEN 12   THEN  90
                    WHEN 5023 THEN  90 WHEN 5020 THEN  90 WHEN 5022 THEN  85
                    WHEN 4    THEN  80 WHEN 11   THEN  80 WHEN 5019 THEN  80
                    WHEN 5021 THEN  80 WHEN 3    THEN  70 WHEN 8    THEN  60
                    WHEN 13   THEN  60 WHEN 10   THEN  55 WHEN 9    THEN  54
                    WHEN 1012 THEN  53 WHEN 1011 THEN  52 WHEN 1014 THEN  51
                    WHEN 5018 THEN  46 WHEN 3017 THEN  45 WHEN 7    THEN  40
                    WHEN 3016 THEN  40 WHEN 6    THEN  30 WHEN 3015 THEN  30
                    WHEN 1013 THEN  25 WHEN 5    THEN  20 WHEN 3014 THEN  20
                    ELSE 0 END) r
),
Addr AS (
    SELECT UserId, City, SubCity, Telephone, Woreda,
           ROW_NUMBER() OVER (PARTITION BY UserId ORDER BY Id DESC) AS rn
    FROM dbo.EmployeeAddress
),
Disc AS (SELECT UserId, N = COUNT(*) FROM dbo.Discipline            GROUP BY UserId),
Cert AS (SELECT UserId, N = COUNT(*) FROM dbo.EmployeeCertification GROUP BY UserId),
Trn  AS (SELECT UserId, N = COUNT(*) FROM dbo.EmployeeTraining      GROUP BY UserId),
GL   AS (SELECT UserId, N = COUNT(*) FROM dbo.GuaranteeLetter       GROUP BY UserId),
Master AS (
SELECT
      d.UserId, d.EmployeeId
    , d.Name + ' ' + d.FName + ' ' + d.GFName AS FullName
    , d.Sex AS Gender, d.MaritalStatus, d.EmploymentType
    , CASE WHEN d.TerminationDate IS NULL THEN 'Active' ELSE 'Terminated' END AS EmploymentStatus
    , d.TINNumber, d.PensionNumber
    , d.DateOfBirth
    , age.Yrs AS Age, age.Text AS AgeText
    , CASE WHEN dq.AgeIsPlausible = 1 THEN age.Yrs END AS AgeForStats
    , dq.AgeIsPlausible
    , CASE WHEN dq.AgeIsPlausible = 0 THEN 'Unknown'
           WHEN age.Yrs < 25 THEN 'Under 25' WHEN age.Yrs < 30 THEN '25-29'
           WHEN age.Yrs < 35 THEN '30-34'    WHEN age.Yrs < 40 THEN '35-39'
           WHEN age.Yrs < 45 THEN '40-44'    WHEN age.Yrs < 50 THEN '45-49'
           WHEN age.Yrs < 55 THEN '50-54'    WHEN age.Yrs < 60 THEN '55-59'
           ELSE '60+' END AS AgeBand
    , CASE WHEN dq.AgeIsPlausible = 1
           THEN DATEDIFF(YEAR, d.DateOfBirth, d.EmploymentDate)
                - CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, d.DateOfBirth, d.EmploymentDate), d.DateOfBirth)
                            > d.EmploymentDate THEN 1 ELSE 0 END END AS AgeAtHire
    , d.EmploymentDate, svc.Yrs AS ServiceYears, svc.Text AS ServiceText
    , CAST(DATEDIFF(DAY, d.EmploymentDate, eff.E) / 365.25 AS decimal(9,2)) AS ServiceYearsDec
    , sq.ServiceIsPlausible
    , CASE WHEN sq.ServiceIsPlausible = 1
           THEN CAST(DATEDIFF(DAY, d.EmploymentDate, eff.E) / 365.25 AS decimal(9,2)) END AS ServiceForStats
    , CASE WHEN sq.ServiceIsPlausible = 0 THEN 'Unknown'
           WHEN svc.Yrs IS NULL THEN 'Unknown'
           WHEN svc.Yrs <  1 THEN 'Under 1 year' WHEN svc.Yrs <  3 THEN '1-2 years'
           WHEN svc.Yrs <  6 THEN '3-5 years'    WHEN svc.Yrs < 11 THEN '6-10 years'
           WHEN svc.Yrs < 16 THEN '11-15 years'  WHEN svc.Yrs < 21 THEN '16-20 years'
           ELSE 'Over 20 years' END AS ServiceBand
    , YEAR(d.EmploymentDate)  AS HireYear
    , MONTH(d.EmploymentDate) AS HireMonth
    , DATENAME(MONTH, d.EmploymentDate) AS HireMonthName
    , CAST(YEAR(d.EmploymentDate) AS varchar(4)) + '-Q'
        + CAST(DATEPART(QUARTER, d.EmploymentDate) AS varchar(1)) AS HireQuarter
    , CASE WHEN d.TerminationDate IS NULL
             AND DATEADD(DAY, ISNULL(d.ProbationDays,0), d.EmploymentDate) >= eff.E
           THEN 1 ELSE 0 END AS IsOnProbation
    , d.TerminationDate, d.TerminationReason AS TerminationReasonId
    , ISNULL(tr.Reason, '(Not recorded)') AS TerminationReason
    , YEAR(d.TerminationDate) AS TerminationYear
    , iy.Text AS InternalExperienceText
    , CAST(ISNULL(DATEDIFF(DAY, ie.FirstStart, ie.LastEnd), 0) / 365.25 AS decimal(9,2)) AS InternalExpYears
    , CAST(ISNULL(ex.SumDays, 0) / 365.25 AS decimal(9,2)) AS ExternalExpYears
    , ey.Text AS ExternalExperienceText
    , CAST(${TOT_DAYS} / 365.25 AS decimal(9,2)) AS TotalExpYears
    , ty.Text AS TotalExperienceText
    , CASE WHEN ${TOT_DAYS} / 365.25 <  2 THEN 'Under 2 years'
           WHEN ${TOT_DAYS} / 365.25 <  6 THEN '2-5 years'
           WHEN ${TOT_DAYS} / 365.25 < 11 THEN '6-10 years'
           WHEN ${TOT_DAYS} / 365.25 < 16 THEN '11-15 years'
           WHEN ${TOT_DAYS} / 365.25 < 21 THEN '16-20 years'
           ELSE 'Over 20 years' END AS TotalExpBand
    , ISNULL(ie.Postings, 0) - CASE WHEN ie.Postings > 0 THEN 1 ELSE 0 END AS InternalMoves
    , CASE WHEN ISNULL(ie.Postings,0) <= 1 THEN 'No move yet'
           WHEN ie.Postings = 2 THEN '1 move'
           WHEN ie.Postings = 3 THEN '2 moves'
           WHEN ie.Postings <= 6 THEN '3-5 moves'
           ELSE 'Over 5 moves' END AS InternalMovesBand
    , cr.AssignmentStart AS CurrentAssignmentStart
    , pyd.Text AS TimeInCurrentPosition
    , CAST(DATEDIFF(DAY, cr.AssignmentStart, eff.E) / 365.25 AS decimal(9,2)) AS PositionTenureYears
    , CASE WHEN cr.AssignmentStart IS NULL THEN 'Unknown'
           WHEN DATEDIFF(DAY, cr.AssignmentStart, eff.E)/365.25 <  1 THEN 'Under 1 year'
           WHEN DATEDIFF(DAY, cr.AssignmentStart, eff.E)/365.25 <  3 THEN '1-2 years'
           WHEN DATEDIFF(DAY, cr.AssignmentStart, eff.E)/365.25 <  6 THEN '3-5 years'
           WHEN DATEDIFF(DAY, cr.AssignmentStart, eff.E)/365.25 < 11 THEN '6-10 years'
           ELSE 'Over 10 years' END AS PositionTenureBand
    , pr0.PresidentId, ISNULL(pr.Name, '(Unassigned)') AS President
    , dp0.DepartmentId, ISNULL(dp.Name, '(Unassigned)') AS Department
    , d0.DivisionId,    ISNULL(dv.Name, '(Unassigned)') AS Division
    , s0.SectionId,     ISNULL(sc.Name, '(Unassigned)') AS Section
    , cr.Position AS PositionId, ISNULL(p.Postion, '(Unassigned)') AS Position
    , p.Grade AS JobGradeId, ISNULL(g.Name, '(Unassigned)') AS JobGrade
    , CASE p.Grade
           WHEN 1 THEN 10 WHEN 2 THEN 20 WHEN 3 THEN 30 WHEN 4 THEN 40 WHEN 5 THEN 50
           WHEN 1023 THEN 51 WHEN 7 THEN 52 WHEN 1020 THEN 53 WHEN 8 THEN 60
           WHEN 9 THEN 70 WHEN 10 THEN 80 WHEN 1024 THEN 90 WHEN 12 THEN 100
           WHEN 13 THEN 110 WHEN 14 THEN 120 WHEN 15 THEN 130 WHEN 16 THEN 140
           WHEN 17 THEN 150 WHEN 18 THEN 160 ELSE 999 END AS JobGradeSort
    , p.Category AS JobCategoryId, ISNULL(jc.Category, '(Unassigned)') AS JobCategory
    , cr.BankingCenter AS BankingCenterId, ISNULL(bc.Name, '(Head Office / None)') AS BankingCenter
    , ISNULL(bc.Grade, '(n/a)') AS BranchGrade
    , el.LevelId AS EducationLevelId, ISNULL(lel.[Level], '(Unknown)') AS EducationLevel
    , ISNULL(el.EduRank, 0) AS EducationRank
    , el.FieldOfStudy AS StudyFieldId, ISNULL(sf.Field, '(Unknown)') AS StudyField
    , el.Institution AS InstitutionId, ISNULL(inst.Institution, '(Unknown)') AS Institution
    , el.GraduationYear, el.CGPA
    , ad.City AS CityId, ISNULL(ct.Name, '(Unknown)') AS City
    , ct.Region AS RegionId, ISNULL(rg.Name, '(Unknown)') AS Region
    , ISNULL(ad.SubCity, '(Unknown)') AS SubCity, ad.Woreda, ad.Telephone
    , d.Salary
    , CASE WHEN d.Salary IS NULL OR d.Salary = 0 THEN '(Not recorded)'
           WHEN d.Salary <  10000 THEN 'Under 10,000'   WHEN d.Salary <  25000 THEN '10,000-24,999'
           WHEN d.Salary <  50000 THEN '25,000-49,999'  WHEN d.Salary <  75000 THEN '50,000-74,999'
           WHEN d.Salary < 100000 THEN '75,000-99,999'  WHEN d.Salary < 150000 THEN '100,000-149,999'
           ELSE '150,000+' END AS SalaryBand
    , CASE WHEN ISNULL(gl.N,0)   > 0 THEN 1 ELSE 0 END AS HasGuaranteeLetter
    , CASE WHEN ISNULL(dsc.N,0)  > 0 THEN 1 ELSE 0 END AS HasDiscipline
    , ISNULL(dsc.N, 0) AS DisciplineCount
    , ISNULL(crt.N, 0) AS CertificationCount
    , ISNULL(trn.N, 0) AS TrainingCount
    , CASE WHEN d.Photo IS NULL THEN 0 ELSE 1 END AS HasPhoto
FROM dbo.EmployeeDetail d
LEFT JOIN CurRow cr            ON cr.UserId = d.UserId AND cr.rn = 1
LEFT JOIN dbo.luPosition p     ON p.Id  = cr.Position
CROSS APPLY (SELECT SectionId    = COALESCE(cr.Section,  p.Section)) s0
LEFT JOIN dbo.luSection sc     ON sc.Id = s0.SectionId
CROSS APPLY (SELECT DivisionId   = COALESCE(cr.Division, p.Division, sc.Division)) d0
LEFT JOIN dbo.luDivision dv    ON dv.Id = d0.DivisionId
CROSS APPLY (SELECT DepartmentId = COALESCE(cr.Department, p.Department, dv.Department, sc.Department)) dp0
LEFT JOIN dbo.luDepartment dp  ON dp.Id = dp0.DepartmentId
CROSS APPLY (SELECT PresidentId  = COALESCE(dp.President, dv.President, p.President)) pr0
LEFT JOIN dbo.luPresident pr   ON pr.Id = pr0.PresidentId
LEFT JOIN dbo.luJobGrade g     ON g.Id  = p.Grade
LEFT JOIN dbo.luJobCategory jc ON jc.Id = p.Category
LEFT JOIN dbo.luBankingCenter bc ON bc.Id = cr.BankingCenter
LEFT JOIN dbo.luTerminationReason tr ON tr.Id = d.TerminationReason
LEFT JOIN IntExp ie            ON ie.UserId = d.UserId
LEFT JOIN ExtExp ex            ON ex.UserId = d.UserId
LEFT JOIN EduRanked el         ON el.UserId = d.UserId AND el.rn = 1
LEFT JOIN dbo.luEducationLevel lel ON lel.Id = el.LevelId
LEFT JOIN dbo.luStudyField sf  ON sf.Id = el.FieldOfStudy
LEFT JOIN dbo.luInstitution inst ON inst.Id = el.Institution
LEFT JOIN Addr ad              ON ad.UserId = d.UserId AND ad.rn = 1
LEFT JOIN dbo.luCity ct        ON ct.Id = ad.City
LEFT JOIN dbo.luRegion rg      ON rg.Id = ct.Region
LEFT JOIN Disc dsc             ON dsc.UserId = d.UserId
LEFT JOIN Cert crt             ON crt.UserId = d.UserId
LEFT JOIN Trn  trn             ON trn.UserId = d.UserId
LEFT JOIN GL   gl              ON gl.UserId  = d.UserId
CROSS APPLY (SELECT E = COALESCE(d.TerminationDate, CAST(GETDATE() AS date))) eff
CROSS APPLY (SELECT AgeIsPlausible = CASE WHEN d.DateOfBirth IS NULL THEN 0
                                          WHEN d.DateOfBirth < '1940-01-01' THEN 0
                                          WHEN d.DateOfBirth > DATEADD(YEAR, -15, eff.E) THEN 0
                                          ELSE 1 END) dq
CROSS APPLY (SELECT ServiceIsPlausible = CASE
                        WHEN d.EmploymentDate IS NULL THEN 0
                        WHEN d.EmploymentDate < '1975-01-01' THEN 0
                        WHEN d.EmploymentDate > eff.E THEN 0
                        WHEN DATEDIFF(DAY, d.EmploymentDate, eff.E) / 365.25 > 45 THEN 0
                        ELSE 1 END) sq
${ymdApply("age", "d.DateOfBirth", "eff.E")}
${ymdApply("svc", "d.EmploymentDate", "eff.E")}
${ymdApply("iy", "ie.FirstStart", "ie.LastEnd")}
${ymdApply("pyd", "cr.AssignmentStart", "COALESCE(cr.AssignmentEnd, eff.E)")}
${daysYmdApply("ey", "ISNULL(ex.SumDays, 0)")}
${daysYmdApply("ty", `ISNULL(DATEDIFF(DAY, ie.FirstStart, ie.LastEnd), 0) + ISNULL(ex.SumDays, 0)`)}
)`;

// --- dimensions ------------------------------------------------------------
// The installed pack materialises these into EmployeeReportDim. Here they are
// expressions over Master, so the same names group and pivot identically.
// SortKey drives "Natural" ordering; null means alphabetical reads fine.
export const DIMENSIONS = {
    President: { label: "m.President", sort: null },
    Department: { label: "m.Department", sort: null },
    Division: { label: "m.Division", sort: null },
    Section: { label: "m.Section", sort: null },
    Position: { label: "m.Position", sort: null },
    JobGrade: { label: "m.JobGrade", sort: "m.JobGradeSort" },
    JobCategory: { label: "m.JobCategory", sort: null },
    BankingCenter: { label: "m.BankingCenter", sort: null },
    BranchGrade: { label: "m.BranchGrade", sort: null },
    Region: { label: "m.Region", sort: null },
    City: { label: "m.City", sort: null },
    SubCity: { label: "m.SubCity", sort: null },
    Gender: { label: "m.Gender", sort: null },
    MaritalStatus: { label: "m.MaritalStatus", sort: null },
    EmploymentType: { label: "m.EmploymentType", sort: null },
    EmploymentStatus: { label: "m.EmploymentStatus", sort: null },
    EducationLevel: { label: "m.EducationLevel", sort: "-m.EducationRank" },
    StudyField: { label: "m.StudyField", sort: null },
    Institution: { label: "m.Institution", sort: null },
    AgeBand: {
        label: "m.AgeBand",
        sort: `CASE m.AgeBand WHEN 'Under 25' THEN 1 WHEN '25-29' THEN 2 WHEN '30-34' THEN 3
                              WHEN '35-39' THEN 4 WHEN '40-44' THEN 5 WHEN '45-49' THEN 6
                              WHEN '50-54' THEN 7 WHEN '55-59' THEN 8 WHEN '60+' THEN 9
                              ELSE 99 END`,
    },
    ServiceBand: {
        label: "m.ServiceBand",
        sort: `CASE m.ServiceBand WHEN 'Under 1 year' THEN 1 WHEN '1-2 years' THEN 2
                                  WHEN '3-5 years' THEN 3 WHEN '6-10 years' THEN 4
                                  WHEN '11-15 years' THEN 5 WHEN '16-20 years' THEN 6
                                  WHEN 'Over 20 years' THEN 7 ELSE 99 END`,
    },
    TotalExpBand: {
        label: "m.TotalExpBand",
        sort: `CASE m.TotalExpBand WHEN 'Under 2 years' THEN 1 WHEN '2-5 years' THEN 2
                                   WHEN '6-10 years' THEN 3 WHEN '11-15 years' THEN 4
                                   WHEN '16-20 years' THEN 5 ELSE 6 END`,
    },
    PositionTenureBand: {
        label: "m.PositionTenureBand",
        sort: `CASE m.PositionTenureBand WHEN 'Under 1 year' THEN 1 WHEN '1-2 years' THEN 2
                                         WHEN '3-5 years' THEN 3 WHEN '6-10 years' THEN 4
                                         WHEN 'Over 10 years' THEN 5 ELSE 99 END`,
    },
    InternalMovesBand: {
        label: "m.InternalMovesBand",
        sort: `CASE m.InternalMovesBand WHEN 'No move yet' THEN 1 WHEN '1 move' THEN 2
                                        WHEN '2 moves' THEN 3 WHEN '3-5 moves' THEN 4
                                        ELSE 5 END`,
    },
    SalaryBand: {
        label: "m.SalaryBand",
        sort: `CASE m.SalaryBand WHEN '(Not recorded)' THEN 0 WHEN 'Under 10,000' THEN 1
                                 WHEN '10,000-24,999' THEN 2 WHEN '25,000-49,999' THEN 3
                                 WHEN '50,000-74,999' THEN 4 WHEN '75,000-99,999' THEN 5
                                 WHEN '100,000-149,999' THEN 6 ELSE 7 END`,
    },
    HireYear: { label: "CAST(m.HireYear AS nvarchar(10))", sort: "m.HireYear" },
    HireMonthName: { label: "m.HireMonthName", sort: "m.HireMonth" },
    HireQuarter: { label: "m.HireQuarter", sort: "m.HireYear * 10 + DATEPART(QUARTER, m.EmploymentDate)" },
    TerminationYear: {
        label: "ISNULL(CAST(m.TerminationYear AS nvarchar(10)), '(Still employed)')",
        sort: "ISNULL(m.TerminationYear, 9999)",
    },
    TerminationReason: { label: "m.TerminationReason", sort: null },
    IsOnProbation: {
        label: "CASE WHEN m.IsOnProbation = 1 THEN 'On probation' ELSE 'Confirmed' END",
        sort: "m.IsOnProbation",
    },
};

export const DIMENSION_NAMES = Object.keys(DIMENSIONS);

// --- parameter collector ---------------------------------------------------
// Every literal that comes from the caller becomes a named parameter. Nothing
// user-supplied is ever concatenated into the SQL text.
export const makeParams = () => {
    const params = [];
    const add = (type, value) => {
        const name = `p${params.length}`;
        params.push({ name, type, value });
        return `@${name}`;
    };
    return { params, add };
};

export const applyParams = (request, params) => {
    params.forEach((p) => request.input(p.name, p.type, p.value));
};

// --- filters ---------------------------------------------------------------

const idList = (raw) => {
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    return list
        .map((v) => String(v).trim())
        .filter((v) => v !== "" && /^-?\d+$/.test(v))
        .map((v) => Number(v));
};

const textList = (raw) => {
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    return list.map((v) => String(v).trim()).filter((v) => v !== "");
};

const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";

// Column each id-list filter tests against.
const ID_FILTERS = {
    UserIds: "m.UserId",
    Presidents: "m.PresidentId",
    Departments: "m.DepartmentId",
    Divisions: "m.DivisionId",
    Sections: "m.SectionId",
    Positions: "m.PositionId",
    JobGrades: "m.JobGradeId",
    JobCategories: "m.JobCategoryId",
    BankingCenters: "m.BankingCenterId",
    Cities: "m.CityId",
    Regions: "m.RegionId",
    EducationLevels: "m.EducationLevelId",
    Institutions: "m.InstitutionId",
    TerminationReasons: "m.TerminationReasonId",
};

const RANGE_FILTERS = [
    ["AgeFrom", "AgeTo", "m.Age", sql.Int],
    ["ServiceFrom", "ServiceTo", "m.ServiceYearsDec", sql.Decimal(9, 2)],
    ["IntExpFrom", "IntExpTo", "m.InternalExpYears", sql.Decimal(9, 2)],
    ["ExtExpFrom", "ExtExpTo", "m.ExternalExpYears", sql.Decimal(9, 2)],
    ["TotExpFrom", "TotExpTo", "m.TotalExpYears", sql.Decimal(9, 2)],
    ["PositionTenureFrom", "PositionTenureTo", "m.PositionTenureYears", sql.Decimal(9, 2)],
    ["InternalMovesFrom", "InternalMovesTo", "m.InternalMoves", sql.Int],
    ["SalaryFrom", "SalaryTo", "m.Salary", sql.Decimal(18, 2)],
];

const DATE_FILTERS = [
    ["HiredFrom", "HiredTo", "m.EmploymentDate"],
    ["TerminatedFrom", "TerminatedTo", "m.TerminationDate"],
    ["DobFrom", "DobTo", "m.DateOfBirth"],
];

const EXACT_FILTERS = [
    ["Gender", "m.Gender", sql.VarChar(10)],
    ["MaritalStatus", "m.MaritalStatus", sql.VarChar(30)],
    ["EmploymentType", "m.EmploymentType", sql.VarChar(50)],
    ["BranchGrade", "m.BranchGrade", sql.VarChar(10)],
];

const LIKE_FILTERS = [
    ["EmployeeId", "m.EmployeeId", sql.VarChar(250)],
    ["TIN", "m.TINNumber", sql.VarChar(20)],
    ["NameLike", "m.FullName", sql.NVarChar(300)],
    ["SubCityLike", "m.SubCity", sql.NVarChar(250)],
];

const BIT_FILTERS = [
    ["HasGuaranteeLetter", "m.HasGuaranteeLetter"],
    ["HasDiscipline", "m.HasDiscipline"],
    ["HasPhoto", "m.HasPhoto"],
    ["IsOnProbation", "m.IsOnProbation"],
];

const present = (v) => v !== undefined && v !== null && v !== "";

// Builds the WHERE body. Mirrors usp_EmployeeFilterResolve, including its
// convention: absent = filter off, 'All' = no filter.
export const buildWhere = (filters, add) => {
    const f = filters || {};
    const parts = [];

    Object.entries(ID_FILTERS).forEach(([key, column]) => {
        if (!present(f[key])) return;
        const ids = idList(f[key]);
        if (!ids.length) return;
        const placeholders = ids.map((id) => add(sql.Int, id)).join(", ");
        parts.push(`${column} IN (${placeholders})`);
    });

    LIKE_FILTERS.forEach(([key, column, type]) => {
        if (!present(f[key])) return;
        // Wildcards are added to the VALUE, not the SQL, so a user typing % or _
        // searches for those characters rather than changing the pattern.
        const p = add(type, `%${String(f[key]).trim()}%`);
        parts.push(`${column} LIKE ${p}`);
    });

    EXACT_FILTERS.forEach(([key, column, type]) => {
        if (!present(f[key])) return;
        const value = String(f[key]).trim();
        if (value.toLowerCase() === "all") return;
        parts.push(`${column} = ${add(type, value)}`);
    });

    // EmploymentStatus defaults to Active, exactly as the procedures do — an
    // absent filter must not silently widen the report to include leavers.
    const statusRaw = present(f.EmploymentStatus) ? String(f.EmploymentStatus).trim() : "Active";
    if (statusRaw.toLowerCase() !== "all") {
        parts.push(`m.EmploymentStatus = ${add(sql.VarChar(20), statusRaw)}`);
    }

    RANGE_FILTERS.forEach(([fromKey, toKey, column, type]) => {
        if (present(f[fromKey]) && Number.isFinite(Number(f[fromKey]))) {
            parts.push(`${column} >= ${add(type, Number(f[fromKey]))}`);
        }
        if (present(f[toKey]) && Number.isFinite(Number(f[toKey]))) {
            parts.push(`${column} <= ${add(type, Number(f[toKey]))}`);
        }
    });

    DATE_FILTERS.forEach(([fromKey, toKey, column]) => {
        if (present(f[fromKey])) {
            const d = new Date(f[fromKey]);
            if (!Number.isNaN(d.getTime())) parts.push(`${column} >= ${add(sql.Date, d)}`);
        }
        if (present(f[toKey])) {
            const d = new Date(f[toKey]);
            if (!Number.isNaN(d.getTime())) parts.push(`${column} <= ${add(sql.Date, d)}`);
        }
    });

    BIT_FILTERS.forEach(([key, column]) => {
        if (!present(f[key])) return;
        parts.push(`${column} = ${add(sql.Bit, truthy(f[key]))}`);
    });

    if (present(f.AgeBands)) {
        const bands = textList(f.AgeBands);
        if (bands.length) {
            const placeholders = bands.map((b) => add(sql.NVarChar(50), b)).join(", ");
            parts.push(`m.AgeBand IN (${placeholders})`);
        }
    }

    if (present(f.MinTrainingCount) && Number.isFinite(Number(f.MinTrainingCount))) {
        parts.push(`m.TrainingCount >= ${add(sql.Int, Math.trunc(Number(f.MinTrainingCount)))}`);
    }

    if (truthy(f.AgeDataValidOnly)) {
        parts.push("m.AgeIsPlausible = 1");
    }

    // "Holds this qualification at ANY level" and "studied this field" look at
    // every education row, not only the highest one.
    const semiJoin = (key, table, column) => {
        if (!present(f[key])) return;
        const ids = idList(f[key]);
        if (!ids.length) return;
        const placeholders = ids.map((id) => add(sql.Int, id)).join(", ");
        parts.push(
            `EXISTS (SELECT 1 FROM ${table} x WHERE x.UserId = m.UserId AND x.${column} IN (${placeholders}))`
        );
    };
    semiJoin("HasEducationLevels", "dbo.EmployeeEducation", "[Level]");
    semiJoin("StudyFields", "dbo.EmployeeEducation", "FieldOfStudy");
    semiJoin("HasTrainingIn", "dbo.EmployeeTraining", "TrainingName");

    return parts.length ? `WHERE ${parts.join("\n  AND ")}` : "";
};

// --- detail ----------------------------------------------------------------

const SORTABLE = {
    EmployeeId: "m.EmployeeId",
    FullName: "m.FullName",
    Department: "m.Department",
    Division: "m.Division",
    Section: "m.Section",
    Position: "m.Position",
    JobCategory: "m.JobCategory",
    BankingCenter: "m.BankingCenter",
    EducationLevel: "m.EducationLevel",
    Gender: "m.Gender",
    AgeBand: "m.AgeBand",
    City: "m.City",
    Age: "m.Age",
    ServiceYears: "m.ServiceYears",
    Salary: "m.Salary",
    JobGrade: "m.JobGradeSort",
    InternalExpYears: "m.InternalExpYears",
    TotalExpYears: "m.TotalExpYears",
    PositionTenureYears: "m.PositionTenureYears",
    InternalMoves: "m.InternalMoves",
    TrainingCount: "m.TrainingCount",
    EmploymentDate: "m.EmploymentDate",
    DateOfBirth: "m.DateOfBirth",
    TerminationDate: "m.TerminationDate",
};

const DETAIL_COLUMNS = `
      m.UserId, m.EmployeeId, m.FullName, m.Gender, m.MaritalStatus
    , m.DateOfBirth, m.Age, m.AgeText, m.AgeBand, m.AgeIsPlausible, m.AgeAtHire
    , m.EmploymentDate, m.ServiceYears, m.ServiceText, m.ServiceBand, m.ServiceIsPlausible
    , m.EmploymentType, m.EmploymentStatus, m.IsOnProbation
    , m.TerminationDate, m.TerminationReason
    , m.President, m.Department, m.Division, m.Section, m.Position
    , m.JobGrade, m.JobCategory, m.BankingCenter, m.BranchGrade
    , m.CurrentAssignmentStart, m.TimeInCurrentPosition, m.PositionTenureBand
    , m.InternalMoves, m.InternalMovesBand
    , m.InternalExperienceText, m.InternalExpYears
    , m.ExternalExperienceText, m.ExternalExpYears
    , m.TotalExperienceText, m.TotalExpYears, m.TotalExpBand
    , m.EducationLevel, m.StudyField, m.Institution, m.GraduationYear, m.CGPA
    , m.Region, m.City, m.SubCity, m.Woreda, m.Telephone
    , m.Salary, m.SalaryBand, m.TINNumber, m.PensionNumber
    , m.HasGuaranteeLetter, m.HasDiscipline, m.DisciplineCount
    , m.TrainingCount, m.CertificationCount`;

export const buildDetail = (body) => {
    const { params, add } = makeParams();
    const where = buildWhere(body, add);

    const sortColumn = SORTABLE[body.SortBy] || SORTABLE.FullName;
    const dir = String(body.SortDir || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";

    // The General Purpose list asks for the whole workforce in one page, and
    // this bank has roughly six thousand records. A 2000 cap silently returned
    // a third of them with nothing on screen to say so; TotalRows rides on
    // every row so the client can report any cap that does bite.
    // The tiebreaker is m.UserId, not m.FullName.
    //
    // SQL Server rejects a duplicated column in ORDER BY, and FullName is the
    // DEFAULT sort — so "sort by name" emitted "ORDER BY m.FullName ASC,
    // m.FullName" and failed outright. UserId can never collide because it is
    // not one of the sortable columns, and being the primary key it is also a
    // better tiebreaker: FullName is not unique, so ties in it made OFFSET /
    // FETCH paging non-deterministic and could repeat or skip a row between
    // pages.
    const size = Math.min(10000, Math.max(1, parseInt(body.PageSize, 10) || 100));
    const page = Math.max(1, parseInt(body.PageNumber, 10) || 1);
    const offset = add(sql.Int, (page - 1) * size);
    const fetch = add(sql.Int, size);

    const text = `${MASTER_CTE}
SELECT ${DETAIL_COLUMNS}
     , TotalRows = COUNT(*) OVER ()
     , SnapshotTakenAt = SYSDATETIME()
FROM Master m
${where}
ORDER BY ${sortColumn} ${dir}, m.UserId
OFFSET ${offset} ROWS FETCH NEXT ${fetch} ROWS ONLY
OPTION (RECOMPILE)`;

    return { text, params };
};

// --- summary ---------------------------------------------------------------

export const buildSummary = (body) => {
    const g1 = DIMENSIONS[body.GroupBy1];
    if (!g1) {
        throw Object.assign(new Error(`Unknown group-by "${body.GroupBy1}"`), { status: 400 });
    }
    const g2 = body.GroupBy2 ? DIMENSIONS[body.GroupBy2] : null;
    if (body.GroupBy2 && !g2) {
        throw Object.assign(new Error(`Unknown group-by "${body.GroupBy2}"`), { status: 400 });
    }

    const { params, add } = makeParams();
    const where = buildWhere(body, add);

    const wantPct = truthy(body.IncludePercentiles);
    const g2Label = g2 ? g2.label : "CAST(NULL AS nvarchar(250))";
    const g2Sort = g2 && g2.sort ? g2.sort : "CAST(NULL AS int)";
    const g1Sort = g1.sort ? g1.sort : "CAST(NULL AS int)";

    // Percentiles are windows, so they are computed in the inner SELECT and
    // collapsed with MIN() outside. They are only emitted when asked for: the
    // pack measured four PERCENTILE_CONT windows at ~140 ms against ~35 ms for
    // the rest of the aggregate.
    const pctSelect = wantPct
        ? `, MedAge = PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY m.AgeForStats)     OVER (PARTITION BY ${g1.label}, ${g2Label})
           , MedSal = PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY m.Salary)          OVER (PARTITION BY ${g1.label}, ${g2Label})
           , SalP25 = PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY m.Salary)          OVER (PARTITION BY ${g1.label}, ${g2Label})
           , SalP75 = PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY m.Salary)          OVER (PARTITION BY ${g1.label}, ${g2Label})`
        : `, MedAge = CAST(NULL AS decimal(18,4)), MedSal = CAST(NULL AS decimal(18,4))
           , SalP25 = CAST(NULL AS decimal(18,4)), SalP75 = CAST(NULL AS decimal(18,4))`;

    const order =
        String(body.OrderBy || "Headcount") === "Name"
            ? "G1, G2"
            : String(body.OrderBy || "Headcount") === "Natural"
              ? "ISNULL(MIN(S1), 2147483647), G1, G2"
              : "COUNT(*) DESC, G1";

    const text = `${MASTER_CTE},
G AS (
    SELECT G1 = ${g1.label}, G2 = ${g2Label}, S1 = ${g1Sort}, S2 = ${g2Sort}
         , m.Gender, m.AgeForStats, m.ServiceForStats, m.Salary, m.EducationRank
         , m.InternalExpYears, m.ExternalExpYears, m.TotalExpYears
         , m.PositionTenureYears, m.InternalMoves, m.TrainingCount
         , m.HasDiscipline, m.IsOnProbation
         ${pctSelect}
    FROM Master m
    ${where}
)
SELECT
      GroupedBy = ${add(sql.VarChar(30), body.GroupBy1)}, GroupName = G1
    , GroupedBy2 = ${body.GroupBy2 ? add(sql.VarChar(30), body.GroupBy2) : "CAST(NULL AS varchar(30))"}
    , GroupName2 = G2
    , Headcount  = COUNT(*)
    , PctOfTotal = CAST(100.0*COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (),0) AS decimal(5,1))
    , Male       = SUM(CASE WHEN Gender='Male' THEN 1 ELSE 0 END)
    , Female     = SUM(CASE WHEN Gender='Female' THEN 1 ELSE 0 END)
    , FemalePct  = CAST(100.0*SUM(CASE WHEN Gender='Female' THEN 1 ELSE 0 END)/COUNT(*) AS decimal(5,1))
    , AvgAge     = CAST(AVG(CAST(AgeForStats AS decimal(9,2))) AS decimal(5,1))
    , MedianAge  = CAST(MIN(MedAge) AS decimal(5,1))
    , MinAge     = MIN(AgeForStats), MaxAge = MAX(AgeForStats)
    , AgeUnknown = SUM(CASE WHEN AgeForStats IS NULL THEN 1 ELSE 0 END)
    , AvgService = CAST(AVG(ServiceForStats) AS decimal(5,1))
    , ServiceUnknown = SUM(CASE WHEN ServiceForStats IS NULL THEN 1 ELSE 0 END)
    , AvgInternalExp    = CAST(AVG(InternalExpYears) AS decimal(5,1))
    , AvgExternalExp    = CAST(AVG(ExternalExpYears) AS decimal(5,1))
    , AvgTotalExp       = CAST(AVG(TotalExpYears) AS decimal(5,1))
    , AvgPositionTenure = CAST(AVG(PositionTenureYears) AS decimal(5,1))
    , AvgInternalMoves  = CAST(AVG(CAST(InternalMoves AS decimal(9,2))) AS decimal(5,1))
    , AvgSalary    = CAST(AVG(Salary) AS decimal(18,2))
    , MedianSalary = CAST(MIN(MedSal) AS decimal(18,2))
    , SalaryP25    = CAST(MIN(SalP25) AS decimal(18,2))
    , SalaryP75    = CAST(MIN(SalP75) AS decimal(18,2))
    , MinSalary    = MIN(Salary), MaxSalary = MAX(Salary), TotalSalary = SUM(Salary)
    , Degreed      = SUM(CASE WHEN EducationRank >= 80 THEN 1 ELSE 0 END)
    , DegreedPct   = CAST(100.0*SUM(CASE WHEN EducationRank >= 80 THEN 1 ELSE 0 END)/COUNT(*) AS decimal(5,1))
    , WithDiscipline = SUM(CASE WHEN HasDiscipline=1 THEN 1 ELSE 0 END)
    , OnProbation    = SUM(CASE WHEN IsOnProbation=1 THEN 1 ELSE 0 END)
    , AvgTrainings   = CAST(AVG(CAST(TrainingCount AS decimal(9,2))) AS decimal(5,1))
FROM G
GROUP BY G1, G2
ORDER BY ${order}
OPTION (RECOMPILE)`;

    return { text, params };
};

// The header figure — "1,234 employees match" — for the same filter.
export const buildSummaryTotal = (body) => {
    const { params, add } = makeParams();
    const where = buildWhere(body, add);
    const text = `${MASTER_CTE}
SELECT Headcount = COUNT(*)
     , AvgAge     = CAST(AVG(CAST(m.AgeForStats AS decimal(9,2))) AS decimal(5,1))
     , AvgService = CAST(AVG(m.ServiceForStats) AS decimal(5,1))
     , AvgSalary  = CAST(AVG(m.Salary) AS decimal(18,2))
     , AgeUnknown = SUM(CASE WHEN m.AgeForStats IS NULL THEN 1 ELSE 0 END)
     , ServiceUnknown = SUM(CASE WHEN m.ServiceForStats IS NULL THEN 1 ELSE 0 END)
FROM Master m
${where}
OPTION (RECOMPILE)`;
    return { text, params };
};

// --- pivot -----------------------------------------------------------------
// Returns CELLS rather than a pivoted grid. The installed procedure builds the
// column list with dynamic SQL; assembling the grid in JavaScript instead keeps
// this module free of EXEC and of any string-built identifier.

const PIVOT_METRIC_SQL = {
    Headcount: "CAST(COUNT(*) AS decimal(18,2))",
    AvgAge: "CAST(AVG(CAST(m.AgeForStats AS decimal(9,2))) AS decimal(18,2))",
    AvgSalary: "CAST(AVG(m.Salary) AS decimal(18,2))",
    AvgService: "CAST(AVG(m.ServiceForStats) AS decimal(18,2))",
    FemalePct:
        "CAST(100.0*SUM(CASE WHEN m.Gender='Female' THEN 1 ELSE 0 END)/COUNT(*) AS decimal(18,2))",
};

export const buildPivotCells = (body) => {
    const row = DIMENSIONS[body.RowDimension];
    const col = DIMENSIONS[body.ColDimension];
    if (!row) throw Object.assign(new Error(`Unknown row dimension "${body.RowDimension}"`), { status: 400 });
    if (!col) throw Object.assign(new Error(`Unknown column dimension "${body.ColDimension}"`), { status: 400 });

    const metric = PIVOT_METRIC_SQL[body.Metric] || PIVOT_METRIC_SQL.Headcount;

    const { params, add } = makeParams();
    const where = buildWhere(body, add);

    const text = `${MASTER_CTE}
SELECT RowLabel = ${row.label}
     , RowSort  = MIN(${row.sort ? row.sort : "CAST(NULL AS int)"})
     , ColLabel = ${col.label}
     , ColSort  = MIN(${col.sort ? col.sort : "CAST(NULL AS int)"})
     , Val      = ${metric}
FROM Master m
${where}
GROUP BY ${row.label}, ${col.label}
OPTION (RECOMPILE)`;

    return { text, params };
};

// --- headcount movement ----------------------------------------------------
// The installed version walks a persisted Numbers table. A recursive CTE gives
// the same period series without needing that table to exist.

export const buildMovement = (body) => {
    const period = ["Month", "Quarter", "Year"].includes(body.Period) ? body.Period : "Year";
    const groupDim = body.GroupBy ? DIMENSIONS[body.GroupBy] : null;
    if (body.GroupBy && !groupDim) {
        throw Object.assign(new Error(`Unknown group-by "${body.GroupBy}"`), { status: 400 });
    }

    const to = body.To && !Number.isNaN(new Date(body.To).getTime()) ? new Date(body.To) : new Date();
    const from =
        body.From && !Number.isNaN(new Date(body.From).getTime())
            ? new Date(body.From)
            : new Date(to.getFullYear() - 5, to.getMonth(), to.getDate());

    const { params, add } = makeParams();
    // Movement takes only the organisation-shaped filters, and always across all
    // employment statuses — a leaver must still be counted in the period they
    // left, which an Active-only filter would hide.
    const orgOnly = {};
    [
        "Presidents",
        "Departments",
        "Divisions",
        "BankingCenters",
        "JobGrades",
        "JobCategories",
        "Gender",
        "EmploymentType",
        "Regions",
    ].forEach((k) => {
        if (present(body[k])) orgOnly[k] = body[k];
    });
    orgOnly.EmploymentStatus = "All";
    const where = buildWhere(orgOnly, add);

    const pFrom = add(sql.Date, from);
    const pTo = add(sql.Date, to);

    const anchor =
        period === "Month"
            ? `DATEADD(DAY, 1-DAY(${pFrom}), ${pFrom})`
            : period === "Quarter"
              ? `DATEADD(QUARTER, DATEDIFF(QUARTER, 0, ${pFrom}), 0)`
              : `DATEADD(YEAR, DATEDIFF(YEAR, 0, ${pFrom}), 0)`;

    const step = period.toUpperCase();
    const label =
        period === "Month"
            ? "CONVERT(varchar(7), p.PeriodStart, 126)"
            : period === "Quarter"
              ? `CAST(YEAR(p.PeriodStart) AS varchar(4)) + '-Q' + CAST(DATEPART(QUARTER, p.PeriodStart) AS varchar(1))`
              : "CAST(YEAR(p.PeriodStart) AS varchar(4))";

    const groupLabel = groupDim ? groupDim.label : "'(All)'";

    const text = `${MASTER_CTE},
Per AS (
    SELECT PeriodStart = CAST(${anchor} AS date)
    UNION ALL
    SELECT CAST(DATEADD(${step}, 1, PeriodStart) AS date) FROM Per
    WHERE DATEADD(${step}, 1, PeriodStart) <= ${pTo}
),
P2 AS (
    SELECT PeriodStart,
           PeriodEnd = DATEADD(DAY, -1, DATEADD(${step}, 1, PeriodStart))
    FROM Per
),
E AS (
    SELECT m.UserId, m.EmploymentDate, m.TerminationDate, GLabel = ${groupLabel}
    FROM Master m
    ${where}
)
SELECT
      PeriodLabel = ${label}
    , p.PeriodStart, p.PeriodEnd
    , GroupedBy = ${body.GroupBy ? add(sql.VarChar(30), body.GroupBy) : "CAST(NULL AS varchar(30))"}
    , GroupName = e.GLabel
    , Opening = SUM(CASE WHEN e.EmploymentDate <  p.PeriodStart
                          AND (e.TerminationDate IS NULL OR e.TerminationDate >= p.PeriodStart)
                         THEN 1 ELSE 0 END)
    , Joiners = SUM(CASE WHEN e.EmploymentDate BETWEEN p.PeriodStart AND p.PeriodEnd THEN 1 ELSE 0 END)
    , Leavers = SUM(CASE WHEN e.TerminationDate BETWEEN p.PeriodStart AND p.PeriodEnd THEN 1 ELSE 0 END)
    , Closing = SUM(CASE WHEN e.EmploymentDate <= p.PeriodEnd
                          AND (e.TerminationDate IS NULL OR e.TerminationDate > p.PeriodEnd)
                         THEN 1 ELSE 0 END)
    , NetChange = SUM(CASE WHEN e.EmploymentDate BETWEEN p.PeriodStart AND p.PeriodEnd THEN 1 ELSE 0 END)
                - SUM(CASE WHEN e.TerminationDate BETWEEN p.PeriodStart AND p.PeriodEnd THEN 1 ELSE 0 END)
    , TurnoverPct = CAST(100.0
          * SUM(CASE WHEN e.TerminationDate BETWEEN p.PeriodStart AND p.PeriodEnd THEN 1 ELSE 0 END)
          / NULLIF((SUM(CASE WHEN e.EmploymentDate <  p.PeriodStart
                              AND (e.TerminationDate IS NULL OR e.TerminationDate >= p.PeriodStart)
                             THEN 1 ELSE 0 END)
                  + SUM(CASE WHEN e.EmploymentDate <= p.PeriodEnd
                              AND (e.TerminationDate IS NULL OR e.TerminationDate > p.PeriodEnd)
                             THEN 1 ELSE 0 END)) / 2.0, 0)
          AS decimal(6,2))
FROM P2 p
CROSS JOIN E e
GROUP BY p.PeriodStart, p.PeriodEnd, e.GLabel
HAVING SUM(CASE WHEN e.EmploymentDate <= p.PeriodEnd
                 AND (e.TerminationDate IS NULL OR e.TerminationDate > p.PeriodEnd)
                THEN 1 ELSE 0 END) > 0
    OR SUM(CASE WHEN e.EmploymentDate  BETWEEN p.PeriodStart AND p.PeriodEnd THEN 1 ELSE 0 END) > 0
    OR SUM(CASE WHEN e.TerminationDate BETWEEN p.PeriodStart AND p.PeriodEnd THEN 1 ELSE 0 END) > 0
ORDER BY p.PeriodStart, e.GLabel
OPTION (MAXRECURSION 1200, RECOMPILE)`;

    return { text, params };
};

// ---------------------------------------------------------------------------
// Movement derivation
// ---------------------------------------------------------------------------
// The pack materialises this into EmployeeMovementSnapshot. It is a self-join
// of consecutive internal postings, so it inlines cleanly — no table, no
// refresh job.
//
// Every rule is the SQL author's, carried over with the reasoning:
//   * Department on the posting row is null on 61 internal rows, so it falls
//     back to the position's own place in the org chart.
//   * "A/", "Acting", "Relief" and the misspelling "Relif" all appear among
//     the acting-style position titles.
//   * Acting transitions are tested BEFORE grade, so confirming someone out of
//     an acting post is not reported as a demotion.
//
// Emitted without a leading WITH so it can be appended to MASTER_CTE or opened
// with one of its own.
export const MOVEMENT_BODY = `
Postings AS (
    SELECT e.UserId, e.Id, e.[From], e.DateOfRelease,
           PositionId = e.Position,
           Position   = p.Postion,
           GradeName  = g.Name,
           GradeSort  = CASE p.Grade
                WHEN 1 THEN 10 WHEN 2 THEN 20 WHEN 3 THEN 30 WHEN 4 THEN 40 WHEN 5 THEN 50
                WHEN 1023 THEN 51 WHEN 7 THEN 52 WHEN 1020 THEN 53 WHEN 8 THEN 60
                WHEN 9 THEN 70 WHEN 10 THEN 80 WHEN 1024 THEN 90 WHEN 12 THEN 100
                WHEN 13 THEN 110 WHEN 14 THEN 120 WHEN 15 THEN 130 WHEN 16 THEN 140
                WHEN 17 THEN 150 WHEN 18 THEN 160 END,
           DepartmentId = COALESCE(e.Department, p.Department, dv.Department),
           BankingCenterId = e.BankingCenter,
           IsActing = CASE WHEN p.Postion LIKE 'A/%' OR p.Postion LIKE '%Acting%'
                             OR p.Postion LIKE '%Relief%' OR p.Postion LIKE '%Relif%'
                           THEN 1 ELSE 0 END,
           rn = ROW_NUMBER() OVER (PARTITION BY e.UserId ORDER BY e.[From], e.Id)
    FROM dbo.EmployeeExperience e
    LEFT JOIN dbo.luPosition  p  ON p.Id  = e.Position
    LEFT JOIN dbo.luJobGrade  g  ON g.Id  = p.Grade
    LEFT JOIN dbo.luDivision  dv ON dv.Id = COALESCE(e.Division, p.Division)
    WHERE e.ExperienceType = 1 AND e.[From] IS NOT NULL
),
Pairs AS (
    SELECT c.UserId, SeqNo = c.rn, MoveDate = c.[From],
           PrevPosition = pr.Position, PrevGrade = pr.GradeName, PrevGradeSort = pr.GradeSort,
           PrevDepartmentId = pr.DepartmentId, PrevBankingCenterId = pr.BankingCenterId,
           PrevStart = pr.[From], PrevIsActing = pr.IsActing, PrevPositionId = pr.PositionId,
           NewPosition = c.Position, NewGrade = c.GradeName, NewGradeSort = c.GradeSort,
           NewDepartmentId = c.DepartmentId, NewBankingCenterId = c.BankingCenterId,
           NewIsActing = c.IsActing, NewPositionId = c.PositionId,
           c.DateOfRelease
    FROM Postings c
    JOIN Postings pr ON pr.UserId = c.UserId AND pr.rn = c.rn - 1
),
Movement AS (
    SELECT
          m.UserId
        , d.EmployeeId
        , FullName = d.[Name] + ' ' + d.FName + ' ' + d.GFName
        , Gender = d.Sex
        , m.SeqNo, m.MoveDate
        , MoveYear = YEAR(m.MoveDate)
        , MoveMonth = MONTH(m.MoveDate)
        , MoveQuarter = CAST(YEAR(m.MoveDate) AS varchar(4)) + '-Q'
                      + CAST(DATEPART(QUARTER, m.MoveDate) AS varchar(1))
        , PrevPosition = ISNULL(m.PrevPosition, '(Unknown)')
        , PrevGrade    = ISNULL(m.PrevGrade, '(Unknown)')
        , PrevDepartment = ISNULL(pd.Name, '(Unassigned)')
        , PrevBankingCenter = ISNULL(pb.Name, '(Head Office / None)')
        , m.PrevStart
        , YearsInPrevPosition = CASE
              WHEN DATEDIFF(DAY, m.PrevStart, m.MoveDate) BETWEEN 0 AND 16436
              THEN CAST(DATEDIFF(DAY, m.PrevStart, m.MoveDate)/365.25 AS decimal(9,2)) END
        , NewPosition = ISNULL(m.NewPosition, '(Unknown)')
        , NewGrade    = ISNULL(m.NewGrade, '(Unknown)')
        , NewDepartment = ISNULL(nd.Name, '(Unassigned)')
        , NewBankingCenter = ISNULL(nb.Name, '(Head Office / None)')
        , m.PrevDepartmentId, m.NewDepartmentId, m.NewBankingCenterId
        , IsPromotion = CASE WHEN m.NewGradeSort > m.PrevGradeSort THEN 1 ELSE 0 END
        , IsGradeDecrease = CASE WHEN m.NewGradeSort < m.PrevGradeSort THEN 1 ELSE 0 END
        , IsTransfer = CASE WHEN ISNULL(m.NewDepartmentId,-1)    <> ISNULL(m.PrevDepartmentId,-1)
                              OR ISNULL(m.NewBankingCenterId,-1) <> ISNULL(m.PrevBankingCenterId,-1)
                            THEN 1 ELSE 0 END
        , IsBranchMove = CASE WHEN ISNULL(m.NewBankingCenterId,-1) <> ISNULL(m.PrevBankingCenterId,-1)
                              THEN 1 ELSE 0 END
        , MoveType = CASE
              WHEN m.PrevIsActing = 1 AND m.NewIsActing = 0 THEN 'Confirmed from acting'
              WHEN m.PrevIsActing = 0 AND m.NewIsActing = 1 THEN 'Acting appointment'
              WHEN m.NewGradeSort > m.PrevGradeSort         THEN 'Promotion'
              WHEN m.NewGradeSort < m.PrevGradeSort         THEN 'Grade decrease'
              WHEN ISNULL(m.NewDepartmentId,-1) <> ISNULL(m.PrevDepartmentId,-1)
                OR ISNULL(m.NewBankingCenterId,-1) <> ISNULL(m.PrevBankingCenterId,-1)
                                                            THEN 'Transfer'
              WHEN ISNULL(m.NewPositionId,-1) <> ISNULL(m.PrevPositionId,-1)
                                                            THEN 'Reassignment'
              ELSE 'No recorded change' END
        , m.DateOfRelease
        , CurrentSalary = d.Salary
    FROM Pairs m
    JOIN dbo.EmployeeDetail d ON d.UserId = m.UserId
    LEFT JOIN dbo.luDepartment pd    ON pd.Id = m.PrevDepartmentId
    LEFT JOIN dbo.luDepartment nd    ON nd.Id = m.NewDepartmentId
    LEFT JOIN dbo.luBankingCenter pb ON pb.Id = m.PrevBankingCenterId
    LEFT JOIN dbo.luBankingCenter nb ON nb.Id = m.NewBankingCenterId
)`;

// --- lookups ---------------------------------------------------------------
// The pack's usp_ReportFilterOptions in one batch of plain SELECTs.

export const FILTER_OPTIONS_SQL = `
SELECT Id, Name = Name     FROM dbo.luPresident      ORDER BY Name;
SELECT Id, Name = Name     FROM dbo.luDepartment     ORDER BY Name;
SELECT Id, Name = Name, DepartmentId = Department FROM dbo.luDivision ORDER BY Name;
SELECT Id, Name = Name, DepartmentId = Department, DivisionId = Division FROM dbo.luSection ORDER BY Name;
SELECT Id, Name = Postion, DepartmentId = Department, GradeId = Grade, CategoryId = Category FROM dbo.luPosition ORDER BY Postion;
SELECT Id, Name = Name     FROM dbo.luJobGrade       ORDER BY Id;
SELECT Id, Name = Category FROM dbo.luJobCategory    ORDER BY Category;
SELECT Id, Name = Name, Grade FROM dbo.luBankingCenter ORDER BY Name;
SELECT Id, Name = Name     FROM dbo.luRegion         ORDER BY Name;
SELECT Id, Name = Name, RegionId = Region FROM dbo.luCity ORDER BY Name;
SELECT Id, Name = [Level]  FROM dbo.luEducationLevel ORDER BY [Level];
SELECT Id, Name = Field    FROM dbo.luStudyField     ORDER BY Field;
SELECT Id, Name = Institution FROM dbo.luInstitution ORDER BY Institution;
SELECT Id, Name = Reason   FROM dbo.luTerminationReason ORDER BY Reason;
SELECT Id, Name = Name     FROM dbo.luTrainingName   ORDER BY Name;
SELECT Id = UserId, Name = EmployeeId + ' - ' + Name + ' ' + FName + ' ' + GFName
  FROM dbo.EmployeeDetail WHERE TerminationDate IS NULL ORDER BY 2;`;

// Live values for one dimension, with counts — what the cascading filter
// controls bind to.
export const buildDimensionValues = (dimension) => {
    const dim = DIMENSIONS[dimension];
    if (!dim) throw Object.assign(new Error(`Unknown dimension "${dimension}"`), { status: 400 });
    return {
        text: `${MASTER_CTE}
SELECT Label = ${dim.label}
     , Employees = COUNT(*)
     , ActiveEmployees = SUM(CASE WHEN m.EmploymentStatus = 'Active' THEN 1 ELSE 0 END)
     , SortKey = MIN(${dim.sort ? dim.sort : "CAST(NULL AS int)"})
FROM Master m
GROUP BY ${dim.label}
ORDER BY ISNULL(MIN(${dim.sort ? dim.sort : "CAST(NULL AS int)"}), 2147483647), ${dim.label}
OPTION (RECOMPILE)`,
        params: [],
    };
};

// ---------------------------------------------------------------------------
// The eleven standard reports, live
// ---------------------------------------------------------------------------
// Each returns an ordered list of { set, text, params }. The route runs them in
// order — sequentially, never Promise.all, because they share one small pool.
//
// Several are the Explorer's own shapes with the group-by fixed, so they
// delegate rather than restate the aggregate. Where a report's columns differ
// from the Explorer's they are written out to match the pack's output, so HR
// sees the same headings they already know.

const dateRange = (add, column, from, to) => {
    const parts = [];
    if (present(from)) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) parts.push(`${column} >= ${add(sql.Date, d)}`);
    }
    if (present(to)) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) parts.push(`${column} <= ${add(sql.Date, d)}`);
    }
    return parts;
};

const inList = (add, column, raw) => {
    if (!present(raw)) return null;
    const ids = idList(raw);
    if (!ids.length) return null;
    return `${column} IN (${ids.map((id) => add(sql.Int, id)).join(", ")})`;
};

const whereOf = (parts) => {
    const kept = parts.filter(Boolean);
    return kept.length ? `WHERE ${kept.join("\n  AND ")}` : "";
};

// --- movement-based: promotion & transfer ----------------------------------

const buildPromotion = (body) => {
    const { params, add } = makeParams();

    // Default is promotions only; @MoveTypes widens it to any recorded type.
    let typeClause = "m.MoveType = 'Promotion'";
    if (present(body.MoveTypes)) {
        const types = textList(body.MoveTypes);
        if (types.length) {
            typeClause = `m.MoveType IN (${types
                .map((t) => add(sql.NVarChar(60), t))
                .join(", ")})`;
        }
    }

    const where = whereOf([
        typeClause,
        ...dateRange(add, "m.MoveDate", body.From, body.To),
        inList(add, "m.NewDepartmentId", body.Departments),
        inList(add, "m.NewBankingCenterId", body.BankingCenters),
        present(body.Gender) && String(body.Gender).toLowerCase() !== "all"
            ? `m.Gender = ${add(sql.VarChar(10), String(body.Gender).trim())}`
            : null,
    ]);

    const detail = {
        set: "detail",
        text: `WITH ${MOVEMENT_BODY}
SELECT [ID No.] = m.EmployeeId
     , [Full name] = m.FullName
     , Gender = m.Gender
     , [Move date] = m.MoveDate
     , [Move type] = m.MoveType
     , [Previous position] = m.PrevPosition
     , [Previous grade] = m.PrevGrade
     , [Previous department] = m.PrevDepartment
     , [Years in previous position] = m.YearsInPrevPosition
     , [Position] = m.NewPosition
     , [Grade] = m.NewGrade
     , [Department] = m.NewDepartment
     , [Branch] = m.NewBankingCenter
     , [Date of release] = m.DateOfRelease
     , [Current salary] = m.CurrentSalary
FROM Movement m
${where}
ORDER BY m.MoveDate DESC, m.FullName
OPTION (RECOMPILE)`,
        params,
    };

    // Summary is deliberately over ALL move types in the same window, not just
    // the filtered ones: the pack's guidance is to publish the move-type
    // distribution alongside any promotion figure, which needs the others.
    const s = makeParams();
    const summaryWhere = whereOf([
        ...dateRange(s.add, "m.MoveDate", body.From, body.To),
        inList(s.add, "m.NewDepartmentId", body.Departments),
    ]);
    const summary = {
        set: "summary",
        text: `WITH ${MOVEMENT_BODY}
SELECT [Move type] = m.MoveType
     , Movements = COUNT(*)
     , Employees = COUNT(DISTINCT m.UserId)
     , [Avg years in previous position] = CAST(AVG(m.YearsInPrevPosition) AS decimal(5,1))
FROM Movement m
${summaryWhere}
GROUP BY m.MoveType
ORDER BY COUNT(*) DESC
OPTION (RECOMPILE)`,
        params: s.params,
    };

    return [detail, summary];
};

const buildTransfer = (body) => {
    const { params, add } = makeParams();
    const where = whereOf([
        truthy(body.BranchOnly) ? "m.IsBranchMove = 1" : "m.IsTransfer = 1",
        ...dateRange(add, "m.MoveDate", body.From, body.To),
        inList(add, "m.PrevDepartmentId", body.FromDepartments),
        inList(add, "m.NewDepartmentId", body.ToDepartments),
        present(body.Gender) && String(body.Gender).toLowerCase() !== "all"
            ? `m.Gender = ${add(sql.VarChar(10), String(body.Gender).trim())}`
            : null,
    ]);

    const detail = {
        set: "detail",
        text: `WITH ${MOVEMENT_BODY}
SELECT [ID No.] = m.EmployeeId
     , [Full name] = m.FullName
     , Gender = m.Gender
     , [Move date] = m.MoveDate
     , [Move type] = m.MoveType
     , [From department] = m.PrevDepartment
     , [From branch] = m.PrevBankingCenter
     , [To department] = m.NewDepartment
     , [To branch] = m.NewBankingCenter
     , [Previous position] = m.PrevPosition
     , [Position] = m.NewPosition
     , [Date of release] = m.DateOfRelease
     , [Current salary] = m.CurrentSalary
FROM Movement m
${where}
ORDER BY m.MoveDate DESC, m.FullName
OPTION (RECOMPILE)`,
        params,
    };

    const s = makeParams();
    const summaryWhere = whereOf([
        truthy(body.BranchOnly) ? "m.IsBranchMove = 1" : "m.IsTransfer = 1",
        ...dateRange(s.add, "m.MoveDate", body.From, body.To),
    ]);
    const summary = {
        set: "summary",
        text: `WITH ${MOVEMENT_BODY}
SELECT [From department] = m.PrevDepartment
     , [To department] = m.NewDepartment
     , Moves = COUNT(*)
FROM Movement m
${summaryWhere}
GROUP BY m.PrevDepartment, m.NewDepartment
ORDER BY COUNT(*) DESC
OPTION (RECOMPILE)`,
        params: s.params,
    };

    return [detail, summary];
};

// --- master-based reports --------------------------------------------------

const buildTerminated = (body) => {
    const { params, add } = makeParams();
    const where = whereOf([
        "m.EmploymentStatus = 'Terminated'",
        ...dateRange(add, "m.TerminationDate", body.From, body.To),
        inList(add, "m.DepartmentId", body.Departments),
        inList(add, "m.TerminationReasonId", body.TerminationReasons),
        present(body.Gender) && String(body.Gender).toLowerCase() !== "all"
            ? `m.Gender = ${add(sql.VarChar(10), String(body.Gender).trim())}`
            : null,
    ]);

    const detail = {
        set: "detail",
        text: `${MASTER_CTE}
SELECT [ID No.] = m.EmployeeId
     , [Full name] = m.FullName
     , Gender = m.Gender
     , Department = m.Department
     , Position = m.Position
     , [Job grade] = m.JobGrade
     , [Employment date] = m.EmploymentDate
     , [Termination date] = m.TerminationDate
     , [Termination reason] = m.TerminationReason
     , [Service years] = m.ServiceYearsDec
     , [Service at exit] = m.ServiceBand
     , [Age at exit] = m.Age
     , [Last salary] = m.Salary
FROM Master m
${where}
ORDER BY m.TerminationDate DESC, m.FullName
OPTION (RECOMPILE)`,
        params,
    };

    const s = makeParams();
    const summaryWhere = whereOf([
        "m.EmploymentStatus = 'Terminated'",
        ...dateRange(s.add, "m.TerminationDate", body.From, body.To),
        inList(s.add, "m.DepartmentId", body.Departments),
    ]);
    const summary = {
        set: "summary",
        text: `${MASTER_CTE}
SELECT [Termination reason] = m.TerminationReason
     , Leavers = COUNT(*)
     , [Avg service years] = CAST(AVG(m.ServiceForStats) AS decimal(5,1))
     , [Avg age] = CAST(AVG(CAST(m.AgeForStats AS decimal(9,2))) AS decimal(5,1))
     , [Service unknown] = SUM(CASE WHEN m.ServiceForStats IS NULL THEN 1 ELSE 0 END)
FROM Master m
${summaryWhere}
GROUP BY m.TerminationReason
ORDER BY COUNT(*) DESC
OPTION (RECOMPILE)`,
        params: s.params,
    };

    return [detail, summary];
};

const buildGeneralPurpose = (body) => {
    // Same shape as the Explorer's employee list; the filter vocabulary is a
    // subset of the 55, so buildDetail already understands every field.
    const built = buildDetail({ ...body, PageSize: 10000, PageNumber: 1 });
    return [{ set: "detail", text: built.text, params: built.params }];
};

const buildManpower = (body) => {
    const levels = {
        Position: DIMENSIONS.Position,
        Section: DIMENSIONS.Section,
        Division: DIMENSIONS.Division,
        Department: DIMENSIONS.Department,
    };
    const level = levels[body.Level] || levels.Position;
    const levelName = levels[body.Level] ? body.Level : "Position";

    const { params, add } = makeParams();
    const where = whereOf([
        (() => {
            const status = present(body.EmploymentStatus)
                ? String(body.EmploymentStatus).trim()
                : "Active";
            return status.toLowerCase() === "all"
                ? null
                : `m.EmploymentStatus = ${add(sql.VarChar(20), status)}`;
        })(),
        inList(add, "m.PresidentId", body.Presidents),
        inList(add, "m.DepartmentId", body.Departments),
        inList(add, "m.BankingCenterId", body.BankingCenters),
    ]);

    // Rolling up TO department means the level column IS the department column.
    // Emitting it twice would repeat the heading and, more importantly, put the
    // same column in ORDER BY twice — which SQL Server rejects outright.
    const levelIsDepartment = level.label === DIMENSIONS.Department.label;
    const groupCols = levelIsDepartment
        ? ["m.President", "m.Department"]
        : ["m.President", "m.Department", level.label];

    const structure = {
        set: "structure",
        text: `${MASTER_CTE}
SELECT President = m.President
     , Department = m.Department${levelIsDepartment ? "" : `\n     , [${levelName}] = ${level.label}`}
     , Headcount = COUNT(*)
     , Male = SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END)
     , Female = SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END)
     , [Avg age] = CAST(AVG(CAST(m.AgeForStats AS decimal(9,2))) AS decimal(5,1))
     , [Avg service years] = CAST(AVG(m.ServiceForStats) AS decimal(5,1))
     , [Avg salary] = CAST(AVG(m.Salary) AS decimal(18,2))
FROM Master m
${where}
GROUP BY ${groupCols.join(", ")}
ORDER BY ${groupCols.join(", ")}
OPTION (RECOMPILE)`,
        params,
    };

    const s = makeParams();
    const totalWhere = whereOf([
        (() => {
            const status = present(body.EmploymentStatus)
                ? String(body.EmploymentStatus).trim()
                : "Active";
            return status.toLowerCase() === "all"
                ? null
                : `m.EmploymentStatus = ${s.add(sql.VarChar(20), status)}`;
        })(),
        inList(s.add, "m.PresidentId", body.Presidents),
        inList(s.add, "m.DepartmentId", body.Departments),
        inList(s.add, "m.BankingCenterId", body.BankingCenters),
    ]);
    const summary = {
        set: "summary",
        text: `${MASTER_CTE}
SELECT [Total headcount] = COUNT(*)
     , Departments = COUNT(DISTINCT m.Department)
     , Positions = COUNT(DISTINCT m.Position)
     , Branches = COUNT(DISTINCT m.BankingCenter)
     , Male = SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END)
     , Female = SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END)
FROM Master m
${totalWhere}
OPTION (RECOMPILE)`,
        params: s.params,
    };

    return [structure, summary];
};

const buildDiscipline = (body) => {
    const { params, add } = makeParams();
    const today = new Date();
    const where = whereOf([
        ...dateRange(add, "d.IssueDate", body.From, body.To),
        inList(add, "m.DepartmentId", body.Departments),
        truthy(body.ActiveOnly) ? `d.EndDate >= ${add(sql.Date, today)}` : null,
    ]);
    const pToday = add(sql.Date, today);

    const detail = {
        set: "detail",
        text: `${MASTER_CTE}
SELECT [ID No.] = m.EmployeeId
     , [Full name] = m.FullName
     , Gender = m.Gender
     , Department = m.Department
     , Position = m.Position
     , [Action taken] = ISNULL(a.[Action], '(Not recorded)')
     , [Issue date] = d.IssueDate
     , [End date] = d.EndDate
     , [Duration days] = DATEDIFF(DAY, d.IssueDate, d.EndDate)
     , [Status] = CASE WHEN d.EndDate >= ${pToday} THEN 'In force' ELSE 'Expired' END
     , [Employment status] = m.EmploymentStatus
FROM dbo.Discipline d
JOIN Master m ON m.UserId = d.UserId
LEFT JOIN dbo.luActionTaken a ON a.Id = d.BreachType
${where}
ORDER BY d.IssueDate DESC, m.FullName
OPTION (RECOMPILE)`,
        params,
    };

    const s = makeParams();
    const summaryWhere = whereOf(dateRange(s.add, "d.IssueDate", body.From, body.To));
    const sToday = s.add(sql.Date, today);
    const summary = {
        set: "summary",
        text: `SELECT [Action taken] = ISNULL(a.[Action], '(Not recorded)')
     , Cases = COUNT(*)
     , Employees = COUNT(DISTINCT d.UserId)
     , [In force] = SUM(CASE WHEN d.EndDate >= ${sToday} THEN 1 ELSE 0 END)
     , [Avg duration days] = AVG(DATEDIFF(DAY, d.IssueDate, d.EndDate))
FROM dbo.Discipline d
LEFT JOIN dbo.luActionTaken a ON a.Id = d.BreachType
${summaryWhere}
GROUP BY a.[Action]
ORDER BY COUNT(*) DESC
OPTION (RECOMPILE)`,
        params: s.params,
    };

    return [detail, summary];
};

const buildTurnover = (body) => {
    const leaversParams = makeParams();
    const leaversWhere = whereOf([
        "m.EmploymentStatus = 'Terminated'",
        ...dateRange(leaversParams.add, "m.TerminationDate", body.From, body.To),
        inList(leaversParams.add, "m.DepartmentId", body.Departments),
    ]);

    const leavers = {
        set: "leavers",
        text: `${MASTER_CTE}
SELECT [ID No.] = m.EmployeeId
     , [Full name] = m.FullName
     , Gender = m.Gender
     , Department = m.Department
     , [Employment date] = m.EmploymentDate
     , [Termination date] = m.TerminationDate
     , [Termination reason] = m.TerminationReason
     , [Service at exit] = m.ServiceBand
     , [Service years] = m.ServiceYearsDec
     , [Last salary] = m.Salary
FROM Master m
${leaversWhere}
ORDER BY m.TerminationDate DESC, m.FullName
OPTION (RECOMPILE)`,
        params: leaversParams.params,
    };

    const bandParams = makeParams();
    const bandWhere = whereOf([
        "m.EmploymentStatus = 'Terminated'",
        ...dateRange(bandParams.add, "m.TerminationDate", body.From, body.To),
        inList(bandParams.add, "m.DepartmentId", body.Departments),
    ]);
    const byBand = {
        set: "byReason",
        text: `${MASTER_CTE}
SELECT [Service at exit] = m.ServiceBand
     , Leavers = COUNT(*)
     , [Avg service years] = CAST(AVG(m.ServiceForStats) AS decimal(5,1))
     , [Top reason] = MIN(m.TerminationReason)
FROM Master m
${bandWhere}
GROUP BY m.ServiceBand
ORDER BY COUNT(*) DESC
OPTION (RECOMPILE)`,
        params: bandParams.params,
    };

    // The rate itself is exactly the Explorer's movement series.
    const series = buildMovement({
        From: body.From,
        To: body.To,
        Period: body.Period || "Year",
        GroupBy: body.GroupBy,
        Departments: body.Departments,
    });

    return [leavers, byBand, { set: "series", text: series.text, params: series.params }];
};

const buildMonthly = (body) => {
    const year = Number(body.Year) || new Date().getFullYear();
    const month = Math.min(12, Math.max(1, Number(body.Month) || new Date().getMonth() + 1));
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));

    const mk = (setName, selectSql, extra) => {
        const { params, add } = makeParams();
        const pStart = add(sql.Date, start);
        const pEnd = add(sql.Date, end);
        const dept = inList(add, "m.DepartmentId", body.Departments);
        return {
            set: setName,
            text: selectSql(pStart, pEnd, dept ? `AND ${dept}` : ""),
            params,
            ...extra,
        };
    };

    const joiners = mk(
        "joiners",
        (s, e, dept) => `${MASTER_CTE}
SELECT [ID No.] = m.EmployeeId, [Full name] = m.FullName, Gender = m.Gender
     , Department = m.Department, Position = m.Position, [Job grade] = m.JobGrade
     , [Employment date] = m.EmploymentDate, Salary = m.Salary
FROM Master m
WHERE m.EmploymentDate BETWEEN ${s} AND ${e} ${dept}
ORDER BY m.EmploymentDate, m.FullName
OPTION (RECOMPILE)`
    );

    const leavers = mk(
        "leavers",
        (s, e, dept) => `${MASTER_CTE}
SELECT [ID No.] = m.EmployeeId, [Full name] = m.FullName, Gender = m.Gender
     , Department = m.Department, Position = m.Position
     , [Termination date] = m.TerminationDate, [Termination reason] = m.TerminationReason
     , [Service years] = m.ServiceYearsDec
FROM Master m
WHERE m.TerminationDate BETWEEN ${s} AND ${e} ${dept}
ORDER BY m.TerminationDate, m.FullName
OPTION (RECOMPILE)`
    );

    const movements = (() => {
        const { params, add } = makeParams();
        const pStart = add(sql.Date, start);
        const pEnd = add(sql.Date, end);
        const dept = inList(add, "m.NewDepartmentId", body.Departments);
        return {
            set: "movements",
            text: `WITH ${MOVEMENT_BODY}
SELECT [ID No.] = m.EmployeeId, [Full name] = m.FullName
     , [Move date] = m.MoveDate, [Move type] = m.MoveType
     , [Previous position] = m.PrevPosition, [Position] = m.NewPosition
     , [Previous department] = m.PrevDepartment, [Department] = m.NewDepartment
FROM Movement m
WHERE m.MoveDate BETWEEN ${pStart} AND ${pEnd} ${dept ? `AND ${dept}` : ""}
ORDER BY m.MoveDate, m.FullName
OPTION (RECOMPILE)`,
            params,
        };
    })();

    const byDepartment = mk(
        "byDepartment",
        (s, e, dept) => `${MASTER_CTE}
SELECT Department = m.Department
     , [Opening] = SUM(CASE WHEN m.EmploymentDate < ${s}
                             AND (m.TerminationDate IS NULL OR m.TerminationDate >= ${s})
                            THEN 1 ELSE 0 END)
     , Joiners = SUM(CASE WHEN m.EmploymentDate BETWEEN ${s} AND ${e} THEN 1 ELSE 0 END)
     , Leavers = SUM(CASE WHEN m.TerminationDate BETWEEN ${s} AND ${e} THEN 1 ELSE 0 END)
     , [Closing] = SUM(CASE WHEN m.EmploymentDate <= ${e}
                             AND (m.TerminationDate IS NULL OR m.TerminationDate > ${e})
                            THEN 1 ELSE 0 END)
FROM Master m
WHERE 1 = 1 ${dept}
GROUP BY m.Department
HAVING SUM(CASE WHEN m.EmploymentDate <= ${e}
                 AND (m.TerminationDate IS NULL OR m.TerminationDate > ${e})
                THEN 1 ELSE 0 END) > 0
ORDER BY m.Department
OPTION (RECOMPILE)`
    );

    const summary = mk(
        "summary",
        (s, e, dept) => `${MASTER_CTE}
SELECT [Period start] = ${s}, [Period end] = ${e}
     , [Opening headcount] = SUM(CASE WHEN m.EmploymentDate < ${s}
                                       AND (m.TerminationDate IS NULL OR m.TerminationDate >= ${s})
                                      THEN 1 ELSE 0 END)
     , Joiners = SUM(CASE WHEN m.EmploymentDate BETWEEN ${s} AND ${e} THEN 1 ELSE 0 END)
     , Leavers = SUM(CASE WHEN m.TerminationDate BETWEEN ${s} AND ${e} THEN 1 ELSE 0 END)
     , [Closing headcount] = SUM(CASE WHEN m.EmploymentDate <= ${e}
                                       AND (m.TerminationDate IS NULL OR m.TerminationDate > ${e})
                                      THEN 1 ELSE 0 END)
FROM Master m
WHERE 1 = 1 ${dept}
OPTION (RECOMPILE)`
    );

    return [joiners, leavers, movements, byDepartment, summary];
};

// Grouped headcount reports are the Explorer's Summary with the group-by
// fixed, so they delegate rather than restate a forty-line aggregate.
const buildGrouped = (dimension) => (body) => {
    const shared = {
        EmploymentStatus: body.EmploymentStatus,
        Gender: body.Gender,
        IncludePercentiles: body.IncludePercentiles,
        GroupBy1: dimension,
        GroupBy2: present(body.SplitBy) && DIMENSIONS[body.SplitBy] ? body.SplitBy : "",
        OrderBy: "Headcount",
    };
    const groups = buildSummary(shared);
    const total = buildSummaryTotal(shared);
    return [
        { set: "groups", text: groups.text, params: groups.params },
        { set: "total", text: total.text, params: total.params },
    ];
};

export const STANDARD_REPORT_BUILDERS = {
    promotion: buildPromotion,
    transfer: buildTransfer,
    terminated: buildTerminated,
    monthly: buildMonthly,
    manpower: buildManpower,
    general: buildGeneralPurpose,
    "by-department": buildGrouped("Department"),
    "by-job-category": buildGrouped("JobCategory"),
    "by-marital-status": buildGrouped("MaritalStatus"),
    discipline: buildDiscipline,
    turnover: buildTurnover,
};

export { sql };

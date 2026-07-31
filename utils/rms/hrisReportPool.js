import sql from "mssql";
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

// Dedicated HRIS connection pool for the reporting module.
//
// Deliberately NOT the global `sql.connect()` pool that utils/rms/test.js uses.
// Every helper in that file opens the global pool and closes it again in a
// `finally`, which is why running two of them concurrently kills the pool — the
// first one to finish closes the connection the second is still using. A
// reporting screen fires several queries per page and holds them open for
// hundreds of milliseconds, so joining that pattern would make the problem
// worse for everyone.
//
// A separate ConnectionPool instance is independent of the global one: a
// `sql.close()` elsewhere in the codebase cannot pull the rug out from under
// these queries, and these queries cannot starve the letter flows.

const reportConfig = {
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
    pool: {
        max: 4, // reports are heavy; a small ceiling keeps HRIS out of trouble
        min: 0,
        idleTimeoutMillis: 60000,
    },
    // mssql defaults to 15 s. The percentile summary alone measures ~140 ms,
    // but usp_RefreshEmployeeReportSnapshot rebuilds the whole snapshot and can
    // run for minutes on a cold cache — 15 s would abort it every time.
    requestTimeout: 300000,
    connectionTimeout: 30000,
};

let poolPromise = null;

const createPool = () => {
    const pool = new sql.ConnectionPool(reportConfig);

    // Without this handler a transport-level error becomes an unhandled
    // rejection and takes the node process down under iisnode.
    pool.on("error", (err) => {
        console.error("[hris-report] pool error:", err.message);
        poolPromise = null;
    });

    return pool.connect().catch((err) => {
        // Drop the cached promise so the next request retries instead of
        // resolving the same rejection forever.
        poolPromise = null;
        throw err;
    });
};

export const getReportPool = async () => {
    if (poolPromise) {
        try {
            const pool = await poolPromise;
            if (pool && pool.connected) return pool;
        } catch (e) {
            // Fall through and rebuild.
        }
        poolPromise = null;
    }
    poolPromise = createPool();
    return poolPromise;
};

export const closeReportPool = async () => {
    if (!poolPromise) return;
    try {
        const pool = await poolPromise;
        await pool.close();
    } catch (e) {
        console.error("[hris-report] pool close failed:", e.message);
    } finally {
        poolPromise = null;
    }
};

export { sql };

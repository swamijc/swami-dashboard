import { Router, Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db/database';
import { decrypt } from '../crypto/encrypt';

const router = Router();

const PHOTON_BASE = 'https://timetracker.photon.com/timetracker';
// Projects for Boots UK Ltd. and Time Off accounts
// Photon internal API IDs (these differ from the human-readable project numbers shown in the UI)
// 6347 – Boots UK Ltd. project (maps to Mobile App Condor Squad / Mobile App'23 etc.)
// 5284 – Boots UK Ltd. project
// 5704 – Boots UK Ltd. project
// 4545 – Boots UK Ltd. project
// The human-readable project numbers (13755, 12667, 11925, 13087, 99995) are UI labels;
// the API requires the internal numeric IDs below.
const DEFAULT_PROJECT_IDS  = '6347,5284,5704,4545';
const DEFAULT_ACCOUNT_CODE = '0016F00004AtTC8QAN';
const TIME_OFF_PROJECT_CODE = '99995'; // Human-readable projectCode returned in API responses
// Skip corporate TLS cert (same pattern as time-tracking service)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Shared request headers for all Photon API calls
function photonHeaders(cookie: string) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Host: 'timetracker.photon.com',
    Origin: 'https://timetracker.photon.com',
    Referer: 'https://timetracker.photon.com/timetracker/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'Cache-Control': 'no-cache, no-store',
    DNT: '1',
  };
}

// Fetch Time Off entries for all employees using getEmployeeReport (20 at a time in parallel)
async function fetchTimeOffRecords(
  cookie: string, employeeCodes: string, fromDate: string, toDate: string
): Promise<any[]> {
  const codes = employeeCodes.split(',').map(c => parseInt(c.trim(), 10)).filter(n => !isNaN(n) && n > 0);
  const CONCURRENCY = 20;
  const timeOffRecords: any[] = [];

  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (empCode) => {
      try {
        const r = await axios.post(
          `${PHOTON_BASE}/getEmployeeReport?time-stamp=${Date.now()}`,
          { employeeCode: empCode, status: 0, fromDate, toDate },
          {
            httpsAgent,
            headers: photonHeaders(cookie),
            timeout: 20_000,
            validateStatus: (s: number) => s < 500,
          }
        );
        const d = r.data;
        if (typeof d === 'string' && d.trim().startsWith('<')) return []; // expired
        const recs: any[] = Array.isArray(d?.data) ? d.data : [];
        return recs.filter((rec: any) => String(rec.projectCode ?? '') === TIME_OFF_PROJECT_CODE);
      } catch { return []; }
    }));
    batchResults.forEach(recs => timeOffRecords.push(...recs));
  }

  return timeOffRecords;
}

function getSessionCookie(): string {
  const cfg = getDb().prepare(
    `SELECT session_cookie_enc, shibboleth_cookie_enc FROM service_configs WHERE service_name='photontrack_access'`
  ).get() as any;
  if (!cfg) return '';
  try {
    const full = cfg.session_cookie_enc ? decrypt(cfg.session_cookie_enc) : '';
    if (full.includes('myCookie=') || full.includes('_shibsession_')) return full;
    const shib = cfg.shibboleth_cookie_enc ? decrypt(cfg.shibboleth_cookie_enc) : '';
    return [full, shib].filter(Boolean).join('; ');
  } catch { return ''; }
}

function getExtraConfig(): { projectId: string; accountCode: string; employeeCode: string } {
  const cfg = getDb().prepare(
    `SELECT extra_config FROM service_configs WHERE service_name='photontrack_access'`
  ).get() as any;
  let employeeCode = '';
  if (cfg?.extra_config) {
    try {
      const p = JSON.parse(cfg.extra_config);
      employeeCode = p.employee_numbers
        || (Array.isArray(p.employee_batches) ? p.employee_batches.join(',') : '')
        || '';
    } catch { /* ignore */ }
  }
  return { projectId: DEFAULT_PROJECT_IDS, accountCode: DEFAULT_ACCOUNT_CODE, employeeCode };
}

// ── GET /api/timesheet-report/cached?accountId=boots ──────────
// Returns the last successfully fetched report from cache for the given account.
// Falls back to the generic 'latest' cache if no account-specific entry exists.
router.get('/cached', requireAuth, (req: Request, res: Response) => {
  try {
    const { accountId } = req.query as { accountId?: string };
    const db = getDb();
    // Try account-specific key first, then fall back to generic 'latest'
    const cacheKeys = accountId ? [`${accountId}_latest`, 'latest'] : ['latest'];
    let row: any = null;
    for (const key of cacheKeys) {
      row = db.prepare(`SELECT data, fetched_at FROM timesheet_report_cache WHERE id=?`).get(key);
      if (row) break;
    }
    if (!row) { res.json({ cached: false }); return; }
    const data = JSON.parse(row.data);
    res.json({ cached: true, cachedAt: row.fetched_at, ...data });
  } catch {
    res.json({ cached: false });
  }
});

// ── POST /api/timesheet-report/data ─────────────────────────────
router.post('/data', requireAuth, async (req: Request, res: Response) => {
  const {
    fromDate, toDate,
    projectIds: reqProjectIds,
    accountCode: reqAccountCode,
    includeTimeOff,  // boolean — if true also fetch Time Off via getEmployeeReport
  } = req.body as { fromDate?: string; toDate?: string; projectIds?: string; accountCode?: string; includeTimeOff?: boolean };

  if (!fromDate || !toDate) {
    res.status(400).json({ error: 'fromDate and toDate are required' });
    return;
  }

  const cookie = getSessionCookie();
  if (!cookie) {
    res.status(401).json({ error: 'Photon Timetracker session not configured. Save the cookie in Admin → Photon Track.' });
    return;
  }

  const { projectId, accountCode, employeeCode } = getExtraConfig();

  // IMPORTANT: Always use the backend's internal project IDs for the Photon projectReport API.
  // The frontend sends human-readable projectCodes (13755, 12667 etc.) which are response-level
  // identifiers, NOT the internal API parameter IDs (6347, 5284 etc.) that Photon requires.
  // Frontend projectIds are used only for response-level filtering (pie charts, table).
  const payload: Record<string, string> = {
    projectId,   // always DEFAULT_PROJECT_IDS = '6347,5284,5704,4545'
    accountCode: reqAccountCode || accountCode,
    status: '1,2,3,4',
    fromDate,
    toDate,
  };
  if (employeeCode) payload.employeeCode = employeeCode;

  try {
    const response = await axios.post(
      `${PHOTON_BASE}/projectReport?time-stamp=${Date.now()}`,
      payload,
      {
        httpsAgent,
        headers: photonHeaders(cookie),
        timeout: 120_000,
        maxContentLength: 20 * 1024 * 1024, // 20 MB
        validateStatus: (s: number) => s < 500,
      }
    );

    // Detect auth failures (session expired → HTML redirect)
    const isHtml = typeof response.data === 'string' && response.data.trim().startsWith('<');
    if (response.status === 401 || response.status === 403 || isHtml) {
      res.status(401).json({ error: 'Photon Timetracker session expired. Please update the cookie in Admin.' });
      return;
    }

    // Optionally fetch Time Off entries via per-employee getEmployeeReport calls
    let rawData: unknown = response.data;
    if (includeTimeOff && employeeCode) {
      const timeOffRecs = await fetchTimeOffRecords(cookie, employeeCode, fromDate!, toDate!);
      if (timeOffRecs.length > 0) {
        // Merge Time Off records with Boots UK records
        const bootsRecs: any[] = Array.isArray((rawData as any)?.data) ? (rawData as any).data : [];
        rawData = { ...response.data as any, data: [...bootsRecs, ...timeOffRecs] };
      }
    }

    const processed = processReport(rawData, fromDate!, toDate!);

    // Persist to account-specific cache AND generic 'latest'
    try {
      const db = getDb();
      const cacheId = includeTimeOff ? 'timeoff_latest' : 'boots_latest';
      const serialised = JSON.stringify(processed);
      const params = JSON.stringify({ fromDate, toDate });
      db.prepare(`INSERT OR REPLACE INTO timesheet_report_cache (id, data, fetched_at, params) VALUES (?, ?, datetime('now'), ?)`).run(cacheId, serialised, params);
      db.prepare(`INSERT OR REPLACE INTO timesheet_report_cache (id, data, fetched_at, params) VALUES ('latest', ?, datetime('now'), ?)`).run(serialised, params);
    } catch { /* cache failure is non-fatal */ }

    res.json(processed);
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      res.status(401).json({ error: 'Photon session expired. Please refresh the cookie in Admin.' });
    } else {
      res.status(500).json({ error: err.message || 'Failed to fetch timesheet report' });
    }
  }
});

// ── Helpers ──────────────────────────────────────────────────────

interface DailyEntry {
  date: string;
  saved: number; submitted: number; approved: number; disputed: number; total: number;
}
interface EmployeeEntry {
  code: string; name: string;
  saved: number; submitted: number; approved: number; disputed: number;
  total: number; hours: number; daysLogged: number;
}
interface ProjectEntry {
  projectId: string; projectName: string;
  saved: number; submitted: number; approved: number; disputed: number; total: number;
}

function processReport(raw: unknown, fromDate: string, toDate: string) {
  // Accept various response envelope shapes from Photon API
  // Confirmed shape: { data: [...], statusCode, status }
  const records: any[] = Array.isArray(raw) ? raw
    : Array.isArray((raw as any)?.data)          ? (raw as any).data
    : Array.isArray((raw as any)?.records)       ? (raw as any).records
    : Array.isArray((raw as any)?.reportData)    ? (raw as any).reportData
    : Array.isArray((raw as any)?.timesheetData) ? (raw as any).timesheetData
    : Array.isArray((raw as any)?.result)        ? (raw as any).result
    : [];

  const overall = { total: records.length, saved: 0, submitted: 0, approved: 0, disputed: 0 };
  const dailyMap: Record<string, DailyEntry> = {};
  const empMap: Record<string, EmployeeEntry & { dates: Set<string> }> = {};
  const projMap: Record<string, ProjectEntry> = {};

  for (const r of records) {
    // Actual Photon API fields (confirmed from live response):
    // statusCode, status, timesheetDate, employeeCode, employeeName,
    // projectCode, projectName, accountCode, accountName, totalHours,
    // submittedBy, submittedDate, approvedBy, approvedCode
    // NOTE: statusCode is always 0; the real status is in the 'status' text field.
    const status = String(
      r.status ?? r.Status ?? r.timesheetStatus ?? r.approvalStatus ?? ''
    ).trim().toLowerCase();
    const rawDate: string = (
      r.timesheetDate ?? r.date ?? r.Date ?? r.workDate ?? r.logDate ?? r.entryDate ?? ''
    ).toString();
    const date = rawDate.includes('T') ? rawDate.split('T')[0]
      : rawDate.includes(' ')          ? rawDate.split(' ')[0]
      : rawDate;
    const code = String(
      r.employeeCode ?? r.empCode ?? r.empId ?? r.resourceCode ?? ''
    ).trim();
    const name = String(
      r.employeeName ?? r.empName ?? r.name ?? r.resourceName ?? r.displayName ?? code
    ).trim();
    const hours = parseFloat(
      r.totalHours ?? r.hours ?? r.loggedHours ?? r.duration ?? r.actualHours ?? 0
    ) || 0;

    if      (status === 'saved')     overall.saved++;
    else if (status === 'submitted') overall.submitted++;
    else if (status === 'approved')  overall.approved++;
    else if (status === 'disputed')  overall.disputed++;

    if (date) {
      if (!dailyMap[date]) dailyMap[date] = { date, saved: 0, submitted: 0, approved: 0, disputed: 0, total: 0 };
      if      (status === 'saved')     dailyMap[date].saved++;
      else if (status === 'submitted') dailyMap[date].submitted++;
      else if (status === 'approved')  dailyMap[date].approved++;
      else if (status === 'disputed')  dailyMap[date].disputed++;
      dailyMap[date].total++;
    }

    if (code) {
      if (!empMap[code]) {
        empMap[code] = { code, name, saved: 0, submitted: 0, approved: 0, disputed: 0, total: 0, hours: 0, daysLogged: 0, dates: new Set() };
      }
      if      (status === 'saved')     empMap[code].saved++;
      else if (status === 'submitted') empMap[code].submitted++;
      else if (status === 'approved')  empMap[code].approved++;
      else if (status === 'disputed')  empMap[code].disputed++;
      empMap[code].total++;
      empMap[code].hours += hours;
      if (date) empMap[code].dates.add(date);
    }

    // Project-level aggregation — use confirmed API field names
    const projId = String(
      r.projectCode ?? r.projectId ?? r.project_id ?? r.projectNo ?? ''
    ).trim();
    const projName = String(
      r.projectName ?? r.project_name ?? r.projectTitle ?? projId
    ).trim();
    if (projId || projName) {
      const key = projId || projName;
      if (!projMap[key]) projMap[key] = { projectId: projId, projectName: projName || projId, saved: 0, submitted: 0, approved: 0, disputed: 0, total: 0 };
      if      (status === 'saved')     projMap[key].saved++;
      else if (status === 'submitted') projMap[key].submitted++;
      else if (status === 'approved')  projMap[key].approved++;
      else if (status === 'disputed')  projMap[key].disputed++;
      projMap[key].total++;
    }
  }

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  const employees = Object.values(empMap).map(({ dates, ...rest }) => ({
    ...rest,
    hours: Math.round(rest.hours * 10) / 10,
    daysLogged: dates.size,
  })).sort((a, b) => b.total - a.total);
  const projectBreakdown = Object.values(projMap).sort((a, b) => b.total - a.total);

  return { fromDate, toDate, totalRecords: records.length, overall, daily, employees, projectBreakdown };
}

export default router;

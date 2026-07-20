import { Router, Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db/database';
import { decrypt } from '../crypto/encrypt';

const router = Router();

const PHOTON_BASE = 'https://timetracker.photon.com/timetracker';
const DEFAULT_PROJECT_IDS = '6347,5284,5704,4545';
const DEFAULT_ACCOUNT_CODE = '0016F00004AtTC8QAN';
// Skip corporate TLS cert (same pattern as time-tracking service)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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

// ── POST /api/timesheet-report/data ─────────────────────────────
router.post('/data', requireAuth, async (req: Request, res: Response) => {
  const { fromDate, toDate } = req.body as { fromDate?: string; toDate?: string };
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

  const payload: Record<string, string> = {
    projectId,
    accountCode,
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
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          Cookie: cookie,
          Host: 'timetracker.photon.com',
          Origin: 'https://timetracker.photon.com',
          Referer: 'https://timetracker.photon.com/timetracker/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
          'Cache-Control': 'no-cache, no-store',
          DNT: '1',
        },
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

    const processed = processReport(response.data, fromDate, toDate);
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

function processReport(raw: unknown, fromDate: string, toDate: string) {
  // Accept various response envelope shapes from Photon API
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

  for (const r of records) {
    const status = String(
      r.status ?? r.Status ?? r.timesheetStatus ?? r.statusCode ?? r.approvalStatus ?? ''
    ).trim();
    const rawDate: string = (
      r.date ?? r.Date ?? r.workDate ?? r.timesheetDate ?? r.logDate ?? r.entryDate ?? ''
    ).toString();
    const date = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
    const code = String(
      r.employeeCode ?? r.employeeId ?? r.empCode ?? r.empId ?? r.resourceCode ?? ''
    ).trim();
    const name = String(
      r.employeeName ?? r.empName ?? r.name ?? r.resourceName ?? r.displayName ?? code
    ).trim();
    const hours = parseFloat(
      r.hours ?? r.loggedHours ?? r.totalHours ?? r.duration ?? r.actualHours ?? 0
    ) || 0;

    if      (status === '1') overall.saved++;
    else if (status === '2') overall.submitted++;
    else if (status === '3') overall.approved++;
    else if (status === '4') overall.disputed++;

    if (date) {
      if (!dailyMap[date]) dailyMap[date] = { date, saved: 0, submitted: 0, approved: 0, disputed: 0, total: 0 };
      if      (status === '1') dailyMap[date].saved++;
      else if (status === '2') dailyMap[date].submitted++;
      else if (status === '3') dailyMap[date].approved++;
      else if (status === '4') dailyMap[date].disputed++;
      dailyMap[date].total++;
    }

    if (code) {
      if (!empMap[code]) {
        empMap[code] = { code, name, saved: 0, submitted: 0, approved: 0, disputed: 0, total: 0, hours: 0, daysLogged: 0, dates: new Set() };
      }
      if      (status === '1') empMap[code].saved++;
      else if (status === '2') empMap[code].submitted++;
      else if (status === '3') empMap[code].approved++;
      else if (status === '4') empMap[code].disputed++;
      empMap[code].total++;
      empMap[code].hours += hours;
      if (date) empMap[code].dates.add(date);
    }
  }

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  const employees = Object.values(empMap).map(({ dates, ...rest }) => ({
    ...rest,
    hours: Math.round(rest.hours * 10) / 10,
    daysLogged: dates.size,
  })).sort((a, b) => b.total - a.total);

  return { fromDate, toDate, totalRecords: records.length, overall, daily, employees };
}

export default router;

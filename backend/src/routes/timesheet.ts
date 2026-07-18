import { Router, Request, Response } from 'express';
import axios from 'axios';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getDb } from '../db/database';
import { decrypt } from '../crypto/encrypt';

const router = Router();

const PHOTON_URL = process.env.PHOTON_SERVICE_URL || 'http://localhost:8001';
const BOOTS_URL  = process.env.BOOTS_KI_SERVICE_URL || 'http://localhost:8002';

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Format a Date using local calendar date parts (avoids UTC midnight boundary
// crossing on IST machines where midnight local = previous day in UTC).
function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getMonday(value?: string): Date {
  // Use noon (T12:00:00) so that local getDay()/getDate() arithmetic stays on
  // the intended calendar date regardless of IST / other UTC+ timezones.
  const source = value ? new Date(`${value}T12:00:00`) : new Date();
  const day = source.getDay();
  const diff = source.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(source.setDate(diff));
}

function getPhotonStatusLookupConfig(serviceName: string): { configured: boolean; endpoint?: string } {
  const cfg = getDb().prepare(`SELECT extra_config FROM service_configs WHERE service_name=?`).get(serviceName) as any;
  const extra = JSON.parse(cfg?.extra_config || '{}');
  const endpoint = extra.status_endpoint || extra.timesheet_status_endpoint;
  return { configured: !!endpoint, endpoint };
}

function latestRunForService(serviceName: string, fromDate: string, toDate: string): any {
  return getDb().prepare(`
    SELECT id, service_name, schedule_name, triggered_by, started_at, completed_at,
      status, http_status_code, response_summary, error_message, records_processed, is_dry_run
    FROM job_runs
    WHERE service_name=? AND date(started_at) BETWEEN date(?) AND date(?)
    ORDER BY started_at DESC
    LIMIT 1
  `).get(serviceName, fromDate, toDate);
}

function latestRunForSchedule(serviceName: string, scheduleName: string): any {
  return getDb().prepare(`
    SELECT id, service_name, schedule_name, triggered_by, started_at, completed_at,
      status, http_status_code, response_summary, error_message, records_processed, is_dry_run
    FROM job_runs
    WHERE service_name=? AND schedule_name=?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(serviceName, scheduleName);
}

function latestSuccessfulRunToday(serviceName: string, scheduleName: string): any {
  return getDb().prepare(`
    SELECT id, started_at, completed_at, status, records_processed
    FROM job_runs
    WHERE service_name=? AND schedule_name=? AND status='success' AND date(started_at)=date('now')
    ORDER BY started_at DESC
    LIMIT 1
  `).get(serviceName, scheduleName);
}

function getWeekDayRuns(serviceName: string, weekStart: string): Array<{date: string; label: string; run: any}> {
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  // Parse as UTC midnight so toISOString() gives the correct calendar date
  // regardless of the server's local timezone (e.g. IST = UTC+5:30).
  const monday = new Date(`${weekStart}T00:00:00Z`);
  return DAY_LABELS.map((label, i) => {
    const d = new Date(monday.getTime() + i * 86400000); // add i full days in ms
    const date = d.toISOString().split('T')[0];
    const run = getDb().prepare(`
      SELECT id, status, triggered_by, started_at, completed_at, error_message
      FROM job_runs
      WHERE service_name=? AND date(started_at)=date(?) AND is_dry_run=0
      ORDER BY started_at DESC LIMIT 1
    `).get(serviceName, date) || null;
    return { date, label, run };
  });
}

function logRun(serviceName: string, triggeredBy: string, isDryRun: boolean): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO job_runs (service_name, triggered_by, status, is_dry_run)
    VALUES (?, ?, 'running', ?)
  `).run(serviceName, triggeredBy, isDryRun ? 1 : 0);
  return result.lastInsertRowid as number;
}

function updateRun(id: number, status: string, httpCode?: number, summary?: string, error?: string, records?: number): void {
  getDb().prepare(`
    UPDATE job_runs SET status=?, http_status_code=?, response_summary=?,
    error_message=?, records_processed=?, completed_at=datetime('now')
    WHERE id=?
  `).run(status, httpCode ?? null, summary ?? null, error ?? null, records ?? 0, id);
}

function getSessionCookies(serviceName: string): { photon?: string; ki?: string } {
  const db = getDb();
  const cfg = db.prepare(`SELECT * FROM service_configs WHERE service_name=?`).get(serviceName) as any;
  if (!cfg) return {};

  const photonCookie = cfg.session_cookie_enc ? decrypt(cfg.session_cookie_enc) : '';
  const shibCookie   = cfg.shibboleth_cookie_enc ? decrypt(cfg.shibboleth_cookie_enc) : '';
  const aspSession   = cfg.asp_net_session_enc ? decrypt(cfg.asp_net_session_enc) : '';
  const csrfToken    = cfg.csrf_token_enc ? decrypt(cfg.csrf_token_enc) : '';
  const apiAccess    = cfg.api_access_enc ? decrypt(cfg.api_access_enc) : '';
  const k1           = cfg.k1_enc ? decrypt(cfg.k1_enc) : '';

  return {
    photon: [photonCookie, shibCookie].filter(Boolean).join('; '),
    ki: [`CORE-CURRENTCULTURECODE=`, `CSRFToken=${csrfToken}`,
         `ASP.NET_SessionId=${aspSession}`, `api_access=${apiAccess}`,
         `k1=${k1}`].filter(v => !v.endsWith('=')).join('; ')
  };
}

// ── Photon: Weekly Status Summary ───────────────────────────────
router.get('/photon/status-summary', requireAuth, (req: Request, res: Response) => {
  const selectedMonday = getMonday(req.query.week_start as string | undefined);
  const weekStart = localIsoDate(selectedMonday);
  const weekEnd = localIsoDate(addDays(selectedMonday, 6));

  const entries = [
    {
      key: 'swami',
      title: "Swami's Timesheet Entry",
      service_name: 'photon_swami_entry',
      resource: 'Swaminathan Kannaiyan',
      employee: '17463',
    },
    {
      key: 'prasanna',
      title: "Prasanna's Timesheet Entry",
      service_name: 'photon_prasanna_entry',
      resource: 'Prasanna VI',
      employee: '102014',
    },
  ].map(entry => {
    const lookup = getPhotonStatusLookupConfig(entry.service_name);
    const lastRun = latestRunForService(entry.service_name, weekStart, weekEnd);
    return {
      ...entry,
      week_start: weekStart,
      week_end: weekEnd,
      photon_status_lookup: {
        configured: lookup.configured,
        endpoint: lookup.endpoint || null,
        status: lookup.configured ? 'ready' : 'not_configured',
        message: lookup.configured
          ? 'Photon status endpoint configured.'
          : 'Photon read/status endpoint is not configured yet, so approved/saved/submitted state cannot be verified from Photon.',
      },
      dashboard_submission: {
        inferred_status: lastRun
          ? lastRun.status === 'success'
            ? 'submitted_by_dashboard'
            : lastRun.status
          : 'no_dashboard_run_for_week',
        last_run: lastRun || null,
      },
      week_days: getWeekDayRuns(entry.service_name, weekStart),
    };
  });

  res.json({ week_start: weekStart, week_end: weekEnd, entries });
});

// ── Photon: Approval Schedule Execution Summary ─────────────────
router.get('/photon/approval-summary', requireAuth, (_req: Request, res: Response) => {
  const schedules = getDb().prepare(`
    SELECT id, service_name, schedule_name, cron_expression, timezone, is_enabled
    FROM job_schedules
    WHERE service_name='photon_approval'
    ORDER BY schedule_name
  `).all() as any[];

  res.json({
    service_name: 'photon_approval',
    schedules: schedules.map(schedule => {
      const lastRun = latestRunForSchedule('photon_approval', schedule.schedule_name);
      const todaySuccess = latestSuccessfulRunToday('photon_approval', schedule.schedule_name);
      return {
        ...schedule,
        is_enabled: !!schedule.is_enabled,
        last_run: lastRun || null,
        today_success: !!todaySuccess,
        today_success_run: todaySuccess || null,
      };
    }),
  });
});

// ── Photon: Swami Entry ─────────────────────────────────────────
router.post('/photon/swami/submit', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const isDry = req.body.dry_run === true;

  // Duplicate guard: skip only when submitting for TODAY (no backfill override).
  // If target_date is explicitly a past date, allow it through (backfill).
  const targetDate: string | undefined = req.body.target_date;
  const todayDate = localIsoDate(new Date());
  const isBackfill = targetDate && targetDate !== todayDate;
  if (!isDry && !isBackfill) {
    const existing = getDb().prepare(`
      SELECT id, started_at FROM job_runs
      WHERE service_name='photon_swami_entry'
        AND status='success'
        AND is_dry_run=0
        AND date(started_at)=date(?)
      LIMIT 1
    `).get(todayDate) as any;
    if (existing) {
      return res.json({
        status: 'already_submitted',
        date: todayDate,
        message: `Timesheet for ${todayDate} already has an entry (run #${existing.id}). No duplicate submitted.`,
        run_id: existing.id,
      });
    }
  }

  const runId = logRun('photon_swami_entry', (req.session as any).username, isDry);
  try {
    const cookies = getSessionCookies('photon_swami_entry');
    const resp = await axios.post(`${PHOTON_URL}/swami/submit`, {
      ...req.body, dry_run: isDry, session_cookie: cookies.photon
    }, { timeout: 30000 });
    updateRun(runId, isDry ? 'dry_run' : 'success', resp.status, JSON.stringify(resp.data), undefined, 1);
    res.json({ run_id: runId, ...resp.data });
  } catch (err: any) {
    const msg = err?.response?.data?.detail || err.message;
    updateRun(runId, 'failed', err?.response?.status, undefined, msg);
    res.status(500).json({ run_id: runId, error: msg });
  }
});
// ── Photon: Swami PMO Submit ────────────────────────────────────
// Step 1: calls getRequestReviewSearch to find pending items.
// Step 2: auto-confirms and calls updateRequestForReview.
// Triggers "Defaulter Timesheet Approval Request Notification" email.
router.post('/photon/swami/pmo-submit', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const isDry = req.body.dry_run === true;
  try {
    const cookies = getSessionCookies('photon_swami_entry');
    const resp = await axios.post(`${PHOTON_URL}/swami/pmo-submit`, {
      ...req.body, dry_run: isDry, session_cookie: cookies.photon
    }, { timeout: 30000 });
    res.json(resp.data);
  } catch (err: any) {
    const msg = err?.response?.data?.detail || err.message;
    res.status(err?.response?.status || 500).json({ error: msg });
  }
});
// ── Photon: Prasanna Entry ──────────────────────────────────────
router.post('/photon/prasanna/submit', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const isDry = req.body.dry_run === true;

  // Duplicate guard: skip only when no explicit dates[] provided (backfill bypasses guard).
  const explicitDates: string[] | undefined = req.body.dates;
  const isBackfillPrasanna = explicitDates && explicitDates.length > 0;
  if (!isDry && !isBackfillPrasanna) {
    const existing = getDb().prepare(`
      SELECT id, started_at FROM job_runs
      WHERE service_name='photon_prasanna_entry'
        AND status='success'
        AND is_dry_run=0
        AND date(started_at)=date('now')
      LIMIT 1
    `).get() as any;
    if (existing) {
      return res.json({
        status: 'already_submitted',
        message: `Prasanna's timesheet entry for today was already submitted (run #${existing.id}). No duplicate made.`,
        run_id: existing.id,
      });
    }
  }

  const runId = logRun('photon_prasanna_entry', (req.session as any).username, isDry);
  try {
    const cookies = getSessionCookies('photon_prasanna_entry');
    const resp = await axios.post(`${PHOTON_URL}/prasanna/submit`, {
      ...req.body, dry_run: isDry, session_cookie: cookies.photon
    }, { timeout: 30000 });
    // insertXls returns HTTP 200 even on failure — inspect the body status.
    const bodyStatus: string = resp.data?.status ?? resp.data?.response?.status ?? 'SUCCESS';
    const photonFailed = bodyStatus === 'FAILURE';
    const runStatus = isDry ? 'dry_run' : (photonFailed ? 'failed' : 'success');
    const errMsg = photonFailed ? (resp.data?.message || resp.data?.response?.message || 'Photon insertXls returned FAILURE') : undefined;
    updateRun(runId, runStatus, resp.status, JSON.stringify(resp.data), errMsg, isDry || photonFailed ? 0 : 1);
    if (photonFailed) {
      res.status(417).json({ run_id: runId, error: errMsg, response: resp.data });
    } else {
      res.json({ run_id: runId, ...resp.data });
    }
  } catch (err: any) {
    const msg = err?.response?.data?.detail || err.message;
    updateRun(runId, 'failed', err?.response?.status, undefined, msg);
    res.status(err?.response?.status || 500).json({ run_id: runId, error: msg });
  }
});

// ── Photon: Session health check ───────────────────────────────
// Returns whether the stored Photon Timetracker session is still valid
// by checking whether the last Swami entry succeeded today or recently.
router.get('/photon/session-check', requireAuth, (_req: Request, res: Response) => {
  const cfg = getDb().prepare(`SELECT session_cookie_enc, shibboleth_cookie_enc FROM service_configs WHERE service_name='photon_swami_entry'`).get() as any;
  const cookieSet = !!(cfg?.session_cookie_enc);
  // Check if last photon_swami_entry run failed with a session/redirect error
  const lastRun = getDb().prepare(`
    SELECT status, error_message, started_at FROM job_runs
    WHERE service_name='photon_swami_entry' AND is_dry_run=0
    ORDER BY started_at DESC LIMIT 1
  `).get() as any;
  const sessionExpired = lastRun?.status === 'failed' &&
    (lastRun?.error_message || '').toLowerCase().includes('302');
  res.json({
    cookie_set: cookieSet,
    session_expired: sessionExpired,
    last_run_status: lastRun?.status || null,
    last_run_at: lastRun?.started_at || null,
  });
});

// ── Photon: Refresh session — saves cookie to all 3 photon services ─
// Called from the "Refresh Session" button in the UI.
// Accepts the raw Cookie header string and encrypts it into all three
// photon service configs (photon_swami_entry, photon_prasanna_entry, photon_approval).
router.post('/photon/refresh-session', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { cookie_header } = req.body;
  if (!cookie_header || typeof cookie_header !== 'string') {
    res.status(400).json({ error: 'cookie_header is required' });
    return;
  }
  const normalised = cookie_header.replace(/^cookie:\s*/i, '').split(/\r?\n/)[0].trim();
  if (!normalised.includes('myCookie=') || !normalised.includes('_shibsession_')) {
    res.status(400).json({ error: 'Cookie must contain myCookie and _shibsession_ values' });
    return;
  }
  const { encrypt } = require('../crypto/encrypt');
  const shibPart = normalised.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('_shibsession_')) || '';
  const db = getDb();
  const services = ['photon_swami_entry', 'photon_prasanna_entry', 'photon_approval'];
  for (const svc of services) {
    db.prepare(`
      UPDATE service_configs SET
        session_cookie_enc = ?,
        shibboleth_cookie_enc = ?,
        last_updated_by = ?, last_updated_at = datetime('now')
      WHERE service_name = ?
    `).run(encrypt(normalised), shibPart ? encrypt(shibPart) : null, (req.session as any).username || 'admin', svc);
  }
  res.json({ message: 'Session refreshed for all Photon services', services });
});

// ── Photon: Approval ────────────────────────────────────────────
router.post('/photon/approve', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const isDry = req.body.dry_run === true;
  const runId = logRun('photon_approval', (req.session as any).username, isDry);
  try {
    const cookies = getSessionCookies('photon_approval');
    const resp = await axios.post(`${PHOTON_URL}/approve`, {
      ...req.body, dry_run: isDry, session_cookie: cookies.photon
    }, { timeout: 30000 });
    updateRun(runId, isDry ? 'dry_run' : 'success', resp.status, JSON.stringify(resp.data), undefined, resp.data?.approved_count ?? 0);
    res.json({ run_id: runId, ...resp.data });
  } catch (err: any) {
    const msg = err?.response?.data?.detail || err.message;
    updateRun(runId, 'failed', err?.response?.status, undefined, msg);
    res.status(500).json({ run_id: runId, error: msg });
  }
});

// ── Boots KI: Swami ─────────────────────────────────────────────
router.post('/boots/swami/submit', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const isDry = req.body.dry_run === true;
  const runId = logRun('boots_ki_swami', (req.session as any).username, isDry);
  try {
    const cookies = getSessionCookies('boots_ki_swami');
    const db = getDb();
    const cfg = db.prepare(`SELECT extra_config FROM service_configs WHERE service_name='boots_ki_swami'`).get() as any;
    const resp = await axios.post(`${BOOTS_URL}/submit`, {
      resource_code: 'KSWA1', dry_run: isDry,
      ki_cookie: cookies.ki, config: JSON.parse(cfg?.extra_config || '{}'),
      week_start: req.body.week_start, day_flags: req.body.day_flags
    }, { timeout: 30000 });
    updateRun(runId, isDry ? 'dry_run' : 'success', resp.status, JSON.stringify(resp.data), undefined, 1);
    res.json({ run_id: runId, ...resp.data });
  } catch (err: any) {
    const msg = err?.response?.data?.detail || err.message;
    updateRun(runId, 'failed', err?.response?.status, undefined, msg);
    res.status(500).json({ run_id: runId, error: msg });
  }
});

// ── Boots KI: PV ────────────────────────────────────────────────
router.post('/boots/pv/submit', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const isDry = req.body.dry_run === true;
  const runId = logRun('boots_ki_pv', (req.session as any).username, isDry);
  try {
    const cookies = getSessionCookies('boots_ki_pv');
    const db = getDb();
    const cfg = db.prepare(`SELECT extra_config FROM service_configs WHERE service_name='boots_ki_pv'`).get() as any;
    const resp = await axios.post(`${BOOTS_URL}/submit`, {
      resource_code: 'VILP1', dry_run: isDry,
      ki_cookie: cookies.ki, config: JSON.parse(cfg?.extra_config || '{}'),
      week_start: req.body.week_start, day_flags: req.body.day_flags
    }, { timeout: 30000 });
    updateRun(runId, isDry ? 'dry_run' : 'success', resp.status, JSON.stringify(resp.data), undefined, 1);
    res.json({ run_id: runId, ...resp.data });
  } catch (err: any) {
    const msg = err?.response?.data?.detail || err.message;
    updateRun(runId, 'failed', err?.response?.status, undefined, msg);
    res.status(500).json({ run_id: runId, error: msg });
  }
});

// ── Job Run History ─────────────────────────────────────────────
router.get('/runs', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const service = req.query.service as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const query = service
    ? db.prepare(`SELECT * FROM job_runs WHERE service_name=? ORDER BY started_at DESC LIMIT ?`).all(service, limit)
    : db.prepare(`SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?`).all(limit);
  res.json(query);
});

// ── Team Members ────────────────────────────────────────────────
router.get('/team', requireAuth, (_req: Request, res: Response) => {
  res.json(getDb().prepare(`SELECT * FROM team_members WHERE is_active=1 ORDER BY name`).all());
});

// ── KI Week Flags ────────────────────────────────────────────────
router.get('/ki/flags', requireAuth, (req: Request, res: Response) => {
  const week_start = req.query.week_start as string;
  const resource   = req.query.resource as string;
  if (!week_start || !resource) { res.status(400).json({ error: 'week_start and resource required' }); return; }
  const row = getDb().prepare(`SELECT * FROM ki_week_flags WHERE resource_code=? AND week_start=?`).get(resource, week_start);
  res.json(row || { resource_code: resource, week_start, mon:'Y',tue:'Y',wed:'Y',thu:'Y',fri:'Y' });
});

router.put('/ki/flags', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { resource_code, week_start, mon, tue, wed, thu, fri } = req.body;
  getDb().prepare(`
    INSERT INTO ki_week_flags (resource_code, week_start, mon, tue, wed, thu, fri)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(resource_code, week_start) DO UPDATE SET mon=?,tue=?,wed=?,thu=?,fri=?
  `).run(resource_code, week_start, mon, tue, wed, thu, fri, mon, tue, wed, thu, fri);
  res.json({ message: 'Flags updated' });
});

export default router;

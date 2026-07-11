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

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getMonday(value?: string): Date {
  const source = value ? new Date(`${value}T00:00:00`) : new Date();
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
  const weekStart = toIsoDate(selectedMonday);
  const weekEnd = toIsoDate(addDays(selectedMonday, 6));

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

// ── Photon: Prasanna Entry ──────────────────────────────────────
router.post('/photon/prasanna/submit', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const isDry = req.body.dry_run === true;
  const runId = logRun('photon_prasanna_entry', (req.session as any).username, isDry);
  try {
    const cookies = getSessionCookies('photon_prasanna_entry');
    const resp = await axios.post(`${PHOTON_URL}/prasanna/submit`, {
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

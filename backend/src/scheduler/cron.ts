import cron from 'node-cron';
import axios from 'axios';
import { getDb } from '../db/database';
import { decrypt } from '../crypto/encrypt';

const PHOTON_URL = process.env.PHOTON_SERVICE_URL || 'http://localhost:8001';
const BOOTS_URL  = process.env.BOOTS_KI_SERVICE_URL || 'http://localhost:8002';

// ── Session keep-alive: ping Photon to reset the Shibboleth idle timer ──────
// Returns true if the session is still alive (HTTP 200), false if expired (302).
// A GET to the timetracker home page with a valid session returns 200.
// With an expired session Shibboleth redirects to the SSO login page (302).
export async function pingPhotonSession(): Promise<boolean> {
  const cfg = getDb().prepare(
    `SELECT session_cookie_enc, shibboleth_cookie_enc FROM service_configs WHERE service_name='photon_swami_entry'`
  ).get() as any;
  if (!cfg?.session_cookie_enc) return false;

  const cookie = [
    cfg.session_cookie_enc     ? decrypt(cfg.session_cookie_enc)    : '',
    cfg.shibboleth_cookie_enc  ? decrypt(cfg.shibboleth_cookie_enc) : '',
  ].filter(Boolean).join('; ');

  if (!cookie) return false;

  try {
    const resp = await axios.get('https://timetracker.photon.com/timetracker/', {
      headers: {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      maxRedirects: 0,                       // never follow — 302 = expired
      validateStatus: () => true,            // don't throw on any status
      timeout: 12000,
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

// Write session liveness into DB so the UI and the submission cron can read it.
function storeSessionStatus(alive: boolean): void {
  getDb().prepare(`
    INSERT INTO service_configs (service_name, extra_config, last_updated_at)
    VALUES ('photon_session_status', ?, datetime('now'))
    ON CONFLICT(service_name) DO UPDATE
      SET extra_config=excluded.extra_config,
          last_updated_at=excluded.last_updated_at
  `).run(JSON.stringify({ alive, checked_at: new Date().toISOString() }));
}

async function runPhotonKeepAlive(): Promise<void> {
  const alive = await pingPhotonSession();
  storeSessionStatus(alive);
  if (alive) {
    console.log('[CRON] photon_keepalive: session alive ✓ (idle timer reset)');
  } else {
    console.warn('[CRON] photon_keepalive: session EXPIRED — open Photon Timetracker, copy cookies, paste in Admin panel');
  }
}

function logRun(serviceName: string, scheduleName: string): number {
  const result = getDb().prepare(`
    INSERT INTO job_runs (service_name, schedule_name, triggered_by, status)
    VALUES (?, ?, 'cron', 'running')
  `).run(serviceName, scheduleName);
  return result.lastInsertRowid as number;
}

function finishRun(id: number, status: string, code?: number, summary?: string, error?: string, records?: number): void {
  getDb().prepare(`
    UPDATE job_runs SET status=?, http_status_code=?, response_summary=?,
    error_message=?, records_processed=?, completed_at=datetime('now') WHERE id=?
  `).run(status, code ?? null, summary ?? null, error ?? null, records ?? 0, id);
}

function getPhotonCookie(serviceName: string): string {
  const cfg = getDb().prepare(`SELECT * FROM service_configs WHERE service_name=?`).get(serviceName) as any;
  if (!cfg) return '';
  const parts = [
    cfg.session_cookie_enc     ? decrypt(cfg.session_cookie_enc)     : '',
    cfg.shibboleth_cookie_enc  ? decrypt(cfg.shibboleth_cookie_enc)  : ''
  ].filter(Boolean);
  return parts.join('; ');
}

function getKICookie(): string {
  const cfg = getDb().prepare(`SELECT * FROM service_configs WHERE service_name='boots_ki_swami'`).get() as any;
  if (!cfg) return '';
  return [
    `CORE-CURRENTCULTURECODE=`,
    `CSRFToken=${cfg.csrf_token_enc ? decrypt(cfg.csrf_token_enc) : ''}`,
    `ASP.NET_SessionId=${cfg.asp_net_session_enc ? decrypt(cfg.asp_net_session_enc) : ''}`,
    `api_access=${cfg.api_access_enc ? decrypt(cfg.api_access_enc) : ''}`,
    `k1=${cfg.k1_enc ? decrypt(cfg.k1_enc) : ''}`
  ].join('; ');
}

function getKIConfig(serviceName: string): Record<string, unknown> {
  const cfg = getDb().prepare(`SELECT extra_config FROM service_configs WHERE service_name=?`).get(serviceName) as any;
  return JSON.parse(cfg?.extra_config || '{}');
}

function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

async function runPhotonSwamiEntry(): Promise<void> {
  // Duplicate guard: skip if today already has a successful real submission.
  const alreadyDone = getDb().prepare(`
    SELECT id FROM job_runs
    WHERE service_name='photon_swami_entry' AND status='success'
      AND is_dry_run=0 AND date(started_at)=date('now') LIMIT 1
  `).get();
  if (alreadyDone) {
    console.log('[CRON] photon_swami_entry: already submitted today — skipping duplicate');
    return;
  }

  // Session pre-check: detect expired session early and give a clear error.
  const sessionAlive = await pingPhotonSession();
  storeSessionStatus(sessionAlive);
  if (!sessionAlive) {
    const runId = logRun('photon_swami_entry', 'Daily 1:45 PM IST');
    finishRun(runId, 'failed', 302, undefined,
      'Photon session expired — open timetracker.photon.com, copy fresh cookies, paste in Admin → Photon Access');
    console.error('[CRON] photon_swami_entry: session EXPIRED — skipping submission, please refresh cookies');
    return;
  }

  const runId = logRun('photon_swami_entry', 'Daily 1:45 PM IST');
  try {
    const resp = await axios.post(`${PHOTON_URL}/swami/submit`, {
      dry_run: false, session_cookie: getPhotonCookie('photon_swami_entry')
    }, { timeout: 30000 });
    finishRun(runId, 'success', resp.status, JSON.stringify(resp.data), undefined, 1);
    console.log(`[CRON] photon_swami_entry: success`);
  } catch (err: any) {
    finishRun(runId, 'failed', err?.response?.status, undefined, err.message);
    console.error(`[CRON] photon_swami_entry: failed — ${err.message}`);
  }
}

async function runPhotonSwamiPmoSubmit(): Promise<void> {
  // Guard: only proceed when today's photon_swami_entry has a non-dry success.
  const todayOk = getDb().prepare(`
    SELECT id FROM job_runs
    WHERE service_name='photon_swami_entry'
      AND status='success'
      AND is_dry_run=0
      AND date(started_at)=date('now')
    LIMIT 1
  `).get();

  if (!todayOk) {
    console.log('[CRON] photon_swami_pmo: skipping — today\u2019s timesheet not yet submitted successfully');
    return;
  }

  const runId = logRun('photon_swami_pmo', 'Daily 1:50 PM IST');
  try {
    const resp = await axios.post(`${PHOTON_URL}/swami/pmo-submit`, {
      dry_run: false, session_cookie: getPhotonCookie('photon_swami_entry')
    }, { timeout: 30000 });
    const submitted = resp.data?.submitted_count ?? 0;
    const runStatus = resp.data?.status === 'no_pending' ? 'skipped' : 'success';
    finishRun(runId, runStatus, resp.status, JSON.stringify(resp.data), undefined, submitted);
    console.log(`[CRON] photon_swami_pmo: ${runStatus} submitted=${submitted}`);
  } catch (err: any) {
    finishRun(runId, 'failed', err?.response?.status, undefined, err.message);
    console.error(`[CRON] photon_swami_pmo: failed — ${err.message}`);
  }
}

async function runPhotonPrasannaEntry(): Promise<void> {
  // Duplicate guard: skip if today already has a successful real submission.
  const alreadyDone = getDb().prepare(`
    SELECT id FROM job_runs
    WHERE service_name='photon_prasanna_entry' AND status='success'
      AND is_dry_run=0 AND date(started_at)=date('now') LIMIT 1
  `).get();
  if (alreadyDone) {
    console.log('[CRON] photon_prasanna_entry: already submitted today — skipping duplicate');
    return;
  }

  // Re-use the swami session check result already stored a few ms ago (same session).
  const sessionStatus = getDb().prepare(
    `SELECT extra_config FROM service_configs WHERE service_name='photon_session_status'`
  ).get() as any;
  const sessionAlive = JSON.parse(sessionStatus?.extra_config || '{"alive":true}').alive;
  if (!sessionAlive) {
    const runId = logRun('photon_prasanna_entry', 'Daily 1:45 PM IST');
    finishRun(runId, 'failed', 302, undefined,
      'Photon session expired — open timetracker.photon.com, copy fresh cookies, paste in Admin → Photon Access');
    console.error('[CRON] photon_prasanna_entry: session EXPIRED — skipping submission');
    return;
  }

  const runId = logRun('photon_prasanna_entry', 'Daily 1:45 PM IST');
  try {
    const resp = await axios.post(`${PHOTON_URL}/prasanna/submit`, {
      dry_run: false, session_cookie: getPhotonCookie('photon_prasanna_entry')
    }, { timeout: 30000 });
    finishRun(runId, 'success', resp.status, JSON.stringify(resp.data), undefined, 1);
    console.log(`[CRON] photon_prasanna_entry: success`);
  } catch (err: any) {
    finishRun(runId, 'failed', err?.response?.status, undefined, err.message);
    console.error(`[CRON] photon_prasanna_entry: failed — ${err.message}`);
  }
}

async function runPhotonApproval(scheduleName: string): Promise<void> {
  const runId = logRun('photon_approval', scheduleName);
  try {
    const resp = await axios.post(`${PHOTON_URL}/approve`, {
      dry_run: false, session_cookie: getPhotonCookie('photon_approval')
    }, { timeout: 30000 });
    finishRun(runId, 'success', resp.status, JSON.stringify(resp.data), undefined, resp.data?.approved_count ?? 0);
    console.log(`[CRON] photon_approval (${scheduleName}): approved ${resp.data?.approved_count ?? 0}`);
  } catch (err: any) {
    finishRun(runId, 'failed', err?.response?.status, undefined, err.message);
    console.error(`[CRON] photon_approval: failed — ${err.message}`);
  }
}

async function runBootsKISubmit(resource: 'KSWA1' | 'VILP1', service: string): Promise<void> {
  const runId = logRun(service, 'Monday 1:45 PM IST');
  try {
    const resp = await axios.post(`${BOOTS_URL}/submit`, {
      resource_code: resource, dry_run: false,
      ki_cookie: getKICookie(), config: getKIConfig(service),
      week_start: getCurrentWeekStart(),
      day_flags: { mon:'Y', tue:'Y', wed:'Y', thu:'Y', fri:'Y' }
    }, { timeout: 30000 });
    finishRun(runId, 'success', resp.status, JSON.stringify(resp.data), undefined, 1);
    console.log(`[CRON] ${service}: success`);
  } catch (err: any) {
    finishRun(runId, 'failed', err?.response?.status, undefined, err.message);
    console.error(`[CRON] ${service}: failed — ${err.message}`);
  }
}

// ── Startup catch-up: run missed jobs if backend started after cron time ───
// Called once from initScheduler(). Handles the case where the backend was
// restarted or the Mac woke up after 08:15 UTC on a weekday.
async function scheduleMissedCatchup(): Promise<void> {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun … 6=Sat
  const isWeekday  = dayOfWeek >= 1 && dayOfWeek <= 5;
  const utcHour    = now.getUTCHours();
  const utcMin     = now.getUTCMinutes();
  const pastCron   = utcHour > 8 || (utcHour === 8 && utcMin >= 15);

  if (!isWeekday || !pastCron) {
    console.log('[CRON][CATCHUP] No catch-up needed (not a weekday past 08:15 UTC)');
    return;
  }

  console.log('[CRON][CATCHUP] Weekday past 08:15 UTC — checking for missed jobs...');

  // Allow Python services time to finish starting up
  await new Promise(r => setTimeout(r, 15000));

  // Each function has its own internal duplicate guard — safe to call unconditionally
  await runPhotonSwamiEntry();
  await runPhotonPrasannaEntry();
  await runPhotonApproval('Startup Catch-up');

  // PMO: runs 10 s after swami entry (its own guard checks today's swami success)
  await new Promise(r => setTimeout(r, 10000));
  await runPhotonSwamiPmoSubmit();

  // Boots KI runs Monday only — include in catch-up when today is Monday (UTC)
  if (dayOfWeek === 1) {
    const bootsSwami = getDb().prepare(
      `SELECT id FROM job_runs WHERE service_name='boots_ki_swami' AND status='success' AND is_dry_run=0 AND date(started_at)=date('now') LIMIT 1`
    ).get();
    const bootsPv = getDb().prepare(
      `SELECT id FROM job_runs WHERE service_name='boots_ki_pv' AND status='success' AND is_dry_run=0 AND date(started_at)=date('now') LIMIT 1`
    ).get();
    if (!bootsSwami) {
      console.log('[CRON][CATCHUP] boots_ki_swami missed today (Monday) — running now...');
      await runBootsKISubmit('KSWA1', 'boots_ki_swami');
    }
    if (!bootsPv) {
      console.log('[CRON][CATCHUP] boots_ki_pv missed today (Monday) — running now...');
      await runBootsKISubmit('VILP1', 'boots_ki_pv');
    }
  }

  console.log('[CRON][CATCHUP] Catch-up complete');
}

export function initScheduler(): void {
  // ── Photon Session Keep-alive: Mon-Fri every 2 h (9 AM→6 PM IST) ──────────
  // Resets the Shibboleth idle timer so the 1:45 PM submission succeeds.
  // Runs at 3:30, 5:30, 7:30, 9:30 UTC (9 AM, 11 AM, 1 PM, 3 PM, 5:30 PM IST)
  // Also pings at 6:30 UTC (12 PM IST) — 75 min before the submission cron.
  cron.schedule('30 3,5,6,7,9 * * 1-5', () => {
    console.log('[CRON] Triggering photon_keepalive...');
    runPhotonKeepAlive();
  }, { timezone: 'UTC' });

  // ── Photon Swami Entry: Mon–Fri 1:45 PM IST (08:15 UTC) ────────
  cron.schedule('15 8 * * 1-5', () => {
    console.log('[CRON] Triggering photon_swami_entry...');
    runPhotonSwamiEntry();
  }, { timezone: 'UTC' });

  // ── Photon Swami PMO Submit: Mon–Fri 1:50 PM IST (08:20 UTC) ───
  // Runs 5 min after the timesheet cron; only proceeds if today’s
  // photon_swami_entry has a successful (non-dry) run recorded.
  cron.schedule('20 8 * * 1-5', () => {
    console.log('[CRON] Triggering photon_swami_pmo...');
    runPhotonSwamiPmoSubmit();
  }, { timezone: 'UTC' });

  // ── Photon Prasanna Entry: Mon–Fri 1:45 PM IST (08:15 UTC) ───────
  cron.schedule('15 8 * * 1-5', () => {
    console.log('[CRON] Triggering photon_prasanna_entry...');
    runPhotonPrasannaEntry();
  }, { timezone: 'UTC' });

  // ── Photon Approval Run 1: Daily 1:45 PM IST (08:15 UTC) ────────
  cron.schedule('15 8 * * *', () => {
    console.log('[CRON] Triggering photon_approval (Run 1)...');
    runPhotonApproval('Daily 1:45 PM IST');
  }, { timezone: 'UTC' });

  // ── Photon Approval Run 2: Daily 8:00 PM IST (14:30 UTC) ────────
  cron.schedule('30 14 * * *', () => {
    console.log('[CRON] Triggering photon_approval (Run 2)...');
    runPhotonApproval('Daily 8:00 PM IST');
  }, { timezone: 'UTC' });

  // ── Boots KI Swami: Monday 1:45 PM IST (08:15 UTC) ──────────────
  cron.schedule('15 8 * * 1', () => {
    console.log('[CRON] Triggering boots_ki_swami...');
    runBootsKISubmit('KSWA1', 'boots_ki_swami');
  }, { timezone: 'UTC' });

  // ── Boots KI PV: Monday 1:45 PM IST (08:15 UTC) ─────────────────
  cron.schedule('15 8 * * 1', () => {
    console.log('[CRON] Triggering boots_ki_pv...');
    runBootsKISubmit('VILP1', 'boots_ki_pv');
  }, { timezone: 'UTC' });

  console.log('[CRON] All schedules registered (UTC timezone)');
  console.log('[CRON]   Session keep-alive: Mon-Fri 03:30,05:30,06:30,07:30,09:30 UTC (9AM-5PM IST every 2h)');
  console.log('[CRON]   Swami entry:    Mon-Fri 08:15 UTC (1:45 PM IST)');
  console.log('[CRON]   Swami PMO:      Mon-Fri 08:20 UTC (1:50 PM IST) — conditional on today submit success');
  console.log('[CRON]   Prasanna entry: Mon-Fri 08:15 UTC (1:45 PM IST)');
  console.log('[CRON]   Approval Run1:  Daily   08:15 UTC (1:45 PM IST)');
  console.log('[CRON]   Approval Run2:  Daily   14:30 UTC (8:00 PM IST)');
  console.log('[CRON]   KI Swami:       Monday  08:15 UTC (1:45 PM IST)');
  console.log('[CRON]   KI PV:          Monday  08:15 UTC (1:45 PM IST)');

  // Run catch-up in background — detects missed jobs if backend started late
  scheduleMissedCatchup().catch(err =>
    console.error('[CRON][CATCHUP] Unexpected error:', err)
  );
}

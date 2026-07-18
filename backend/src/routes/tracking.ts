import { Router, Request, Response } from 'express';
import axios from 'axios';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getDb } from '../db/database';
import { decrypt } from '../crypto/encrypt';

const router = Router();
const TRACKING_URL = process.env.TRACKING_SERVICE_URL || 'http://localhost:8013';
const REPORT_TIMEOUT_MS = Number(process.env.TRACKING_REPORT_TIMEOUT_MS || 150000);
const REPORTEES_TIMEOUT_MS = Number(process.env.TRACKING_REPORTEES_TIMEOUT_MS || 45000);

function getPhotontrackCookie(): string {
  const cfg = getDb().prepare(`SELECT * FROM service_configs WHERE service_name='photontrack_access'`).get() as any;
  if (!cfg) return '';
  const sessionCookie = cfg.session_cookie_enc ? decrypt(cfg.session_cookie_enc) : '';
  if (sessionCookie.includes('_shibsession_') || sessionCookie.includes(';')) {
    return sessionCookie;
  }
  const parts = [
    sessionCookie,
    cfg.shibboleth_cookie_enc  ? decrypt(cfg.shibboleth_cookie_enc)  : '',
  ].filter(Boolean);
  return parts.join('; ');
}

function getPhotontrackEmployeeNumbers(): string {
  const cfg = getDb().prepare(`SELECT extra_config FROM service_configs WHERE service_name='photontrack_access'`).get() as any;
  if (!cfg?.extra_config) return '';
  try {
    const parsed = JSON.parse(cfg.extra_config);
    if (parsed.employee_numbers) return parsed.employee_numbers;
    if (Array.isArray(parsed.employee_batches)) {
      return parsed.employee_batches.join(',');
    }
    return '';
  } catch { return ''; }
}

function getPhotontrackNamesMap(): Record<string, string> | undefined {
  const cfg = getDb().prepare(`SELECT extra_config FROM service_configs WHERE service_name='photontrack_access'`).get() as any;
  if (!cfg?.extra_config) return undefined;
  try {
    const parsed = JSON.parse(cfg.extra_config);
    return parsed.employee_names_map || undefined;
  } catch { return undefined; }
}

// ── Auto-save photontrack session from Chrome extension ─────────
router.post('/refresh-session', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { cookie_header } = req.body;
  if (!cookie_header || typeof cookie_header !== 'string') {
    res.status(400).json({ error: 'cookie_header is required' }); return;
  }
  const normalised = cookie_header.replace(/^cookie:\s*/i, '').split(/\r?\n/)[0].trim();
  if (!normalised.includes('myCookie=') && !normalised.includes('_shibsession_')) {
    res.status(400).json({ error: 'Cookie must contain myCookie or _shibsession_' }); return;
  }
  const { encrypt } = require('../crypto/encrypt');
  // Always inject myCookie=value if missing (photontrack uses this literal value)
  const withMyCookie = normalised.includes('myCookie=') ? normalised : 'myCookie=value; ' + normalised;
  const shibPart = withMyCookie.split(';').map((c: string) => c.trim())
    .find((c: string) => c.startsWith('_shibsession_')) || '';
  getDb().prepare(`
    UPDATE service_configs SET
      session_cookie_enc    = ?,
      shibboleth_cookie_enc = ?,
      last_updated_by = ?, last_updated_at = datetime('now')
    WHERE service_name = 'photontrack_access'
  `).run(encrypt(withMyCookie), encrypt(shibPart || withMyCookie), (req.session as any).username || 'extension');
  res.json({ message: 'Photon Track session refreshed', service: 'photontrack_access' });
});

// ── Auto-sync employee names from Photon Timetracker ───────────
// Calls getmyreportees and saves name→code mapping to photontrack_access extra_config.
router.post('/sync-names', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { encrypt: _enc, decrypt } = require('../crypto/encrypt');
    // Get photon timetracker session (same one used for timesheet submission)
    const cfg = db.prepare(`SELECT session_cookie_enc FROM service_configs WHERE service_name='photon_swami_entry'`).get() as any;
    let sessionCookie = '';
    try { sessionCookie = cfg?.session_cookie_enc ? decrypt(cfg.session_cookie_enc) : ''; } catch { sessionCookie = ''; }
    if (!sessionCookie) {
      res.status(400).json({ error: 'Photon Timetracker session not configured. Ensure the Chrome extension has refreshed it.' });
      return;
    }

    const today = new Date();
    const fromDate = new Date(today); fromDate.setDate(today.getDate() - 7);
    const fmt = (d: Date) => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;

    const resp = await axios.post(
      'https://timetracker.photon.com/timetracker/getmyreportees',
      { employeeId: 17463, approverRoll: 3, fromDate: fmt(fromDate), toDate: fmt(today) },
      {
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0',
          Host: 'timetracker.photon.com',
          Origin: 'https://timetracker.photon.com',
          Referer: 'https://timetracker.photon.com/timetracker/',
        },
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
        timeout: 30000,
        maxRedirects: 0,
        validateStatus: (s: number) => s < 400,
      }
    );

    const data = resp.data;
    const isHtml = typeof data === 'string' && data.includes('<!DOCTYPE');
    if (isHtml || !data || typeof data !== 'object' || data.status?.toLowerCase() !== 'success') {
      res.status(502).json({
        error: isHtml
          ? 'Photon Timetracker session expired — open timetracker.photon.com in Chrome, the extension will refresh it, then try again.'
          : 'getmyreportees returned non-success',
        raw: isHtml ? undefined : String(data).slice(0, 200),
      });
      return;
    }

    const reportees: any[] = data.employeeReviewStatus || [];
    const namesMap: Record<string, string> = {};
    for (const r of reportees) {
      // Try common field name patterns
      const code = String(r.employeeCode || r.employeeNumber || r.empCode || r.empNo || '').trim();
      const name = String(r.employeeName || r.empName || r.name || r.resourceName || r.reporteeName || '').trim();
      if (code && name && !namesMap[code]) namesMap[code] = name;
    }

    if (Object.keys(namesMap).length === 0) {
      res.status(502).json({ error: 'No names found in response. Check employee fields.', sample: reportees[0] });
      return;
    }

    // Merge with existing extra_config
    const existing = db.prepare(`SELECT extra_config FROM service_configs WHERE service_name='photontrack_access'`).get() as any;
    const existingConfig = existing?.extra_config ? JSON.parse(existing.extra_config) : {};
    const merged = { ...existingConfig, employee_names_map: namesMap };
    db.prepare(`UPDATE service_configs SET extra_config=?, last_updated_by=?, last_updated_at=datetime('now') WHERE service_name='photontrack_access'`)
      .run(JSON.stringify(merged), (req.session as any).username || 'admin');

    res.json({ message: `Synced ${Object.keys(namesMap).length} employee names`, names_map: namesMap });
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: err?.response?.data?.detail || err.message });
  }
});

// ── Raw access debug — returns exact Photon API response ──────────
router.post('/raw-access', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const empNumbers = req.body.employee_numbers || getPhotontrackEmployeeNumbers();
    const resp = await axios.post(`${TRACKING_URL}/raw-access`, {
      session_cookie:   getPhotontrackCookie(),
      from_date:        req.body.from_date,
      to_date:          req.body.to_date,
      employee_numbers: empNumbers,
    }, { timeout: 30000 });
    res.json(resp.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: err?.response?.data?.detail || err.message });
  }
});

// ── Fetch reportees list ────────────────────────────────────────
router.get('/reportees', requireAuth, async (_req: Request, res: Response) => {
  try {
    const resp = await axios.get(`${TRACKING_URL}/reportees`, {
      params: { session_cookie: getPhotontrackCookie() },
      timeout: REPORTEES_TIMEOUT_MS,
    });
    res.json(resp.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: err?.response?.data?.detail || err.message });
  }
});

// ── Fetch weekly report ─────────────────────────────────────────
router.post('/report', requireAuth, async (req: Request, res: Response) => {
  try {
    const resp = await axios.post(`${TRACKING_URL}/report`, {
      session_cookie:      getPhotontrackCookie(),
      from_date:           req.body.from_date,
      to_date:             req.body.to_date,
      employee_numbers:    getPhotontrackEmployeeNumbers() || undefined,
      employee_names_map:  getPhotontrackNamesMap(),
    }, { timeout: REPORT_TIMEOUT_MS });
    res.json(resp.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: err?.response?.data?.detail || err.message });
  }
});

// ── Get stored photontrack session status ───────────────────────
router.get('/session-status', requireAuth, (_req: Request, res: Response) => {
  const cfg = getDb().prepare(`SELECT * FROM service_configs WHERE service_name='photontrack_access'`).get() as any;
  // session_set is sufficient — shibboleth is embedded in the full cookie for photontrack
  res.json({
    session_set:      !!(cfg?.session_cookie_enc),
    shibboleth_set:   !!(cfg?.shibboleth_cookie_enc || cfg?.session_cookie_enc),
    last_updated_at:  cfg?.last_updated_at || null,
  });
});

export default router;

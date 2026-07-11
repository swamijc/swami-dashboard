import { Router, Request, Response } from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/auth';
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

// ── Fetch reportees list ────────────────────────────────────────
router.get('/reportees', requireAuth, async (_req: Request, res: Response) => {
  try {
    const resp = await axios.get(`${TRACKING_URL}/reportees`, {
      params: { session_cookie: getPhotontrackCookie() },
      timeout: REPORTEES_TIMEOUT_MS,
    });
    res.json(resp.data);
  } catch (err: any) {
    res.status(500).json({ error: err?.response?.data?.detail || err.message });
  }
});

// ── Fetch weekly report ─────────────────────────────────────────
router.post('/report', requireAuth, async (req: Request, res: Response) => {
  try {
    const resp = await axios.post(`${TRACKING_URL}/report`, {
      session_cookie: getPhotontrackCookie(),
      from_date: req.body.from_date,
      to_date: req.body.to_date,
    }, { timeout: REPORT_TIMEOUT_MS });
    res.json(resp.data);
  } catch (err: any) {
    res.status(500).json({ error: err?.response?.data?.detail || err.message });
  }
});

// ── Get stored photontrack session status ───────────────────────
router.get('/session-status', requireAuth, (_req: Request, res: Response) => {
  const cfg = getDb().prepare(`SELECT * FROM service_configs WHERE service_name='photontrack_access'`).get() as any;
  res.json({
    session_set: !!(cfg?.session_cookie_enc),
    shibboleth_set: !!(cfg?.shibboleth_cookie_enc),
  });
});

export default router;

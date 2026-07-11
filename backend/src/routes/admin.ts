import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getDb } from '../db/database';
import { encrypt, decrypt } from '../crypto/encrypt';
import bcrypt from 'bcryptjs';

const router = Router();

function extractCookiePair(cookieHeader: string, cookieNamePrefix: string): string | null {
  const cookies = cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean);
  return cookies.find(cookie => cookie.startsWith(cookieNamePrefix)) || null;
}

function extractCookieHeader(rawValue: string): string {
  const lines = rawValue.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const cookieLine = lines.find(line => /^cookie:/i.test(line));
  const value = cookieLine ? cookieLine.replace(/^cookie:\s*/i, '') : rawValue.replace(/^cookie:\s*/i, '');
  return value.split(/\r?\n/)[0].trim();
}

// ── Service Configs ─────────────────────────────────────────────
router.get('/configs', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const rows = getDb().prepare(`SELECT id, service_name, display_name, base_url, endpoint, method,
    content_type, extra_config, is_active, last_updated_at FROM service_configs`).all();
  res.json(rows);
});

router.put('/configs/:service_name', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { service_name } = req.params;
  const { extra_config, cookie_header, session_cookie, shibboleth_cookie,
          asp_net_session, csrf_token, api_access, k1 } = req.body;
  const normalisedCookieHeader = cookie_header ? extractCookieHeader(cookie_header) : null;
  const parsedMyCookie = normalisedCookieHeader ? extractCookiePair(normalisedCookieHeader, 'myCookie=') : null;
  const parsedShibCookie = normalisedCookieHeader ? extractCookiePair(normalisedCookieHeader, '_shibsession_') : null;
  const sessionCookieToStore = service_name === 'photontrack_access' && normalisedCookieHeader
    ? normalisedCookieHeader
    : parsedMyCookie || session_cookie;
  const db = getDb();
  db.prepare(`
    UPDATE service_configs SET
      extra_config = COALESCE(?, extra_config),
      session_cookie_enc      = COALESCE(?, session_cookie_enc),
      shibboleth_cookie_enc   = COALESCE(?, shibboleth_cookie_enc),
      asp_net_session_enc     = COALESCE(?, asp_net_session_enc),
      csrf_token_enc          = COALESCE(?, csrf_token_enc),
      api_access_enc          = COALESCE(?, api_access_enc),
      k1_enc                  = COALESCE(?, k1_enc),
      last_updated_by = ?, last_updated_at = datetime('now')
    WHERE service_name = ?
  `).run(
    extra_config ? JSON.stringify(extra_config) : null,
    sessionCookieToStore ? encrypt(sessionCookieToStore) : null,
    parsedShibCookie || shibboleth_cookie ? encrypt(parsedShibCookie || shibboleth_cookie) : null,
    asp_net_session   ? encrypt(asp_net_session)   : null,
    csrf_token        ? encrypt(csrf_token)        : null,
    api_access        ? encrypt(api_access)        : null,
    k1                ? encrypt(k1)                : null,
    'admin', service_name
  );
  res.json({ message: 'Config updated' });
});

// Verify a session is saved (returns masked confirmation, not the actual value)
router.get('/configs/:service_name/session-status', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const cfg = getDb().prepare(`SELECT * FROM service_configs WHERE service_name=?`).get(req.params.service_name) as any;
  if (!cfg) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({
    photon_session_set: !!cfg.session_cookie_enc,
    shibboleth_set:     !!cfg.shibboleth_cookie_enc,
    asp_net_session_set:!!cfg.asp_net_session_enc,
    csrf_token_set:     !!cfg.csrf_token_enc,
    api_access_set:     !!cfg.api_access_enc,
    k1_set:             !!cfg.k1_enc
  });
});

// ── Schedules ────────────────────────────────────────────────────
router.get('/schedules', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  res.json(getDb().prepare(`SELECT * FROM job_schedules ORDER BY service_name, schedule_name`).all());
});

router.put('/schedules/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { cron_expression, is_enabled, timezone } = req.body;
  getDb().prepare(`
    UPDATE job_schedules SET cron_expression=COALESCE(?,cron_expression),
    is_enabled=COALESCE(?,is_enabled), timezone=COALESCE(?,timezone)
    WHERE id=?
  `).run(cron_expression ?? null, is_enabled ?? null, timezone ?? null, req.params.id);
  res.json({ message: 'Schedule updated' });
});

// ── Users ────────────────────────────────────────────────────────
router.get('/users', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  res.json(getDb().prepare(`SELECT id, username, email, role, is_active, created_at FROM users`).all());
});

router.post('/users', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) { res.status(400).json({ error: 'username, email, password required' }); return; }
  if (role && !['admin', 'viewer'].includes(role)) { res.status(400).json({ error: 'role must be admin or viewer' }); return; }
  const hash = bcrypt.hashSync(password, 12);
  try {
    getDb().prepare(`INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,?)`)
      .run(username, email, hash, role || 'viewer');
    res.json({ message: 'User created' });
  } catch (e: any) {
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

router.put('/users/:id/role', requireAuth, requireAdmin, (req: Request, res: Response) => {
  getDb().prepare(`UPDATE users SET role=? WHERE id=?`).run(req.body.role, req.params.id);
  res.json({ message: 'Role updated' });
});

// ── Team Members ─────────────────────────────────────────────────
router.post('/team', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { name, email, photon_emp_id, photon_insight_id, photon_emp_code,
          ki_resource_code, ki_hours_per_day, manager_insight_id } = req.body;
  getDb().prepare(`
    INSERT INTO team_members (name, email, photon_emp_id, photon_insight_id, photon_emp_code,
      ki_resource_code, ki_hours_per_day, manager_insight_id)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(name, email, photon_emp_id, photon_insight_id, photon_emp_code,
         ki_resource_code, ki_hours_per_day || 8.0, manager_insight_id);
  res.json({ message: 'Team member added' });
});

// ── Audit Logs ────────────────────────────────────────────────────
router.get('/audit', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(getDb().prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`).all(limit));
});

export default router;

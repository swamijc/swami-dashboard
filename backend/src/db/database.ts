// Uses Node.js 22+ built-in SQLite (node:sqlite) — no native compilation required
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

let db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (!db) {
    const dbPath = process.env.DB_PATH || './data/dashboard.db';
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','viewer')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'POST',
      content_type TEXT NOT NULL DEFAULT 'application/json',
      payload_template TEXT,
      extra_config TEXT,
      session_cookie_enc TEXT,
      shibboleth_cookie_enc TEXT,
      asp_net_session_enc TEXT,
      csrf_token_enc TEXT,
      api_access_enc TEXT,
      k1_enc TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_updated_by TEXT,
      last_updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_name TEXT NOT NULL,
      schedule_name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      run_mode TEXT NOT NULL DEFAULT 'auto',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_name TEXT NOT NULL,
      schedule_name TEXT,
      triggered_by TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','failed','skipped','dry_run')),
      http_status_code INTEGER,
      response_summary TEXT,
      error_message TEXT,
      records_processed INTEGER DEFAULT 0,
      is_dry_run INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      photon_emp_id TEXT,
      photon_insight_id TEXT,
      photon_emp_code TEXT,
      ki_resource_code TEXT,
      ki_hours_per_day REAL DEFAULT 8.0,
      manager_insight_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      photon_enabled INTEGER NOT NULL DEFAULT 1,
      boots_ki_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ki_week_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_code TEXT NOT NULL,
      week_start TEXT NOT NULL,
      mon TEXT NOT NULL DEFAULT 'Y',
      tue TEXT NOT NULL DEFAULT 'Y',
      wed TEXT NOT NULL DEFAULT 'Y',
      thu TEXT NOT NULL DEFAULT 'Y',
      fri TEXT NOT NULL DEFAULT 'Y',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(resource_code, week_start)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS onboarding_pipelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      start_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      triggered_by TEXT,
      triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS release_promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      environment TEXT UNIQUE NOT NULL CHECK(environment IN ('QA','PROD')),
      release_version TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT (datetime('now')),
      branch TEXT,
      commit_sha TEXT,
      commit_short_sha TEXT,
      workflow_run TEXT,
      run_id TEXT
    );
  `);

  // Seed default admin user if not exists
  const adminExists = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get();
  if (!adminExists) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin@1234!', 12);
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('admin', 'admin@dashboard.local', ?, 'admin')
    `).run(hash);
    console.log('[DB] Default admin user created');
  }

  // Seed default service configs
  seedServiceConfigs(db);
  seedTeamMembers(db);
  seedSchedules(db);
}

function seedServiceConfigs(db: DatabaseSync): void {
  const configs = [
    {
      service_name: 'photon_swami_entry',
      display_name: 'Photon — Swami Timesheet Entry',
      base_url: 'https://timetracker.photon.com',
      endpoint: '/timetracker/updatetimesheet',
      method: 'POST',
      content_type: 'application/json',
      extra_config: JSON.stringify({
        emp_id: 17463, project_id: 6347, category_id: 1,
        sub_category_id: 15, timesheet_status_id: 2, flag: 1,
        total_minutes: 528
      })
    },
    {
      service_name: 'photon_prasanna_entry',
      display_name: 'Photon — Prasanna Timesheet Entry',
      base_url: 'https://timetracker.photon.com',
      endpoint: '/timetracker/insertXls',
      method: 'POST',
      content_type: 'application/json',
      extra_config: JSON.stringify({
        submitted_by: 17463, file_type: 'Entry',
        insight_id: 'prasanna_vi', employee_code: '102014',
        project_code: '12667', from_time: '09:00', to_time: '18:00',
        total_mnts: '528', comments: 'Boots 50% billable',
        approver_insight_id: 'swaminathan_k'
      })
    },
    {
      service_name: 'photon_approval',
      display_name: 'Photon — Timesheet Approval',
      base_url: 'https://timetracker.photon.com',
      endpoint: '/timetracker/approvedisputetimesheet',
      method: 'POST',
      content_type: 'application/json',
      extra_config: JSON.stringify({ emp_id: 17463, status: 'Approved', dispute_comments: '' })
    },
    {
      service_name: 'boots_ki_swami',
      display_name: 'Boots KI — Swami Timesheet',
      base_url: 'https://allianceboots.hosted.keyedinprojects.co.uk',
      endpoint: '/TimeEntry/SaveTimeEntry',
      method: 'POST',
      content_type: 'application/x-www-form-urlencoded; charset=UTF-8',
      extra_config: JSON.stringify({
        site: 'KIE200143PROD', resource_code: 'KSWA1',
        hours_per_day: 9.0, project_id: 'PRJ7531',
        project_description: 'Mobile App Continuous Delivery - FY26',
        activity_id: 'PR-002', activity_description: 'Project Management',
        task_id: '51830', task_description: '10 | Overall Release'
      })
    },
    {
      service_name: 'boots_ki_pv',
      display_name: 'Boots KI — PV Timesheet',
      base_url: 'https://allianceboots.hosted.keyedinprojects.co.uk',
      endpoint: '/TimeEntry/SaveTimeEntry',
      method: 'POST',
      content_type: 'application/x-www-form-urlencoded; charset=UTF-8',
      extra_config: JSON.stringify({
        site: 'KIE200143PROD', resource_code: 'VILP1',
        hours_per_day: 4.5, project_id: 'PRJ7531',
        project_description: 'Mobile App Continuous Delivery - FY26',
        activity_id: 'PR-002', activity_description: 'Project Management',
        task_id: '51830', task_description: '10 | Overall Release'
      })
    },
    {
      service_name: 'photontrack_access',
      display_name: 'Photon Track — Team Time Tracking',
      base_url: 'https://photontrack.photon.com',
      endpoint: '/photontrack/getReporteesAccess',
      method: 'POST',
      content_type: 'application/json',
      extra_config: JSON.stringify({
        employee_batches: ['150868,144957,151389', '102594,153016,119156', '142462,153175,153149'],
        manager_insight_id: 'swaminathan_k'
      })
    }
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO service_configs
      (service_name, display_name, base_url, endpoint, method, content_type, extra_config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of configs) {
    stmt.run(c.service_name, c.display_name, c.base_url, c.endpoint, c.method, c.content_type, c.extra_config);
  }
}

function seedTeamMembers(db: DatabaseSync): void {
  const members = [
    {
      name: 'Swaminathan Kannaiyan', email: 'swaminathan.kannaiyan@photon.com',
      photon_emp_id: '17463', photon_insight_id: 'swaminathan_k',
      ki_resource_code: 'KSWA1', ki_hours_per_day: 9.0,
      manager_insight_id: null
    },
    {
      name: 'Prasanna VI', email: 'prasanna_vi@photon.com',
      photon_emp_id: null, photon_insight_id: 'prasanna_vi',
      photon_emp_code: '102014', ki_resource_code: 'VILP1',
      ki_hours_per_day: 4.5, manager_insight_id: 'swaminathan_k'
    }
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO team_members
      (name, email, photon_emp_id, photon_insight_id, photon_emp_code,
       ki_resource_code, ki_hours_per_day, manager_insight_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of members) {
    stmt.run(
      m.name, m.email, m.photon_emp_id ?? null, m.photon_insight_id ?? null,
      (m as any).photon_emp_code ?? null, m.ki_resource_code ?? null,
      m.ki_hours_per_day, m.manager_insight_id ?? null
    );
  }
}

function seedSchedules(db: DatabaseSync): void {
  const schedules = [
    { service_name: 'photon_swami_entry',   schedule_name: 'Daily 1:45 PM IST', cron_expression: '15 8 * * 1-5', is_enabled: 1 },
    { service_name: 'photon_prasanna_entry',schedule_name: 'Monday 1:45 PM IST', cron_expression: '15 8 * * 1',   is_enabled: 1 },
    { service_name: 'photon_approval',      schedule_name: 'Daily 1:45 PM IST', cron_expression: '15 8 * * *',   is_enabled: 1 },
    { service_name: 'photon_approval',      schedule_name: 'Daily 8:00 PM IST', cron_expression: '30 14 * * *',  is_enabled: 1 },
    { service_name: 'boots_ki_swami',       schedule_name: 'Monday 1:45 PM IST', cron_expression: '15 8 * * 1',  is_enabled: 1 },
    { service_name: 'boots_ki_pv',          schedule_name: 'Monday 1:45 PM IST', cron_expression: '15 8 * * 1',  is_enabled: 1 }
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO job_schedules (service_name, schedule_name, cron_expression, is_enabled)
    VALUES (?, ?, ?, ?)
  `);
  for (const s of schedules) {
    const exists = db.prepare(`SELECT id FROM job_schedules WHERE service_name=? AND schedule_name=?`)
      .get(s.service_name, s.schedule_name);
    if (!exists) stmt.run(s.service_name, s.schedule_name, s.cron_expression, s.is_enabled);
  }
}

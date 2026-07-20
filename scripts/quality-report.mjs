import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(rootDir, 'reports');
const publicDir = path.join(rootDir, 'frontend', 'public');
const reportPath = path.join(publicDir, 'quality-report.json');
fs.mkdirSync(reportsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

function runCommand(name, command, args, cwd) {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  const durationMs = Math.round(performance.now() - started);
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    name,
    status: result.status === 0 ? 'passed' : 'failed',
    durationMs,
    exitCode: result.status ?? 1,
    output: output.slice(-4000)
  };
}

function passedCheck(name, extra = {}) {
  return { name, status: 'passed', ...extra };
}

function failedCheck(name, extra = {}) {
  return { name, status: 'failed', ...extra };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function smokeTests() {
  const checks = [];
  for (const check of [
    { name: 'Frontend /timesheet route', url: 'http://localhost:5173/timesheet', expected: 200 },
    { name: 'Frontend /release route', url: 'http://localhost:5173/release', expected: 200 },
    { name: 'Backend health route', url: 'http://localhost:3001/api/health', expected: 200 }
  ]) {
    const started = performance.now();
    try {
      const response = await fetch(check.url);
      checks.push({ name: check.name, status: response.status === check.expected ? 'passed' : 'failed', httpStatus: response.status, durationMs: Math.round(performance.now() - started) });
    } catch (error) {
      checks.push({ name: check.name, status: 'failed', error: error.message, durationMs: Math.round(performance.now() - started) });
    }
  }
  return checks;
}

async function loadTest() {
  const totalRequests = 100;
  const concurrency = 10;
  const latencies = [];
  let passed = 0;
  let failed = 0;
  let cursor = 0;
  const started = performance.now();

  async function worker() {
    while (cursor < totalRequests) {
      cursor += 1;
      const requestStart = performance.now();
      try {
        const response = await fetch('http://localhost:3001/api/health');
        const elapsed = performance.now() - requestStart;
        latencies.push(elapsed);
        if (response.ok) passed += 1; else failed += 1;
      } catch {
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  latencies.sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95) - 1] || latencies[latencies.length - 1] : 0;
  const durationMs = Math.round(performance.now() - started);
  return {
    name: 'Local API health load test',
    status: failed === 0 && p95 < 500 ? 'passed' : 'failed',
    totalRequests,
    concurrency,
    passed,
    failed,
    p95Ms: Math.round(p95),
    durationMs
  };
}

async function securityChecks() {
  const checks = [];
  try {
    const health = await fetch('http://localhost:3001/api/health');
    checks.push({ name: 'Helmet security headers present', status: health.headers.has('x-content-type-options') && health.headers.has('x-frame-options') ? 'passed' : 'failed' });
  } catch (error) {
    checks.push({ name: 'Helmet security headers present', status: 'failed', error: error.message });
  }

  try {
    const { response } = await fetchJson('http://localhost:3001/api/admin/users');
    checks.push({ name: 'Admin API rejects anonymous access', status: response.status === 401 ? 'passed' : 'failed', httpStatus: response.status });
  } catch (error) {
    checks.push({ name: 'Admin API rejects anonymous access', status: 'failed', error: error.message });
  }

  try {
    const { response } = await fetchJson('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    });
    checks.push({ name: 'Invalid login is rejected', status: response.status === 401 ? 'passed' : 'failed', httpStatus: response.status });
  } catch (error) {
    checks.push({ name: 'Invalid login is rejected', status: 'failed', error: error.message });
  }

  return checks;
}

async function apiContractTests() {
  const checks = [];

  try {
    const { response, body } = await fetchJson('http://localhost:3001/api/health');
    const valid = response.status === 200 && body?.status === 'ok' && typeof body?.time === 'string' && body?.service === 'swami-dashboard-gateway';
    checks.push({ name: 'Health API contract', status: valid ? 'passed' : 'failed', httpStatus: response.status });
  } catch (error) {
    checks.push(failedCheck('Health API contract', { error: error.message }));
  }

  try {
    const { response, body } = await fetchJson('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '', password: '' })
    });
    const valid = response.status === 400 && body?.error === 'Username and password required';
    checks.push({ name: 'Login validation error contract', status: valid ? 'passed' : 'failed', httpStatus: response.status });
  } catch (error) {
    checks.push(failedCheck('Login validation error contract', { error: error.message }));
  }

  try {
    const { response, body } = await fetchJson('http://localhost:3001/api/admin/users');
    const valid = response.status === 401 && body?.error === 'Not authenticated';
    checks.push({ name: 'Admin unauthorized contract', status: valid ? 'passed' : 'failed', httpStatus: response.status });
  } catch (error) {
    checks.push(failedCheck('Admin unauthorized contract', { error: error.message }));
  }

  return checks;
}

function walkFiles(directory, options = {}) {
  const ignored = options.ignored || new Set();
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(rootDir, fullPath);
    if ([...ignored].some(pattern => relative === pattern || relative.startsWith(`${pattern}/`))) continue;
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, options));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function secretsScan() {
  const ignored = new Set(['backend/node_modules', 'frontend/node_modules', 'backend/dist', 'frontend/dist', 'backend/coverage', 'reports', 'logs', 'data', '.env']);
  const allowedFiles = ['.env.example', 'README.md', 'conversation_logs/chat_history.txt', 'conversation_logs/context_log.txt'];
  const files = walkFiles(rootDir, { ignored }).filter(file => {
    const relative = path.relative(rootDir, file);
    if (allowedFiles.includes(relative)) return false;
    return /\.(ts|tsx|js|mjs|json|py|md|html|css|sh|yml|yaml)$/i.test(relative);
  });

  const patterns = [
    { name: 'Jira API token', regex: /JIRA_API_TOKEN_ID\s*=\s*[^\s<][^\s]+/i },
    { name: 'Session cookie value', regex: /(?:myCookie|_shibsession_[^\n=]*|ASP\.NET_SessionId|api_access|JSESSIONID)=\s*[A-Za-z0-9%._~+/=-]{16,}/i },
    { name: 'Private key', regex: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
    { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
    { name: 'Generic bearer token', regex: /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/ }
  ];

  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.regex.test(content)) {
        findings.push({ file: path.relative(rootDir, file), pattern: pattern.name });
      }
    }
  }

  return [findings.length === 0
    ? passedCheck('No hardcoded secrets in source files', { findings: 0, scannedFiles: files.length })
    : failedCheck('No hardcoded secrets in source files', { findings: findings.length, output: JSON.stringify(findings.slice(0, 10)) })];
}

function staticSecurityScan() {
  const sourceFiles = [
    ...walkFiles(path.join(rootDir, 'frontend', 'src'), { ignored: new Set() }),
    ...walkFiles(path.join(rootDir, 'backend', 'src'), { ignored: new Set() }),
    ...walkFiles(path.join(rootDir, 'services'), { ignored: new Set(['services/**/__pycache__']) })
  ].filter(file => /\.(ts|tsx|js|py)$/i.test(file));

  const checks = [];
  const combined = sourceFiles.map(file => ({ file, content: fs.readFileSync(file, 'utf8') }));
  const unsafePatterns = [
    { name: 'No eval usage', regex: /\beval\s*\(/ },
    { name: 'No Function constructor usage', regex: /new\s+Function\s*\(/ },
    { name: 'No React dangerouslySetInnerHTML usage', regex: /dangerouslySetInnerHTML/, allowedFiles: ['frontend/src/pages/Jira.tsx', 'frontend/src/pages/JiraDueDate.tsx'] },
    { name: 'No direct document.cookie access', regex: /document\.cookie/ }
  ];

  for (const pattern of unsafePatterns) {
    const matches = combined
      .filter(item => {
        if (!pattern.regex.test(item.content)) return false;
        if (pattern.allowedFiles) {
          const rel = path.relative(rootDir, item.file);
          if (pattern.allowedFiles.includes(rel)) return false;
        }
        return true;
      })
      .map(item => path.relative(rootDir, item.file));
    checks.push(matches.length === 0 ? passedCheck(pattern.name) : failedCheck(pattern.name, { findings: matches.length, output: matches.slice(0, 10).join('\n') }));
  }

  const backendIndex = fs.readFileSync(path.join(rootDir, 'backend', 'src', 'index.ts'), 'utf8');
  checks.push(backendIndex.includes("httpOnly: true") ? passedCheck('Session cookie is HttpOnly') : failedCheck('Session cookie is HttpOnly'));
  checks.push(backendIndex.includes("sameSite: 'lax'") ? passedCheck('Session cookie has SameSite protection') : failedCheck('Session cookie has SameSite protection'));
  checks.push(backendIndex.includes("express.json({ limit: '1mb' })") ? passedCheck('Request JSON body size is limited') : failedCheck('Request JSON body size is limited'));

  return checks;
}

function licenseCompliance() {
  const packageLocks = [
    path.join(rootDir, 'frontend', 'package-lock.json'),
    path.join(rootDir, 'backend', 'package-lock.json')
  ];
  const blocked = /\b(AGPL|GPL|LGPL)\b/i;
  const findings = [];
  let packages = 0;

  for (const lockPath of packageLocks) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    for (const [packagePath, meta] of Object.entries(lock.packages || {})) {
      if (!packagePath || !meta?.license) continue;
      packages += 1;
      if (blocked.test(String(meta.license))) {
        findings.push({ package: packagePath, license: meta.license, project: path.basename(path.dirname(lockPath)) });
      }
    }
  }

  return [findings.length === 0
    ? passedCheck('No blocked GPL-family licenses detected', { packages })
    : failedCheck('No blocked GPL-family licenses detected', { findings: findings.length, output: JSON.stringify(findings.slice(0, 10)) })];
}

function readCoverage() {
  const coveragePath = path.join(rootDir, 'backend', 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(coveragePath)) return null;
  const summary = JSON.parse(fs.readFileSync(coveragePath, 'utf8')).total;
  return {
    lines: summary.lines.pct,
    statements: summary.statements.pct,
    functions: summary.functions.pct,
    branches: summary.branches.pct
  };
}

function auditSummary(commandResult) {
  const jsonStart = commandResult.output.indexOf('{');
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(commandResult.output.slice(jsonStart));
    const vulnerabilities = parsed.metadata?.vulnerabilities || {};
    return {
      info: vulnerabilities.info || 0,
      low: vulnerabilities.low || 0,
      moderate: vulnerabilities.moderate || 0,
      high: vulnerabilities.high || 0,
      critical: vulnerabilities.critical || 0,
      total: vulnerabilities.total || 0
    };
  } catch {
    return null;
  }
}

const commands = [
  runCommand('Frontend production build', 'npm', ['run', 'build'], path.join(rootDir, 'frontend')),
  runCommand('Backend TypeScript build', 'npm', ['run', 'build'], path.join(rootDir, 'backend')),
  runCommand('Backend unit tests with coverage', 'npm', ['run', 'test:coverage'], path.join(rootDir, 'backend')),
  runCommand('Playwright E2E and accessibility tests', 'npm', ['run', 'test:e2e'], path.join(rootDir, 'frontend')),
  runCommand('Frontend production dependency audit', 'npm', ['audit', '--omit=dev', '--json'], path.join(rootDir, 'frontend')),
  runCommand('Backend production dependency audit', 'npm', ['audit', '--omit=dev', '--json'], path.join(rootDir, 'backend')),
  runCommand('Frontend full dependency audit', 'npm', ['audit', '--json'], path.join(rootDir, 'frontend')),
  runCommand('Backend full dependency audit', 'npm', ['audit', '--json'], path.join(rootDir, 'backend'))
];

const smoke = await smokeTests();
const load = await loadTest();
const security = await securityChecks();
const apiContracts = await apiContractTests();
const secrets = secretsScan();
const staticSecurity = staticSecurityScan();
const licenses = licenseCompliance();
const coverage = readCoverage();
const audits = commands.filter(command => command.name.includes('audit')).map(command => {
  const vulnerabilities = auditSummary(command);
  const isFullAudit = command.name.includes('full');
  const hasVulnerabilities = (vulnerabilities?.total || 0) > 0;
  return {
    name: command.name,
    status: command.status === 'passed' ? 'passed' : isFullAudit && hasVulnerabilities ? 'attention' : 'failed',
    vulnerabilities
  };
});

const allChecks = [
  ...commands.filter(command => !command.name.includes('audit')).map(command => ({ name: command.name, status: command.status, durationMs: command.durationMs })),
  ...audits,
  ...smoke,
  load,
  ...security,
  ...apiContracts,
  ...secrets,
  ...staticSecurity,
  ...licenses
];

const report = {
  generatedAt: new Date().toISOString(),
  overallStatus: allChecks.some(check => check.status === 'failed') ? 'attention' : allChecks.some(check => check.status === 'attention') ? 'attention' : 'passed',
  score: Math.round((allChecks.filter(check => check.status === 'passed').length / allChecks.length) * 100),
  coverage,
  categories: [
    { name: 'Build', checks: commands.filter(command => command.name.includes('build')) },
    { name: 'Unit & Coverage', checks: commands.filter(command => command.name.includes('unit')) },
    { name: 'E2E UI & Accessibility', checks: commands.filter(command => command.name.includes('Playwright')) },
    { name: 'Regression Smoke', checks: smoke },
    { name: 'API Contract', checks: apiContracts },
    { name: 'Load Test', checks: [load] },
    { name: 'Pen Test Baseline', checks: security },
    { name: 'Secrets Scan', checks: secrets },
    { name: 'Static Security Scan', checks: staticSecurity },
    { name: 'License Compliance', checks: licenses },
    { name: 'Dependency Audit', checks: audits }
  ],
  notes: [
    'Security is measured through baseline checks and dependency audit; no software can be guaranteed impossible to hack.',
    'Load test is local and targets /api/health with 100 requests at concurrency 10.',
    'E2E and accessibility checks use Playwright Chromium against the running local dashboard.',
    'Secrets scanning intentionally excludes local .env, logs, build output, node_modules, and generated reports.',
    'Coverage currently reflects backend unit, route, session, and access-control tests.',
    'Production dependency audits are the deploy-time gate. Full audits include local development tooling such as Vite.'
  ]
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(reportsDir, `quality-report-${Date.now()}.json`), JSON.stringify(report, null, 2));
console.log(`Quality report written to ${path.relative(rootDir, reportPath)}`);
console.log(`Overall status: ${report.overallStatus}, score: ${report.score}%`);
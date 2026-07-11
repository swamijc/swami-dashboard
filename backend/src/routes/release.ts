import fs from 'node:fs';
import path from 'node:path';
import { Request, Response, Router } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireAdmin } from '../middleware/auth';

type ReleaseEnvironment = {
  name: 'DEV' | 'QA' | 'PROD';
  status: 'passed' | 'pending' | 'awaiting_approval' | 'failed';
  gate: string;
  description: string;
  testUrl: string | null;
  push: null | {
    version: string;
    pushedAt: string;
    pushedBy: string;
    branch: string;
    commitSha: string;
    commitShortSha: string;
    workflowRun: string;
  };
};

type ReleaseReport = {
  generatedAt: string | null;
  releaseVersion: string;
  currentStage: string;
  overallStatus: string;
  branch: string;
  commitSha: string;
  commitShortSha: string;
  workflow: string;
  runNumber: string;
  runId: string;
  actor: string;
  environments: ReleaseEnvironment[];
  checks: string[];
  approvals?: any[];
};

const router = Router();

const fallbackReport: ReleaseReport = {
  generatedAt: null,
  releaseVersion: 'local-dev',
  currentStage: 'DEV',
  overallStatus: 'in_progress',
  branch: 'local',
  commitSha: 'local',
  commitShortSha: 'local',
  workflow: 'local',
  runNumber: 'local',
  runId: 'local',
  actor: 'local',
  environments: [
    { name: 'DEV', status: 'passed', gate: 'automatic', description: 'Initial validation stage.', testUrl: process.env.RELEASE_DEV_URL || process.env.FRONTEND_URL || 'http://localhost:5173', push: { version: 'local-dev', pushedAt: new Date().toISOString(), pushedBy: 'local', branch: 'local', commitSha: 'local', commitShortSha: 'local', workflowRun: 'local' } },
    { name: 'QA', status: 'pending', gate: 'admin approval after DEV passes', description: 'Moves to QA only after an admin approves the promotion.', testUrl: process.env.RELEASE_QA_URL || null, push: null },
    { name: 'PROD', status: 'awaiting_approval', gate: 'admin approval after QA passes', description: 'Moves to PROD only after QA is approved and an admin approves production promotion.', testUrl: process.env.RELEASE_PROD_URL || null, push: null },
  ],
  checks: [],
};

function reportPath() {
  return path.resolve(__dirname, '../../../frontend/public/release-report.json');
}

function readBaseReport(): ReleaseReport {
  try {
    return JSON.parse(fs.readFileSync(reportPath(), 'utf8')) as ReleaseReport;
  } catch {
    return fallbackReport;
  }
}

function approvals() {
  return getDb().prepare(`SELECT * FROM release_promotions ORDER BY approved_at ASC`).all() as any[];
}

function mergeReport(): ReleaseReport {
  const report = readBaseReport();
  const rows = approvals();
  const byEnvironment = new Map(rows.map(row => [row.environment, row]));
  const qaApproved = byEnvironment.has('QA');
  const prodApproved = byEnvironment.has('PROD');

  report.environments = report.environments.map(environment => {
    const row = byEnvironment.get(environment.name);
    if (!row) {
      if (environment.name === 'QA') return { ...environment, status: qaApproved ? 'passed' : 'pending' };
      if (environment.name === 'PROD') return { ...environment, status: prodApproved ? 'passed' : qaApproved ? 'awaiting_approval' : 'pending' };
      return environment;
    }
    return {
      ...environment,
      status: 'passed',
      push: {
        version: row.release_version,
        pushedAt: row.approved_at,
        pushedBy: row.approved_by,
        branch: row.branch || report.branch,
        commitSha: row.commit_sha || report.commitSha,
        commitShortSha: row.commit_short_sha || report.commitShortSha,
        workflowRun: row.workflow_run || report.runNumber,
      },
    };
  });

  report.currentStage = prodApproved ? 'PROD' : qaApproved ? 'QA' : 'DEV';
  report.overallStatus = prodApproved ? 'released' : qaApproved ? 'awaiting_prod_approval' : 'in_progress';
  report.approvals = rows;
  return report;
}

router.get('/report', requireAuth, (_req: Request, res: Response) => {
  res.json(mergeReport());
});

router.post('/promote', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const target = String(req.body.target || '').toUpperCase();
  if (!['QA', 'PROD'].includes(target)) {
    res.status(400).json({ error: 'target must be QA or PROD' });
    return;
  }

  const report = mergeReport();
  const qaAlreadyApproved = report.environments.some(environment => environment.name === 'QA' && environment.status === 'passed');
  const prodAlreadyApproved = report.environments.some(environment => environment.name === 'PROD' && environment.status === 'passed');

  if (target === 'QA' && qaAlreadyApproved) {
    res.status(409).json({ error: 'QA is already approved' });
    return;
  }
  if (target === 'PROD' && prodAlreadyApproved) {
    res.status(409).json({ error: 'PROD is already approved' });
    return;
  }
  if (target === 'PROD' && !qaAlreadyApproved) {
    res.status(409).json({ error: 'QA must be approved before PROD' });
    return;
  }

  const session = req.session as any;
  const approvedBy = session.username || 'admin';
  getDb().prepare(`
    INSERT INTO release_promotions
      (environment, release_version, approved_by, branch, commit_sha, commit_short_sha, workflow_run, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(target, report.releaseVersion, approvedBy, report.branch, report.commitSha, report.commitShortSha, report.runNumber, report.runId);

  res.status(201).json(mergeReport());
});

export default router;
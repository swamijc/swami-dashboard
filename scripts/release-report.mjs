import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'frontend', 'public');
const reportPath = path.join(publicDir, 'release-report.json');
fs.mkdirSync(publicDir, { recursive: true });

const stage = (process.argv[2] || process.env.RELEASE_STAGE || 'dev').toLowerCase();
const validStages = ['dev', 'qa', 'prod'];
const currentStage = validStages.includes(stage) ? stage : 'dev';
const stageOrder = { dev: 0, qa: 1, prod: 2 };
const stageIndex = stageOrder[currentStage];

function shortSha(value) {
  return value ? value.slice(0, 7) : 'local';
}

function stageStatus(name) {
  const index = stageOrder[name];
  if (index < stageIndex) return 'passed';
  if (index === stageIndex) return 'passed';
  return name === 'prod' && currentStage === 'qa' ? 'awaiting_approval' : 'pending';
}

const commitSha = process.env.GITHUB_SHA || '';
const runNumber = process.env.GITHUB_RUN_NUMBER || 'local';
const branch = process.env.GITHUB_REF_NAME || 'local';
const releaseVersion = process.env.RELEASE_VERSION || `${branch}-${shortSha(commitSha)}-${runNumber}`;
const generatedAt = new Date().toISOString();

function pushDetails(name) {
  const status = stageStatus(name);
  if (status === 'pending' || status === 'awaiting_approval') return null;
  return {
    version: releaseVersion,
    pushedAt: generatedAt,
    pushedBy: process.env.GITHUB_ACTOR || 'local',
    branch,
    commitSha: commitSha || 'local',
    commitShortSha: shortSha(commitSha),
    workflowRun: runNumber,
  };
}

function testUrl(name) {
  if (name === 'dev') return process.env.RELEASE_DEV_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
  if (name === 'qa') return process.env.RELEASE_QA_URL || null;
  return process.env.RELEASE_PROD_URL || null;
}

const report = {
  generatedAt,
  releaseVersion,
  currentStage: currentStage.toUpperCase(),
  overallStatus: currentStage === 'prod' ? 'released' : currentStage === 'qa' ? 'awaiting_prod_approval' : 'in_progress',
  branch,
  commitSha: commitSha || 'local',
  commitShortSha: shortSha(commitSha),
  workflow: process.env.GITHUB_WORKFLOW || 'local',
  runNumber,
  runId: process.env.GITHUB_RUN_ID || 'local',
  actor: process.env.GITHUB_ACTOR || 'local',
  environments: [
    {
      name: 'DEV',
      status: stageStatus('dev'),
      gate: 'automatic',
      description: 'Initial validation stage for build, tests, audits, E2E, accessibility, Python compile checks, and image build.',
      testUrl: testUrl('dev'),
      push: pushDetails('dev'),
    },
    {
      name: 'QA',
      status: stageStatus('qa'),
      gate: 'automatic after DEV passes',
      description: 'Runs only after DEV succeeds and repeats the validation gates before production promotion.',
      testUrl: testUrl('qa'),
      push: pushDetails('qa'),
    },
    {
      name: 'PROD',
      status: stageStatus('prod'),
      gate: 'manual approval after QA passes',
      description: 'Runs only after QA succeeds and the GitHub prod environment approval is granted.',
      testUrl: testUrl('prod'),
      push: pushDetails('prod'),
    },
  ],
  checks: [
    'Backend build, unit tests, coverage, and production audit',
    'Frontend production build, Playwright E2E, axe accessibility, and production audit',
    'Python service dependency install and compile check',
    'Docker Compose image build on CI runners with Docker available',
  ],
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Release report written to ${path.relative(rootDir, reportPath)}`);
console.log(`Stage: ${report.currentStage}, status: ${report.overallStatus}, version: ${report.releaseVersion}`);
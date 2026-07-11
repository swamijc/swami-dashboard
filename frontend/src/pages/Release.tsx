import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../auth/AuthContext';

type ReleaseEnvironment = {
  name: string;
  status: 'passed' | 'pending' | 'awaiting_approval' | 'failed';
  gate: string;
  description: string;
  testUrl: string | null;
  push: {
    version: string;
    pushedAt: string;
    pushedBy: string;
    branch: string;
    commitSha: string;
    commitShortSha: string;
    workflowRun: string;
  } | null;
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
};

const fallbackGeneratedAt = new Date().toISOString();

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
    { name: 'DEV', status: 'passed', gate: 'automatic', description: 'Initial validation stage.', testUrl: 'http://localhost:5173', push: { version: 'local-dev', pushedAt: fallbackGeneratedAt, pushedBy: 'local', branch: 'local', commitSha: 'local', commitShortSha: 'local', workflowRun: 'local' } },
    { name: 'QA', status: 'pending', gate: 'automatic after DEV passes', description: 'Runs after DEV passes.', testUrl: null, push: null },
    { name: 'PROD', status: 'awaiting_approval', gate: 'manual approval after QA passes', description: 'Requires GitHub prod environment approval.', testUrl: null, push: null },
  ],
  checks: [],
};

function statusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

function statusClass(status: string) {
  if (status === 'passed' || status === 'released') return 'border-green-200 bg-green-100 text-green-700';
  if (status === 'failed') return 'border-red-200 bg-red-100 text-red-700';
  if (status === 'awaiting_approval' || status === 'awaiting_prod_approval') return 'border-amber-200 bg-amber-100 text-amber-700';
  return 'border-blue-200 bg-blue-100 text-blue-700';
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(status)}`}>{statusLabel(status)}</span>;
}

export default function Release() {
  const { user } = useAuth();
  const [report, setReport] = useState<ReleaseReport>(fallbackReport);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const loadReport = () => {
    setLoading(true);
    api.get('/release/report')
      .then(response => setReport(response.data))
      .catch(() => setReport(fallbackReport))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReport();
  }, []);

  const completedStages = useMemo(() => report.environments.filter(environment => environment.status === 'passed').length, [report.environments]);
  const environmentStatus = useMemo(() => Object.fromEntries(report.environments.map(environment => [environment.name, environment.status])), [report.environments]);
  const isAdmin = user?.role === 'admin';
  const canApproveQA = isAdmin && environmentStatus.DEV === 'passed' && environmentStatus.QA !== 'passed';
  const canApprovePROD = isAdmin && environmentStatus.QA === 'passed' && environmentStatus.PROD !== 'passed';

  const approvePromotion = async (target: 'QA' | 'PROD') => {
    setApproving(target);
    setMessage('');
    try {
      const response = await api.post('/release/promote', { target });
      setReport(response.data);
      setMessage(`${target} promotion approved successfully.`);
    } catch (error: any) {
      setMessage(error.response?.data?.error || `Unable to approve ${target} promotion.`);
    } finally {
      setApproving(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Release Tracking</h1>
          <p className="text-gray-500">DEV to QA to PROD promotion status for dashboard releases.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          Last generated: <span className="font-medium text-gray-800">{report.generatedAt ? new Date(report.generatedAt).toLocaleString() : 'Not generated yet'}</span>
        </div>
      </div>

      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Release Approval</h2>
            <p className="mt-1 text-sm text-gray-500">Admins approve environment promotion from DEV to QA and from QA to PROD. Viewers can see environment details only.</p>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => approvePromotion('QA')}
                disabled={!canApproveQA || approving !== null}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {approving === 'QA' ? 'Approving QA...' : 'Approve Move to QA'}
              </button>
              <button
                type="button"
                onClick={() => approvePromotion('PROD')}
                disabled={!canApprovePROD || approving !== null}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {approving === 'PROD' ? 'Approving PROD...' : 'Approve Move to PROD'}
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">View-only access</div>
          )}
        </div>
        {message && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</div>}
      </section>

      {loading && <div className="mb-5 rounded-xl border border-gray-200 bg-white p-6 text-gray-400">Loading release report...</div>}

      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 font-semibold text-gray-800">Environment Test URLs</h2>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {report.environments.map(environment => (
            <div key={environment.name} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-gray-900">{environment.name}</h3>
                <StatusBadge status={environment.status} />
              </div>
              {environment.testUrl ? (
                <a href={environment.testUrl} target="_blank" rel="noreferrer" className="break-all text-sm font-semibold text-blue-700 hover:text-blue-900">
                  {environment.testUrl}
                </a>
              ) : (
                <div className="text-sm font-semibold text-amber-700">{environment.name} URL not configured</div>
              )}
              <div className="mt-3">
                {environment.testUrl ? (
                  <a href={environment.testUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800">
                    Open {environment.name}
                  </a>
                ) : (
                  <span className="inline-flex rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                    Set RELEASE_{environment.name}_URL
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="text-xs text-gray-500">Release Version Number</div><div className="mt-1 text-xl font-bold text-gray-900 break-words">{report.releaseVersion}</div><StatusBadge status={report.overallStatus} /></div>
        <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="text-xs text-gray-500">Current Stage</div><div className="mt-1 text-3xl font-bold text-blue-700">{report.currentStage}</div><div className="text-xs text-gray-600">active promotion stage</div></div>
        <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="text-xs text-gray-500">Stages Passed</div><div className="mt-1 text-3xl font-bold text-green-700">{completedStages}</div><div className="text-xs text-gray-600">of {report.environments.length}</div></div>
        <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="text-xs text-gray-500">Workflow Run</div><div className="mt-1 text-3xl font-bold text-gray-900">{report.runNumber}</div><div className="text-xs text-gray-600">actor {report.actor}</div></div>
      </div>

      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 font-semibold text-gray-800">Environment Promotion</h2>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {report.environments.map((environment, index) => (
            <div key={environment.name} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">{index + 1}</span>
                  <h3 className="font-semibold text-gray-900">{environment.name}</h3>
                </div>
                <StatusBadge status={environment.status} />
              </div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Gate</div>
              <p className="mb-3 text-sm text-gray-800">{environment.gate}</p>
              <p className="text-sm text-gray-500">{environment.description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 font-semibold text-gray-800">Release Checks</h2>
          <div className="divide-y divide-gray-100">
            {report.checks.map(check => (
              <div key={check} className="py-3">
                <div className="font-medium text-gray-800">{check}</div>
                <div className="mt-1 text-xs text-gray-600">Required in every stage before promotion continues.</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 font-semibold text-gray-800">Build Metadata</h2>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Branch</dt><dd className="mt-1 text-gray-900 break-words">{report.branch}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Commit</dt><dd className="mt-1 text-gray-900 break-words">{report.commitShortSha}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Workflow</dt><dd className="mt-1 text-gray-900 break-words">{report.workflow}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Run ID</dt><dd className="mt-1 text-gray-900 break-words">{report.runId}</dd></div>
          </dl>
        </section>
      </div>

      <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 font-semibold text-gray-800">Environment Push Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Environment</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Release Version</th>
                <th className="px-3 py-2 text-left">Test URL</th>
                <th className="px-3 py-2 text-left">Pushed At</th>
                <th className="px-3 py-2 text-left">Pushed By</th>
                <th className="px-3 py-2 text-left">Branch</th>
                <th className="px-3 py-2 text-left">Commit</th>
                <th className="px-3 py-2 text-left">Run</th>
              </tr>
            </thead>
            <tbody>
              {report.environments.map(environment => (
                <tr key={environment.name} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{environment.name}</td>
                  <td className="px-3 py-2"><StatusBadge status={environment.status} /></td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{environment.push?.version || '-'}</td>
                  <td className="px-3 py-2 text-blue-700 whitespace-nowrap">{environment.testUrl ? <a href={environment.testUrl} target="_blank" rel="noreferrer">Open {environment.name}</a> : <span className="text-amber-700">Not configured</span>}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{environment.push?.pushedAt ? new Date(environment.push.pushedAt).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{environment.push?.pushedBy || '-'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{environment.push?.branch || '-'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{environment.push?.commitShortSha || '-'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{environment.push?.workflowRun || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
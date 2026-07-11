import React, { useEffect, useMemo, useState } from 'react';

type Check = {
  name: string;
  status: 'passed' | 'failed' | 'attention';
  durationMs?: number;
  httpStatus?: number;
  totalRequests?: number;
  concurrency?: number;
  passed?: number;
  failed?: number;
  p95Ms?: number;
  vulnerabilities?: Record<string, number> | null;
  output?: string;
  error?: string;
};

type QualityReport = {
  generatedAt: string | null;
  overallStatus: 'passed' | 'failed' | 'attention';
  score: number;
  coverage: { lines: number; statements: number; functions: number; branches: number } | null;
  categories: { name: string; checks: Check[] }[];
  notes: string[];
};

const fallbackReport: QualityReport = {
  generatedAt: null,
  overallStatus: 'attention',
  score: 0,
  coverage: null,
  categories: [],
  notes: ['Run node scripts/quality-report.mjs from the project root to generate the latest quality results.']
};

function statusClass(status: string) {
  if (status === 'passed') return 'bg-green-100 text-green-700 border-green-200';
  if (status === 'failed') return 'bg-red-100 text-red-700 border-red-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(status)}`}>{status}</span>;
}

function CheckMeta({ check }: { check: Check }) {
  const items = [
    check.durationMs !== undefined ? `${check.durationMs} ms` : null,
    check.httpStatus !== undefined ? `HTTP ${check.httpStatus}` : null,
    check.totalRequests !== undefined ? `${check.totalRequests} requests` : null,
    check.concurrency !== undefined ? `concurrency ${check.concurrency}` : null,
    check.p95Ms !== undefined ? `p95 ${check.p95Ms} ms` : null,
    check.vulnerabilities ? `${check.vulnerabilities.total || 0} advisories` : null,
    check.error || null
  ].filter(Boolean);

  return <div className="mt-1 text-xs text-gray-600">{items.join(' · ') || 'Completed'}</div>;
}

export default function Quality() {
  const [report, setReport] = useState<QualityReport>(fallbackReport);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/quality-report.json', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : fallbackReport)
      .then(setReport)
      .catch(() => setReport(fallbackReport))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const checks = report.categories.flatMap(category => category.checks);
    return {
      total: checks.length,
      passed: checks.filter(check => check.status === 'passed').length,
      failed: checks.filter(check => check.status === 'failed').length
    };
  }, [report.categories]);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Code Quality Dashboard</h1>
          <p className="text-gray-500">Build, coverage, regression, load, and security baseline results for this dashboard.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          Last generated: <span className="font-medium text-gray-800">{report.generatedAt ? new Date(report.generatedAt).toLocaleString() : 'Not generated yet'}</span>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="text-xs text-gray-500">Quality Score</div><div className="mt-1 text-3xl font-bold text-gray-900">{report.score}%</div><StatusBadge status={report.overallStatus} /></div>
        <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="text-xs text-gray-500">Checks Passed</div><div className="mt-1 text-3xl font-bold text-green-700">{totals.passed}</div><div className="text-xs text-gray-600">of {totals.total || 0} checks</div></div>
        <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="text-xs text-gray-500">Checks Failed</div><div className="mt-1 text-3xl font-bold text-red-700">{totals.failed}</div><div className="text-xs text-gray-600">needs review</div></div>
        <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="text-xs text-gray-500">Line Coverage</div><div className="mt-1 text-3xl font-bold text-blue-700">{report.coverage ? `${report.coverage.lines}%` : '-'}</div><div className="text-xs text-gray-600">backend unit coverage</div></div>
      </div>

      {report.coverage && (
        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
          {Object.entries(report.coverage).map(([key, value]) => (
            <div key={key} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-600">{key}</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">{value}%</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, value)}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {loading && <div className="rounded-xl border border-gray-200 bg-white p-6 text-gray-400">Loading quality report...</div>}
        {!loading && report.categories.map(category => (
          <section key={category.name} className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 font-semibold text-gray-800">{category.name}</h2>
            <div className="divide-y divide-gray-100">
              {category.checks.map(check => (
                <div key={`${category.name}-${check.name}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-gray-800">{check.name}</div>
                    <CheckMeta check={check} />
                  </div>
                  <StatusBadge status={check.status} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <div className="mb-2 font-semibold">Security note</div>
        <ul className="list-disc space-y-1 pl-5">
          {report.notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      </div>
    </div>
  );
}
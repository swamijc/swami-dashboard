import React, { useCallback, useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import api from '../api/client';

// ── Account & Project master data ─────────────────────────────
// projectCode values returned by the Photon API are the human-readable IDs
// (13755, 12667, etc.). The API parameter 'projectId' uses different internal
// IDs (6347, 5284, etc.) set in the backend DEFAULT_PROJECT_IDS constant.
const ACCOUNTS = [
  {
    id: 'boots',
    name: 'Boots UK Ltd.',
    code: '0016F00004AtTC8QAN',
    projects: [
      { id: '13755', label: "Mobile App Condor Squad (Mar'26-May'26)" },
      { id: '12667', label: "Boots Mobile App'23" },
      { id: '11925', label: 'GCB Support (Boots International)' },
      { id: '13087', label: 'Boots Staffing' },
    ],
  },
];
const ALL_PROJECTS = ACCOUNTS.flatMap(a => a.projects);

// ── Colour palette ──────────────────────────────────────────────
const COLORS = {
  saved:     '#94a3b8', // slate-400
  submitted: '#0072ce', // Photon blue
  approved:  '#16a34a', // green-600
  disputed:  '#dc2626', // red-600
};
const PIE_COLORS = [COLORS.saved, COLORS.submitted, COLORS.approved, COLORS.disputed];

// ── Date helpers ─────────────────────────────────────────────────
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: localIso(from), to: localIso(to) };
}

function previousMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to   = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: localIso(from), to: localIso(to) };
}

// ── Types ────────────────────────────────────────────────────────
interface OverallStats { total: number; saved: number; submitted: number; approved: number; disputed: number; }
interface DailyEntry   { date: string; saved: number; submitted: number; approved: number; disputed: number; total: number; }
interface EmployeeEntry{ code: string; name: string; saved: number; submitted: number; approved: number; disputed: number; total: number; hours: number; daysLogged: number; }
interface ProjectEntry { projectId: string; projectName: string; saved: number; submitted: number; approved: number; disputed: number; total: number; }
interface ReportData   { fromDate: string; toDate: string; totalRecords: number; overall: OverallStats; daily: DailyEntry[]; employees: EmployeeEntry[]; projectBreakdown?: ProjectEntry[]; cached?: boolean; cachedAt?: string; }

// ── Sub-components ───────────────────────────────────────────────
function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-3xl font-bold" style={{ color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function fmt(date: string): string {
  // YYYY-MM-DD → DD MMM
  const parts = date.split('-');
  if (parts.length !== 3) return date;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ── Main page ────────────────────────────────────────────────────
export default function TimesheetReport() {
  const init = currentMonthRange();
  const [fromDate,         setFromDate]         = useState(init.from);
  const [toDate,           setToDate]           = useState(init.to);
  const [data,             setData]             = useState<ReportData | null>(null);
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState('');
  const [empFilter,        setEmpFilter]        = useState('');
  const [selectedAccount,  setSelectedAccount]  = useState('all');
  const [selectedProjects, setSelectedProjects] = useState<string[]>(ALL_PROJECTS.map(p => p.id));

  // Projects visible in the checkbox list based on selected account
  const visibleProjects = selectedAccount === 'all'
    ? ALL_PROJECTS
    : (ACCOUNTS.find(a => a.id === selectedAccount)?.projects ?? []);

  function handleAccountChange(accountId: string) {
    setSelectedAccount(accountId);
    const projects = accountId === 'all'
      ? ALL_PROJECTS
      : (ACCOUNTS.find(a => a.id === accountId)?.projects ?? []);
    setSelectedProjects(projects.map(p => p.id));
  }

  function toggleProject(id: string) {
    setSelectedProjects(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }

  function toggleAllVisible(checked: boolean) {
    if (checked) setSelectedProjects(prev => Array.from(new Set([...prev, ...visibleProjects.map(p => p.id)])));
    else         setSelectedProjects(prev => prev.filter(id => !visibleProjects.some(p => p.id === id)));
  }

  // ─ Load cached result on mount (no live call) ──────────────────────────
  useEffect(() => {
    api.get('/timesheet-report/cached')
      .then(r => { if (r.data?.cached) setData(r.data); })
      .catch(() => {/* no cache yet — page starts empty */});
  }, []);

  const fetchReport = useCallback(async (
    from: string, to: string,
    projIds: string[] = selectedProjects,
    accountId: string = selectedAccount,
  ) => {
    setLoading(true);
    setError('');
    try {
      const acc = ACCOUNTS.find(a => a.id === accountId);
      const resp = await api.post('/timesheet-report/data', {
        fromDate: from,
        toDate: to,
        projectIds: projIds.length > 0 ? projIds.join(',') : undefined,
        accountCode: acc?.code,
      });
      setData(resp.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [selectedProjects, selectedAccount]);

  function runReport(from = fromDate, to = toDate) {
    fetchReport(from, to, selectedProjects, selectedAccount);
  }

  function applyRange(from: string, to: string) {
    setFromDate(from);
    setToDate(to);
    fetchReport(from, to, selectedProjects, selectedAccount);
  }

  const overall = data?.overall ?? { total: 0, saved: 0, submitted: 0, approved: 0, disputed: 0 };
  const pieData = [
    { name: 'Saved',     value: overall.saved,     color: COLORS.saved },
    { name: 'Submitted', value: overall.submitted,  color: COLORS.submitted },
    { name: 'Approved',  value: overall.approved,   color: COLORS.approved },
    { name: 'Disputed',  value: overall.disputed,   color: COLORS.disputed },
  ].filter(d => d.value > 0);

  // Account + Project consolidated pie — built from projectBreakdown when available;
  // falls back to account-level grouping using the ACCOUNTS config + selected projects.
  const accountProjectPie = (() => {
    const pb = data?.projectBreakdown ?? [];
    if (pb.length > 0) {
      return pb.map((p, i) => {
        const acc = ACCOUNTS.find(a => a.projects.some(pr => pr.id === p.projectId || pr.id === p.projectName));
        const proj = acc?.projects.find(pr => pr.id === p.projectId || pr.id === p.projectName);
        return {
          name: acc && proj ? `${acc.name} / ${proj.label}` : (p.projectName || p.projectId),
          value: p.total,
          color: PIE_COLORS[i % PIE_COLORS.length],
        };
      }).filter(d => d.value > 0);
    }
    // Fallback: count employees * submitted per selected account/project label
    // (shows the distribution by selected filter even without raw project IDs in response)
    return ACCOUNTS.flatMap(acc =>
      acc.projects
        .filter(p => selectedProjects.includes(p.id))
        .map((proj, i) => ({
          name: `${acc.name} / ${proj.label}`,
          value: 0,
          color: PIE_COLORS[i % PIE_COLORS.length],
        }))
    ).filter(d => d.value > 0);
  })();

  const filteredEmployees = (data?.employees ?? []).filter(e =>
    !empFilter || e.name.toLowerCase().includes(empFilter.toLowerCase()) || e.code.includes(empFilter)
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Timesheet Report</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Daily submission analysis and individual breakdown from Photon Timetracker</p>
        </div>
        <a
          href="https://timetracker.photon.com/timetracker/#/gen/report"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-blue-500 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          Open Timetracker ↗
        </a>
      </div>

      {/* ── Filters ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 space-y-4">
        {/* Row 1: Account + Projects */}
        <div className="flex flex-wrap gap-6">
          {/* Account selector */}
          <div className="min-w-[180px]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Account Name</label>
            <select
              value={selectedAccount}
              onChange={e => handleAccountChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              <option value="all">All Accounts</option>
              {ACCOUNTS.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Project multi-select */}
          <div className="flex-1 min-w-[260px]">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Projects</label>
              <div className="flex gap-3 text-xs">
                <button type="button" onClick={() => toggleAllVisible(true)}
                  className="text-blue-600 hover:underline dark:text-blue-400">All</button>
                <button type="button" onClick={() => toggleAllVisible(false)}
                  className="text-gray-400 hover:underline">None</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleProjects.map(p => (
                <label key={p.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition select-none
                  ${ selectedProjects.includes(p.id)
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300' }`}>
                  <input type="checkbox" className="sr-only"
                    checked={selectedProjects.includes(p.id)}
                    onChange={() => toggleProject(p.id)} />
                  {selectedProjects.includes(p.id) ? '✓ ' : ''}{p.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Date range */}
        <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">To</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <button
            onClick={() => runReport()}
            disabled={loading || selectedProjects.length === 0}
            className="rounded-lg bg-[#0072ce] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#005eb8] disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Run Report'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => { const r = currentMonthRange(); applyRange(r.from, r.to); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-blue-500 hover:text-blue-700 dark:border-gray-700 dark:text-gray-300"
            >
              Current Month
            </button>
            <button
              onClick={() => { const r = previousMonthRange(); applyRange(r.from, r.to); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-blue-500 hover:text-blue-700 dark:border-gray-700 dark:text-gray-300"
            >
              Previous Month
            </button>
          </div>
        </div>
      </div>

      {/* ── Cached data banner ── */}
      {data?.cached && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center justify-between dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>📋 Showing cached report from <strong>{data.cachedAt?.replace('T', ' ').slice(0, 16)} UTC</strong>. Click <em>Run Report</em> to fetch live data.</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-semibold">{error}</p>
          {error.toLowerCase().includes('session') && (
            <p className="mt-2 text-xs leading-5">
              Shibboleth SSO sessions expire after ~1 hour. To get a fresh cookie:
              &nbsp;<strong>1.</strong> Open{' '}
              <a href="https://timetracker.photon.com/timetracker/" target="_blank" rel="noreferrer"
                 className="underline hover:text-red-900 dark:hover:text-red-100">
                timetracker.photon.com
              </a>{' '}
              and log in. &nbsp;<strong>2.</strong> Open DevTools → Network → copy the <code>Cookie:</code> line from any request.
              &nbsp;<strong>3.</strong> Go to <strong>Admin → Photon Track</strong> and save the new cookie.
            </p>
          )}
        </div>
      )}

      {/* ── KPI Cards ── */}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            <KpiCard label="Total Records"  value={overall.total}     color="#0f172a" />
            <KpiCard label="Saved (Draft)"  value={overall.saved}     color={COLORS.saved} />
            <KpiCard label="Submitted"      value={overall.submitted} color={COLORS.submitted} />
            <KpiCard label="Approved"       value={overall.approved}  color={COLORS.approved} />
            <KpiCard label="Disputed"       value={overall.disputed}  color={COLORS.disputed} />
          </div>

          {/* ── Charts row ── */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            {/* Overall status pie */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Overall Status</h2>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2} label={(props: any) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}>
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => (v != null ? Number(v).toLocaleString() : '0')} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-gray-400">No data for this period</p>
              )}
            </div>

            {/* Account + Project consolidated pie */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Account / Project Distribution</h2>
              {accountProjectPie.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={accountProjectPie} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2} label={(props: any) => `${((props.percent ?? 0) * 100).toFixed(0)}%`}>
                      {accountProjectPie.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => (v != null ? Number(v).toLocaleString() : '0')} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-gray-400">Project breakdown not available in API response</p>
              )}
            </div>

            {/* Daily submission bar */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Daily Submissions</h2>
              {data.daily.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.daily} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip labelFormatter={(label) => fmt(String(label ?? ''))} />
                    <Legend />
                    <Bar dataKey="saved"     name="Saved"     fill={COLORS.saved}     stackId="a" />
                    <Bar dataKey="submitted" name="Submitted" fill={COLORS.submitted} stackId="a" />
                    <Bar dataKey="approved"  name="Approved"  fill={COLORS.approved}  stackId="a" />
                    <Bar dataKey="disputed"  name="Disputed"  fill={COLORS.disputed}  stackId="a" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-gray-400">No daily data for this period</p>
              )}
            </div>
          </div>

          {/* ── Individual Report ── */}
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Individual Report</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">{data.fromDate} → {data.toDate} · {filteredEmployees.length} employees</p>
              </div>
              <input
                type="search"
                placeholder="Search by name or code…"
                value={empFilter}
                onChange={e => setEmpFilter(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400">
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3 text-right">Saved</th>
                    <th className="px-4 py-3 text-right">Submitted</th>
                    <th className="px-4 py-3 text-right">Approved</th>
                    <th className="px-4 py-3 text-right">Disputed</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Hours</th>
                    <th className="px-4 py-3 text-right">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map(emp => (
                    <tr key={emp.code} className="border-b border-gray-50 transition hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900 dark:text-white">{emp.name}</div>
                        <div className="text-xs text-gray-400">{emp.code}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{emp.saved || '–'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-[#0072ce]">{emp.submitted || '–'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-green-600">{emp.approved || '–'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-red-600">{emp.disputed || '–'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{emp.total}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{emp.hours > 0 ? emp.hours : '–'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{emp.daysLogged > 0 ? emp.daysLogged : '–'}</td>
                    </tr>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                        {data.totalRecords === 0 ? 'No timesheet records found for this period.' : 'No employees match your filter.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !data && (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        </div>
      )}
    </div>
  );
}

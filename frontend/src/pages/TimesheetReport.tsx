import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  {
    id: 'timeoff',
    name: 'Time Off',
    code: '0016F00004AtTC8QAN',
    // Time Off data is fetched via getEmployeeReport (not projectReport)
    // and identified by projectCode 99995 in the API response
    projects: [
      { id: '99995', label: 'Time Off' },
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

// Previous week Monday → current week Sunday (two-week window for Time Off tab)
function twoWeekRange(): { from: string; to: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon … 6=Sat
  // Monday of the current week
  const currentMonday = new Date(now);
  currentMonday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  // Monday of the previous week
  const prevMonday = new Date(currentMonday);
  prevMonday.setDate(currentMonday.getDate() - 7);
  // Sunday of the current week
  const currentSunday = new Date(currentMonday);
  currentSunday.setDate(currentMonday.getDate() + 6);
  return { from: localIso(prevMonday), to: localIso(currentSunday) };
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
  const [sortCol,          setSortCol]          = useState<'name'|'saved'|'submitted'|'approved'|'disputed'|'total'|'hours'|'daysLogged'>('total');
  const [sortDir,          setSortDir]          = useState<'asc'|'desc'>('desc');
  const [page,             setPage]             = useState(1);
  const PAGE_SIZE = 10;
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

  // ─ Load cached result for the active account on mount (no live call) ──────
  useEffect(() => {
    // Load Boots UK cache on initial mount (first tab)
    api.get('/timesheet-report/cached?accountId=boots')
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
      // Include Time Off (via getEmployeeReport) when 'timeoff' is selected
      const includeTimeOff = accountId === 'timeoff';
      const resp = await api.post('/timesheet-report/data', {
        fromDate: from,
        toDate: to,
        projectIds: projIds.length > 0 ? projIds.join(',') : undefined,
        accountCode: acc?.code,
        includeTimeOff,
      });
      setData(resp.data);
      setError(''); // clear any previous error on success
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to load report';
      setError(msg);
      // Auto-dismiss error after 8 s so it doesn't block the cached report view
      setTimeout(() => setError(e => e === msg ? '' : e), 8000);
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

  // Filter projectBreakdown to only entries matching the currently selected project pills
  const selectedProjectBreakdown = useMemo(() =>
    (data?.projectBreakdown ?? []).filter(p =>
      selectedProjects.includes(p.projectId) || selectedProjects.includes(p.projectName)
    ),
    [data?.projectBreakdown, selectedProjects]
  );

  // ─ Account Distribution pie (Boots UK Ltd. vs Time Off) — respects selected projects
  const accountPie = useMemo(() => {
    if (selectedProjectBreakdown.length === 0) return [];
    const accTotals: Record<string, { name: string; total: number; color: string }> = {};
    selectedProjectBreakdown.forEach(p => {
      const acc = ACCOUNTS.find(a => a.projects.some(pr => pr.id === p.projectId || pr.id === p.projectName));
      const accName = acc?.name ?? (p.projectName || p.projectId);
      if (!accTotals[accName]) {
        accTotals[accName] = { name: accName, total: 0, color: PIE_COLORS[Object.keys(accTotals).length % PIE_COLORS.length] };
      }
      accTotals[accName].total += p.total;
    });
    return Object.values(accTotals).filter(d => d.total > 0).map(d => ({ ...d, value: d.total }));
  }, [selectedProjectBreakdown]);

  // ─ Project Distribution pie — respects selected projects
  const projectPie = useMemo(() =>
    selectedProjectBreakdown.map((p, i) => {
      const acc = ACCOUNTS.find(a => a.projects.some(pr => pr.id === p.projectId || pr.id === p.projectName));
      const proj = acc?.projects.find(pr => pr.id === p.projectId || pr.id === p.projectName);
      return {
        name: proj?.label ?? p.projectName ?? p.projectId,
        value: p.total,
        color: PIE_COLORS[i % PIE_COLORS.length],
      };
    }).filter(d => d.value > 0),
    [selectedProjectBreakdown]
  );

  const filteredEmployees = useMemo(() => {
    const filtered = (data?.employees ?? []).filter(e =>
      !empFilter || e.name.toLowerCase().includes(empFilter.toLowerCase()) || e.code.includes(empFilter)
    );
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = (a[sortCol] as number) - (b[sortCol] as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data?.employees, empFilter, sortCol, sortDir]);

  function handleSort(col: typeof sortCol) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
    setPage(1);
  }

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [empFilter, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / PAGE_SIZE));
  const pagedEmployees = filteredEmployees.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function downloadCSV() {
    const headers = ['Employee', 'Code', 'Saved', 'Submitted', 'Approved', 'Disputed', 'Total', 'Hours', 'Days'];
    const rows = filteredEmployees.map(e => [
      `"${e.name.replace(/"/g, '""')}"`, e.code,
      e.saved, e.submitted, e.approved, e.disputed, e.total, e.hours, e.daysLogged,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-report-${data?.fromDate}-${data?.toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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

      {/* ── Account tabs ── */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800">
        {ACCOUNTS.map(acc => (
          <button
            key={acc.id}
            type="button"
            onClick={() => {
              const projects = acc.projects.map(p => p.id);
              setSelectedAccount(acc.id);
              setSelectedProjects(projects);
              // Time Off tab defaults to prev week + current week; Boots UK keeps current dates
              let tabFrom = fromDate;
              let tabTo   = toDate;
              if (acc.id === 'timeoff') {
                const r = twoWeekRange();
                tabFrom = r.from;
                tabTo   = r.to;
                setFromDate(tabFrom);
                setToDate(tabTo);
              }
              // Show account-specific cached data immediately while fetching live
              api.get(`/timesheet-report/cached?accountId=${acc.id}`)
                .then(r => { if (r.data?.cached) setData(r.data); })
                .catch(() => {});
              // Fetch live with the correct date range for this tab
              fetchReport(tabFrom, tabTo, projects, acc.id);
            }}
            className={`relative px-5 py-3 text-sm font-semibold transition whitespace-nowrap
              ${selectedAccount === acc.id
                ? 'text-[#0072ce] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#0072ce] after:rounded-t'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`}
          >
            {acc.name === 'Boots UK Ltd.' ? '🏢 ' : '🏖️ '}
            {acc.name}
            {loading && selectedAccount === acc.id && (
              <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#0072ce] border-t-transparent" />
            )}
          </button>
        ))}
      </div>

      {/* ── Filters (projects + date range) ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 space-y-4">
        {/* Project pills for active account */}
        <div>
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

        {/* Date range */}
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
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          data // cached data already visible — show as a gentle warning, not a blocker
            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
            : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              {data
                ? <p><strong>Live refresh failed.</strong> {error.includes('session') ? 'Photon session expired — showing last cached data.' : error} The cached report above is still valid.</p>
                : (
                  <>
                    <p className="font-semibold">{error}</p>
                    {error.toLowerCase().includes('session') && (
                      <p className="mt-2 text-xs leading-5">
                        Shibboleth SSO sessions expire after ~1 hour. To get a fresh cookie:
                        &nbsp;<strong>1.</strong> Open{' '}
                        <a href="https://timetracker.photon.com/timetracker/" target="_blank" rel="noreferrer" className="underline">timetracker.photon.com</a>{' '}
                        and log in. &nbsp;<strong>2.</strong> DevTools → Network → copy the <code>Cookie:</code> line from any request.
                        &nbsp;<strong>3.</strong> Run the <code>pbpaste | node -e ...</code> script in terminal, or go to <strong>Admin → Photon Track</strong> and paste the cookie.
                      </p>
                    )}
                  </>
                )
              }
            </div>
            <button type="button" onClick={() => setError('')} className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100">×</button>
          </div>
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

          {/* ── Charts — 2 × 2 grid, larger size ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* 1. Overall Status */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Overall Status Distribution</h2>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={120} innerRadius={60} paddingAngle={2} label={(props: any) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}>
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => (v != null ? Number(v).toLocaleString() : '0')} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-20 text-center text-sm text-gray-400">No data for this period</p>
              )}
            </div>

            {/* 2. Account Distribution */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Account Distribution</h2>
              {accountPie.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={accountPie} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={120} innerRadius={60} paddingAngle={2} label={(props: any) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}>
                      {accountPie.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => (v != null ? Number(v).toLocaleString() : '0')} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-20 text-center text-sm text-gray-400">No data for this period</p>
              )}
            </div>

            {/* 3. Project Distribution */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Project Distribution</h2>
              {projectPie.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={projectPie} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={120} innerRadius={60} paddingAngle={2} label={(props: any) => `${((props.percent ?? 0) * 100).toFixed(0)}%`}>
                      {projectPie.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => (v != null ? Number(v).toLocaleString() : '0')} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-20 text-center text-sm text-gray-400">No project breakdown available</p>
              )}
            </div>

            {/* 4. Daily Submissions */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Daily Submissions</h2>
              {data.daily.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
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
                <p className="py-20 text-center text-sm text-gray-400">No daily data for this period</p>
              )}
            </div>
          </div>

          {/* ── Individual Report ── */}
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {/* Header */}
            <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Individual Report</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {data.fromDate} → {data.toDate} · {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="search"
                  placeholder="Search by name or code…"
                  value={empFilter}
                  onChange={e => setEmpFilter(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
                <button
                  type="button"
                  onClick={downloadCSV}
                  disabled={filteredEmployees.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-blue-500 hover:text-blue-700 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  ⬇ Download CSV
                </button>
              </div>
            </div>

            {/* Table — fixed height shows 10 rows, scrollable */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400">
                    {([
                      { key: 'name',       label: 'Employee',  right: false },
                      { key: 'saved',      label: 'Saved',     right: true  },
                      { key: 'submitted',  label: 'Submitted', right: true  },
                      { key: 'approved',   label: 'Approved',  right: true  },
                      { key: 'disputed',   label: 'Disputed',  right: true  },
                      { key: 'total',      label: 'Total',     right: true  },
                      { key: 'hours',      label: 'Hours',     right: true  },
                      { key: 'daysLogged', label: 'Days',      right: true  },
                    ] as const).map(col => (
                      <th key={col.key}
                        className={`px-4 py-3 ${col.right ? 'text-right' : ''} cursor-pointer select-none whitespace-nowrap hover:text-gray-900 dark:hover:text-gray-100`}
                        onClick={() => handleSort(col.key)}>
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {sortCol === col.key
                            ? <span className="text-[#0072ce]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                            : <span className="opacity-25">↕</span>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedEmployees.map(emp => (
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
                  {pagedEmployees.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                        {data.totalRecords === 0 ? 'No timesheet records found for this period.' : 'No employees match your filter.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            {filteredEmployees.length > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredEmployees.length)} of {filteredEmployees.length}
                </p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(1)}       disabled={page === 1}         className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800">«</button>
                  <button type="button" onClick={() => setPage(p => p - 1)} disabled={page === 1}      className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800">‹</button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const half = Math.floor(Math.min(5, totalPages) / 2);
                    const start = Math.max(1, Math.min(page - half, totalPages - Math.min(5, totalPages) + 1));
                    return start + i;
                  }).map(n => (
                    <button key={n} type="button" onClick={() => setPage(n)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition ${n === page ? 'bg-[#0072ce] text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
                      {n}
                    </button>
                  ))}
                  <button type="button" onClick={() => setPage(p => p + 1)} disabled={page === totalPages} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800">›</button>
                  <button type="button" onClick={() => setPage(totalPages)} disabled={page === totalPages} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800">»</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Empty state (no cache yet and not loading) ── */}
      {!data && !loading && !error && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl mb-3">📋</p>
          <p className="text-base font-semibold text-gray-700 dark:text-gray-300">No report data yet</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Select your date range and click <strong>Run Report</strong> to fetch the timesheet data from Photon Timetracker.
          </p>
        </div>
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

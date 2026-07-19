import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import WeeklyPieChart from './WeeklyPieChart';
import DailyTable from './DailyTable';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';

function toIsoDate(d: Date) {
  return format(d, 'yyyy-MM-dd');
}

function getWeekRange(weekStart?: string) {
  const monday = weekStart ? parseISO(weekStart) : startOfWeek(new Date(), { weekStartsOn: 1 });
  const sunday = addDays(monday, 6);
  return {
    from: toIsoDate(monday),
    to: toIsoDate(sunday),
    label: `${format(monday, 'MMM d')} – ${format(sunday, 'MMM d, yyyy')}`,
  };
}

function StatCard({ title, value, sub, color }: { title: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      <div className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function TimeTrackingPanel() {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const CACHE_KEY = 'swami-time-tracking-report';
  const cachedReport = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } })();
  const [report, setReport] = useState<any>(cachedReport);
  // If we already have cached data on mount, show the amber banner immediately
  // (it clears only when a fresh fetch succeeds)
  const [usingCache, setUsingCache] = useState<boolean>(!!cachedReport);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [sessionSet, setSessionSet] = useState<boolean | null>(null);
  const [selectedMonday, setSelectedMonday] = useState(() => toIsoDate(startOfWeek(new Date(), { weekStartsOn: 1 })));
  const week = getWeekRange(selectedMonday);

  const fetchReport = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.post('/tracking/report', {
        from_date: week.from,
        to_date:   week.to,
      });
      setReport(r.data);
      setUsingCache(false);  // fresh data — clear the stale-cache banner
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(r.data)); } catch { /* ignore */ }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e.message || 'Failed to fetch report';
      // Session expired — always fall back to cache, never show an error if we have data
      const cached = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } })();
      if (cached) {
        setReport(cached);
        setUsingCache(true);
        setError('');
      } else {
        setUsingCache(false);
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.from, week.to]);

  // On mount: always try to fetch (uses cache if session fails).
  useEffect(() => {
    api.get('/tracking/session-status')
      .then(r => {
        const isSet = !!(r.data.session_set);
        setSessionSet(isSet);
        // Always attempt a fetch — if session expired, will fall back to cache
        fetchReport();
      })
      .catch(() => { setSessionSet(false); fetchReport(); });
  // fetchReport intentionally omitted — only run once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user picks a different week, refresh (uses cache if needed).
  const isFirstRender = React.useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    fetchReport();
  }, [selectedMonday]); // eslint-disable-line react-hooks/exhaustive-deps

  // Summary stats
  const meta = report?.meta;
  const employees: any[] = report?.employees || [];
  const buckets: any[] = report?.summary_buckets || [];
  const dailyTeam: any[] = report?.daily_team || [];

  const below40 = employees.filter(e => e.below_target).length;
  const onTrack  = employees.filter(e => !e.below_target).length;
  const alertDays = employees.reduce((sum, e) => sum + (e.daily_alerts?.length || 0), 0);
  const teamAvg  = employees.length
    ? Math.round(employees.reduce((s, e) => s + e.total_hours, 0) / employees.length * 10) / 10
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Team Time Tracking</h2>
          <p className="text-sm text-gray-500 mt-0.5">Week: {week.label} (Monday-Sunday){isViewer ? ' · viewer access' : ''}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {!isViewer && (
            <label className="text-xs text-gray-500 flex items-center gap-2">
              Week start
              <input
                type="date"
                value={selectedMonday}
                onChange={e => {
                  const monday = startOfWeek(parseISO(e.target.value), { weekStartsOn: 1 });
                  setSelectedMonday(toIsoDate(monday));
                  setReport(null);
                  setError('');
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          )}
          {isViewer && (
            <div className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1.5 rounded-lg">
              Current week only
            </div>
          )}
          {sessionSet === false && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg">
              ⚠ Photon Track session not configured{isViewer ? ' — contact an admin' : ' — go to Admin → Session Tokens'}
            </div>
          )}
          <button
            onClick={() => fetchReport()}
            disabled={loading}
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
          >
            {loading ? '⟳ Fetching…' : '↻ Refresh Report'}
          </button>
        </div>
      </div>

      {usingCache && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm mb-4 flex items-start gap-2">
          <span className="mt-0.5">⚠</span>
          <span>
            <strong>Showing last saved data</strong> — Photon Track session not active.
            {report?.meta?.from && <span className="ml-1 text-amber-600">(cached from {report.meta.from} to {report.meta.to})</span>}
            <span className="ml-1">Open </span>
            <a href="https://photontrack.photon.com/photontrack/#/manager" target="_blank" rel="noreferrer" className="underline font-medium">photontrack.photon.com</a>
            <span> in Chrome to refresh automatically, or use the </span>
            <strong>↻ Refresh Report</strong>
            <span> button once your session is active.</span>
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      {!report && !loading && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">📈</div>
          <p className="text-gray-500 text-sm mb-1">No data loaded yet.</p>
          <p className="text-gray-400 text-xs mb-4">
            Open <a href="https://photontrack.photon.com/photontrack/#/manager" target="_blank" rel="noreferrer" className="underline text-blue-600">photontrack.photon.com</a> in Chrome — the extension will save your session and load the report automatically.
          </p>
          <button onClick={() => fetchReport()} disabled={loading}
            className="bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-800 transition">
            Load This Week's Data
          </button>
        </div>
      )}

      {report && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard title="Team Members" value={String(meta?.total_members || employees.length)} sub="tracked this week" />
            <StatCard title="Team Avg Hours" value={`${teamAvg}h`} sub={`target: ${meta?.weekly_target || 40}h/week`}
              color={teamAvg >= 40 ? 'text-green-700' : 'text-red-600'} />
            <StatCard title="On Track (≥40h)" value={String(onTrack)}
              sub={`${employees.length ? Math.round(onTrack/employees.length*100) : 0}% of team`}
              color="text-green-700" />
            <StatCard title="Below Target" value={String(below40)}
              sub={`${alertDays} day${alertDays !== 1 ? 's' : ''} below 6h alert`}
              color={below40 > 0 ? 'text-red-600' : 'text-green-700'} />
          </div>

          {/* Pie chart */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <h3 className="font-semibold text-gray-800 mb-1">Weekly Hours Distribution</h3>
            <p className="text-xs text-gray-400 mb-5">
              Click a segment to see which team members fall in that bracket
              {meta?.is_partial_week && ' · Mid-week projection based on daily average so far'}
            </p>
            <WeeklyPieChart buckets={buckets} />
          </div>

          {/* Daily breakdown */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h3 className="font-semibold text-gray-800 mb-1">Daily Breakdown</h3>
            <p className="text-xs text-gray-400 mb-5">
              Expected 8h/day per person · Red cells = below 6h threshold · ⚠ = alert
            </p>
            <DailyTable
              dailyTeam={dailyTeam}
              employees={employees}
              isPartialWeek={meta?.is_partial_week || false}
            />
          </div>
        </>
      )}
    </div>
  );
}

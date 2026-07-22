import React, { useEffect, useState } from 'react';
import api from '../../../api/client';
import RunButton from '../../../components/RunButton';
import JobHistory from '../../../components/JobHistory';
import { useAuth } from '../../../auth/AuthContext';

// Format a date using LOCAL calendar parts — avoids UTC midnight boundary
// crossing on IST machines (UTC+5:30) where toISOString() rolls back one day.
function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toIsoDate(date: Date) {
  return localIsoDate(date);
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  return copy;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

const statusBadge: Record<string, string> = {
  submitted_by_dashboard: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  dry_run: 'bg-blue-100 text-blue-700',
  running: 'bg-yellow-100 text-yellow-700',
  no_dashboard_run_for_week: 'bg-gray-100 text-gray-600',
  not_configured: 'bg-amber-100 text-amber-700',
};

function Badge({ value }: { value: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[value] || 'bg-gray-100 text-gray-600'}`}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

function formatDateTime(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—';
}

// Is the current local time past 1:14 PM IST (07:44 UTC)?
function isPastScheduledTime(): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  return utcHour > 8 || (utcHour === 8 && utcMin >= 15);
}

function WeekGrid({ days }: { days?: any[] }) {
  const today = new Date().toISOString().split('T')[0];
  const afterSchedule = isPastScheduledTime();

  if (!days || days.length === 0) {
    return <div className="text-xs text-gray-400 py-2 animate-pulse">Loading week…</div>;
  }

  return (
    <div className="grid grid-cols-5 gap-1.5 mb-4">
      {days.map((day: any) => {
        const isToday = day.date === today;
        const isPast = day.date < today;
        const run = day.run;

        let bg = 'bg-gray-50 border-gray-100';
        let label = '—';
        let labelCls = 'text-gray-400';

        if (run) {
          if (run.status === 'success') {
            bg = 'bg-green-50 border-green-200'; label = '✓ done'; labelCls = 'text-green-700';
          } else if (run.status === 'dry_run') {
            bg = 'bg-blue-50 border-blue-200'; label = '✓ dry'; labelCls = 'text-blue-700';
          } else if (run.status === 'failed') {
            bg = 'bg-red-50 border-red-200'; label = '✗ failed'; labelCls = 'text-red-700';
          } else if (run.status === 'running') {
            bg = 'bg-yellow-50 border-yellow-200'; label = '⟳ running'; labelCls = 'text-yellow-700';
          }
        } else if (isToday && !afterSchedule) {
          bg = 'bg-blue-50 border-blue-200'; label = '⏰ 1:45 PM'; labelCls = 'text-blue-600';
        } else if (isToday || isPast) {
          bg = 'bg-amber-50 border-amber-200'; label = '⚠ not run'; labelCls = 'text-amber-700';
        }

        return (
          <div
            key={day.date}
            className={`rounded-lg border p-2 text-center ${bg} ${isToday ? 'ring-2 ring-blue-400' : ''}`}
            title={day.date}
          >
            <div className="text-xs font-semibold text-gray-700">{day.label}</div>
            <div className="text-xs text-gray-400">{day.date.slice(5)}</div>
            <div className={`text-xs font-medium mt-1 ${labelCls}`}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Session Refresh Panel ────────────────────────────────────────────────────
// Shown whenever the Photon session is expired or a run returns a 302 error.
function SessionRefreshPanel({
  onRefreshed,
}: {
  onRefreshed: () => void;
}) {
  const [cookiePaste, setCookiePaste] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    const clean = cookiePaste.replace(/^Cookie:\s*/i, '').trim();
    if (!clean.includes('myCookie=') || !clean.includes('_shibsession_')) {
      setMsg('❌ Missing myCookie or _shibsession_ — paste the full Cookie header.');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      await api.post('/timesheet/photon/refresh-session', { cookie_header: clean });
      setMsg('✅ Session saved! Retrying…');
      setCookiePaste('');
      setTimeout(() => { onRefreshed(); setMsg(''); }, 800);
    } catch (e: any) {
      setMsg(`❌ ${e?.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-xl">⚠</span>
        <div>
          <p className="font-semibold text-amber-900 text-sm">Photon session expired</p>
          <p className="text-xs text-amber-800 mt-0.5">
            The Shibboleth SSO cookie has expired. You need fresh cookies from your browser.
          </p>
          <ol className="text-xs text-amber-800 mt-2 space-y-0.5 list-decimal list-inside">
            <li>Open <a href="https://timetracker.photon.com/timetracker/" target="_blank" rel="noreferrer" className="underline font-medium">timetracker.photon.com</a> in Chrome and log in</li>
            <li>Press F12 → Network tab → click any request → Headers → find <code className="bg-amber-100 px-1 rounded">Cookie:</code></li>
            <li>Right-click the value → <strong>Copy value</strong>, then paste below</li>
          </ol>
        </div>
      </div>
      <textarea
        rows={3}
        placeholder="Paste the full Cookie: header value here…"
        value={cookiePaste}
        onChange={e => setCookiePaste(e.target.value)}
        className="w-full border border-amber-300 rounded-lg px-3 py-2 text-xs font-mono bg-white focus:ring-2 focus:ring-amber-400 outline-none resize-none"
      />
      {msg && (
        <p className={`text-xs mt-1.5 font-medium ${msg.startsWith('✅') ? 'text-green-700' : 'text-red-700'}`}>{msg}</p>
      )}
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={save}
          disabled={saving || !cookiePaste.trim()}
          className="px-4 py-1.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
        >
          {saving ? 'Saving…' : 'Save & Retry'}
        </button>
        <span className="text-xs text-amber-700">
          Or run: <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono">pbpaste | python3 scripts/refresh-photon-session.py</code>
        </span>
      </div>
    </div>
  );
}

export default function PhotonPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const today = localIsoDate(new Date());
  const weekStart = localIsoDate(startOfWeek(new Date()));
  const [statusSummary, setStatusSummary] = useState<any>(null);
  const [approvalSummary, setApprovalSummary] = useState<any>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);

  const checkSession = async () => {
    try {
      const r = await api.get('/timesheet/photon/session-check');
      setSessionExpired(r.data.session_expired === true);
    } catch { /* silent */ }
  };

  const loadStatus = async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const [statusResp, approvalResp] = await Promise.all([
        api.get(`/timesheet/photon/status-summary?week_start=${weekStart}`),
        api.get('/timesheet/photon/approval-summary'),
      ]);
      setStatusSummary(statusResp.data);
      setApprovalSummary(approvalResp.data);
    } catch (error: any) {
      setStatusError(error?.response?.data?.error || error.message || 'Failed to load Photon status');
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => { loadStatus(); checkSession(); }, [weekStart]);

  const swamiEntry = statusSummary?.entries?.find((e: any) => e.key === 'swami');
  const prasannaEntry = statusSummary?.entries?.find((e: any) => e.key === 'prasanna');

  const [pmoStatus, setPmoStatus] = React.useState<{ status: string; message: string; count: number } | null>(null);
  const [pmoLoading, setPmoLoading] = React.useState(false);

  const submitToPmo = async (dryRun = false) => {
    setPmoLoading(true);
    setPmoStatus(null);
    try {
      const resp = await api.post('/timesheet/photon/swami/pmo-submit', { dry_run: dryRun });
      const d = resp.data;
      if (d.status === 'no_pending') {
        setPmoStatus({ status: 'none', message: 'No pending PMO review requests found.', count: 0 });
      } else if (d.status === 'success') {
        setPmoStatus({ status: 'success', message: `Request submitted to PMO (${d.submitted_count} item${d.submitted_count !== 1 ? 's' : ''})`, count: d.submitted_count });
      } else if (d.dry_run) {
        setPmoStatus({ status: 'dry', message: `Dry run — ${d.pending_count} item(s) would be submitted`, count: d.pending_count || 0 });
      } else {
        setPmoStatus({ status: 'info', message: d.message || JSON.stringify(d).slice(0, 100), count: 0 });
      }
    } catch (err: any) {
      const errMsg: string = err?.response?.data?.error || err.message || '';
      // 302 redirect = session expired
      if (errMsg.includes('302') || errMsg.toLowerCase().includes('redirect') || errMsg.toLowerCase().includes('session')) {
        setSessionExpired(true);
        setPmoStatus({ status: 'error', message: 'Session expired — paste fresh cookies in the banner above and retry.', count: 0 });
      } else {
        setPmoStatus({ status: 'error', message: errMsg, count: 0 });
      }
    } finally {
      setPmoLoading(false);
    }
  };

  const todayDayStatus = (entry: any) => {
    if (!entry?.week_days) return null;
    return entry.week_days.find((d: any) => d.date === today) || null;
  };

  const todaySwami = todayDayStatus(swamiEntry);
  const todayPrasanna = todayDayStatus(prasannaEntry);

  return (
    <div className="w-full">

      {/* ── Session Expired Banner — shown when SSO cookie has expired ── */}
      {isAdmin && sessionExpired && (
        <SessionRefreshPanel
          onRefreshed={() => {
            setSessionExpired(false);
            setPmoStatus(null);
            loadStatus();
          }}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* Swami's Entry */}
      <Card title="👤 Swami's Timesheet Entry">
        <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-3">
          <span><span className="font-medium text-gray-700">Schedule:</span> Mon–Fri at 1:45 PM IST (auto)</span>
          <span><span className="font-medium text-gray-700">Default:</span> 8:48 (528 min/day)</span>
          <span><span className="font-medium text-gray-700">Employee:</span> 17463</span>
          <span><span className="font-medium text-gray-700">Endpoint:</span> POST /timetracker/updatetimesheet</span>
        </div>

        {/* Mon–Fri week grid */}
        <WeekGrid days={swamiEntry?.week_days} />

        {/* Today status banner */}
        {todaySwami && todaySwami.run && (
          <div className={`mb-4 text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${
            todaySwami.run.status === 'success' ? 'bg-green-50 border border-green-200 text-green-800' :
            todaySwami.run.status === 'failed'  ? 'bg-red-50 border border-red-200 text-red-800'    :
            'bg-gray-50 border border-gray-200 text-gray-700'
          }`}>
            <span className="font-medium">Today ({today}):</span>
            <span>{todaySwami.run.status === 'success' ? '✅ Submitted successfully' :
                   todaySwami.run.status === 'failed'  ? `❌ Failed — ${todaySwami.run.error_message || 'see logs'}` :
                   todaySwami.run.status}</span>
            <span className="text-gray-400 ml-auto">{formatDateTime(todaySwami.run.started_at)}</span>
          </div>
        )}
        {todaySwami && !todaySwami.run && (
          <div className="mb-4 text-xs rounded-lg px-3 py-2 bg-blue-50 border border-blue-200 text-blue-800 flex items-center gap-2">
            <span className="font-medium">Today ({today}):</span>
            <span>{isPastScheduledTime() ? '⚠ Auto-submit did not run — use button below to submit manually' : '⏰ Scheduled for 1:45 PM IST'}</span>
          </div>
        )}

        {isAdmin && (
          <RunButton
            label="Submit Swami's Timesheet"
            onRun={async (dryRun) => {
              const resp = await api.post('/timesheet/photon/swami/submit', { dry_run: dryRun });
              if (resp.data?.status === 'already_submitted') {
                throw new Error(`⚠ ${resp.data.message}`);
              }
              await loadStatus();
            }}
          />
        )}

        {/* Submit to PMO section */}
        {isAdmin && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-semibold text-gray-700">📬 Submit to PMO</span>
              <span className="text-xs text-gray-400">Sends timesheet review request → you receive "Defaulter Timesheet Approval Request Notification" email</span>
            </div>
            {pmoStatus && (
              <div className={`mb-3 text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${
                pmoStatus.status === 'success' ? 'bg-green-50 border border-green-200 text-green-800' :
                pmoStatus.status === 'error'   ? 'bg-red-50 border border-red-200 text-red-800' :
                pmoStatus.status === 'none'    ? 'bg-gray-50 border border-gray-200 text-gray-600' :
                'bg-blue-50 border border-blue-200 text-blue-800'
              }`}>
                <span>
                  {pmoStatus.status === 'success' ? '✅' :
                   pmoStatus.status === 'error'   ? '❌' :
                   pmoStatus.status === 'none'    ? '—'  : 'ℹ'}
                </span>
                <span>{pmoStatus.message}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button
                disabled={pmoLoading}
                onClick={() => submitToPmo(false)}
                className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
              >
                {pmoLoading ? 'Submitting…' : 'Submit to PMO'}
              </button>
            </div>
          </div>
        )}
      </Card>

        {/* Prasanna's Entry */}
        <Card title="👮 Prasanna's Timesheet Entry">
        <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-3">
          <span><span className="font-medium text-gray-700">Schedule:</span> Mon–Fri at 1:45 PM IST (one day per run)</span>
          <span><span className="font-medium text-gray-700">Default:</span> 8:48 (528 min/day × 5 days)</span>
          <span><span className="font-medium text-gray-700">Employee:</span> 102014</span>
          <span><span className="font-medium text-gray-700">Endpoint:</span> POST /timetracker/insertXls</span>
        </div>

        {/* Mon–Fri week grid */}
        <WeekGrid days={prasannaEntry?.week_days} />

        {/* Today status banner */}
        {todayPrasanna && todayPrasanna.run && (
          <div className={`mb-4 text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${
            todayPrasanna.run.status === 'success' ? 'bg-green-50 border border-green-200 text-green-800' :
            todayPrasanna.run.status === 'failed'  ? 'bg-red-50 border border-red-200 text-red-800'    :
            'bg-gray-50 border border-gray-200 text-gray-700'
          }`}>
            <span className="font-medium">Today ({today}):</span>
            <span>{todayPrasanna.run.status === 'success' ? '✅ Submitted successfully' :
                   todayPrasanna.run.status === 'failed'  ? `❌ Failed — ${todayPrasanna.run.error_message || 'see logs'}` :
                   todayPrasanna.run.status}</span>
            <span className="text-gray-400 ml-auto">{formatDateTime(todayPrasanna.run.started_at)}</span>
          </div>
        )}
        {todayPrasanna && !todayPrasanna.run && (
          <div className="mb-4 text-xs rounded-lg px-3 py-2 bg-blue-50 border border-blue-200 text-blue-800 flex items-center gap-2">
            <span className="font-medium">Today ({today}):</span>
            <span>{isPastScheduledTime() ? '⚠ Auto-submit did not run — use button below to submit manually' : '⏰ Scheduled for 1:45 PM IST'}</span>
          </div>
        )}

        {isAdmin && (
          <RunButton
            label="Submit Prasanna's Timesheet"
            onRun={async (dryRun) => {
              const resp = await api.post('/timesheet/photon/prasanna/submit', { dry_run: dryRun });
              if (resp.data?.status === 'already_submitted') {
                throw new Error(`⚠ ${resp.data.message}`);
              }
              await loadStatus();
            }}
          />
        )}
      </Card>

        {/* Approval */}
        <Card title="✅ Timesheet Approval">
        <div className="text-sm text-gray-500 mb-4 space-y-1">
          <p><span className="font-medium">Endpoint:</span> POST /timetracker/approvedisputetimesheet</p>
          <p><span className="font-medium">Schedule:</span> Daily at 1:45 PM and 8:00 PM IST — <span className="text-blue-600 font-medium">always auto-runs</span></p>
          <p><span className="font-medium">Approver:</span> swaminathan_k (emp_id: 17463)</p>
        </div>
        <div className="mb-4 overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">Interval</th>
                <th className="text-left px-3 py-2">Cron</th>
                <th className="text-left px-3 py-2">Configured</th>
                <th className="text-left px-3 py-2">Last Run</th>
                <th className="text-left px-3 py-2">Last Status</th>
                <th className="text-left px-3 py-2">Today Success</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(approvalSummary?.schedules || []).map((schedule: any) => (
                <tr key={schedule.id}>
                  <td className="px-3 py-2 font-medium text-gray-700">{schedule.schedule_name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{schedule.cron_expression}</td>
                  <td className="px-3 py-2">
                    <Badge value={schedule.is_enabled ? 'success' : 'not_configured'} />
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDateTime(schedule.last_run?.started_at)}</td>
                  <td className="px-3 py-2">
                    {schedule.last_run ? <Badge value={schedule.last_run.status} /> : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${schedule.today_success ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {schedule.today_success ? 'yes' : 'not yet'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <RunButton
            label="Run Approval Now"
            onRun={async (dryRun) => {
              await api.post('/timesheet/photon/approve', { dry_run: dryRun });
            }}
          />
        )}
      </Card>

        {/* Run History */}
        {isAdmin && (
          <Card title="📜 Run History — Photon">
            <JobHistory service="photon_swami_entry" />
          </Card>
        )}

      </div>
    </div>
  );
}

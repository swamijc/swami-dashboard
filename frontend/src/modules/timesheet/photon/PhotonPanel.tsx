import React, { useEffect, useState } from 'react';
import api from '../../../api/client';
import RunButton from '../../../components/RunButton';
import JobHistory from '../../../components/JobHistory';
import { useAuth } from '../../../auth/AuthContext';

function toIsoDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5">
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

export default function PhotonPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const today = new Date().toISOString().split('T')[0];
  const currentMonday = startOfWeek(new Date());
  const minMonday = startOfWeek(addDays(new Date(), -31));
  const [weekStart, setWeekStart] = useState(toIsoDate(currentMonday));
  const [statusSummary, setStatusSummary] = useState<any>(null);
  const [approvalSummary, setApprovalSummary] = useState<any>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

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

  useEffect(() => { loadStatus(); }, [weekStart]);

  return (
    <div className="max-w-3xl">
      {/* Swami's Entry */}
      <Card title="⏱ Swami's Timesheet Entry">
        <div className="text-sm text-gray-500 mb-4 space-y-1">
          <p><span className="font-medium">Endpoint:</span> POST /timetracker/updatetimesheet</p>
          <p><span className="font-medium">Schedule:</span> Mon–Fri at 1:45 PM IST (auto if not logged in)</p>
          <p><span className="font-medium">Date:</span> {today} &nbsp;·&nbsp; <span className="font-medium">Hours:</span> 528 min (8h 48m)</p>
        </div>
        {isAdmin && (
          <RunButton
            label="Submit Swami's Timesheet"
            onRun={async (dryRun) => {
              await api.post('/timesheet/photon/swami/submit', { dry_run: dryRun });
            }}
          />
        )}
      </Card>

      {/* Prasanna's Entry */}
      <Card title="📋 Prasanna's Timesheet Entry">
        <div className="text-sm text-gray-500 mb-4 space-y-1">
          <p><span className="font-medium">Endpoint:</span> POST /timetracker/insertXls</p>
          <p><span className="font-medium">Schedule:</span> Every Monday at 1:45 PM IST</p>
          <p><span className="font-medium">Resource:</span> prasanna_vi (102014) &nbsp;·&nbsp; <span className="font-medium">Hours:</span> 528 min/day × 5 days</p>
        </div>
        {isAdmin && (
          <RunButton
            label="Submit Prasanna's Timesheet"
            onRun={async (dryRun) => {
              await api.post('/timesheet/photon/prasanna/submit', { dry_run: dryRun });
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
          <p className="text-amber-600 text-xs mt-2">⚠ Pending timesheets GET endpoint not yet configured — update in Admin → Service Configs.</p>
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

      <Card title="📆 Photon Timesheet Status">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4">
          <div className="text-sm text-gray-500">
            <p>Check current week or previous weeks up to one month.</p>
            {statusSummary && <p className="text-xs text-gray-400 mt-1">Showing {statusSummary.week_start} to {statusSummary.week_end}</p>}
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs font-medium text-gray-600">
              Week start
              <input
                type="date"
                min={toIsoDate(minMonday)}
                max={toIsoDate(currentMonday)}
                value={weekStart}
                onChange={event => setWeekStart(toIsoDate(startOfWeek(new Date(`${event.target.value}T00:00:00`))))}
                className="mt-1 block border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <button
              onClick={loadStatus}
              disabled={statusLoading}
              className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {statusLoading ? 'Checking…' : 'Refresh'}
            </button>
          </div>
        </div>
        {statusError && <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{statusError}</div>}
        <div className="space-y-3">
          {(statusSummary?.entries || []).map((entry: any) => (
            <div key={entry.key} className="border border-gray-100 rounded-lg p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-gray-800">{entry.title}</div>
                  <div className="text-xs text-gray-400">{entry.resource} · {entry.employee}</div>
                </div>
                <Badge value={entry.dashboard_submission.inferred_status} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-xs">
                <div>
                  <div className="text-gray-400">Photon Status Lookup</div>
                  <Badge value={entry.photon_status_lookup.status} />
                </div>
                <div>
                  <div className="text-gray-400">Last Dashboard Run</div>
                  <div className="text-gray-700">{formatDateTime(entry.dashboard_submission.last_run?.started_at)}</div>
                </div>
                <div>
                  <div className="text-gray-400">Run Result</div>
                  <div className="text-gray-700">{entry.dashboard_submission.last_run?.status || '—'}</div>
                </div>
              </div>
              {!entry.photon_status_lookup.configured && (
                <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  {entry.photon_status_lookup.message}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

    </div>
  );
}

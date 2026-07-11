import React, { useEffect, useState } from 'react';
import api from '../api/client';

interface Run {
  id: number; service_name: string; schedule_name: string;
  triggered_by: string; started_at: string; completed_at: string;
  status: string; http_status_code: number; response_summary: string;
  error_message: string; records_processed: number; is_dry_run: number;
}

const statusBadge: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failed:  'bg-red-100 text-red-700',
  running: 'bg-yellow-100 text-yellow-700',
  skipped: 'bg-gray-100 text-gray-600',
  dry_run: 'bg-blue-100 text-blue-700',
};

export default function JobHistory({ service }: { service?: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    const params = service ? `?service=${service}&limit=20` : '?limit=20';
    api.get(`/timesheet/runs${params}`)
      .then(r => setRuns(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [service]);

  if (loading) return <div className="text-sm text-gray-400 py-4">Loading history…</div>;
  if (!runs.length) return <div className="text-sm text-gray-400 py-4">No runs yet.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b">
            <th className="pb-2 pr-4">Service</th>
            <th className="pb-2 pr-4">Trigger</th>
            <th className="pb-2 pr-4">Started</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">HTTP</th>
            <th className="pb-2">Records</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {runs.map(r => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="py-2 pr-4 font-mono text-xs text-gray-600">{r.service_name}</td>
              <td className="py-2 pr-4 text-gray-600">{r.triggered_by}{r.is_dry_run ? ' (dry)' : ''}</td>
              <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{r.started_at?.replace('T',' ').slice(0,16)}</td>
              <td className="py-2 pr-4">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[r.status] || 'bg-gray-100 text-gray-600'}`}>
                  {r.status}
                </span>
              </td>
              <td className="py-2 pr-4 text-gray-500">{r.http_status_code || '—'}</td>
              <td className="py-2 text-gray-500">{r.records_processed ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

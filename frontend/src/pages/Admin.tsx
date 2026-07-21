import React, { useEffect, useState } from 'react';
import api from '../api/client';
import JobHistory from '../components/JobHistory';

export default function Admin() {
  const [configs, setConfigs] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [tab, setTab] = useState<'sessions' | 'schedules' | 'users' | 'audit'>('sessions');
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '', role: 'viewer' });
  const [userError, setUserError] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [sessionStatus, setSessionStatus] = useState<any>(null);
  const [sessionChecking, setSessionChecking] = useState(false);

  const loadUsers = () => api.get('/admin/users').then(r => setUsers(r.data)).catch(() => {});

  const checkPhotonSession = async () => {
    setSessionChecking(true);
    try {
      const r = await api.get('/timesheet/photon/session-check');
      setSessionStatus(r.data);
    } catch { /* ignore */ }
    finally { setSessionChecking(false); }
  };

  useEffect(() => {
    api.get('/admin/configs').then(r => setConfigs(r.data)).catch(() => {});
    api.get('/admin/schedules').then(r => setSchedules(r.data)).catch(() => {});
    loadUsers();
    checkPhotonSession();
  }, []);

  const [sessionForm, setSessionForm] = useState<Record<string, string>>({});
  const saveSession = async (serviceName: string) => {
    const { employee_numbers, employee_names_map, ...rest } = sessionForm as any;
    const payload: Record<string, any> = { ...rest };
    if (employee_numbers !== undefined || employee_names_map !== undefined) {
      const existingMap = employee_names_map ? JSON.parse(employee_names_map) : undefined;
      payload.extra_config = {
        ...(employee_numbers !== undefined ? { employee_numbers } : {}),
        ...(existingMap ? { employee_names_map: existingMap } : {}),
      };
    }
    await api.put(`/admin/configs/${serviceName}`, payload);
    alert('Session saved and encrypted.');
    setSessionForm({});
  };

  const tabs = [
    { id: 'sessions',  label: '🔑 Session Tokens' },
    { id: 'schedules', label: '⏰ Schedules' },
    { id: 'users',     label: '👤 Users' },
    { id: 'audit',     label: '📋 Audit Log' },
  ];

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setUserError('');
    setUserMessage('');
    try {
      await api.post('/admin/users', userForm);
      setUserForm({ username: '', email: '', password: '', role: 'viewer' });
      setUserMessage('User created successfully.');
      await loadUsers();
    } catch (error: any) {
      setUserError(error?.response?.data?.error || error.message || 'Failed to create user');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Settings</h1>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-8 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition
              ${tab === t.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Session Tokens */}
      {tab === 'sessions' && (
        <div className="space-y-8 max-w-2xl">

          {/* ── Photon: auto-managed ── */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-semibold text-gray-800">Photon Sessions</h2>
              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">Auto-managed via Chrome Extension</span>
            </div>

            {/* ── Session liveness banner ── */}
            {sessionStatus && (
              <div className={`rounded-lg px-4 py-3 text-sm mb-4 ${
                !sessionStatus.cookie_set
                  ? 'bg-gray-50 border border-gray-200 text-gray-600'
                  : sessionStatus.session_alive
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-amber-50 border border-amber-200 text-amber-800'
              }`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    {!sessionStatus.cookie_set ? (
                      <p>No Photon session stored yet. Install the browser extension or paste cookies manually below.</p>
                    ) : sessionStatus.session_alive ? (
                      <p>
                        <strong>● Session alive</strong> — Shibboleth SSO is active.
                        {sessionStatus.last_ping_at && (
                          <span className="text-xs font-normal ml-1 opacity-75">
                            (last verified {new Date(sessionStatus.last_ping_at).toLocaleTimeString()})
                          </span>
                        )}
                        <span className="block text-xs mt-0.5 opacity-75">
                          Keep-alive pings run every 2 h (9 AM–5 PM IST). The 1:45 PM cron will succeed today.
                        </span>
                      </p>
                    ) : (
                      <p>
                        <strong>⚠ Session expired</strong> — the Shibboleth SSO cookie has expired.
                        <span className="block text-xs mt-0.5">
                          Open <strong>timetracker.photon.com</strong> in Chrome (the browser extension will auto-refresh), or paste fresh cookies below.
                        </span>
                      </p>
                    )}
                  </div>
                  <button onClick={checkPhotonSession} disabled={sessionChecking}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg border font-medium transition
                      bg-white hover:bg-gray-50 border-gray-300 text-gray-700 disabled:opacity-50">
                    {sessionChecking ? 'Checking…' : 'Re-check'}
                  </button>
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 mb-4">
              Sessions are captured automatically when you log into Photon in Chrome.
              Install the extension from <code className="text-xs">browser-extension/</code>, then visiting
              <strong> timetracker.photon.com</strong> or <strong>photontrack.photon.com</strong> refreshes
              the session instantly — no manual paste needed.
            </div>

            <div className="space-y-3">
              {/* Timetracker status */}
              {(() => {
                const svc = configs.find(c => c.service_name === 'photon_swami_entry');
                const active = !!svc?.last_updated_at;
                return (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-800 text-sm">Photon Timetracker</div>
                        <div className="text-xs text-gray-400 font-mono mt-0.5">timetracker.photon.com</div>
                        <div className="text-xs text-gray-500 mt-1">Covers: Swami Entry · Prasanna Entry · Timesheet Approval</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        !active ? 'bg-gray-100 text-gray-500'
                        : sessionStatus?.session_alive ? 'bg-green-100 text-green-700'
                        : sessionStatus?.session_expired ? 'bg-amber-100 text-amber-700'
                        : 'bg-green-100 text-green-700'
                      }`}>
                        {!active ? '○ Not configured'
                          : sessionStatus?.session_alive ? '● Session alive'
                          : sessionStatus?.session_expired ? '⚠ Session expired'
                          : '● Active'}
                      </span>
                    </div>
                    {svc?.last_updated_at && (
                      <div className="text-xs text-gray-400 mt-2">
                        Last refreshed: {new Date(svc.last_updated_at + 'Z').toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Photon Track status + employee numbers */}
              {(() => {
                const svc = configs.find(c => c.service_name === 'photontrack_access');
                const active = !!svc?.last_updated_at;
                return (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-800 text-sm">Photon Track</div>
                        <div className="text-xs text-gray-400 font-mono mt-0.5">photontrack.photon.com</div>
                        <div className="text-xs text-gray-500 mt-1">Covers: Team Time Tracking</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {active ? '● Active' : '○ Not configured'}
                      </span>
                    </div>
                    {svc?.last_updated_at && (
                      <div className="text-xs text-gray-400 mt-1">
                        Last refreshed: {new Date(svc.last_updated_at + 'Z').toLocaleString()}
                      </div>
                    )}
                    {/* Session status + emergency paste */}
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-600 mb-1">Session cookie <span className="font-normal text-gray-400">(auto-managed by Chrome extension — paste here only if extension is unavailable)</span></p>
                      <textarea rows={3}
                        placeholder="Paste full Cookie: header from photontrack.photon.com request"
                        onChange={e => setSessionForm(f => ({ ...f, cookie_header: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                    </div>

                    <div className="mt-4 pt-3 border-t border-gray-100">
                      <label className="text-xs font-medium text-gray-600 block mb-1">
                        Team employee numbers
                        <span className="font-normal text-gray-400 ml-1">(comma-separated — from the <code>employeenumber</code> payload field)</span>
                      </label>
                      <input type="text" placeholder="144267,153175,153149,..."
                        onChange={e => setSessionForm(f => ({ ...f, employee_numbers: e.target.value.trim() }))}
                        className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                      <p className="text-xs text-gray-400 mt-1">Saved separately — does not affect session cookies.</p>

                      <label className="text-xs font-medium text-gray-600 block mb-1 mt-4">
                        Employee name mapping
                        <span className="font-normal text-gray-400 ml-1">(one per line: <code>code: Full Name</code>)</span>
                      </label>
                      <textarea rows={6}
                        placeholder={"144267: Alice Brown\n153175: Prasanna V\n153149: John D"}
                        onChange={e => {
                          const lines = e.target.value.split('\n').filter(l => l.includes(':'));
                          const map: Record<string, string> = {};
                          lines.forEach(l => {
                            const [code, ...rest] = l.split(':');
                            if (code.trim()) map[code.trim()] = rest.join(':').trim();
                          });
                          setSessionForm(f => ({ ...f, employee_names_map: JSON.stringify(map) }));
                        }}
                        className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <p className="text-xs text-gray-400 flex-1">Names show in the Individual Breakdown table instead of employee codes.</p>
                        <button
                          type="button"
                          onClick={async () => {
                            setSyncMsg('Syncing…');
                            try {
                              const r = await api.post('/tracking/sync-names', {});
                              setSyncMsg(`✅ ${r.data.message}`);
                              api.get('/admin/configs').then(res => setConfigs(res.data));
                            } catch (e: any) {
                              setSyncMsg(`❌ ${e?.response?.data?.error || e.message}`);
                            }
                          }}
                          className="shrink-0 text-xs px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white rounded-lg transition"
                        >
                          ↻ Sync names from Timetracker
                        </button>
                      </div>
                      {syncMsg && <p className="text-xs mt-1 font-medium text-gray-700">{syncMsg}</p>}
                      <button onClick={() => saveSession('photontrack_access')}
                        className="mt-3 bg-blue-700 hover:bg-blue-800 text-white text-sm px-4 py-2 rounded-lg transition">
                        Save Employee Config
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Boots KI: manual ── */}
          <div>
            <h2 className="font-semibold text-gray-800 mb-1">Boots KI Sessions</h2>
            <p className="text-xs text-gray-500 mb-4">Boots uses a separate auth system — these must be refreshed manually when your Boots session expires.</p>
            <div className="space-y-5">
              {configs.filter(c => c.service_name.startsWith('boots')).map(cfg => (
                <div key={cfg.service_name} className="bg-white border border-gray-200 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-800 mb-1">{cfg.display_name}</h3>
                  <p className="text-xs text-gray-400 font-mono mb-4">{cfg.service_name}</p>
                  {cfg.last_updated_at && (
                    <p className="text-xs text-gray-400 mb-3">Last updated: {new Date(cfg.last_updated_at + 'Z').toLocaleString()}</p>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">ASP.NET_SessionId</label>
                      <input type="password" placeholder="y0kyczpcad04w5b4k2xzkcbw"
                        onChange={e => setSessionForm(f => ({ ...f, asp_net_session: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">CSRFToken</label>
                      <input type="password" placeholder="66f8318b-354d-4274-ad5d-..."
                        onChange={e => setSessionForm(f => ({ ...f, csrf_token: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">api_access</label>
                      <textarea rows={2} placeholder="SWAMI.K@EXT.BOOTS.COM:..."
                        onChange={e => setSessionForm(f => ({ ...f, api_access: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">k1</label>
                      <textarea rows={2} placeholder="3EB8727DBF1..."
                        onChange={e => setSessionForm(f => ({ ...f, k1: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                    </div>
                  </div>
                  <button onClick={() => saveSession(cfg.service_name)}
                    className="mt-4 bg-blue-700 hover:bg-blue-800 text-white text-sm px-4 py-2 rounded-lg transition">
                    Save & Encrypt
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Schedules */}
      {tab === 'schedules' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-w-3xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Service','Schedule','Cron (UTC)','Timezone','Enabled'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {schedules.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.service_name}</td>
                  <td className="px-4 py-3 text-gray-700">{s.schedule_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.cron_expression}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.timezone}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.is_enabled ? 'Active' : 'Paused'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Users */}
      {tab === 'users' && (
        <div className="space-y-5 max-w-3xl">
          <form onSubmit={createUser} className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-800 mb-1">Add Dashboard User</h3>
            <p className="text-xs text-gray-500 mb-4">Use viewer role for report-only current-week access. Viewers cannot see Admin, logs, schedules, session tokens, or manual run controls.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600">
                Username
                <input required value={userForm.username}
                  onChange={e => setUserForm(f => ({ ...f, username: e.target.value }))}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-gray-600">
                Email
                <input required type="email" value={userForm.email}
                  onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-gray-600">
                Temporary Password
                <input required type="password" value={userForm.password}
                  onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-gray-600">
                Role
                <select value={userForm.role}
                  onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm">
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                </select>
              </label>
            </div>
            {userError && <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{userError}</div>}
            {userMessage && <div className="mt-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{userMessage}</div>}
            <button type="submit" className="mt-4 bg-blue-700 hover:bg-blue-800 text-white text-sm px-4 py-2 rounded-lg transition">
              Create User
            </button>
          </form>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Username','Email','Role','Status','Created'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{u.username}</td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{u.role}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{u.created_at?.slice(0,10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit */}
      {tab === 'audit' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-3xl">
          <JobHistory />
        </div>
      )}
    </div>
  );
}

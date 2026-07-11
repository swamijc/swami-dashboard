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

  const loadUsers = () => api.get('/admin/users').then(r => setUsers(r.data)).catch(() => {});

  useEffect(() => {
    api.get('/admin/configs').then(r => setConfigs(r.data)).catch(() => {});
    api.get('/admin/schedules').then(r => setSchedules(r.data)).catch(() => {});
    loadUsers();
  }, []);

  const [sessionForm, setSessionForm] = useState<Record<string, string>>({});
  const saveSession = async (serviceName: string) => {
    await api.put(`/admin/configs/${serviceName}`, sessionForm);
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
        <div className="space-y-5 max-w-2xl">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <strong>Security:</strong> Session tokens are AES-256 encrypted before storage. After saving, raw values are never shown again.
          </div>
          {configs.map(cfg => (
            <div key={cfg.service_name} className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-800 mb-1">{cfg.display_name}</h3>
              <p className="text-xs text-gray-400 font-mono mb-4">{cfg.service_name}</p>
              {cfg.service_name === 'photontrack_access' ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">Open <strong>https://photontrack.photon.com/photontrack/#/manager</strong>, inspect the <strong>reportees</strong> or <strong>getReporteesAccess</strong> request, then paste the full Request Headers <strong>Cookie:</strong> value here. The app will extract <strong>myCookie</strong> and <strong>_shibsession_</strong> automatically.</p>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Full Cookie header from photontrack.photon.com</label>
                    <textarea rows={4} placeholder="visid_incap_...=...; myCookie=value; _shibsession_646566...=..."
                      onChange={e => setSessionForm(f => ({ ...f, cookie_header: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                  </div>
                </div>
              ) : cfg.service_name.startsWith('photon') ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">myCookie value</label>
                    <input type="password" placeholder="myCookie=value"
                      onChange={e => setSessionForm(f => ({ ...f, session_cookie: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">_shibsession_ value (full cookie string)</label>
                    <textarea rows={2} placeholder="_shibsession_...=value"
                      onChange={e => setSessionForm(f => ({ ...f, shibboleth_cookie: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                  </div>
                </div>
              ) : cfg.service_name.startsWith('boots') ? (
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
                    <label className="text-xs font-medium text-gray-600 block mb-1">api_access (full value)</label>
                    <textarea rows={2} placeholder="SWAMI.K@EXT.BOOTS.COM:..."
                      onChange={e => setSessionForm(f => ({ ...f, api_access: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">k1 (full value)</label>
                    <textarea rows={2} placeholder="3EB8727DBF1..."
                      onChange={e => setSessionForm(f => ({ ...f, k1: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none" />
                  </div>
                </div>
              ) : null}
              <button onClick={() => saveSession(cfg.service_name)}
                className="mt-4 bg-blue-700 hover:bg-blue-800 text-white text-sm px-4 py-2 rounded-lg transition">
                Save & Encrypt
              </button>
            </div>
          ))}
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

import React, { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import photonIcon from '../assets/icons/photon.png';

const navItems = [
  { path: '/',           label: 'Dashboard', icon: '🏠' },
  { path: '/timesheet',  label: 'Timesheet',  icon: '⏱️' },
  { path: '/tracking',   label: 'Time Tracking', icon: '📈' },
  { path: '/revenue',    label: 'Revenue',    icon: '💰', disabled: true },
  { path: '/jira',       label: 'JIRA',       icon: '🔀' },
  { path: '/world-cup',  label: 'World Cup Live', icon: '🏆' },
  { path: '/onboarding', label: 'Onboarding', icon: '👥' },
  { path: '/quality',    label: 'Quality',    icon: '🛡️' },
  { path: '/release',    label: 'Release',    icon: '🚀' },
  { path: '/admin',      label: 'Admin',      icon: '⚙️', adminOnly: true },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('swami-dashboard-theme') === 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('swami-dashboard-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const handleLogout = async () => { await logout(); navigate('/login'); };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-[#06121f] text-white flex flex-col border-r border-[#123456]">
        <div className="px-6 py-5 border-b border-white/10">
          <div className="text-2xl font-bold flex items-center gap-2">
            <img
              src={photonIcon}
              alt=""
              className="h-7 w-7 rounded-sm object-contain"
            />
            <span>SPD</span>
          </div>
          <div className="text-xs text-sky-200 mt-0.5">Swami's Portfolio Dashboard</div>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-3">
          {navItems.map(item => {
            if (item.adminOnly && user?.role !== 'admin') return null;
            if (user?.role === 'viewer' && !['/', '/tracking', '/jira', '/world-cup', '/onboarding', '/quality', '/release'].includes(item.path)) return null;
            const active = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={(item as any).disabled ? '#' : item.path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition
                  ${active ? 'bg-[#0072ce] text-white shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'}
                  ${(item as any).disabled ? 'text-slate-400 cursor-not-allowed pointer-events-none' : ''}`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {(item as any).disabled && <span className="ml-auto text-xs bg-white/15 text-slate-200 px-1.5 py-0.5 rounded">Soon</span>}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-4 border-t border-white/10">
          <div className="text-xs text-sky-200 mb-1">{user?.username} · {user?.role}</div>
          <button onClick={handleLogout} className="text-sm text-slate-300 hover:text-white transition">Sign out →</button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between dark:bg-gray-900 dark:border-gray-800">
          <div className="text-lg font-semibold text-gray-900 tracking-tight">Swami's Portfolio Dashboard</div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <button
              type="button"
              onClick={() => setDarkMode(value => !value)}
              aria-pressed={darkMode}
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-[#0072ce] hover:text-[#005eb8] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <span className={`h-4 w-8 rounded-full p-0.5 transition ${darkMode ? 'bg-[#0072ce]' : 'bg-gray-300'}`}>
                <span className={`block h-3 w-3 rounded-full bg-white transition ${darkMode ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
              {darkMode ? 'Dark' : 'Light'}
            </button>
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              All systems operational
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-8 bg-[#f5f8fb] dark:bg-gray-950">{children}</div>
      </main>
    </div>
  );
}

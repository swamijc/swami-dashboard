import React from 'react';
import { useAuth } from '../auth/AuthContext';

const modules = [
  { title: 'Timesheet', icon: '⏱️', path: '/timesheet', desc: 'Photon & Boots KI timesheet entry, approval, and compliance', active: true },
  { title: 'Timesheet Report', icon: '📄', path: '/timesheet-report', desc: 'Daily submission pie, overall saved/submitted/approved/disputed stats, and individual breakdown', active: true },
  { title: 'Time Tracking', icon: '📈', path: '/tracking', desc: 'Team in/out hours — 40hr / 40-50hr / 50+ hr weekly analysis', active: true },
  { title: 'Revenue Report', icon: '💰', path: '/revenue', desc: 'Revenue vs target, variance and team contribution reports', active: false },
  { title: 'JIRA Dashboard', icon: '🔀', path: '/jira', desc: 'Boots Mobile App open sprint Story/Bug report by resource and story points', active: true },
  { title: 'Onboarding', icon: '👥', path: '/onboarding', desc: 'Photon and Boots onboarding/offboarding workflow tracking', active: true },
  { title: 'Code Quality', icon: '🛡️', path: '/quality', desc: 'Build, coverage, regression, load, and security test results', active: true },
  { title: 'Release Tracking', icon: '🚀', path: '/release', desc: 'DEV, QA, and PROD promotion status with manual approval tracking', active: true },
];

export default function Home() {
  const { user } = useAuth();
  const visibleModules = user?.role === 'viewer'
    ? modules.filter(module => ['/', '/tracking', '/jira', '/timesheet-report', '/onboarding', '/quality', '/release'].includes(module.path))
    : modules;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Portfolio Dashboard</h1>
      <p className="text-gray-500 mb-8">
        {user?.role === 'viewer'
          ? 'Current-week reporting view for team time tracking'
          : 'Photon-styled command center for timesheets, reporting, and team operations'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {visibleModules.map(m => (
          <a
            key={m.path}
            href={m.active ? m.path : undefined}
            className={`block bg-white rounded-xl border p-6 transition
              ${m.active ? 'border-blue-200 hover:border-blue-500 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer' : 'border-gray-200 opacity-50 cursor-not-allowed'}`}
          >
            <div className="text-3xl mb-3">{m.icon}</div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-semibold text-gray-900">{m.title}</h2>
              {!m.active && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Coming Soon</span>}
              {m.active  && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Active</span>}
            </div>
            <p className="text-sm text-gray-500">{m.desc}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

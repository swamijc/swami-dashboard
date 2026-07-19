import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import Timesheet from './pages/Timesheet';
import TimeTracking from './pages/TimeTracking';
import Admin from './pages/Admin';
import Onboarding from './pages/Onboarding';
import Jira from './pages/Jira';
import JiraDueDate from './pages/JiraDueDate';
import WorldCup from './pages/WorldCup';
import Quality from './pages/Quality';
import Release from './pages/Release';

function ProtectedRoute({ children, adminOnly }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/timesheet" element={<ProtectedRoute adminOnly><Timesheet /></ProtectedRoute>} />
          <Route path="/timesheet/*" element={<ProtectedRoute adminOnly><Timesheet /></ProtectedRoute>} />
          <Route path="/tracking" element={<ProtectedRoute><TimeTracking /></ProtectedRoute>} />
          <Route path="/jira" element={<ProtectedRoute><Jira /></ProtectedRoute>} />
          <Route path="/jira/due-date" element={<ProtectedRoute><JiraDueDate /></ProtectedRoute>} />
          <Route path="/world-cup" element={<ProtectedRoute><WorldCup /></ProtectedRoute>} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/onboarding/*" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/quality" element={<ProtectedRoute><Quality /></ProtectedRoute>} />
          <Route path="/release" element={<ProtectedRoute><Release /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const MobileSessionPage = lazy(() => import('./pages/MobileSessionPage').then((module) => ({ default: module.MobileSessionPage })));

const AgentActivityPage = lazy(() => import('./pages/AgentActivityPage').then((module) => ({ default: module.AgentActivityPage })));
const SalesVisitEntryPage = lazy(() => import('./pages/SalesVisitEntryPage').then((module) => ({ default: module.SalesVisitEntryPage })));
const ManagerRetailersPage = lazy(() => import('./pages/ManagerRetailersPage').then((module) => ({ default: module.ManagerRetailersPage })));
const AgentDashboardPage = lazy(() => import('./pages/AgentDashboardPage').then((module) => ({ default: module.AgentDashboardPage })));
const AgentNewOrderPage = lazy(() => import('./pages/AgentNewOrderPage').then((module) => ({ default: module.AgentNewOrderPage })));
const AgentShopsPage = lazy(() => import('./pages/AgentShopsPage').then((module) => ({ default: module.AgentShopsPage })));
const AgentProfilePage = lazy(() => import('./pages/AgentProfilePage').then((module) => ({ default: module.AgentProfilePage })));
const AgentFuelPage = lazy(() => import('./pages/AgentFuelPage').then((module) => ({ default: module.AgentFuelPage })));
const OperationsChatPage = lazy(() => import('./pages/OperationsChatPage').then((module) => ({ default: module.OperationsChatPage })));
const SafetyPage = lazy(() => import('./pages/SafetyPage').then((module) => ({ default: module.SafetyPage })));
const AgentContactsPage = lazy(() => import('./pages/ContactsPage').then((module) => ({ default: module.AgentContactsPage })));

const LoadingPortal = () => (
  <div className="min-h-[100dvh] grid place-items-center bg-slate-950 text-sm font-semibold text-cyan-300">
    Loading Reproutes Sales…
  </div>
);

const agentRoute = (page: React.ReactNode, loginPath = '/sales/login') => (
  <ProtectedRoute allowedRole="agent" loginPath={loginPath}>{page}</ProtectedRoute>
);

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <ErrorBoundary portalName="Sales">
            <Suspense fallback={<LoadingPortal />}>
              <Routes>
                <Route path="/" element={<Navigate to="/sales/login" replace />} />
                <Route path="/login" element={<Navigate to="/sales/login" replace />} />
                <Route path="/sales/login" element={<LoginPage portal="sales" />} />
                <Route path="/mobile/session" element={<MobileSessionPage />} />

                <Route path="/sales/dashboard" element={agentRoute(<AgentDashboardPage />)} />
                <Route path="/sales/new-order" element={agentRoute(<AgentNewOrderPage />)} />
                <Route path="/sales/shops" element={agentRoute(<AgentShopsPage />)} />
                <Route path="/sales/retailers/add" element={agentRoute(<ManagerRetailersPage view="add" portal="agent" />)} />
                <Route path="/sales/profile" element={agentRoute(<AgentProfilePage />)} />
                <Route path="/sales/activity" element={agentRoute(<AgentActivityPage />)} />
                <Route path="/sales/visits/new" element={agentRoute(<SalesVisitEntryPage />)} />
                <Route path="/sales/fuel" element={agentRoute(<AgentFuelPage />)} />
                <Route path="/sales/chat" element={agentRoute(<OperationsChatPage />)} />
                <Route path="/sales/safety" element={agentRoute(<SafetyPage />)} />
                <Route path="/sales/contacts" element={agentRoute(<AgentContactsPage />)} />

                <Route path="*" element={<Navigate to="/sales/login" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}

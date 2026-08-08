import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, ProtectedRoute } from './hooks/useAuth';
import LoginPage from './pages/login';
import DashboardPage from './pages/dashboard';
import BrokersPage from './pages/brokers';
import ClientsPage from './pages/clients';
import InvestigationsListPage from './pages/investigations-list';
import InvestigationWorkspacePage from './pages/investigation-workspace';
import WorkspaceLayout from './components/layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public auth page */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected SaaS workspace layout */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <WorkspaceLayout>
                    <DashboardPage />
                  </WorkspaceLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/brokers"
              element={
                <ProtectedRoute>
                  <WorkspaceLayout>
                    <BrokersPage />
                  </WorkspaceLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/clients"
              element={
                <ProtectedRoute>
                  <WorkspaceLayout>
                    <ClientsPage />
                  </WorkspaceLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/investigations"
              element={
                <ProtectedRoute>
                  <WorkspaceLayout>
                    <InvestigationsListPage />
                  </WorkspaceLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/investigations/:id"
              element={
                <ProtectedRoute>
                  <WorkspaceLayout>
                    <InvestigationWorkspacePage />
                  </WorkspaceLayout>
                </ProtectedRoute>
              }
            />

            {/* Default redirects */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

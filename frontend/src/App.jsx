import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { ThemeProvider } from './ThemeContext';
import * as api from './api';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ExpensesView = lazy(() => import('./pages/ExpensesView'));
const CategoriesView = lazy(() => import('./pages/CategoriesView'));
const BudzetyView = lazy(() => import('./pages/Budgets'));
const TagsView = lazy(() => import('./pages/Tags'));
const YearOverview = lazy(() => import('./pages/YearOverview'));

function Spinner() {
  return (
    <div className="flex justify-center items-center h-screen">
      <div className="w-8 h-8 border-4 border-[#32a852]/20 border-t-[#32a852] rounded-full animate-spin"></div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

const UnprotectedRoute = ({ children, redirect = "/dashboard" }) => {
  const { user } = useAuth();
  if (user) {
    return <Navigate to={redirect} replace />;
  }
  return children;
};

const IndexGate = () => {
  const { user } = useAuth();
  return user ? (
    <Navigate to="/dashboard" replace />
  ) : (
    <Navigate to="/login" replace />
  );
};

function AppRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clearSession } = useAuth();

  // Global expired-token handler: any authenticated API call that gets a 401
  // (JWT expired) drops the local session and redirects to /login, where a
  // small "session expired" toast is shown via location.state.
  useEffect(() => {
    api.setSessionExpiredHandler(() => {
      clearSession();
      if (location.pathname !== '/login') {
        navigate('/login', { replace: true, state: { sessionExpired: true } });
      }
    });
  }, [navigate, location.pathname, clearSession]);

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<IndexGate />} />
        <Route
          path="/login"
          element={
            <UnprotectedRoute redirect="/dashboard">
              <LoginPage />
            </UnprotectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/wydatki"
          element={
            <ProtectedRoute>
              <ExpensesView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/kategorie"
          element={
            <ProtectedRoute>
              <CategoriesView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/budzety"
          element={
            <ProtectedRoute>
              <BudzetyView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tags"
          element={
            <ProtectedRoute>
              <TagsView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/year"
          element={
            <ProtectedRoute>
              <YearOverview />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rejestracja"
          element={
            <UnprotectedRoute redirect="/dashboard">
              <RegisterPage />
            </UnprotectedRoute>
          }
        />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

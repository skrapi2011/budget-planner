// Auth context + hook only (no JSX) — same split as ToastContext.js / ToastProvider.jsx
// (audit P1-31: react-refresh/only-export-components fires when a file exports both a
// provider component and a hook).
import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

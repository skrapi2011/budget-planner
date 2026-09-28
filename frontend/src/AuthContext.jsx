import { createContext, useContext, useState, useEffect } from 'react';
import * as api from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(localStorage.getItem('user'));
  const [token, setToken] = useState(localStorage.getItem('token'));

  // Validate a stored token once at startup: a JWT that the server no longer accepts
  // used to survive until the first API call, leaving the SPA showing a logged-in shell
  // that then bounced to /login. GET /auth/status had no caller (audit P0-25).
  useEffect(() => {
    if (!token) return;
    api.getAuthStatus()
      .then((s) => { if (!s || s.authenticated !== true) clearSession(); })
      .catch(() => { /* 401 path already clears the session via the expired handler */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (username, password) => {
    await api.login(username, password);
    setUser(localStorage.getItem('user'));
    setToken(localStorage.getItem('token'));
  };

  const clearSession = () => {
    // Synchronous, no network — used when the backend reports an expired token.
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setToken(null);
  };

  const adoptSession = () => {
    // Pick up a session that is already in localStorage without any network
    // call — used after registration, where api.register() stores the token.
    setUser(localStorage.getItem('user'));
    setToken(localStorage.getItem('token'));
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch {}
    clearSession();
  };

  return <AuthContext.Provider value={{ user, token, login: handleLogin, logout: handleLogout, clearSession, adoptSession }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

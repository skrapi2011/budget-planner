import { createContext, useContext, useState } from 'react';
import * as api from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(localStorage.getItem('user'));
  const [token, setToken] = useState(localStorage.getItem('token'));

  const handleLogin = async (username, password) => {
    await api.login(username, password);
    setUser(localStorage.getItem('user'));
    setToken(localStorage.getItem('token'));
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setToken(null);
  };

  return <AuthContext.Provider value={{ user, token, login: handleLogin, logout: handleLogout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

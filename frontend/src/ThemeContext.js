// Theme context + hook only (no JSX) — same split as ToastContext.js / ToastProvider.jsx
// (audit P1-31: react-refresh/only-export-components).
import { createContext, useContext } from 'react';

export const ThemeContext = createContext(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}

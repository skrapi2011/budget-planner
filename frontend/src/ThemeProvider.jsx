import { useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { ThemeContext } from './ThemeContext';

// Must match --theme-switch-ms in index.css (the fallback timer has to outlast the CSS
// transition, so the class is removed only after the cross-fade has finished).
const TRANSITION_MS = 500;

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    try {
      // Sprawdzi czy .dark jest juz ustawione przez skrypt w index.html
      if (document.documentElement.classList.contains('dark')) return true;
      const stored = localStorage.getItem('theme');
      if (stored) return stored === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch {}
  }, [isDark]);

  // The reveal starts at the toggle button, so the caller passes its centre. Keyboard
  // activation (Enter/Space) has no pointer coords, which is why Layout measures the
  // button's bounding box instead of reading clientX/clientY.
  const toggleTheme = useCallback((origin) => {
    const root = document.documentElement;
    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? 0;
    root.style.setProperty('--theme-x', `${x}px`);
    root.style.setProperty('--theme-y', `${y}px`);

    const apply = () => setIsDark((prev) => !prev);

    if (prefersReducedMotion() || typeof document.startViewTransition !== 'function') {
      // Path B: a one-off colour cross-fade across the tree (.theme-transition in
      // index.css). The class is dropped afterwards so hover/focus keep their timing.
      root.classList.add('theme-transition');
      apply();
      window.setTimeout(() => root.classList.remove('theme-transition'), TRANSITION_MS);
      return;
    }

    // Path A: snapshot the old theme, then commit the new one synchronously so the
    // capture sees the flipped DOM (React docs pair startViewTransition with flushSync).
    document.startViewTransition(() => {
      flushSync(apply);
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

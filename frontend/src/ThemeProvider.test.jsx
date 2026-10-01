import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './ThemeContext';

// AGENTS.md §7.3: dark mode is the `.dark` class on <html>, toggled by ThemeContext,
// persisted in localStorage.theme, and pre-empted by the anti-FOUC script in index.html.
// The provider and the hook live in separate files (react-refresh rule) — both are used here.

function Probe() {
  const { isDark, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="state">{isDark ? 'dark' : 'light'}</span>
      <button type="button" onClick={toggleTheme}>toggle</button>
    </div>
  );
}

function renderProbe() {
  render(<ThemeProvider><Probe /></ThemeProvider>);
}

function htmlHasDark() {
  return document.documentElement.classList.contains('dark');
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  localStorage.clear();
  window.matchMedia = (q) => ({
    matches: q.includes('dark'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

describe('ThemeProvider init', () => {
  it('honours a stored light preference', () => {
    localStorage.setItem('theme', 'light');
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('light');
    expect(htmlHasDark()).toBe(false);
  });

  it('honours a stored dark preference and puts .dark on <html>', () => {
    localStorage.setItem('theme', 'dark');
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('dark');
    expect(htmlHasDark()).toBe(true);
  });

  it('defers to the anti-FOUC script when .dark is already set (no flash)', () => {
    // index.html sets .dark before React runs; the provider must agree, not flip it back.
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'light');
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('dark');
    expect(htmlHasDark()).toBe(true);
  });

  it('falls back to the OS preference when nothing is stored', () => {
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} });
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('light');
  });

  it('respects prefers-color-scheme: dark on a first visit', () => {
    window.matchMedia = (q) => ({ matches: q.includes('dark'), media: q, addEventListener: () => {}, removeEventListener: () => {} });
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('dark');
  });
});

describe('toggle', () => {
  it('flips the class and persists the choice', () => {
    localStorage.setItem('theme', 'light');
    renderProbe();
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    expect(htmlHasDark()).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    expect(htmlHasDark()).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('is its own inverse (two toggles return to the start)', () => {
    renderProbe();
    const btn = screen.getByRole('button', { name: 'toggle' });
    const before = localStorage.getItem('theme');
    act(() => btn.click());
    act(() => btn.click());
    expect(localStorage.getItem('theme')).toBe(before);
  });
});

describe('useTheme', () => {
  it('throws outside the provider (the app must wrap routes)', () => {
    const spy = console.error;
    console.error = () => {};
    expect(() => render(<Probe />)).toThrow('useTheme must be used within ThemeProvider');
    console.error = spy;
  });

  it('exposes exactly isDark and toggleTheme', () => {
    let value;
    function Probe2() {
      const v = useTheme();
      // Recording during render is a side effect (react-hooks/globals); an effect is the
      // sanctioned place, and it runs before the assertions below.
      useEffect(() => { value = v; }, [v]);
      return null;
    }
    render(<ThemeProvider><Probe2 /></ThemeProvider>);
    expect(Object.keys(value).sort()).toEqual(['isDark', 'toggleTheme']);
  });
});

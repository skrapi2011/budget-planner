import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// Layout passes the toggle button's centre, so the wipe radiates from where the user
// clicked. This probe drives the same contract from a test.
function OriginProbe() {
  const { isDark, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="state">{isDark ? 'dark' : 'light'}</span>
      <button type="button" onClick={() => toggleTheme({ x: 120, y: 30 })}>toggle</button>
    </div>
  );
}

function renderProbe() {
  render(<ThemeProvider><Probe /></ThemeProvider>);
}

function renderOriginProbe() {
  render(<ThemeProvider><OriginProbe /></ThemeProvider>);
}

function htmlHasDark() {
  return document.documentElement.classList.contains('dark');
}

let originalSvt;

beforeEach(() => {
  // The fallback path schedules a real 420 ms timer; without fake timers it leaks into
  // the next test and leaves .theme-transition on <html>.
  vi.useFakeTimers();
  document.documentElement.classList.remove('dark');
  document.documentElement.classList.remove('theme-transition');
  localStorage.clear();
  window.matchMedia = (q) => ({
    matches: q.includes('dark'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  // jsdom ships no View Transitions API; tests that want it stub it in.
  originalSvt = document.startViewTransition;
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  if (originalSvt) document.startViewTransition = originalSvt;
  else delete document.startViewTransition;
  document.documentElement.style.removeProperty('--theme-x');
  document.documentElement.style.removeProperty('--theme-y');
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

describe('theme transition', () => {
  const stubViewTransitions = () => {
    const calls = [];
    document.startViewTransition = (cb) => {
      calls.push(cb);
      cb();
      return { finished: Promise.resolve() };
    };
    return calls;
  };

  it('uses the View Transitions API when the browser has it (circular wipe)', () => {
    const calls = stubViewTransitions();
    localStorage.setItem('theme', 'light');
    renderProbe();
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    expect(calls).toHaveLength(1);
    expect(htmlHasDark()).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('flips the DOM synchronously inside the transition callback (snapshot-safe)', () => {
    const calls = stubViewTransitions();
    localStorage.setItem('theme', 'light');
    renderProbe();
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    // The stub runs the callback synchronously. flushSync must have committed .dark
    // before it returned, so the captured snapshot is the new theme, not the old one.
    expect(calls).toHaveLength(1);
    expect(htmlHasDark()).toBe(true);
  });

  it('records the reveal origin so the wipe starts at the toggle button', () => {
    stubViewTransitions();
    localStorage.setItem('theme', 'light');
    renderOriginProbe();
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--theme-x')).toBe('120px');
    expect(root.style.getPropertyValue('--theme-y')).toBe('30px');
    expect(screen.getByTestId('state')).toHaveTextContent('dark');
  });

  it('falls back to a one-off colour cross-fade without the API, then releases it', () => {
    localStorage.setItem('theme', 'light');
    renderProbe();
    const root = document.documentElement;
    expect(root.classList.contains('theme-transition')).toBe(false);

    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    expect(root.classList.contains('theme-transition')).toBe(true);
    expect(htmlHasDark()).toBe(true);

    // The class must not outlive the transition: it overrides every element's own
    // hover/focus transition, so leaving it on would make the UI feel sluggish.
    act(() => { vi.runAllTimers(); });
    expect(root.classList.contains('theme-transition')).toBe(false);
    expect(htmlHasDark()).toBe(true);
  });

  it('does not animate under prefers-reduced-motion', () => {
    const calls = stubViewTransitions();
    localStorage.setItem('theme', 'light');
    window.matchMedia = (q) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    renderProbe();
    act(() => screen.getByRole('button', { name: 'toggle' }).click());
    expect(calls).toHaveLength(0);
    expect(htmlHasDark()).toBe(true); // the theme still changes, just instantly
  });

  it('never animates on mount (only on a toggle)', () => {
    const calls = stubViewTransitions();
    renderProbe();
    expect(calls).toHaveLength(0);
    expect(document.documentElement.classList.contains('theme-transition')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--theme-x')).toBe('');
  });
});

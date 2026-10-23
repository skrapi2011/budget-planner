import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../AuthProvider';
import { ThemeProvider } from '../ThemeProvider';
import ToastProvider from '../components/ToastProvider';

// App.jsx wraps the routes in: ThemeProvider > AuthProvider > ToastProvider > Router.
// Rendering a page in isolation needs the same stack, so it is centralised here.
export function renderWithProviders(ui, { route = '/', ...rest } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>{ui}</ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
    rest,
  );
}

/**
 * Flush every pending promise and every animation frame with FAKE timers, so a
 * count-up / progress-bar value lands on its target deterministically.
 *
 * Real-time `findByText(..., {timeout: 2000})` is not reliable here: jsdom fires rAF
 * every 16 ms only when the runner's event loop is not starved, and a loaded shared
 * CI runner starves it. On CI the 6 animation assertions failed twice (i.e. with
 * --retry=1), and the same 6 fail locally when four vitest runs compete for CPU.
 * Fake timers remove the dependency on wall-clock speed.
 *
 * Usage: vi.useFakeTimers(); render…; await settle(); expect(screen.getByText(...))
 * with `afterEach(() => vi.useRealTimers())` in the file.
 */
export async function settle(maxPasses = 5) {
  // Multiple passes are required, measured, not guessed: the mocked api.js promise resolves
  // as a microtask AFTER the first runAllTimersAsync has already drained the queue, so the
  // count-up for the loaded data starts only on the next pass (one pass leaves the cards at
  // "0,00 zł", two settles them). Each pass is cheap — runAllTimersAsync returns immediately
  // on an empty queue — and we stop as soon as nothing is pending.
  for (let i = 0; i < maxPasses; i++) {
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    if (vi.getTimerCount() === 0) break;
  }
}

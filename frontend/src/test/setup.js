// Vitest global setup.
import '@testing-library/jest-dom/vitest';

// React 19 ships a separate dev/prod bundle. Vitest sets NODE_ENV='test', which resolves to
// the production build under some bundlers — the testing library then has no act() support and
// `findBy*` hangs. Pin it to development.
process.env.NODE_ENV = 'test';

// jsdom has no real layout: recharts measures a 0×0 container and renders nothing, so any
// chart assertion is meaningless here. Charts are asserted on the data they receive, not on
// their SVG output.
if (!window.matchMedia) {
  window.matchMedia = (q) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
}

// ⚠️ requestAnimationFrame is re-implemented on top of the timer set that vitest fakes.
// jsdom's own rAF is driven by jsdom's event loop, which `vi.useFakeTimers()` does NOT
// control (vitest's default toFake list is setTimeout/clearTimeout/setInterval/
// clearInterval/setImmediate/clearImmediate/Date), so an animation asserted under fake
// timers can never settle — and under real timers jsdom fires rAF every 16ms only when
// the runner's event loop is not starved. That is exactly why the 6 animation assertions
// failed on the CI runner (and locally when four vitest runs compete for CPU).
// 16ms per "frame" keeps the semantics, and the stamp comes from the same clock the
// faked timers use, so a count-up advances in lockstep with vi.advanceTimersByTime.
const rafIds = new Map();
window.requestAnimationFrame = (cb) => {
  const id = window.setTimeout(() => cb(Date.now()), 16);
  rafIds.set(id, cb);
  return id;
};
window.cancelAnimationFrame = (id) => {
  rafIds.delete(id);
  window.clearTimeout(id);
};

// localStorage is per-worker and survives test files by default; a stale `token` from one case
// leaks into the next. Reset before each test.
beforeEach(() => {
  localStorage.clear();
});

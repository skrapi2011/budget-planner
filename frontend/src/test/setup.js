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

// localStorage is per-worker and survives test files by default; a stale `token` from one case
// leaks into the next. Reset before each test.
beforeEach(() => {
  localStorage.clear();
});

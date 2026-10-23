import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MONTH_NAMES, monthLabel, currentMonthStr, currentYear, localDateStr,
} from './date';

describe('MONTH_NAMES', () => {
  it('has 12 Polish names in calendar order', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe('Styczeń');
    expect(MONTH_NAMES[11]).toBe('Grudzień');
  });

  it('uses Polish diacritics, not ASCII fallbacks', () => {
    // The UI is Polish (AGENTS.md §7.4); a stray "October" is a visible regression.
    expect(MONTH_NAMES.join(' ')).toMatch(/[ąćęłńóśźż]/);
  });
});

describe('monthLabel', () => {
  it('renders a month string as a Polish label', () => {
    expect(monthLabel('2026-09')).toBe('Wrzesień 2026');
    expect(monthLabel('2025-01')).toBe('Styczeń 2025');
    expect(monthLabel('2026-12')).toBe('Grudzień 2026');
  });

  it('passes through anything that is not a valid month', () => {
    for (const bad of ['', 'abc', '2026', '2026-00', '2026-13', '0000-01']) {
      expect(monthLabel(bad)).toBe(bad);
    }
  });

  it('tolerates a full date string (the extra day is ignored)', () => {
    // Deep links carry "YYYY-MM-DD" in places; monthLabel must not crash on them.
    expect(monthLabel('2026-07-15')).toBe('Lipiec 2026');
  });

  it('accepts a non-padded month', () => {
    expect(monthLabel('2026-5')).toBe('Maj 2026');
  });
});

describe('currentMonthStr', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('is "YYYY-MM" with a zero-padded month', () => {
    expect(currentMonthStr()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('agrees with the calendar month of the local clock', () => {
    const d = new Date();
    expect(currentMonthStr()).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  });
});

describe('currentYear', () => {
  it('is the local four-digit year', () => {
    expect(currentYear()).toBe(new Date().getFullYear());
    expect(String(currentYear())).toMatch(/^\d{4}$/);
  });
});

describe('localDateStr', () => {
  it('formats a Date as local "YYYY-MM-DD"', () => {
    expect(localDateStr(new Date('2026-05-09T23:30:00+11:00'))).toBe('2026-05-09');
    expect(localDateStr(new Date('2026-12-01T00:00:00'))).toBe('2026-12-01');
  });

  it('zero-pads month and day', () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateStr(new Date(2026, 8, 1))).toBe('2026-09-01');
  });

  it('defaults to today (local)', () => {
    const d = new Date();
    expect(localDateStr()).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  });

  it('is the local date, not the UTC date, for a late-evening timestamp', () => {
    // audit P0-19: toISOString() is UTC, so a user entering an expense after 23:00 got
    // yesterday's date. A Date built from local components is the honest reference in any
    // timezone; the UTC divergence only exists east of UTC, so it is asserted conditionally.
    const justAfterMidnight = new Date(2026, 1, 1, 0, 30);  // local 2026-02-01 00:30
    expect(localDateStr(justAfterMidnight)).toBe('2026-02-01');
    if (-justAfterMidnight.getTimezoneOffset() > 0) {
      // East of UTC: the same instant is 2026-01-31 in UTC, so a toISOString() date
      // would have filed the expense in the previous month.
      expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-01-31');
    }
  });
});

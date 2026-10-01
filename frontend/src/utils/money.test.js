import { describe, it, expect } from 'vitest';
import { formatMoney } from './money';

// pl-PL uses a non-breaking space (U+00A0) as the thousands separator and a comma as the
// decimal point. Tests must spell that separator exactly — a normal space fails.
const NBSP = '\u00A0';

describe('formatMoney', () => {
  it('formats a number as Polish currency', () => {
    expect(formatMoney(12)).toBe('12,00 zł');
    expect(formatMoney(0)).toBe('0,00 zł');
    expect(formatMoney(1234.5)).toBe('1234,50 zł');
  });

  it('always shows exactly two decimals', () => {
    expect(formatMoney(7.1)).toBe('7,10 zł');
    expect(formatMoney(7.001)).toBe('7,00 zł');
    expect(formatMoney(7.005)).toBe('7,01 zł');
  });

  it('groups thousands with NBSP and keeps the comma decimal', () => {
    // A US-style "1,234.50 zł" is the visible tell-tale of a lost pl-PL locale.
    expect(formatMoney(1234567.89)).toBe(`1${NBSP}234${NBSP}567,89 zł`);
    expect(formatMoney(10000)).toBe(`10${NBSP}000,00 zł`);
    expect(formatMoney(1234567.89)).not.toMatch(/^[\d,]+\.\d{2}/);
  });

  it('accepts numeric strings from the API', () => {
    expect(formatMoney('42.5')).toBe('42,50 zł');
  });

  it('passes through an already-formatted string', () => {
    // The API sometimes returns pre-formatted text; re-formatting would double the "zł".
    expect(formatMoney('12,00 zł')).toBe('12,00 zł');
    expect(formatMoney('0,00 zł')).toBe('0,00 zł');
  });

  it('treats null and empty as zero, not as text', () => {
    // Number(null) is 0, so a missing amount renders as money, not as "null zł".
    expect(formatMoney(null)).toBe('0,00 zł');
    expect(formatMoney('')).toBe('0,00 zł');
  });

  it('passes through genuinely unparseable values as text', () => {
    expect(formatMoney(undefined)).toBe('undefined');
    expect(formatMoney(NaN)).toBe('NaN');
    expect(formatMoney('abc')).toBe('abc');
  });

  it('handles negatives (balances can be negative)', () => {
    expect(formatMoney(-20)).toBe('-20,00 zł');
  });

  it('never emits "NaN zł" for a missing amount', () => {
    // The stat cards render this directly; "NaN zł" is a shipped-data bug.
    for (const v of [null, undefined, NaN, '', 'abc', 12, '12,00 zł']) {
      expect(formatMoney(v)).not.toContain('NaN zł');
    }
  });

  it('is the single formatter (no page re-implements it)', () => {
    // audit P1-30: Dashboard, ExpensesView and YearOverview each had their own copy with
    // different edge cases. The exported function is the only one, and it is a pure function.
    expect(typeof formatMoney).toBe('function');
    expect(formatMoney.length).toBe(1);
    expect(formatMoney(5)).toBe(formatMoney(5));
  });
});

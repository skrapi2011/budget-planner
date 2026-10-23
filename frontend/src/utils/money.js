// Single money formatter (audit P1-30: three near-identical copies lived in
// Dashboard, ExpensesView and YearOverview, each with slightly different edge cases).

export function formatMoney(v) {
  // Strings that are already formatted (e.g. "12,00 zł") pass through untouched.
  if (typeof v === 'string' && v.endsWith('zł')) return v;
  const num = Number(v);
  if (!Number.isFinite(num)) return String(v);
  return `${num.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
}

// Shared date helpers (month strings are "YYYY-MM", local time — never toISOString,
// which is UTC and can shift the month around midnight/timezone borders).

// Polish month names, in calendar order. Duplicated across 4 pages before audit P1-30.
export const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

// "YYYY-MM" -> "Wrzesień 2026" (index is 1-based in the month string).
export function monthLabel(monthStr) {
  const [y, m] = String(monthStr).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthStr;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentYear() {
  return new Date().getFullYear();
}

// Local "YYYY-MM-DD" (Transactions.date format). toISOString() is UTC, so a user
// entering an expense after 23:00 got yesterday's date (audit P0-19).
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

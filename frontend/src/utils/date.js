// Shared date helpers (month strings are "YYYY-MM", local time — never toISOString,
// which is UTC and can shift the month around midnight/timezone borders).

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

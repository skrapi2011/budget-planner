// Shared date helpers (month strings are "YYYY-MM", local time — never toISOString,
// which is UTC and can shift the month around midnight/timezone borders).

export function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentYear() {
  return new Date().getFullYear();
}

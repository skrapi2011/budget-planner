const SERVER_URL = import.meta.env.VITE_API_URL || '';
const API_BASE = `${SERVER_URL}/api`;

// Registered by the router (App.jsx): called when an authenticated request
// comes back 401, i.e. the JWT expired. Redirects to /login with a toast.
let sessionExpiredHandler = null;
export function setSessionExpiredHandler(fn) {
  sessionExpiredHandler = fn;
}

async function _fetch(url, options) {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  const response = await fetch(fullUrl, options);
  if (response.status === 401) {
    // Only treat as expired session when we actually sent a token.
    // Login/register send no auth header — their 401 means bad credentials.
    const hadAuth = Boolean(options?.headers?.Authorization);
    if (hadAuth) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      try {
        sessionExpiredHandler?.();
      } catch { /* handler errors are non-fatal */ }
    }
    throw new Error('Unauthorized');
  }
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error || 'An error occurred';
    throw new Error(message);
  }
  return data;
}

function getHeaders(includeAuth = true) {
  return {
    'Content-Type': 'application/json',
    ...(includeAuth ? { Authorization: `Bearer ${localStorage.getItem('token')}` } : {}),
  };
}

// ---- AUTH ----

export async function login(username, password) {
  const data = await _fetch('/auth/login', {
    method: 'POST',
    headers: getHeaders(false),
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', username);
  return data;
}

export async function getAuthStatus() {
  // Was an endpoint with no caller (audit P0-25); now used by AuthContext to validate
  // a stored token at startup, so a stale JWT is dropped before the first page renders.
  return _fetch('/auth/status', { method: 'GET', headers: getHeaders(true) });
}

export async function logout() {
  // Backend logout is a stateless no-op (no @require_auth), so we skip the
  // auth header — an expired token here must NOT trigger the session-expired toast.
  const token = localStorage.getItem('token');
  if (token) {
    try { await _fetch('/auth/logout', { method: 'DELETE', headers: getHeaders(false) }); } catch {}
  }
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export async function register(username, password, confirmPassword) {
  const data = await _fetch('/auth/register', {
    method: 'POST',
    headers: getHeaders(false),
    body: JSON.stringify({ username, password, confirmPassword }),
  });
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', username);
  return data;
}

// ---- CATEGORIES ----

export async function getCategories(active) {
  // active=true has a dedicated endpoint (ordered by default_order) that had no caller
  // (audit P0-25); use it instead of re-implementing the filter via query string.
  if (active === true) {
    return _fetch('/categories/active', { method: 'GET', headers: getHeaders(true) });
  }
  const params = new URLSearchParams();
  if (active !== undefined) params.set('active', String(active));
  const query = params.toString() ? `?${params.toString()}` : '';
  return _fetch(`/categories${query}`, { method: 'GET', headers: getHeaders(true) });
}

export async function createCategory(data) {
  return _fetch('/categories', { method: 'POST', headers: getHeaders(true), body: JSON.stringify(data) });
}

export async function updateCategory(id, data) {
  return _fetch(`/categories/${id}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify(data) });
}

export async function deleteCategory(id) {
  return _fetch(`/categories/${id}`, { method: 'DELETE', headers: getHeaders(true) });
}

// ---- BUDGETS ----

export async function createBudget(data) {
  return _fetch('/budgets', { 
    method: 'POST', 
    headers: getHeaders(true), 
    body: JSON.stringify({ 
      category_id: Number(data.categoryId || data.category_id), 
      amount_monthly: parseFloat(data.amount_monthly || data.budzet), 
      month_year: data.month_year 
    }) 
  });
}

export async function updateBudget(id, data) {
  return _fetch(`/budgets/${id}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify(data) });
}

// ---- TRANSACTIONS ----

export async function addTransaction(data) {
  return _fetch('/transactions', { 
    method: 'POST', 
    headers: getHeaders(true), 
    body: JSON.stringify({ 
      category_id: Number(data.categoryId || data.category_id), 
      date: data.date, 
      amount: parseFloat(data.amount), 
      type: data.type || 'wydatek', 
      description: data.description || '', 
      // tags was dropped here, so the whole tags backend (json_each, /tags/all,
      // PUT tags) was unreachable from the UI (audit P0-22).
      tags: Array.isArray(data.tags) ? data.tags : (data.tags ? String(data.tags).split(',').map((t) => t.trim()).filter(Boolean) : []) 
    }) 
  });
}

export async function deleteTransaction(id) {
  return _fetch(`/transactions/${id}`, { method: 'DELETE', headers: getHeaders(true) });
}

export async function updateTransaction(id, data) {
  // PUT /api/transactions/<id> existed with no caller (audit P0-26).
  return _fetch(`/transactions/${id}`, {
    method: 'PUT',
    headers: getHeaders(true),
    body: JSON.stringify({
      category_id: Number(data.categoryId || data.category_id),
      date: data.date,
      amount: parseFloat(data.amount),
      type: data.type || 'wydatek',
      description: data.description || '',
      tags: Array.isArray(data.tags) ? data.tags : (data.tags ? String(data.tags).split(',').map((t) => t.trim()).filter(Boolean) : []),
    }),
  });
}

// Fetches every transaction of the current user (backend filters by user_id).
// `month=all` skips the date filter — the default GET is current-month only (§7.2),
// which made the Tags tab operate on a month while promising "all transactions" (P0-23).
export async function getTransactionsAll() {
  return _fetch('/transactions?month=all', { method: 'GET', headers: getHeaders(true) });
}

// Transactions for a specific month ("YYYY-MM"). Without `month` the backend
// returns only the current month — that's what getTransactionsAll() is for.
export async function getTransactions(month) {
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  const qs = params.toString();
  return _fetch(`/transactions${qs ? `?${qs}` : ''}`, { method: 'GET', headers: getHeaders(true) });
}

// ---- TAGS ----

export async function getAllTags() {
  return _fetch('/tags/all', { method: 'GET', headers: getHeaders(true) });
}

// Tag-manipulation helpers used by Tags.jsx. Single backend call over ALL the user's
// transactions; errors propagate so Tags.jsx can show a failure toast (audit P0-23 —
// the old version looped over current-month transactions, swallowed every error and
// reported success even when the backend failed).
export async function deleteTag(tagToRemove) {
  return _fetch(`/tags/${encodeURIComponent(tagToRemove)}`, { method: 'DELETE', headers: getHeaders(true) });
}

export async function updateTagName(oldName, newName) {
  return _fetch(`/tags/${encodeURIComponent(oldName)}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify({ new_name: newName }) });
}

// ---- STATS/BUDGETS VIEW HELPERS ----

export async function getDashboardData(month) {
  const m = month || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  return _fetch('/stats/dashboard-data', { method: 'POST', headers: getHeaders(true), body: JSON.stringify({ month: m }) });
}

/* ===========================================
   BUDGETS VIEW (by-month POST – incluye
   wydatki, saldo, status from backend)
   =========================================== */
export async function getBudgetsViewByMonth(monthStr) {
  return _fetch('/budgets/by-month-post', { method: 'POST', headers: getHeaders(true), body: JSON.stringify({ month: monthStr }) });
}

export async function getYearSummary(year) {
  const yr = year || `${new Date().getFullYear()}`;
  return _fetch('/stats/year-summary', { method: 'POST', headers: getHeaders(true), body: JSON.stringify({ year: yr }) });
}
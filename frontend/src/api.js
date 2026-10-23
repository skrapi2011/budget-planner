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
      description: data.description || '' 
    }) 
  });
}

export async function deleteTransaction(id) {
  return _fetch(`/transactions/${id}`, { method: 'DELETE', headers: getHeaders(true) });
}

// Fetches all transactions of the current user (backend filters by user_id).
export async function getTransactionsAll() {
  return _fetch('/transactions', { method: 'GET', headers: getHeaders(true) });
}

// ---- TAGS ----

export async function getAllTags() {
  return _fetch('/tags/all', { method: 'GET', headers: getHeaders(true) });
}

// Tag-manipulation helpers used by Tags.jsx
export async function deleteTag(tagToRemove) {
  try {
    const txns = await _fetch('/transactions', { method: 'GET', headers: getHeaders(true) });
    for (const t of (txns || [])) {
      let tags = [];
      if (typeof t.tags === 'string') { try { tags = JSON.parse(t.tags); } catch {} } else if (Array.isArray(t.tags)) { tags = t.tags; }
      const filtered = Array.isArray(tags) ? tags.filter((x) => x !== tagToRemove) : [];
      if (filtered.length !== tags.length || !Array.isArray(filtered)) {
        await _fetch(`/transactions/${t.id}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify({ tags: filtered }) });
      }
    }
  } catch {}
}

export async function updateTagName(editId, newName) {
  try {
    const txns = await _fetch('/transactions', { method: 'GET', headers: getHeaders(true) });
    for (const t of (txns || [])) {
      let tags = [];
      if (typeof t.tags === 'string') { try { tags = JSON.parse(t.tags); } catch {} } else if (Array.isArray(t.tags)) { tags = t.tags; }
      const idx = Array.isArray(tags) ? tags.indexOf(editId) : -1;
      if (idx > -1) tags[idx] = newName;
      await _fetch(`/transactions/${t.id}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify({ tags }) });
    }
  } catch {}
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
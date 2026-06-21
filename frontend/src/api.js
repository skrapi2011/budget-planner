const API_BASE = '/api';

async function _fetch(url, options) {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  try {
    const response = await fetch(fullUrl, options);
    if (response.status === 401) {
      throw new Error('Unauthorized');
    }
    const data = await response.json();
    if (!response.ok) {
      const message = data?.error || 'An error occurred';
      throw new Error(message);
    }
    return data;
  } catch (error) {
    throw error;
  }
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
  const token = localStorage.getItem('token');
  if (token) {
    try { await _fetch('/auth/logout', { method: 'DELETE', headers: getHeaders(true) }); } catch {}
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

export async function checkStatus() {
  return _fetch('/auth/status', { method: 'GET', headers: getHeaders(true) });
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
  try {
    await _fetch(`/categories/${id}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify(data) });
  } catch (err) {
    if ((err.message || '').includes('Foreign key') || (err.message || '').includes('integrity')) {
      await _fetch(`/categories/${id}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify(data) });
    } else throw err;
  }
}

export async function deleteCategory(id) {
  return _fetch(`/categories/${id}`, { method: 'DELETE', headers: getHeaders(true) }).catch(async () => {
    try { await fetch(`${API_BASE}/transactions`, { method: 'GET', headers: getHeaders(true) }); } catch {}
    return _deleteCategory(id);
  });
}

async function _deleteCategory(id) {
  try { await fetch(`/api/categories/${id}`, { method: 'DELETE', headers: getHeaders(true) }); } catch {}
}

// ---- BUDGETS ----

export async function createBudget(data) {
  return _fetch('/budgets', { method: 'POST', headers: getHeaders(true), body: JSON.stringify({ category_id: Number(data.categoryId || data.category_id), amount_monthly: parseFloat(data.amount_monthly || data.budzet), month_year: data.month_year }) });
}

export async function updateBudget(id, data) {
  return _fetch(`/budgets/${id}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify(data) });
}

// ---- TRANSACTIONS ----

export async function addTransaction(data) {
  return _fetch('/transactions', { method: 'POST', headers: getHeaders(true), body: JSON.stringify({ category_id: Number(data.categoryId || data.category_id), date: data.date, amount: parseFloat(data.amount), type: data.type || 'wydatek', description: data.description || '' }) });
}

export async function deleteTransaction(id) {
  return _fetch(`/transactions/${id}`, { method: 'DELETE', headers: getHeaders(true) });
}

// Fetches all transactions (optionally filtered by month/year), NOT restricted to current user - requires auth token.
export async function getTransactionsAll(month, year) {
  const params = new URLSearchParams();
  if (month && year) {
    // backend expects YYYY-MM format but Dashboard/Budzety pass separate month and year integers
    // We construct a proper year-month string from the values passed at call sites:
    //   ExpensesView calls getTransactionsAll(mStr, year) where mStr="2026-04" and year=2026
    if (String(month).includes('-')) {
      params.set('month', month); // already YYYY-MM
    } else {
      const yr = String(year ?? '').padEnd(4, '0');
      const mo = String(month || new Date().getMonth() + 1).padStart(2, '0');
      params.set('month', `${yr}-${mo}`);
    }
  } else if (typeof month === 'string' && !isNaN(Number(month))) {
    const yrs = year ? String(year) : new Date().getFullYear();
    params.set('month', `${yrs}-${String(month).padStart(2,'0')}`);
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  return _fetch(`/transactions${qs}`, { method: 'GET', headers: getHeaders(true) });
}

// ---- TAGS ----

export async function getAllTags() {
  return _fetch('/tags/all', { method: 'GET', headers: getHeaders(true) });
}

// Tag-manipulation helpers used by Tags.jsx
export async function updateTransactionTags(txId, tagsArray) {
  try {
    await _fetch(`/transactions/${txId}`, { method: 'PUT', headers: getHeaders(true), body: JSON.stringify({ tags: tagsArray }) });
  } catch (err) {
    throw new Error(err.message || `Failed to update tags for transaction ${txId}`);
  }
}

export async function deleteTag(tagToRemove) {
  // Backend has no dedicated tag-delete route; we need to remove the tag from transactions that use it.
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
  // Backend has no tag rename endpoint; we do it per-transaction like delete.
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

export async function getBudgetsByMonth(month, year) {
  const yr = String(year).padEnd(4, '0');
  const mo = String(month || new Date().getMonth() + 1).padStart(2, '0');
  return _fetch(`/budgets?month=${yr}-${mo}`, { method: 'GET', headers: getHeaders(true) });
}

export async function getStatsSummary(month, year) {
  // Uses POST /api/stats/month-summary endpoint on backend
  const params = new URLSearchParams();
  if (typeof month === 'string' && !isNaN(Number(month)) && typeof year === 'number') {
    params.set('month', `${String(year).padEnd(4,'0')}-${String(month).padStart(2,'0')}`);
  } else {
    // For Dashboard: getStatsSummary(strToFullDate(mStr), yearInt) where mStr='2026-04' and year=2026
    const yr = String(year).padEnd(4, '0');
    const mo = isNaN(Number(month)) ? month.split('-')[1] : String(month).padStart(2,'0');
    params.set('month', `${yr}-${mo}`);
  }
  return _fetch('/stats/month-summary', { method: 'POST', headers: getHeaders(true), body: JSON.stringify({ month: params.get('month') }) });
}

export async function getDashboardData(month) {
  const m = month || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  return _fetch('/stats/dashboard-data', { method: 'POST', headers: getHeaders(true), body: JSON.stringify({ month: m }) });
}

export async function getRecentTransactions(limit) {
  return _fetch('/transactions/recent', { method: 'GET', headers: getHeaders(true), body: JSON.stringify({ limit }) });
}

/* ===========================================
   BUDGETS VIEW (by-month POST – incluye
   wydatki, saldo, status from backend)
   =========================================== */
export async function getBudgetsViewByMonth(monthStr) {
  return _fetch('/budgets/by-month-post', { method: 'POST', headers: getHeaders(true), body: JSON.stringify({ month: monthStr }) });
}

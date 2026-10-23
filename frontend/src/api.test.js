import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as api from './api';

// AGENTS.md §7.2: api.js is the ONLY place HTTP happens. These tests pin the contract the
// pages rely on: URL shape, auth headers, the 401 session-expiry flow, and the field-name
// normalisation (camelCase/snake_case tolerance) that older pages depend on.

const calls = [];

function respond(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function last() {
  return calls[calls.length - 1];
}

function url() {
  return last()[0];
}

function opts() {
  return last()[1];
}

function body() {
  return JSON.parse(last()[1].body);
}

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  localStorage.setItem('token', 'tok');
  api.setSessionExpiredHandler(null);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, o) => {
    calls.push([u, o]);
    return respond({ ok: true });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request shape', () => {
  it('prefixes every path with /api', async () => {
    await api.getCategories();
    expect(url()).toBe('/api/categories');
  });

  it('sends JSON content type', async () => {
    await api.getCategories();
    expect(opts().headers['Content-Type']).toBe('application/json');
  });

  it('sends the stored token as a Bearer token', async () => {
    localStorage.setItem('token', 'abc123');
    await api.getCategories();
    expect(opts().headers.Authorization).toBe('Bearer abc123');
  });

  it('sends no auth header for login (its 401 must not look like an expired session)', async () => {
    await api.login('u', 'p');
    expect(opts().headers.Authorization).toBeUndefined();
    expect(opts().method).toBe('POST');
  });

  it('sends no auth header for register', async () => {
    await api.register('u', 'p', 'p');
    expect(opts().headers.Authorization).toBeUndefined();
  });

  it('sends no auth header for logout (stateless no-op, expired token must not fire the toast)', async () => {
    await api.logout();
    expect(opts().headers.Authorization).toBeUndefined();
    expect(opts().method).toBe('DELETE');
  });
});

describe('401 session expiry', () => {
  it('clears the stored session and calls the handler when a token was sent', async () => {
    const handler = vi.fn();
    api.setSessionExpiredHandler(handler);
    localStorage.setItem('user', 'admin');
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond({ error: 'x' }, 401); });
    await expect(api.getCategories()).rejects.toThrow('Unauthorized');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not clear the session for an unauthenticated 401 (bad credentials)', async () => {
    const handler = vi.fn();
    api.setSessionExpiredHandler(handler);
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond({ error: 'Złe dane' }, 401); });
    await expect(api.login('u', 'bad')).rejects.toThrow('Unauthorized');
    expect(localStorage.getItem('token')).toBe('tok');
    expect(handler).not.toHaveBeenCalled();
  });

  it('survives a handler that throws', async () => {
    api.setSessionExpiredHandler(() => { throw new Error('boom'); });
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond({}, 401); });
    await expect(api.getCategories()).rejects.toThrow('Unauthorized');
  });

  it('throws the backend error message for a non-401 failure', async () => {
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond({ error: 'Hasło musi mieć co najmniej 4 znaki' }, 400); });
    await expect(api.register('a', 'x', 'x')).rejects.toThrow('Hasło musi mieć co najmniej 4 znaki');
  });

  it('has a generic fallback when the error body has no message', async () => {
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond({}, 500); });
    // Polish: the backend messages are Polish (AGENTS.md §6.3) and pages toast err.message
    // verbatim, so the fallback must not be an English string in a Polish UI.
    await expect(api.getCategories()).rejects.toThrow('Coś poszło nie tak — sprawdź połączenie z serwerem');
  });

  it('returns the parsed body on success', async () => {
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond([{ id: 1, name: 'Transport' }]); });
    expect(await api.getCategories()).toEqual([{ id: 1, name: 'Transport' }]);
  });
});

describe('auth', () => {
  it('login stores token and user', async () => {
    localStorage.removeItem('token');
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond({ token: 'newtok', username: 'admin' }); });
    const data = await api.login('admin', 'admin123');
    expect(data.token).toBe('newtok');
    expect(localStorage.getItem('token')).toBe('newtok');
    expect(localStorage.getItem('user')).toBe('admin');
    expect(url()).toBe('/api/auth/login');
    expect(body()).toEqual({ username: 'admin', password: 'admin123' });
  });

  it('register auto-logs-in (registration returns a token and stores it)', async () => {
    localStorage.removeItem('token');
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond({ token: 'rtok', username: 'nowy' }); });
    await api.register('nowy', 'haslo', 'haslo');
    expect(localStorage.getItem('token')).toBe('rtok');
    expect(localStorage.getItem('user')).toBe('nowy');
    expect(url()).toBe('/api/auth/register');
    expect(body()).toEqual({ username: 'nowy', password: 'haslo', confirmPassword: 'haslo' });
  });

  it('logout clears the session even when the backend call fails', async () => {
    fetch.mockImplementation(async (u, o) => { calls.push([u, o]); return respond({}, 500); });
    localStorage.setItem('user', 'admin');
    await api.logout();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('logout skips the request when there is no token', async () => {
    localStorage.removeItem('token');
    await api.logout();
    expect(calls).toHaveLength(0);
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('getAuthStatus is an authenticated GET /auth/status', async () => {
    await api.getAuthStatus();
    expect(url()).toBe('/api/auth/status');
    expect(opts().method).toBe('GET');
    expect(opts().headers.Authorization).toBe('Bearer tok');
  });
});

describe('categories', () => {
  it('active=true uses the dedicated ordered endpoint', async () => {
    await api.getCategories(true);
    expect(url()).toBe('/api/categories/active');
  });

  it('active=false is a query param, not the active endpoint', async () => {
    await api.getCategories(false);
    expect(url()).toBe('/api/categories?active=false');
  });

  it('omitting active sends no query', async () => {
    await api.getCategories();
    expect(url()).toBe('/api/categories');
  });

  it('passes a numeric active through as text', async () => {
    await api.getCategories(1);
    expect(url()).toBe('/api/categories?active=1');
  });

  it('create/update/delete hit the right verbs', async () => {
    await api.createCategory({ name: 'Nowa', color: '#32a852', icon: '🚗' });
    expect([url(), opts().method]).toEqual(['/api/categories', 'POST']);
    expect(body()).toEqual({ name: 'Nowa', color: '#32a852', icon: '🚗' });

    await api.updateCategory(7, { active: false });
    expect([url(), opts().method]).toEqual(['/api/categories/7', 'PUT']);

    await api.deleteCategory(7);
    expect([url(), opts().method]).toEqual(['/api/categories/7', 'DELETE']);
  });
});

describe('budgets', () => {
  it('createBudget normalises camelCase and snake_case to the API shape', async () => {
    await api.createBudget({ categoryId: '12', amount_monthly: '300', month_year: '2026-05' });
    expect(body()).toEqual({ category_id: 12, amount_monthly: 300, month_year: '2026-05' });
    expect(url()).toBe('/api/budgets');
    expect(opts().method).toBe('POST');
  });

  it('keeps a zero limit (?? not ||): 0 used to become NaN and 400', async () => {
    // audit P1-32.
    await api.createBudget({ category_id: 3, amount_monthly: 0, month_year: '2026-05' });
    expect(body().amount_monthly).toBe(0);
    expect(Number.isNaN(body().amount_monthly)).toBe(false);
  });

  it('accepts the legacy `budzet` key', async () => {
    await api.createBudget({ category_id: 3, budzet: 250.5, month_year: '2026-05' });
    expect(body().amount_monthly).toBe(250.5);
  });

  it('updateBudget is a PUT with the raw body', async () => {
    await api.updateBudget(4, { amount: 500 });
    expect([url(), opts().method]).toEqual(['/api/budgets/4', 'PUT']);
    expect(body()).toEqual({ amount: 500 });
  });

  it('deleteBudget exists (audit P1-48: the backend had no DELETE route)', async () => {
    await api.deleteBudget(4);
    expect([url(), opts().method]).toEqual(['/api/budgets/4', 'DELETE']);
  });

  it('the budgets view is the POST-only endpoint (the GET twin was removed)', async () => {
    await api.getBudgetsViewByMonth('2026-05');
    expect(url()).toBe('/api/budgets/by-month-post');
    expect(opts().method).toBe('POST');
    expect(body()).toEqual({ month: '2026-05' });
  });
});

describe('transactions', () => {
  it('addTransaction sends the API shape with snake_case', async () => {
    await api.addTransaction({ category_id: 12, date: '2026-05-15', amount: '42.5', type: 'wydatek', description: 'zakupy' });
    expect(body()).toEqual({ category_id: 12, date: '2026-05-15', amount: 42.5, type: 'wydatek', description: 'zakupy', tags: [] });
    expect(url()).toBe('/api/transactions');
  });

  it('defaults the type to wydatek', async () => {
    await api.addTransaction({ category_id: 12, date: '2026-05-15', amount: 10 });
    expect(body().type).toBe('wydatek');
  });

  it('keeps the capital-P Przychod exactly (CHECK constraint, AGENTS.md §5)', async () => {
    await api.addTransaction({ category_id: 12, date: '2026-05-15', amount: 900, type: 'Przychod' });
    expect(body().type).toBe('Przychod');
  });

  it('sends tags as an array (audit P0-22: tags used to be dropped)', async () => {
    await api.addTransaction({ category_id: 12, date: '2026-05-15', amount: 10, tags: ['dom', 'zakupy'] });
    expect(body().tags).toEqual(['dom', 'zakupy']);
  });

  it('splits a comma-separated tag string and drops empties', async () => {
    await api.addTransaction({ category_id: 12, date: '2026-05-15', amount: 10, tags: 'dom, zakupy,,' });
    expect(body().tags).toEqual(['dom', 'zakupy']);
  });

  it('updateTransaction is a PUT with the same normalisation (audit P0-26)', async () => {
    await api.updateTransaction(9, { categoryId: 12, date: '2026-05-15', amount: 20, tags: ['x'] });
    expect([url(), opts().method]).toEqual(['/api/transactions/9', 'PUT']);
    // A partial PUT sends only what the caller passed. The old implementation built the full
    // payload, so a call that omitted category_id sent Number(undefined) = NaN → JSON null →
    // backend 400, and it invented type/description defaults the caller never asked for.
    expect(body()).toEqual({ category_id: 12, date: '2026-05-15', amount: 20, tags: ['x'] });
  });

  it('deleteTransaction is a DELETE', async () => {
    await api.deleteTransaction(9);
    expect([url(), opts().method]).toEqual(['/api/transactions/9', 'DELETE']);
  });

  it('getTransactionsAll asks for the whole history (audit P0-23)', async () => {
    await api.getTransactionsAll();
    expect(url()).toBe('/api/transactions?month=all');
  });

  it('getTransactions passes the selected month', async () => {
    await api.getTransactions('2026-05');
    expect(url()).toBe('/api/transactions?month=2026-05');
  });

  it('getTransactions without a month lets the backend default to the current month', async () => {
    await api.getTransactions();
    expect(url()).toBe('/api/transactions');
  });

  it('month is URL-encoded when it needs to be (keyword search)', async () => {
    await api.getTransactions('2026-05');
    expect(url()).not.toContain(' ');
  });
});

describe('tags', () => {
  it('lists all tags', async () => {
    await api.getAllTags();
    expect(url()).toBe('/api/tags/all');
  });

  it('deletes a tag with the name encoded', async () => {
    await api.deleteTag('za dom');
    expect(url()).toBe('/api/tags/za%20dom');
    expect(opts().method).toBe('DELETE');
  });

  it('renames a tag with the body key the backend expects', async () => {
    await api.updateTagName('dom', 'house');
    expect(url()).toBe('/api/tags/dom');
    expect(opts().method).toBe('PUT');
    expect(body()).toEqual({ new_name: 'house' });
  });

  it('encodes a tag with a slash so it cannot escape the route', async () => {
    await api.deleteTag('a/b');
    expect(url()).toBe('/api/tags/a%2Fb');
  });
});

describe('stats', () => {
  it('dashboard-data is a POST with the month', async () => {
    await api.getDashboardData('2026-05');
    expect(url()).toBe('/api/stats/dashboard-data');
    expect(opts().method).toBe('POST');
    expect(body()).toEqual({ month: '2026-05' });
  });

  it('dashboard-data defaults to the current month (local, not UTC)', async () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    await api.getDashboardData();
    expect(body().month).toBe(expected);
  });

  it('year-summary passes the year through unchanged', async () => {
    // YearOverview.jsx sends String(year); the backend coerces to str before validating, so
    // an int is accepted too. Pinning both keeps the contract honest on both sides.
    await api.getYearSummary('2026');
    expect(url()).toBe('/api/stats/year-summary');
    expect(body()).toEqual({ year: '2026' });
    await api.getYearSummary(2026);
    expect(body()).toEqual({ year: 2026 });
  });

  it('year-summary defaults to the current year', async () => {
    await api.getYearSummary();
    expect(body().year).toBe(String(new Date().getFullYear()));
  });
});

describe('no second fetch layer', () => {
  it('every exported function is a function (the pages import * as api)', async () => {
    const names = Object.keys(api);
    expect(names.length).toBeGreaterThan(20);
    expect(names.every((n) => typeof api[n] === 'function')).toBe(true);
  });

  it('the API base is a single prefix, so pages never hardcode a host', async () => {
    await api.getCategories();
    await api.getTransactionsAll();
    expect(url().startsWith('/api/')).toBe(true);
    expect(calls.every(([u]) => u.startsWith('/api/'))).toBe(true);
  });
});

describe('partial PUT and the error message language', () => {
  it('updateTransaction sends only the keys the caller passed', async () => {
    // The backend PUT is a partial update. The old implementation built the full payload, so a
    // partial call sent category_id: Number(undefined) = NaN → JSON null → backend 400.
    await api.updateTransaction(7, { amount: 12.5 });
    const sent = body();
    expect(sent).toEqual({ amount: 12.5 });
    expect('category_id' in sent).toBe(false);
    expect('date' in sent).toBe(false);
    expect(sent.amount).not.toBeNaN();
  });

  it('a full edit still sends every field', async () => {
    await api.updateTransaction(7, {
      category_id: 3, date: '2026-06-01', amount: 10, type: 'Przychod', description: 'x', tags: ['a'],
    });
    expect(body()).toEqual({
      category_id: 3, date: '2026-06-01', amount: 10, type: 'Przychod', description: 'x', tags: ['a'],
    });
  });

  it('camelCase categoryId is accepted alongside snake_case', async () => {
    await api.updateTransaction(7, { categoryId: 5 });
    expect(body()).toEqual({ category_id: 5 });
  });

  it('the fallback error message is Polish, not English', async () => {
    // The backend answers Polish (AGENTS.md §6.3) and pages toast err.message verbatim, so a
    // body without data.error must not surface an English string in a Polish UI.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, o) => {
      calls.push([u, o]);
      return respond({}, 400);
    });
    await expect(api.createCategory({ name: 'X' })).rejects.toThrow('Coś poszło nie tak — sprawdź połączenie z serwerem');
  });

  it('the backend message is surfaced verbatim when there is one', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, o) => {
      calls.push([u, o]);
      return respond({ error: 'Kwota musi być większa od zera' }, 400);
    });
    await expect(api.addTransaction({ category_id: 1, date: '2026-06-01', amount: 0 })).rejects.toThrow('Kwota musi być większa od zera');
  });
});

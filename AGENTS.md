# AGENTS.md — budget-planner ("Planowanie Wydatków")

Operating manual for AI agents (and humans) working in this repository.
Read this file **before** making changes. Sections marked ⚠️ contain traps that will
silently break the app if ignored.

---

## 1. Project overview

`budget-planner` is a personal household budget planner. The user-facing language is
**Polish** (UI labels, routes, month names, seeded category names). It consists of two
applications in one monorepo:

| App | Stack | Port | Purpose |
|---|---|---|---|
| `backend/` | Python 3.14, Flask, PyJWT, flask-cors, SQLite | **3001** | REST API + data storage |
| `frontend/` | React 19, Vite 8, Tailwind CSS 4, recharts 3, react-router-dom 7 | **5173** (dev) | SPA |

Multi-user: every user gets their own categories, budgets and transactions. Auth is
stateless JWT (HS256, 24 h expiry). There **is** a test suite (314 backend + 347 frontend),
**a CI pipeline** (`.github/workflows/ci.yml`, gating PRs and pushes to `main`) and
**`backend/requirements.txt`** — see §8 for how changes are verified.

---

## 2. Repository layout

```
budget-planner/
├── AGENTS.md                  ← you are here
├── README.md                  ← one line only; this file is the real doc
├── pytest.ini                 ← testpaths = backend/tests, -q --disable-warnings
├── dev.sh                     ← starts backend + frontend in one shot
├── AUDIT.md / todo.md         ← the audit report + the deferred items
├── .github/workflows/ci.yml   ← the CI pipeline (§8): backend, frontend, the "CI summary" gate
├── backend/
│   ├── App.py                 ← ALL Flask routes + seeding logic (~1300 lines). Entry point.
│   ├── database.py            ← SQLite schema (SCHEMA list) + get_connection() factory
│   ├── requirements.txt       ← Flask / PyJWT / flask-cors / pytest
│   ├── __init__.py            ← empty
│   ├── tests/                 ← pytest suite (conftest.py sets DATABASE_PATH before App import)
│   └── data/baza.db           ← SQLite DB (gitignored; auto-created on first run)
└── frontend/
    ├── index.html             ← contains anti-FOUC dark-mode script — keep in sync with ThemeContext
    ├── vite.config.js         ← dev server :5173, proxies /api → 127.0.0.1:3001
    ├── vercel.json            ← SPA rewrite for production deploy
    ├── eslint.config.js       ← ESLint flat config (react-hooks, react-refresh)
    ├── package.json           ← scripts: dev / build / lint / preview / deploy(gh-pages)
    └── src/
        ├── main.jsx           ← React root, StrictMode
        ├── App.jsx            ← router: lazy routes + ProtectedRoute/UnprotectedRoute
        ├── api.js             ← ⚠️ the ONLY place HTTP happens. Never fetch() in pages.
        ├── AuthContext.js     ← context + useAuth() hook ONLY (no JSX) — see §7.5
        ├── AuthProvider.jsx   ← user/token state, login/logout/adoptSession/clearSession
        ├── ThemeContext.js    ← context + useTheme() hook ONLY (no JSX) — see §7.5
        ├── ThemeProvider.jsx  ← dark/light, .dark class on <html>
        ├── index.css          ← Tailwind v4 entry + animation utilities (.page-enter, .stagger-children, …)
        ├── components/
        │   ├── Layout.jsx     ← top nav (navItems array = the app's menu)
        │   ├── AddExpenseModal.jsx
        │   ├── AddBudgetModal.jsx
        │   ├── ToastContext.js← useToast() hook + context (NO component — see §7.5)
        │   ├── ToastProvider.jsx ← toast/confirm UI, wraps <AppRoutes/> in App.jsx
        │   └── SessionExpiredToast.jsx
        ├── hooks/
        │   └── animation.js   ← useAnimatedValue() / useCountUp()
        ├── utils/
        │   ├── date.js        ← currentMonthStr() / currentYear() / monthLabel() / MONTH_NAMES
        │   └── money.js       ← formatMoney() — the single PLN formatter
        ├── test/                ← renderWithProviders() harness + setup.js (matchMedia, localStorage)
        │   ⚠️ tests are colocated with the code they test: utils/date.test.js,
        │   components/AddBudgetModal.test.jsx, pages/Budgets.test.jsx, …
        └── pages/             ← one file per route, all lazy-loaded
            ├── LoginPage.jsx  RegisterPage.jsx
            ├── Dashboard.jsx  ExpensesView.jsx  CategoriesView.jsx
            ├── Budgets.jsx    Tags.jsx  YearOverview.jsx
```

---

## 3. Getting started (development)

### Backend (port 3001)

```bash
# Install the manifest (backend/requirements.txt exists — §9.7):
pip install -r backend/requirements.txt

# Run from the repo root or backend/ (App.py imports `database` as a top-level module):
python backend/App.py
# → http://127.0.0.1:3001  (debug is OFF by default — §9.6; single process, dev only)
```

Optional env for `App.py` (all have safe dev defaults, so a fresh clone runs with none of them):

| Var | Effect |
|---|---|
| `SECRET_KEY` | JWT signing key. Unset → a 64-char value is generated once and persisted to `backend/data/.jwt_secret` (mode 0600, gitignored) so tokens survive a restart (§9.5). **Set it in any real deployment.** |
| `ALLOWED_ORIGINS` | comma-separated CORS origins. Default `http://localhost:5173,http://127.0.0.1:5173`. The dev SPA reaches the API through the Vite proxy, i.e. same-origin, so it needs no CORS at all; in production set the deployed frontend's origin. An unknown origin is never echoed. |
| `LOGIN_LIMIT` / `REGISTER_LIMIT` / `LOGIN_WINDOW_S` | the login/register throttle per `(ip, username)`; `0` disables it (the test suite disables it in `conftest.py`). |
| `DATABASE_PATH` | redirects the DB file; `conftest.py` sets it **before** importing App, which is what makes the module-level `init_db()` safe (§3). |
| `FLASK_DEBUG=1` | opt-in dev debugger (§9.6). |

⚠️ **Importing `App.py` has side effects.** `init_db()` is called at module level (end of
`App.py`): it creates the DB file, ensures the demo user exists, and seeds data. Do not
`import App` casually from scripts or tests — you will create/modify `backend/data/baza.db`.

**Demo account:** `admin` / `admin123` (created on first run; seeded with 10 default
categories and ~12 months of dummy budgets + transactions).

**Reset demo data:** stop the backend, delete `backend/data/baza.db`, restart. The DB is
gitignored — deleting it is safe and lossless for dev.

### Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, /api proxied to 127.0.0.1:3001
npm run lint       # eslint
npm run build      # outputs to dist/ (gitignored)
```

- Dev proxy (`vite.config.js`): `/api` → `http://127.0.0.1:3001`. No env file needed in dev.
- Production: API base comes from `VITE_API_URL` (`frontend/src/api.js`:
  `API_BASE = ${VITE_API_URL || ''}/api`).

---

## 4. Architecture

```
┌──────────────┐   /api (dev proxy)    ┌─────────────────────────┐      ┌────────────────┐
│ React SPA    │ ────────────────────► │ Flask app (:3001)       │ ───► │ SQLite          │
│ :5173        │  Bearer JWT in header │ require_auth decorator  │      │ data/baza.db   │
└──────────────┘                       │ g.current_user_id per   │      │ Users/Categories│
                                       │ request                 │      │ Budgets/Trans.  │
                                       └─────────────────────────┘      └────────────────┘
```

Auth flow:

1. `POST /api/auth/login` → `{ token, username }`. Token stored in `localStorage` under
   keys `token` and `user` (see `api.js` + `AuthContext.jsx`).
2. Every API call sends `Authorization: Bearer <jwt>`.
3. `require_auth` (in `App.py`) decodes the JWT, puts `user_id`/`username` on Flask's `g`,
   returns 401 otherwise.
4. **Row-level isolation is manual**: every query must include
   `user_id = g.current_user_id`. There are no DB-level grants; forgetting the filter
   leaks data across users.
5. **Registration auto-logs-in:** `POST /api/auth/register` returns a token and `api.register()`
   stores it (the user is already authenticated). `RegisterPage` then calls `adoptSession()`
   (sync, no network — reads the just-stored localStorage) and navigates to `/dashboard`.
   Don't show an intermediate "go log in" screen.

---

## 5. Data model & format contracts

Schema lives in `SCHEMA` in `backend/database.py` (applied idempotently at startup).

| Table | Key columns | Notes |
|---|---|---|
| `Users` | `username UNIQUE`, `password_hash` | werkzeug password hashing |
| `Categories` | `name`, `color`, `icon`, `default_order`, `active`, `user_id` | per-user; duplicate name rejected in code (409), not by schema |
| `Budgets` | `category_id`, `amount_monthly ≥ 0`, `month_year TEXT`, `user_id` | `UNIQUE(category_id, month_year, user_id)` — upsert on conflict |
| `Transactions` | `user_id`, `category_id`, `date DATE`, `amount > 0`, `type`, `description`, `tags TEXT`, `created_at` | FKs are `ON DELETE SET NULL`; `PRAGMA foreign_keys=ON` per connection |

### ⚠️ Format contracts (breaking these breaks data, not just a page)

- **Month string:** `"YYYY-MM"` (e.g. `"2025-07"`) — used in `Budgets.month_year`,
  query params and JSON bodies everywhere.
- **Date string:** `"YYYY-MM-DD"` for `Transactions.date`.
- **⚠️ Transaction type is case-sensitive and inconsistent on purpose-in-practice:**
  valid values are exactly `'wydatek'` (lowercase) and `'Przychod'` (**capital P**).
  Enforced by a SQL `CHECK(type IN ('wydatek','Przychod'))`. The frontend sends both
  (`AddExpenseModal.jsx` options: `value="wydatek"` / `value="Przychod"`). **Do not "fix"
  the casing of `Przychod`** without a coordinated migration of DB data + backend CHECK +
  all SQL `type='...'` filters + frontend. All spending aggregates filter on
  `type='wydatek'`.
- **Tags:** stored as a JSON array string in `Transactions.tags` (e.g. `'["dom","zakupy"]'`).
  Backend parses to list on read; `/api/tags/all` uses SQLite `json_each()`. Always send an
  array (or JSON string) — never comma-separated text.
- **Money:** plain `REAL`, PLN implied, no currency column. Amounts must be > 0 for
  transactions, ≥ 0 for budgets. Round to 2 decimals on the backend.
- **Category colors:** hex strings (`#e74c3c`); icons: single emoji.
- ⚠️ **The write boundary is the only place these formats are enforced.** The helpers at the top
  of `App.py` (`parse_amount`, `as_text`, `normalize_month`, `normalize_active`,
  `normalize_order`, `normalize_tags`, `normalize_color`) reject everything that does not fit,
  answer 400 in Polish, and let nothing reach a column un-normalised. Concretely:
  `month_year` is normalised to `YYYY-MM` on POST `/api/budgets` (it used to be inserted
  verbatim, so rows keyed `2026-13` / `abc` / `2026-5` existed and no month view could match
  them); `active` and `default_order` are coerced to 1/0 and int (a string like `"abc"` used to
  land as TEXT in an INTEGER column, which hid the category from `/api/categories/active`);
  amounts must be **finite** (`1e999` was stored as Infinity, which Flask emits as the bare
  word `Infinity` — invalid JSON, so `api.js` threw on `response.json()` and the page died, and
  NaN hit the CHECK/NOT NULL constraint as an unhandled IntegrityError → 500);
  `description`/`icon`/`name`/tag names must be strings within their caps (a `dict` reached the
  DBAPI → `ProgrammingError` → 500). `description` and `tags` stay optional (`description?`).
  If you add a field, extend the boundary — do not validate inside the route body.

---

## 6. Backend guide (`backend/App.py`)

### 6.1 Structure of a route (house style)

```python
@app.route("/api/...", methods=["POST"])
@require_auth
def my_endpoint():
    data = request.get_json(silent=True) or {}
    # validate → return jsonify({"error": ...}), 400
    conn = get_connection()
    try:
        # queries ALWAYS filtered by g.current_user_id
        conn.execute(...)
        conn.commit()          # explicit commit after writes
        return jsonify(...), 201
    except sqlite3.IntegrityError:
        conn.rollback()
        return jsonify({"error": "..."}), 409
    finally:
        conn.close()           # one connection per request, always closed
```

Conventions to keep:
- One `get_connection()` per request; `try/finally: conn.close()`.
- Explicit `conn.commit()` after writes; `rollback()` on error paths.
- Errors are JSON: `{"error": "..."}` with an appropriate status code.
- Row → dict conversion inline (`hasattr(v, "isoformat")` for dates).

### 6.2 Endpoint reference

Auth (no token needed except where noted):

| Method & path | Body / params | Returns |
|---|---|---|
| `POST /api/auth/register` | `{username, password, confirmPassword}` (min 4 chars) | 201 `{token, username}`; seeds the user's default categories |
| `POST /api/auth/login` | `{username, password}` | `{token, username}` |
| `DELETE\|POST /api/auth/logout` | — | no-op `{success:true}` (JWT is stateless) |
| `GET /api/auth/status` 🔒 | — | `{authenticated, username}` — called by `AuthContext` on startup to drop a stale JWT before the first page renders |

🔒 = requires `Authorization: Bearer`.

Categories:

| Method & path | Notes |
|---|---|
| `GET /api/categories?active=` 🔒 | `active=true\|false\|-1` (omit or `-1` = no filter) |
| `GET /api/categories/active` 🔒 | only `active=1`, ordered by `default_order` — `api.getCategories(true)` calls this |
| `POST /api/categories` 🔒 | `{name, color?, icon?}` → 201; duplicate name for user → 409 |
| `PUT /api/categories/<id>` 🔒 | partial: any of `name,color,icon,default_order,active` |
| `DELETE /api/categories/<id>` 🔒 | cascades to the user's transactions **and budgets** (see bug §9.2). **404** when the id is not owned (audit P1-47 — it used to answer a false 200) |

Budgets:

| Method & path | Notes |
|---|---|
| `POST /api/budgets/by-month-post` 🔒 | `{month}` → LEFT JOIN: all active categories + `wydatki`, `saldo`, `status` (`in_budget`\|`over_budget`). The only budgets-view endpoint — the copy-paste GET twin `GET /api/budgets/by-month` and the unused `GET /api/budgets?month=` were removed (audit P0-25); `GET /api/budgets` with GET now returns **405** |
| `POST /api/budgets` 🔒 | `{category_id, amount_monthly, month_year}` → 201; UNIQUE conflict → upsert → 200 |
| `PUT /api/budgets/<id>` 🔒 | `{amount}` or `{amount_monthly}` (≥ 0) |
| `DELETE /api/budgets/<id>` 🔒 | added in audit P1-48 (the route did not exist → 405). 404 when the row is not owned; `api.deleteBudget` + the trash button in `Budgets.jsx` |

Transactions:

| Method & path | Notes |
|---|---|
| `GET /api/transactions?month=&category=&keyword=` 🔒 | ⚠️ **defaults to the current month** when `month` omitted; **`month=all` = the user's whole history** (used by `Tags.jsx`); keyword searches description AND tags; `tags` returned as parsed array |
| `POST /api/transactions` 🔒 | `{type, amount>0, date, category_id, description?, tags?[]}` → 201 full row |
| `PUT /api/transactions/<id>` 🔒 | partial update of any of `type,amount,date,category_id,description,tags` — driven by the edit button in `ExpensesView` (audit P0-26) |
| `DELETE /api/transactions/<id>` 🔒 | |

Tags & stats:

| Method & path | Notes |
|---|---|
| `GET /api/tags/all` 🔒 | distinct tags via `json_each(Transactions.tags)`; Python fallback for rows whose `tags` is not valid JSON (audit P0-12) |
| `DELETE /api/tags/<tag>` 🔒 | removes the tag from **every** transaction of the user → `{removed_from: n}` |
| `PUT /api/tags/<tag>` 🔒 | `{new_name}` → renames across the whole history, deduplicating within a row → `{renamed_in: n}`; missing `new_name` → 400 |
| `POST /api/stats/dashboard-data` 🔒 | `{month}` (optional — defaults to the current month) → dashboard KPIs, chart data, 13-month history |
| `POST /api/stats/year-summary` 🔒 | `{year}` → yearly totals, monthly breakdown (Polish month names), category variance |

### 6.3 ⚠️ Status-code inconsistencies (do not "normalize" unilaterally)

- `PUT /api/budgets/<id>` returns **401** (not 404) when the budget isn't found/owned.
- `PUT`/`DELETE /api/transactions/<id>` return **403** for missing rows.
- The frontend only treats non-ok as generic errors (`api.js` throws on `!response.ok`,
  special-casing 401), so these codes are safe to have — but if you change them, check the
  frontend first.
- New routes use the conventional codes: `DELETE /api/categories/<id>` and
  `DELETE /api/budgets/<id>` both answer **404**. Do not "fix" the two legacy codes above
  without checking `api.js`.
- **413** (oversized body) and **429** (login/register throttle) are also JSON: `MAX_CONTENT_LENGTH`
  is 128 kB with a Polish 413 handler, and the throttle answers
  `Zbyt wiele prób. Spróbuj później.` per `(ip, username)`. The knobs are `LOGIN_LIMIT`,
  `REGISTER_LIMIT`, `LOGIN_WINDOW_S` (0 disables); `conftest.py` disables them because the
  fixtures create a fresh user per test from one IP.
- **All validation messages are Polish** (audit P1-46): `api.js` throws `data.error` and pages
  show it via `toastError(err.message)`, so a new message must be written in Polish.

---

## 7. Frontend guide (`frontend/`)

### 7.1 Routing & pages

Routes are defined in `src/App.jsx` (all lazy-loaded via `React.lazy` + `<Suspense>`):

| Path | Page file | Access |
|---|---|---|
| `/login`, `/rejestracja` | LoginPage, RegisterPage | public (redirect to `/dashboard` if logged in) |
| `/dashboard` | Dashboard.jsx | protected |
| `/wydatki` | ExpensesView.jsx | protected |
| `/kategorie` | CategoriesView.jsx | protected |
| `/budzety` | Budgets.jsx | protected |
| `/tags` | Tags.jsx | protected |
| `/year` | YearOverview.jsx | protected |

Route paths are **Polish and part of the contract** — don't rename them without updating
`App.jsx`, `Layout.jsx` (`navItems`) and any deep links. The app menu is the single
`navItems` array in `components/Layout.jsx`.

**Deep links (query params):**
- `/wydatki?kategoria=<categoryId>&miesiac=YYYY-MM` — opens ExpensesView with that category
  pre-selected and the given month loaded. Set by clicking a donut segment or a category row on
  the Dashboard (which also sends the month currently shown there). `ExpensesView` reads both via
  `useSearchParams`; the effective filter is *derived* (user's dropdown choice wins, else the
  param; an unknown/invalid id falls back to "all"). Keep the param names `kategoria`/`miesiac`
  if you extend this pattern.

### 7.2 API access rules

- **All HTTP goes through `src/api.js`.** Pages import `* as api` and call named functions.
  Do not add raw `fetch`/`axios` calls in components.
- `api.js` normalizes auth headers and error throwing (401 → `Error('Unauthorized')`,
  otherwise throws `data.error`).
- ⚠️ Legacy quirk: several `api.js` functions accept **both** camelCase and snake_case keys
  (`data.categoryId || data.category_id`, `data.amount_monthly || data.budzet`). New code
  should send snake_case (matching the API), but don't remove the fallbacks — older pages
  rely on them.
- `getTransactionsAll()` calls `GET /api/transactions?month=all` and returns the user's
  **whole** history (used by `Tags.jsx`, which must see tags from past months). To fetch a
  *specific* month use `getTransactions(monthStr)` (sends `?month=YYYY-MM`).
  Month-scoped pages (ExpensesView) must pass the selected month, not call `getTransactionsAll()`.
- **Session-expiry flow (401):** `_fetch` treats a 401 on an *authenticated* request as an
  expired session — it clears `token`/`user` from localStorage and calls the handler registered
  via `setSessionExpiredHandler()` (wired in `App.jsx` → `clearSession()` + redirect to `/login`
  with `state.sessionExpired`, shown as a toast by `LoginPage` + `SessionExpiredToast`).
  Login/register send **no** auth header, so their 401s (bad credentials) never trigger it.
  Keep that separation when adding endpoints; don't throw 'Unauthorized' handling elsewhere.

### 7.3 Theming & styling

- Tailwind CSS **v4** (no `tailwind.config.js`): entry is `src/index.css` with
  `@import "tailwindcss"` and `@custom-variant dark (&:is(.dark *));`. Dark mode = `.dark`
  class on `<html>`, toggled by `ThemeContext.jsx`, persisted in `localStorage.theme`,
  initialized by an inline anti-FOUC script in **`index.html`** (keep both in sync).
- **Every new UI element needs `dark:` variants** — the app is dark-mode-first-class.
  Reference surfaces: light `bg-white / text-gray-900`, dark `dark:bg-slate-800/900 /
  dark:text-slate-100/300`.
- Brand color is green **`#32a852`** (hover `#1f8c42`). It's used as arbitrary values
  (`text-[#32a852]`, `bg-[#32a852]`) rather than a Tailwind theme token — follow suit for
  consistency.
- Status colors: over budget = red, warning (≥80%) = amber, ok = green gradient
  (see `getBarStatus` in `pages/Budgets.jsx`).
- Charts: **recharts** (`PieChart`, `BarChart`, …) — see Dashboard/YearOverview for patterns.

### 7.4 Language & state

- All user-visible strings are **Polish** (nav, buttons, month names, validation messages).
  Keep new UI text in Polish. The `MONTH_NAMES` array (`Styczeń…Grudzień`) lives **only** in
  `utils/date.js`; use `monthLabel("YYYY-MM")` → `"Wrzesień 2026"` instead of re-deriving it
  per page. The backend mirrors the same list as `MONTH_NAMES_PL` in `App.py`.
  ⚠️ Two known leaks of non-Polish text: (a) `dashboard_data` builds `monthly_history` labels
  with `calendar.month_name` → the Dashboard history chart renders `"October 26"` while the
  cards around it say `"Październik"`; (b) backend validation messages are English
  (`"Color must be a hex value like #e74c3c"`) and `api.js` surfaces them verbatim through
  `toastError(err.message)`. Fix both in the backend, not by patching pages.
- No global state library. Auth: `AuthContext`; theme: `ThemeContext`; everything else is
  local `useState`/`useEffect` per page with a `loading` flag and a `load*()` async function
  in a `useEffect` keyed on the month/year filter (see `Budgets.jsx`, `Dashboard.jsx`).
- Legacy duplication to be aware of: `Dashboard.jsx` defines its own local `useDark()` hook
  (system media query) instead of using `ThemeContext` — it drives one text colour in
  `CategoryRow`, so a manual theme toggle in `Layout` does not reach it. Don't copy that
  pattern into new pages.

### 7.5 Toasts, confirm dialogs & animations (shared infra)

- **Toasts / confirm:** use `useToast()` from `components/ToastContext.js` — returns
  `{ success, error, confirm }`. Backed by `<ToastProvider>` (in `App.jsx`, wraps the routes).
  - `success(msg)` / `error(msg)` push an auto-dismissing toast (top-right stack, max 4,
    ~3.5 s). `confirm(message, { title?, confirmLabel?, cancelLabel?, danger? })` returns a
    `Promise<boolean>` — resolves `true` on confirm, `false` on cancel/Escape. `danger`
    defaults to `true` (red button); pass `{ danger: false }` for neutral/green confirms.
  - ⚠️ `ToastContext.js` exports **only** the context + hook (no JSX). The provider component
    lives in `ToastProvider.jsx`. Keep them split — merging them re-triggers the
    `react-refresh/only-export-components` ESLint error. Do not reintroduce native
    `alert()`/`confirm()`; route every user notification through `useToast()`.
  - **The same split applies to Auth and Theme**: `AuthContext.js` / `AuthProvider.jsx` and
    `ThemeContext.js` / `ThemeProvider.jsx`. Import the hook from the `.js` file and the
    provider from the `.jsx` file (`App.jsx` does exactly this). Adding a component to a
    `.js` context file re-breaks fast refresh.
- **Animation utilities** (defined in `index.css`, respect `prefers-reduced-motion`):
  - `.page-enter` — fade/slide-in for a page's main content block. Pair with a `key={monthStr}`
    (or year) so it re-animates on filter change.
  - `.stagger-children` — applies incremental `animation-delay` to direct children (use on
    stat-card grids). Children get the fade-in; no per-child classes needed.
  - `.modal-panel-in` / `.backdrop-in` — modal entrance (used by the Add* modals).
- **Value animations** (`hooks/animation.js`):
  - `useCountUp(target, duration?)` — animates a number from its previous value to `target`
    (ease-out). Non-numeric values pass through unchanged. Use for stat-card figures.
  - `useAnimatedValue(target)` — returns a width-% that starts at 0 and transitions to
    `target`; use for progress bars so they fill on mount. The consuming element must carry its
    own `transition-all`/`transition-[width]`.
- **Loading pattern (no-flicker):** pages keep a `hasLoaded` flag alongside `loading`. Show the
  spinner only while `loading && !hasLoaded`; once data has loaded at least once, re-fetches
  dim the existing content (`opacity-50 pointer-events-none`) instead of unmounting it.
- **Date helpers** (`utils/date.js`): `currentMonthStr()` → local `"YYYY-MM"`, `currentYear()`,
  `localDateStr()` → `"YYYY-MM-DD"`, `MONTH_NAMES` + `monthLabel("YYYY-MM")` → `"Wrzesień 2026"`.
  Always use these for "today/this month" defaults — never `new Date().toISOString()` (UTC
  can shift the month). Month nav pages also expose a “Dziś” / “Ten rok” shortcut button.
- **Money formatting** (`utils/money.js`): `formatMoney(v)` is the single PLN formatter
  (`pl-PL`, 2 decimals, `zł` suffix). It passes through already-formatted strings and returns
  `String(v)` for non-finite input, so `NaN` never reaches the DOM. Do not add a per-page
  `fmtMoney`/`formatMoney` copy — three divergent copies were removed in audit P1-30.

---

## 8. Verification workflow

There **is a CI pipeline** (`.github/workflows/ci.yml`): two jobs behind one required check,
**`CI summary`** (the check name is the job name — `CI summary`, not `CI / summary`).

- **backend** — `setup-python` 3.14, `pip install -r backend/requirements.txt`, `pytest backend/tests`.
- **frontend** — Node 22, `npm ci`, `eslint .`, `npm test -- --retry=1`, `npm run build`, uploads `frontend/dist` as an artefact.
- **summary** — `needs: [backend, frontend]` + `if: always()`, so the aggregate check always reports; it is the name to require in branch protection.
- Fires on `pull_request` and `push` to `main`, plus `workflow_dispatch`. `permissions: contents: read`, `concurrency.cancel-in-progress`, job timeouts 10/15 min.

`main` **is protected**: required status check `CI summary` (strict — the PR must be current
with `main`), `enforce_admins` is **on**, force-push and branch deletion are off, 0 approving
reviews required, stale reviews dismissed. So **a direct `git push` to `main` is blocked**
(also for the owner) and a PR merges only when the check is green — work goes through a
`feature/*` branch + PR (§11).

The suite (added after the second audit round): **314 backend + 347 frontend tests, all
green.** A green run is the pre-existing state — if a change breaks one, fix the code, not the
assertion.

```bash
python -m pytest backend/tests            # backend: Flask test client + isolated temp DB
python -m pytest backend/tests -v         # per-case output
cd frontend && npm test                   # Vitest + Testing Library (jsdom)
cd frontend && npm test -- --run          # single run (no watch)
```

- `backend/tests/conftest.py` sets `DATABASE_PATH` to a per-session temp file **before**
  importing `App.py`, which is what makes the module-level `init_db()` side effect (§3) safe.
  Never import `App` outside that harness.
- Frontend tests live next to the code they test (`src/utils/date.test.js`,
  `src/components/AddBudgetModal.test.jsx`, …). Vitest reuses **`vite.config.js`** (its `test`
  block sets `environment: 'jsdom'`, `globals: true`, `setupFiles`), so the JSX transform and
  the Tailwind plugin are identical to the dev/build pipeline. `src/test/setup.js` pins
  `NODE_ENV=test`, stubs `matchMedia` and clears `localStorage` between tests.
- ⚠️ **Animation assertions must be deterministic — use fake timers.** `src/test/setup.js`
  re-implements `requestAnimationFrame`/`cancelAnimationFrame` on top of the timer set that
  vitest fakes (16 ms per frame, stamp from `Date.now()`), because jsdom's own rAF is driven by
  jsdom's event loop, which `vi.useFakeTimers()` does not control, and because a loaded shared
  CI runner fires rAF far slower than 16 ms. The pattern is:
  ```js
  vi.useFakeTimers();
  renderWithProviders(<Budgets />);
  await settle();            // from src/test/renderPage.jsx
  expect(screen.getByText('700,00 zł')).toBeInTheDocument();
  ```
  `settle()` loops `runAllTimersAsync` until the timer queue is empty — **more than one pass is
  required**: the mocked `api.js` promise resolves as a microtask after the first pass has
  drained, so the count-up for the loaded data starts only on the second. End every such file
  with `afterEach(() => vi.useRealTimers())`. Do not assert animated values with
  `findByText(..., { timeout: 2000 })` — that is the shape of the CI failure (6 animation
  assertions failed twice on the runner, and reproduce locally when 4 vitest runs compete for
  CPU).
- `npm run lint` is clean for `src/` and for `eslint .` (`dist`/`dist_probe` are ignored).

For changes the suite does not cover, verify manually in this order:

1. **Backend change:**
   ```bash
   python backend/App.py &                      # start :3001
   TOKEN=$(curl -s -X POST localhost:3001/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

   curl -s localhost:3001/api/categories -H "Authorization: Bearer $TOKEN"
   curl -s -X POST localhost:3001/api/transactions -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"type":"wydatek","amount":42.5,"date":"2025-07-15","category_id":1,"description":"test"}'
   curl -s -X POST localhost:3001/api/stats/dashboard-data -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"month":"2025-07"}'
   ```
2. **Frontend change:** `cd frontend && npm run lint && npm run build`, then exercise the
   page in `npm run dev` (backend must be running for real data).
3. **DB sanity:** `sqlite3 backend/data/baza.db "SELECT * FROM Transactions ORDER BY id DESC LIMIT 5;"`
4. After manual tests, delete test rows or reset the DB (§3) so demo data stays clean.
5. Keep the suites honest: a new endpoint gets a `backend/tests/` case, a new page component
   gets a `frontend` case. If you fix a bug, add the failing case first (the AddBudgetModal TDZ
   crash is the example — `npm run build` and lint both passed while the modal was dead).

---

## 9. Known issues & tech debt (⚠️ read before touching nearby code)

1. ~~`POST /api/stats/dashboard-data` 500s if `month` is omitted~~ **fixed**: the month is
   normalised up front, so omitting `month` defaults to the current month and returns 200.
2. ~~`DELETE /api/categories/<id>` deletes Budgets rows for ALL users~~ **fixed**: the budget
   delete is scoped by `user_id`, and `Budgets.category_id` is `ON DELETE CASCADE` (§5/§9.8),
   so a category delete cascades only within the owning user.
3. ~~`backend/seed.py` is stale~~ **deleted**: it hardcoded `2025-07`, used different category
   names (`"Nośność / Miejsce zamieszkania"` vs the actual `"Mieszkanie"`) and was never called
   by `App.py`. The *only* seeder is `init_db()` + `_seed_categories_for_user()` +
   `seed_dummy_data()` inside `App.py`. If a standalone seeder is ever needed, build it from
   `App.py`, not from git history.
4. ~~Duplicate `by-month` endpoints~~ **fixed**: `GET /api/budgets/by-month` and
   `GET /api/budgets?month=` (both with no frontend caller) were removed; the single
   implementation is `_budgets_view()` behind `POST /api/budgets/by-month-post`. Also removed
   as caller-less: `GET /api/transactions/recent` and `POST /api/stats/month-summary`.
   `GET /api/categories/active` and `GET /api/auth/status` now have callers.
5. ~~**Weak default JWT secret**~~ **fixed**: the fallback was the literal
   `"planowanie-wydatkow-jwt"` — a value every clone of the repo knows, and 23 bytes, which
   PyJWT flags (`InsecureKeyLengthWarning`, RFC 7518 wants ≥ 32 for HS256). It was
   exploitable: `pyjwt.encode({"user_id": 1, "username": "admin"}, "planowanie-wydatkow-jwt",
   "HS256")` was accepted and `GET /api/auth/status` answered 200 as admin. The secret now
   comes from `SECRET_KEY`, or from a generated 64-char value persisted to
   `backend/data/.jwt_secret` (mode 0600, gitignored) so tokens survive a restart — a
   random-per-process secret would bounce the SPA to /login on every boot. `conftest.py` sets
   `SECRET_KEY` before importing App (same reason as `DATABASE_PATH`).
6. ~~`app.run(debug=True)`~~ **fixed**: debug is off by default; set `FLASK_DEBUG=1` to enable
   it for dev. Unhandled exceptions return JSON `{"error":"Internal server error"}` (500).
7. ~~**No backend dependency manifest.**~~ **fixed**: `backend/requirements.txt` lists
   `Flask`, `PyJWT`, `flask-cors` (runtime) and `pytest` (tests). werkzeug ships with Flask.
   `pip install -r backend/requirements.txt` reproduces the environment.
8. **Deploy config is contradictory, and the deployed app cannot load data.** `package.json`
   has a `deploy: gh-pages -d dist` script *and* there's a `vercel.json` SPA rewrite. Vercel is
   the live target — measured: `budget-planner-skr4p.vercel.app` answers `/`, `/budzety`,
   `/year` and `/wydatki` all **200**, so the catch-all rewrite is applied and the deep links
   work. Three measured facts about what is live:
   - `VITE_API_URL` is set nowhere (no `.env*` is committed, and `api.js` defaults `API_BASE` to
     `''` = same-origin `/api`). Vercel serves the static SPA only, so **there is no backend
     behind the deployed app**.
   - The catch-all rewrite swallows `GET /api/*` too: `GET /api/auth/status` on production
     returned **200 with `text/html`, 331 KB — index.html**. `api.js` calls `response.json()` on
     HTML → `SyntaxError`, so the user sees the generic Polish toast and the app never loads
     data. Excluding `^/api/` from the rewrite would make it a clean 404; that needs a verified
     deploy, so it is not done here.
   - The deployment sits behind **Vercel deployment protection**: `POST
     /api/stats/dashboard-data` answered **401 "Protected deployment"**, so the live site is
     readable only by workspace members.
   Fixing this needs a backend host plus `VITE_API_URL` at build time; do not remove the
   gh-pages script or `vercel.json` without confirming which target is real. The hypothesis that
   `vercel.json` is inert because it sits in `frontend/` and not the repo root is **false**: the
   200s above prove it is read, so the deploy root is `frontend/`.
9. **`README.md` is one line.** This file (AGENTS.md) is the de-facto documentation —
   keep it updated when contracts change.
10. ~~**Nested `<button>` in `Tags.jsx`**~~ **fixed** (P1-52): the row is a `<div>`, the label
    is its own `<button>` and rename/delete are siblings, so the invalid button-in-button
    nesting and the React warning are gone. The "**Still open**" claim here was stale — the
    page was restructured in the P1-52 pass.
11. **Lint baseline is clean for `src/`.** `npx eslint src/` reports 0 problems (the
    react-hooks `set-state-in-effect`, `exhaustive-deps`, `no-empty`, `no-extra-boolean-cast`
    and dead-variable findings from the audit pass were cleared, and `no-empty` is configured
    with `allowEmptyCatch` for the documented best-effort catches). `npm run lint` (`eslint .`)
    also stays clean because `dist` and `dist_probe` are in `globalIgnores`. If you add a
    jsdom probe harness, keep its build output out of the lint graph and declare `jsdom` in
    `package.json` — an undeclared dep in `node_modules` disappears on `npm ci`.
12. ~~`DELETE /api/categories/<id>` returns 200 for a foreign id~~ **fixed** (audit P1-47):
    ownership is checked, so it answers 404 like `PUT` on the same path.
13. ~~No budget delete~~ **fixed** (audit P1-48): `DELETE /api/budgets/<id>` +
    `api.deleteBudget` + a trash button in `Budgets.jsx` (guarded by `confirm()`). The button is
    a sibling of the `limit > 0` ternary, so a zero-limit budget row is deletable too.

---

## 10. Task recipes

### Add a new API endpoint
1. Add the route in `backend/App.py` following §6.1 house style (`@require_auth`,
   `get_connection()`, user-scoped query, explicit commit, `finally: conn.close()`).
2. Validate input up front; return JSON errors with proper status codes — **in Polish** (§6.3).
3. Add a matching function to `frontend/src/api.js` (snake_case body keys) and use it from
   the page — never fetch directly.
4. Add a case to `backend/tests/` (auth, user isolation, the happy path, and the 400/404 path).
5. Verify with `python -m pytest backend/tests`, then in the dev server.

### Add a new page/route
1. Create `frontend/src/pages/<Name>View.jsx` (default export, `Layout` wrapper like other
   pages, `loading` state, Polish UI text, full `dark:` variants).
2. Register it in `App.jsx`: `lazy(() => import('./pages/...'))` + a `<Route>` inside
   `ProtectedRoute`.
3. Add the menu entry to `navItems` in `components/Layout.jsx`.
4. Add a `frontend` test for the render + the main interaction (colocated `*.test.jsx`).
5. `npm run lint && npm run build && npm test`.

### Change an API contract (field names/shapes)
Update **both** sides atomically: backend route + `api.js` function + every page using it.
Search for the field name across `frontend/src` before renaming. Remember `api.js`'s
dual camelCase/snake_case tolerance (§7.2).

### Change default categories / seeding
Edit `_seed_categories_for_user()` in `backend/App.py` — the only seeder. Seeding runs on
startup for the demo admin and on registration for new users; existing users keep their old
rows (inserts are best-effort with `IntegrityError` swallowed).

### Reset to a clean demo state
Stop backend → `rm backend/data/baza.db` → restart. Admin/admin123 + 10 categories +
12 months of dummy data reappear.

---

## 11. Git & commit conventions

- **Conventional commits**, as seen in history: `feat: …`, `fix: …`, `hotfix`, plus
  occasional bare messages. Keep it that way (`feat: add yearly tab`).
- Work on `feature/*` branches, merge to `main` via PR (history shows
  `feature/darkmode`, `feature/ui-tweaks`). ⚠️ `main` is protected with
  **`enforce_admins: true`**, so `git push origin main` is rejected even for the owner: the
  required check `CI summary` must be green and the branch must be current with `main` (§8).
- Never commit: `backend/data/*.db`, `frontend/node_modules/`, `frontend/dist/`,
  `frontend/dist_probe/`, `__pycache__/` — all gitignored. The DB is per-machine state.
- Check `git status` before starting: the working tree may contain in-flight changes from
  a previous session (e.g. uncommitted edits to `backend/App.py`).

---

## 12. Do / Don't quick list

**Do**
- Scope every SQL query by `g.current_user_id` (or `user_id=?` with the same value).
- Keep backend↔frontend field names in sync and update both sides of any contract change.
- Write Polish UI strings; add `dark:` variants to every new element.
- Route all HTTP through `src/api.js`; keep month (`YYYY-MM`) / date (`YYYY-MM-DD`) formats.
- Notify users via `useToast()` (`success`/`error`/`confirm`), never native `alert`/`confirm`.
- Use `utils/date.js` (`currentMonthStr`/`currentYear`/`monthLabel`) for "today" defaults and
  month labels, not `toISOString()`; use `utils/money.js` (`formatMoney`) for PLN amounts.
- Commit with conventional prefixes on a `feature/*` branch.

**Don't**
- Don't rename `'Przychod'` (capital P) or `'wydatek'` — CHECK constraint + data + UI depend on exact casing.
- Don't `import App` in tooling/scripts (side-effect DB init).
- Don't trust `backend/seed.py` for category names or dates — it no longer exists; `App.py` is the seeder.
- Don't assume `GET /api/transactions` returns all history (current month only by default).
- Don't re-derive month names per page — `monthLabel()` and `MONTH_NAMES_PL` are the two
  canonical lists; `dashboard_data` still emits English labels (see §7.4).
- Don't commit the SQLite DB, `node_modules/`, `dist/`, or `dist_probe/`.
- Don't add a second fetch layer, state library, or Tailwind theme token without discussion —
  match the existing minimal architecture.

# AUDIT — budget-planner (optymalizacje, bugy, niedopracowania)

Data audytu: stan repo z niecommitowanymi zmianami (13 plików frontendu + `AGENTS.md`).
Metoda: czytanie kodu + **empiryczna weryfikacja** (backend na :3001, curl, SQL na kopii bazy).
Kolejność = malejące ryzyko. ✅ = potwierdzone testem, 🔧 = z kodu (analiza statyczna).

---

## P0 — wieloużytkownikowość: wycieki i destrukcja danych między userami

### 1. ✅ `POST /api/stats/year-summary` — kategorie WSZYSTKICH userów
`backend/App.py` (~`year_summary`): zapytanie o kategorie ma `WHERE c.active=1` **bez `user_id`**:
```python
"""SELECT c.id AS cid, c.name, c.color, COALESCE(SUM(t.amount),0) AS total_spend
   FROM Categories c
   LEFT JOIN Transactions t ON t.category_id=c.id AND t.user_id=? AND ...
   WHERE c.active=1 GROUP BY c.id"""
```
Wynik testu (admin, rok 2026) — 31 wierszy `category_variance`, w tym kategorie `skrapi2011`
i nowo zarejestrowanego usera, z nazwą `LEAK_MARKER_XYZ`. Strona **Roczny Przegląd** pokazuje
kategorie innych userów. **Naprawa: dodaj `AND c.user_id=?`.**

### 2. ✅ `POST /api/stats/month-summary` — identyczny wyciek
`WHERE c.active=1` bez `user_id` → 31 kategorii zwróconych dla admina. Endpoint nie jest
używany przez frontend (patrz P1-25), więc w UI niewidoczny, ale to aktywny wyciek danych.

### 3. ✅ `POST /api/stats/dashboard-data` — `chart_data` bez filtra usera
Ten sam brak `user_id` w `WHERE c.active=1`. Wyciek maskuje `if cr["total"] > 0` (obce
kategorie mają sumę 0), więc objawów w UI nie widać. To przypadek, nie zabezpieczenie.

### 4. ✅ `DELETE /api/categories/<id>` kasuje budżety innych userów
`DELETE FROM Budgets WHERE category_id=?` bez `user_id` (znany bug §9.2 AGENTS.md).
Test: user 2 miał budżet `id=123` na kategorii 21; usunięcie kategorii 21 przez usera 3
**skasowało wiersz usera 2**. Transakcje są już poprawnie filtrowane.

### 5. ✅ Brak sprawdzenia własności `category_id` przy zapisie
`POST /api/transactions`, `POST /api/budgets`, `PUT /api/transactions/<id>` przyjmują dowolny
`category_id`. Test: user `probe99` → `POST /api/transactions` z `category_id=1` (kategoria
admina) → **201**; `POST /api/budgets` z `category_id=1` → **201**. Skutek: zapisane wiersze
siewidzialne dla obu userów (listy budżetów filtrują po własnych kategoriach) — „martwe dane".
**Naprawa: walidacja `SELECT id FROM Categories WHERE id=? AND user_id=? AND active=1`.**

### 6. ✅ `CATEGORY_IDS_CACHE` budowany bez filtra usera (bug uśpiony)
`init_db()`: `SELECT id FROM Categories ORDER BY default_order ASC` → w testowej bazie 31 id
(21 z nich należy do innych userów). `seed_dummy_data(conn, admin_id)` używa tego cache, więc
przy starcie z wieloma userami i braku budżetów admina **seeduje dane admina na kategoriach
cudzych**. Dziś maskowane przez `already_has_budget`.

---

## P0 — matematyka pieniędzy

### 7. ✅ Przychody (`Przychod`) liczone jako wydatki
`budgets_by_month` / `budgets_by_month_post` oraz `month_summary_stats` sumują
`SUM(amount)` **bez `type='wydatek'`**. Test: dodano przychód 1000 do kategorii Jedzenie
(budżet 169) → `by-month-post` zwrócił `wydatki=1030.78`, `saldo=-861.78`, `status=over_budget`,
podczas gdy `dashboard-data` (poprawnie filtrowany) pokazał 1447.56.
**Strona Budżety fałszywie alarmuje „Przekroczony" przy każdym przychodzie.**
**Naprawa: `AND type='wydatek'` w tych trzech zapytaniach.**

### 8. ✅ Sprzeczność w schemacie: `Budgets.category_id NOT NULL` + `ON DELETE SET NULL`
`backend/database.py`. Test: `DELETE FROM Categories WHERE id=22` →
`IntegrityError: NOT NULL constraint failed: Budgets.category_id`.
`delete_category` działa tylko dlatego, że ręcznie kasuje budżety wcześniej. Każda inna ścieżka
(cascade, ręczna edycja bazy, future refactor) sypie się. **Naprawa: `ON DELETE CASCADE` +
usunięcie `NOT NULL`, albo `NOT NULL` + `ON DELETE CASCADE`.**

---

## P0 — crashe i uszkodzone UI

### 9. ✅ `app.run(debug=True)` → debugger Werkzeug zwracany klientowi + 500 jako HTML
`GET /api/transactions?month=abc` → **500 z HTML-em Werkzeug Debuggera** (stack trace, interaktywna
konsola). `api.js` robi `await response.json()` → `SyntaxError`, UI pokazuje „Unexpected token".
**Naprawa: walidacja parametru + JSON error handler; `debug=False` poza dev.**

### 10. ✅ Brak walidacji parametru `month`
`?month=abc` → `IndexError` (500); `?month=2026-13` → `ValueError: month must be in 1..12` (500).
Dotyczy `get_transactions`, `budgets_by_month`, `budgets_by_month_post`, `month_summary_stats`.

### 11. ✅ `POST /api/stats/dashboard-data` bez `month` → 500
`UnboundLocalError: cannot access local variable 'mon_s'` (znane §9.1). Frontend zawsze wysyła
`month`, więc zamaskowane. Napraw: ustaw `year_s/mon_s` w gałęzi „current month".

### 12. ✅ `tags` nie jest walidowany → `GET /api/tags/all` 500 na stałe
`PUT /api/transactions/<id>` z `{"tags":"not json"}` → **201**, zapis do bazy. Potem
`GET /api/tags/all` → **500 `sqlite3.OperationalError: malformed JSON`** (używa `json_each`).
Zakładka Tagi jest potem trwale zepsuta dla tego usera. **Naprawa: normalizuj `tags` do JSON
(`json.dumps(list)` / `json.loads` z walidacją) i dodaj `try` wokół `json_each`.**

### 13. ✅ Świeży clone nie startuje
`.gitignore` zawiera `!backend/data/.gitkeep`, ale plik `.gitkeep` **nie istnieje**, a
`backend/data/` jest gitignored. `init_db()` (wywoływany przy imporcie `App.py`) →
`sqlite3.OperationalError: unable to open database file`. **Naprawa: dodaj
`backend/data/.gitkeep` + `os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)` w `database.py`.**

### 14. ✅ Wydatki i Tagi nie pokazują koloru/ikony kategorii
Backend zwraca `c.name AS category_name, c.color, c.icon` — klucze to **`color`/`icon`**,
nie `category_color`/`category_icon`. Frontend czyta `tx.category_color` / `tx.category_icon`
(`ExpensesView.jsx:124,125,234,235`, `Tags.jsx:221`) → zawsze fallback `#94a3b8` i brak ikon.
Zweryfikowane na żywym API. **Naprawa: aliasy w SQL (`c.color AS category_color, c.icon AS
category_icon`) albo zmiana frontendu.**

### 15. ✅ Picker ikon w `CategoriesView` rozwalony
`ICON_OPTIONS = '🏉🚗🏠...'.split('')` dzieli pary surrogate:
`split('')` → `["\ud83c","\udfc9", ...]` (28 zepsutych glifów z 14 emoji). Poprawne:
`[...'\u{1F3C9}\u{1F697}...']`.

### 16. ✅ Inline edycja budżetu: literalne „NaN" w inputie
`Budgets.jsx`: `setEditingBudgets({... parseFloat(v || '')})`. Wyczyszczenie pola lub wpisanie
liter → `parseFloat('') = NaN` → input wyświetla **„NaN"**, przycisk „Zapisz" się pojawia
(`NaN !== original`), a `handleSaveInline` (`if (!amt || amt <= 0) return`) **nic nie robi**.
Dodatkowo `amt <= 0` → nie da się ustawić budżetu na 0 ani usunąć wiersza budżetu (brak endpointu DELETE).

### 17. ✅ `YearOverview`: `width: NaN%`
`scaleMax = Math.min(maxRatio*1.25, 2)`; gdy wszystkie kategorie mają budżet i zero wydatków →
`maxRatio = 0` → `ratio/scaleMax = 0/0 = NaN` → `Math.max(5, NaN) = NaN` → `style={{width:'NaN%'}}`.

### 18. ✅ Nazwa usera nigdy nie jest wyświetlana
Wszystkie chronione strony przyjmują prop `user` (`export default function Dashboard({ user })`
itd.), ale `App.jsx` renderuje `<Dashboard />` **bez propsów** → `Layout username={undefined}`
→ `{username && ...}` nigdy nie renderuje się w nawigacji. **Naprawa: `const { user } = useAuth()`
w Layout (Layout już importuje `useAuth` dla logout) i usunięcie martwego propa.**

### 19. ✅ Domyślna data w `AddExpenseModal` z UTC
`new Date().toISOString().slice(0,10)` — dla PL (UTC+1/+2) o 01:00 lokalnie to **wczoraj**.
AGENTS.md §7.5 wymaga `utils/date.js`; dodaj `currentDateStr()` i użyj go.

### 20. ✅ `AddBudgetModal.jsx` — zero wariantów `dark:`
Liczba `dark:` per plik: `AddBudgetModal` **0**, `AddExpenseModal` 23, `Budgets` 67.
W trybie ciemnym modal „Nowy budżet" jest jaskrawo biały (tło, labelki, siatka kategorii).
Narusza AGENTS.md §7.3.

### 21. ✅ Dashboard: stałe szerokości recharts + martwe klasy CSS
- `<ResponsiveContainer width={550} height={340}>` — na telefonie (375 px) wycieka poza kolumnę.
  `YearOverview` słusznie używa `width="100%"`.
- Donut `width={280}` + lista `minWidth:160` w `flex gap-6` → min. 464 px → overflow na mobile.
- `dark:hover:slate-700` (Dashboard.jsx:130,146) — **nieprawidłowa klasa Tailwind** (brak `bg-`)
  → brak ciemnego hovera.
- `custom-scrollbar` (Dashboard.jsx:285) — klasa niezdefiniowana w `index.css` (jest tylko `no-scrollbar`).
- `color: 'var(--tw-text-muted)'` (Dashboard.jsx:129) — zmienna niezdefiniowana przez Tailwind v4
  → tło ikony `var(--tw-text-muted)20` jest nieważne.

### 22. ✅ Tagi nie da się tworzyć (zakładka jest read-only)
`api.addTransaction` wysyła tylko `category_id, date, amount, type, description` — **`tags` jest
gubiony**. `AddExpenseModal` nie ma pola tagów. Znane i odłożone w `todo.md` #13.
Skutek: `/api/tags/all`, `PUT tags`, `json_each` — cała backendowa infrastruktura tagów jest bezużyteczna.

### 23. ✅ `deleteTag` / `updateTagName`: zakres błędny + fałszywy sukces
- Oba działają na `GET /api/transactions` **bez parametru month** → tylko bieżący miesiąc
  (quirk §7.2), a komunikat confirm mówi „ze **wszystkich** transakcji".
- Oba są owinięte `try{}catch{}` → **nigdy nie rzucają**, więc `Tags.jsx` pokazuje
  `success('Tag usunięty')` nawet gdy backend padł (blokada `catch` nigdy nie wchodzi).
- `updateTagName` wysyła `PUT` dla **każdej** transakcji (N żądań), także bez tagu, i nie
  deduplikuje (renamed „a"→„b" przy istniejącym „b" → duplikat w tej samej transakcji).

### 24. ✅ Brak informacji zwrotnej (toasty) w Wydatkach i Budżetach
AGENTS.md §7.5: „route every user notification through `useToast()`".
`ExpensesView.handleAddExpense` = `await api.addTransaction(data)` **bez try/catch** →
nieobsłużona rejection przy 401/network; brak toastu „Dodano". `handleConfirmDelete` ma `catch {}`.
`Budgets.handleSaveInline` ma `catch { /* save failed */ }` → brak komunikatu o błędzie zapisu.
`CategoriesView` i `Tags` toasty mają — te dwa nie.

---

## P1 — martwy kod, niespójności, lint

### 25. ✅ 6 endpointów backendu bez wywołania w frontendzie
`POST /api/stats/month-summary`, `GET /api/budgets?month=`, `GET /api/budgets/by-month`
(kopia `by-month-post`, §9.4), `GET /api/categories/active`, `GET /api/transactions/recent`,
`GET /api/auth/status`. Brak funkcji w `api.js` → martwy kod, podwójna konserwacja.

### 26. ✅ `PUT /api/transactions/<id>` nieużywany — brak edycji transakcji w UI
Backend pozwala edytować wszystko; UI ma tylko dodawanie i usuwanie.

### 27. ✅ Obsługa duplikatu kategorii jest martwa
`create_category` ma `except sqlite3.IntegrityError → 409`, ale schemat **nie ma** `UNIQUE` na
`(name, user_id)` i kod nie sprawdza duplikatu. Test: drugi `POST /api/categories` z nazwą
„Jedzenie" → **201** (duplikat przyjęty). AGENTS.md §6 twierdzi, że zwraca 409 — nieprawda.
Dodatkowo akceptowany jest pusty `color` (`''`) → wykresy/legenda z fallbackiem.

### 28. 🔧 Martwe fragmenty
- `frontend/src/App.css` (2.9 kB) — nieimportowany nigdzie.
- `index.css`: `.modal-overlay`, `.modal-content` — niezastosowane.
- `Dashboard.jsx:111` `getPrevMonthLabel()` — zdefiniowane, nieużyte (StatCard2 liczy self).
- `Dashboard.jsx:109` `planned_all_time` — destrukturowane, nieużyte.
- `StatCard({ ..., badge })` — prop nieużywany.
- `Budgets.jsx getBarStatus` — status `'przekroczony'` nigdy nie wraca z backendu.
- `Budgets.jsx` → `<AddBudgetModal categoriesLoaded={...}>` — modal nie przyjmuje tego propa.
- `Tags.jsx` `tagSet` — liczony i discardowany (używany tylko gdy `getAllTags()` zwróci []).
- `backend/seed.py` — stale (§9.3): `2025`, `user_id=1` na sztywno, inne nazwy kategorii.

### 29. ✅ `_fix_colors.js` — tracked, zepsuty, jednorazowy skrypt
W `frontend/`, w gicie. Hardkoduje `C:\Users\Michal\Desktop\Budget planner\frontend\src`,
ma `orig = c` (implicit global), nieużywane zmienne, `require` w ESM. Powinien być usunięty.

### 30. 🔧 Duplikacja logiki
`MONTH_NAMES` zduplikowana w 4 plikach (`Dashboard`, `Budgets`, `ExpensesView`, `YearOverview`
+ backendowa lista w `year_summary`); `formatMoney` w 3 wersjach (`Dashboard`, `ExpensesView`,
`YearOverview`). Przenieś do `utils/`.

### 31. ✅ `npm run lint`: **37 problemów (33 błędy)**
`no-empty` (puste `catch {}` w `api.js`, `AuthContext`, `ThemeContext`, `Tags`, `ExpensesView`),
`react-hooks/set-state-in-effect` (`AddBudgetModal`, `AddExpenseModal`, `YearOverview`),
`react-refresh/only-export-components` (`AuthContext.jsx`, `ThemeContext.jsx` — hook + provider
w jednym pliku; AGENTS.md §7.5 przestrzega dokładnie tego dla `ToastContext`),
`no-unused-vars` (`handleCancelDelete` w `ExpensesView`, `React` w `AddExpenseModal`).

### 32. 🔧 `api.js`: `createBudget` traci zero
`parseFloat(data.amount_monthly || data.budzet)` → dla `amount_monthly=0` → `undefined` → `NaN`
→ backend 400. Użyj `??`.

---

## P1 — optymalizacje

### 33. N+1 zapytania w statystykach
`dashboard_data`: pętla 13 mies., każde osobne `SELECT SUM(amount)` + osobne `SELECT SUM(amount_monthly)`
→ **26 zapytań na jedno żądanie**. `year_summary`: 12 zapytań miesięcznych + 2.
Zamień na jedno grupowanie:
```sql
SELECT strftime('%Y-%m', date) AS ym, SUM(amount) AS t
FROM Transactions
WHERE user_id=? AND type='wydatek' AND date>=? AND date<?
GROUP BY ym;
```
`year_summary` już tak liczy `months_count` (`COUNT(DISTINCT strftime(...))`) — ten sam wzorzec
nadaje się do pełnego rozbicia.

### 34. ✅ Brak indeksów na `Transactions(user_id, date)`
`sqlite_master` ma tylko `sqlite_autoindex_Users_1` i `sqlite_autoindex_Budgets_1`
(z `UNIQUE(category_id, month_year, user_id)`). Wszystkie agregaty filtrują `user_id`+zakres dat
→ pełny scan. Pomiar na 372 wierszach: 13 zapytań = **0.4 ms bez indeksu, 0.1 ms z indeksem**
(4× szybciej; przy 12 mies. × setki userów różnica rośnie liniowo).
```sql
CREATE INDEX IF NOT EXISTS ix_tx_user_date ON Transactions(user_id, date);
CREATE INDEX IF NOT EXISTS ix_tx_user_type ON Transactions(user_id, type);
CREATE INDEX IF NOT EXISTS ix_bud_user_month ON Budgets(user_id, month_year);
```
Dodaj w `SCHEMA` w `database.py` (idempotentne).

### 35. Brak WAL
`get_connection()` nie ustawia `PRAGMA journal_mode=WAL` → przy równoległych żądaniach
(dev + kilka kart) ryzyko `database is locked`. Dodaj w `get_connection()`.

### 36. `get_connection()` per request
Słuszne, ale `PRAGMA foreign_keys` + otwieranie pliku na każde żądanie. Przy obecnym ruchu
(~1 ms/żądanie, zmierzone) nie jest problemem; nie wprowadzaj puli połączeń bez potrzeby.

---

## P2 — bezpieczeństwo i deploy

### 37. 🔧 `SECRET_KEY` z bezpiecznym defaultem
`os.environ.get("SECRET_KEY", "planowanie-wydatkow-jwt")` (§9.5). Tokeny wydane pod innym
sekretem nie walidują się nawzajem. W deploy: wymuszaj env, nie default.

### 38. ✅ `app.run(debug=True, host="127.0.0.1")`
Poza dev: debugger = zdalne RCE (konsola Werkzeug, PIN liczony z username+PID) i wyciek stack
trace'ów (potwierdzone w P0-9). §9.6.

### 39. 🔧 CORS odbija dowolny origin
`CORS(app)` → `Access-Control-Allow-Origin: http://evil.example` (potwierdzone nagłówkiem).
Przy bearerze w headerze (nie cookie) nie kradnie tokena, ale warto zawęzić do znanych originów.

### 40. 🔧 Brak limitowania logowania + minimalne hasło 4 znaki
`POST /api/auth/login` bez rate limitu/lockout; `register` wymaga min. 4 znaków.
Hashing (`werkzeug`) jest OK (pbkdf2).

### 41. ✅ Brak `requirements.txt` (§9.7)
`flask`, `pyjwt`, `flask-cors` implicytne. Dodaj manifest — bez niego świeże środowisko
nie jest odtwarzalne. **Zrobione:** `backend/requirements.txt` (runtime + pytest).

### 42. 🔧 Sprzeczny deploy (§9.8)
`package.json`: `deploy: gh-pages -d dist` **i** `vercel.json` (SPA rewrite). Vercel wygląda na
żywy cel; gh-pages wymaga `base` w `vite.config.js` (dziś `base: '/'`) → build na gh-pages
prawdopodobnie ma złe ścieżki assetów. Potwierdź cel i usuń jedno.

### 43. ✅ `index.html`: `<html lang="en">` i `<title>frontend</title>`
Aplikacja jest w pełni po polsku. Ustaw `lang="pl"` i `<title>Planowanie Wydatków</title>`.
**Zrobione.**

### 44. 🔧 `init_db()` przy imporcie modułu (§3 AGENTS.md)
Każde `import App` tworzy/modyfikuje bazę. Przenieś wywołanie pod `if __name__ == "__main__"`
(lub do CLI), żeby dało się pisać skrypty/testy.

### 45. 🔧 Seed niezdeterministyczny
`abs(hash((user_id, cid[0], month_str)))` — hash stringów w Pythonie jest solony per proces
(`PYTHONHASHSEED`) → seed data różni się przy każdym starcie. Użyj `random.Random(f"{user_id}-{cid}-{month}")`.

---

## P1 — naprawione w drugiej rundzie (46–52)

### 46. ✅ Angielski tekst w polskim UI
Dwie dziury: `dashboard_data` budował labelki historii przez `calendar.month_name` → wykres
historii na Dashboardzie renderował „October 26" obok kart z „Październik"; oraz komunikaty
walidacji backendu były po angielsku, a `api.js` rzuca je jako `err.message` →
`toastError(err.message)`. Naprawione: `MONTH_NAMES_PL` w `dashboard_data` + wszystkie
komunikaty 400/401/403/404/409/500 po polsku.

### 47. ✅ `DELETE /api/categories/<id>` — fałszywy sukces
Delete jest scoped by `user_id`, więc cudze id nie usuwa danych, ale route odpowiadał
`200 {"success": true}`. `PUT` na tej samej ścieżce odpowiada 404. Dodana kontrola własności → 404.

### 48. ✅ Brak usuwania budżetu
Nie było `DELETE /api/budgets/<id>`, `api.deleteBudget` ani przycisku — budżet dało się tylko
zerować, a DELETE na ścieżce odpowiadał 405. Dodane razem (route → api.js → przycisk w
`Budgets.jsx` z `confirm()`). Route używa 404, nie 401 (quirk `PUT` z §6.3 AGENTS.md). Przycisk
jest rodzeństwem ternary `limit > 0`, więc budżet z limitem 0 też da się usunąć.

### 49. ✅ Brak izolowanej bazy dla testów
`DB_PATH` był liczony z `__file__`, a `init_db()` działa przy imporcie `App.py` (§3 AGENTS.md),
więc testy nie miały czystej bazy. `DATABASE_PATH` (env) wygrywa, gdy ustawiony; domyślna
ścieżka bez zmian. `get_connection()` chroni pusty `dirname` (`makedirs('')` rzuciłby błąd).

### 50. ✅ `Dashboard.jsx` — lokalny `useDark()`
Hook czytał media query systemu, więc ręczny toggle motywu w `Layout` nie docierał do strony
(§7.4 AGENTS.md: „don't copy that pattern"). Jedynym konsumentem był jeden kolor tekstu w
`CategoryRow` — zastąpiony klasą `dark:`, hook usunięty.

### 51. ✅ Wyścig przy szybkiej zmianie miesiąca
`YearOverview` miał guard `cancelled`; `Dashboard`, `ExpensesView` i `Budgets` nie — starsza
odpowiedź mogła nadpisać nową. Dodany id żądania (`reqIdRef`): zapis jest warunkowany tym, czy
odpowiedź należy do najnowszego żądania. W `Budgets.jsx` loader musi być zadeklarowany **przed**
efektem, który go wymienia w deps — wcześniejsza kolejność dawała TDZ ReferenceError.

### 52. ✅ Zagnieżdżone `<button>` w `Tags.jsx` (§9.10)
Wiersz tagu był `<button>` zawierający przyciski rename/delete — invalid HTML, React
`In HTML, <button> cannot be a descendant of <button>`. Wiersz jest teraz `<div>`, nazwa tagu
jest osobnym buttonem, akcje są rodzeństwem (bez `e.stopPropagation()`).

### 53. ✅ Martwy payload w `dashboard_data`
`planned_all_time` i `chart_data` były liczone i nigdy nie czytane (Dashboard używa
`total_all_time`/`month_total`/`prev_month_total`/`current_planned`/`monthly_history`, a paski
budżetów biorą dane z `POST /api/budgets/by-month-post`). Usunięte razem z dwoma zapytaniami.

---

## Testy

Suite jest w `backend/tests/` (pytest, 255 testów) i `frontend/src/**/*.test.{js,jsx}`
(Vitest + Testing Library, 335 testów). Uruchamianie: `python -m pytest backend/tests` i
`cd frontend && npm test`. Brak CI — patrz §8 AGENTS.md.

Backend: Flask test client na tymczasowym SQLite (`DATABASE_PATH` ustawiany przed
`import App`, bo `init_db()` jest side-effectem na poziomie modułu). Frontend: jsdom, każdy
HTTP idzie przez `api.js` i jest mockowany, więc testy nie potrzebują działającego backendu.

Naprawione przez testy (znalezione przez nie, nie przez przegląd):
- `json_each()` na obiekcie JSON zwraca jego wartości → legacy wiersz `{"a":1}` pokazywał
  `1` jako tag. Dodany `json_type(...)='array'`.
- `year_summary` z int `year` → `AttributeError` na `.strip` → 500.
- `strptime("2026-5-15")` akceptuje brak zer → data zapisana bez paddingu psuje
  porównania okna miesiąca i `ORDER BY date`.
- Domyślny handler 405 w Flask zwraca HTML, którego `api.js` nie potrafi odczytać.
- `/api/categories/active` zwracał `active: 1` (int) vs bool w `/api/categories`.
- `Dashboard.handleAddExpense` bez try/catch → nieobsłużony rejection, modal zamykał się
  bez komunikatu.

Zasada: test asercje odzwierciedlają zamierzone zachowanie. Jeśli test przechodzi, bo
kod ma bug, test jest błędny — patrz §8 AGENTS.md.

---

## Co działa dobrze (żeby nie ruszać)

- `api.js` jako jedyny punkt HTTP + spójny flow 401/session-expired (separacja login/register).
- Brak globalnego stanu; wzorzec `loading && !hasLoaded` (no-flicker) w Budgets/Tags/ExpensesView.
- Lazy routes + code-splitting (build: `CartesianChart` 332 kB wyjmuje się z głównego chunka).
- Animacje respektują `prefers-reduced-motion`; `useCountUp`/`useAnimatedValue` są czyste.
- Formaty `YYYY-MM` / `YYYY-MM-DD` i `utils/date.js` używane konsekwentnie (poza P0-19).
- Deep link `?kategoria=&miesiac=` z derived filtrem i fallbackiem na „all" — dobrze zaprojektowany.
- `ToastProvider` (max 4, auto-dismiss, `confirm` jako Promise, focus na „Anuluj", Escape).

## Proponowana kolejność napraw

1. **P0-1..6** — dodaj `user_id` do 3 zapytań o kategorie, filtr `user_id` w DELETE budżetów,
   walidacja własności `category_id` przy zapisie, `user_id` w `CATEGORY_IDS_CACHE`.
2. **P0-7** — `AND type='wydatek'` w `budgets_by_month`, `by-month-post`, `month_summary_stats`.
3. **P0-13, P0-9/10/11/12** — `.gitkeep` + `makedirs`, walidacja `month`/`year`/`tags`,
   JSON error handler, `debug=False` w deploy.
4. **P0-8** — napraw sprzeczność `NOT NULL` + `ON DELETE SET NULL` w `Budgets`.
5. **P0-14..21** — batch frontendu: aliasy SQL `category_color/icon`, `[...ICON_OPTIONS]`,
   `currentDateStr()`, `NaN` guard w inline edycji, `dark:` w `AddBudgetModal`,
   `width="100%"` w recharts, `useAuth()` w Layout, `scaleMax` guard, usunięcie martwych klas.
6. **P0-22/23/24** — pole tagów w modalu + `tags` w `api.addTransaction` (todo #13),
   tagi na wszystkie miesiące + realne error handling + toasty w Wydatkach/Budżetach.
7. **P1-33/34** — indeksy + grupowanie N+1 (jedna migracja `SCHEMA`).
8. **P1-25/27/29/30/31** — usuń martwe endpointy/pliki, `UNIQUE(name, user_id)`,
   wspólne `utils/format.js` + `utils/months.js`, cleanup linta.

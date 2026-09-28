# TODO — odłożone pozycje biznesowe

Pozostałości z audytu UI/UX (sierpień 2026). Punkty 1–12 wdrożono; poniżej to, co celowo odłożono.

- [ ] **13. Pole tagów w `AddExpenseModal` + chipy tagów na wierszach Wydatków**
  - Backend w pełni wspiera tagi (JSON array string w kolumnie TEXT), ale UI nie ma żadnego sposobu,
    żeby je dodać — `api.addTransaction` nie wysyła `tags`. Dopóki tego nie będzie, zakładka Tagi
    jest widokiem tylko-do-czytania. Wymaga: pole tagów w modalu (dodawanie/usuwanie chipów),
    wysyłanie w POST/PUT, wyświetlanie chipów przy transakcjach na Wydatkach.
- [x] **16. Panel: klik w segment donuta → skok do Wydatków z filtrem kategorii** (wdrożone 2026-08)
  - Kontrakt: `/wydatki?kategoria=<id>&miesiac=YYYY-MM` — `ExpensesView` czyta paramy przez
    `useSearchParams`; filtr jest wyprowadzany (derived) z wyboru w select + paramu, nieistniejący
    id → fallback na „Wszystkie kategorie”. Link niesie też miesiąc wybrany na Panelu. Klikalne:
    segmenty donuta (`Pie onClick`) i wiersze listy kategorii przy donucie. Select na Wydatkach
    pokazuje aktywny filtr.

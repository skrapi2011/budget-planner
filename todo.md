# TODO — odłożone pozycje biznesowe

Pozostałości z audytu UI/UX (sierpień 2026). Punkty 1–12 wdrożono; poniżej to, co celowo odłożono.

- [x] **13. Pole tagów w `AddExpenseModal` + chipy tagów na wierszach Wydatków** (wdrożone 2026-09)
  - Pole „Tagi (po przecinku)” z podpowiedziami z `GET /api/tags/all` (datalist), chipy tagów przy
    wierszu transakcji na Wydatkach, wysyłka w POST i PUT. Backend: `DELETE /api/tags/<tag>` oraz
    `PUT /api/tags/<tag>` działają na **całej** historii (`?month=all`), z deduplikacją przy zmianie
    nazwy. Zakres naprawiony w audycie P0-22/P0-23.
- [x] **16. Panel: klik w segment donuta → skok do Wydatków z filtrem kategorii** (wdrożone 2026-08)
  - Kontrakt: `/wydatki?kategoria=<id>&miesiac=YYYY-MM` — `ExpensesView` czyta paramy przez
    `useSearchParams`; filtr jest wyprowadzany (derived) z wyboru w select + paramu, nieistniejący
    id → fallback na „Wszystkie kategorie”. Link niesie też miesiąc wybrany na Panelu. Klikalne:
    segmenty donuta (`Pie onClick`) i wiersze listy kategorii przy donucie. Select na Wydatkach
    pokazuje aktywny filtr.

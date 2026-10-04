"""Row-level isolation.

AGENTS.md §4: "Row-level isolation is manual: every query must include
`user_id = g.current_user_id`. There are no DB-level grants; forgetting the filter leaks data
across users." These cases are the regression net for that rule — each one uses a *real* id
belonging to the other user, so an unscoped query is caught.
"""

from conftest import tx_body, db_rows, user_id_for_token


def cat_id_of(user, name="Transport"):
    rows = user.json(user.get("/api/categories"))
    return next(r["id"] for r in rows if r["name"] == name)


class TestCategoryIsolation:
    def test_list_is_scoped(self, user, second_user):
        mine = {r["id"] for r in user.json(user.get("/api/categories"))}
        theirs = {r["id"] for r in second_user.json(second_user.get("/api/categories"))}
        assert mine.isdisjoint(theirs)

    def test_active_list_is_scoped(self, user, second_user):
        theirs = {r["id"] for r in second_user.json(second_user.get("/api/categories/active"))}
        mine = user.json(user.get("/api/categories/active"))
        assert all(r["id"] in {c["id"] for c in user.json(user.get("/api/categories"))} for r in mine)
        assert all(r["id"] not in theirs for r in mine)

    def test_filter_by_foreign_category_returns_nothing(self, user, second_user, second_category_ids):
        user.post("/api/transactions", json=tx_body(cat_id_of(user), 10, "2026-05-10"))
        rows = user.json(user.get(f"/api/transactions?month=2026-05&category={second_category_ids['Transport']}"))
        assert rows == []

    def test_category_ids_are_unique_across_users(self, user, second_user):
        # The schema has no UNIQUE on name, so two users can both have "Transport" — the ids
        # must differ, otherwise a user_id filter alone is not enough.
        assert cat_id_of(user) != cat_id_of(second_user)


class TestTransactionIsolation:
    def test_list_is_scoped(self, user, second_user, category_ids, second_category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 10, "2026-05-10"))
        assert second_user.json(second_user.get("/api/transactions?month=2026-05")) == []

    def test_month_all_is_scoped(self, user, second_user, category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 10, "2026-05-10"))
        assert second_user.json(second_user.get("/api/transactions?month=all")) == []

    def test_keyword_search_is_scoped(self, user, second_user, category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 10,
                                                    "2026-05-10", desc="sekret"))
        assert second_user.json(second_user.get("/api/transactions?month=all&keyword=sekret")) == []

    def test_tags_all_is_scoped(self, user, second_user, category_ids, second_category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 10,
                                                    "2026-05-10", tags=["sekret"]))
        second_user.post("/api/transactions", json=tx_body(second_category_ids["Transport"], 10,
                                                            "2026-05-10", tags=["obcy"]))
        assert user.json(user.get("/api/tags/all")) == ["sekret"]
        assert second_user.json(second_user.get("/api/tags/all")) == ["obcy"]


class TestBudgetIsolation:
    def test_by_month_is_scoped(self, user, second_user, category_ids, second_category_ids):
        user.post("/api/budgets", json={"category_id": category_ids["Transport"],
                                        "amount_monthly": 300, "month_year": "2026-05"})
        rows = second_user.json(second_user.post("/api/budgets/by-month-post", json={"month": "2026-05"}))
        assert all(r["budzet"] == 0 for r in rows)
        assert category_ids["Transport"] not in [r["cat_id"] for r in rows]

    def test_budget_ids_are_unique_across_users(self, user, second_user, category_ids, second_category_ids):
        user.post("/api/budgets", json={"category_id": category_ids["Transport"],
                                        "amount_monthly": 300, "month_year": "2026-05"})
        second_user.post("/api/budgets", json={"category_id": second_category_ids["Transport"],
                                               "amount_monthly": 100, "month_year": "2026-05"})
        mine = user.json(user.post("/api/budgets/by-month-post", json={"month": "2026-05"}))
        theirs = second_user.json(second_user.post("/api/budgets/by-month-post", json={"month": "2026-05"}))
        my_ids = {r["id"] for r in mine if r["id"] is not None}
        their_ids = {r["id"] for r in theirs if r["id"] is not None}
        assert my_ids.isdisjoint(their_ids)


class TestStatsIsolation:
    def test_dashboard_is_scoped(self, user, second_user, category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 100, "2026-05-10"))
        d = second_user.json(second_user.post("/api/stats/dashboard-data", json={"month": "2026-05"}))
        assert d["month_total"] == 0.0
        assert d["total_all_time"] == 0.0

    def test_year_summary_is_scoped(self, user, second_user, category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 100, "2026-05-10"))
        d = second_user.json(second_user.post("/api/stats/year-summary", json={"year": "2026"}))
        assert d["total_spending"] == 0.0
        assert all(v["spending"] == 0.0 for v in d["category_variance"])


class TestSeedingIsolation:
    def test_registering_a_user_does_not_write_budgets_for_others(self, client, admin):
        # audit P0-6: CATEGORY_IDS_CACHE was a module global filled by an unscoped query, so
        # seed_dummy_data() attached the admin's dummy budgets to foreign categories.
        before = db_rows("SELECT COUNT(*) AS n FROM Budgets WHERE user_id=1")
        from conftest import register_user
        register_user(client, "seed_probe")
        after = db_rows("SELECT COUNT(*) AS n FROM Budgets WHERE user_id=1")
        assert after[0]["n"] == before[0]["n"]

    def test_new_user_has_no_budgets(self, client, admin):
        from conftest import register_user
        token = register_user(client, "no_budgets")
        rows = db_rows("SELECT COUNT(*) AS n FROM Budgets WHERE user_id=?", (user_id_for_token(token),))
        assert rows[0]["n"] == 0

    def test_new_user_has_no_transactions(self, client, admin):
        from conftest import register_user
        token = register_user(client, "no_tx")
        rows = db_rows("SELECT COUNT(*) AS n FROM Transactions WHERE user_id=?", (user_id_for_token(token),))
        assert rows[0]["n"] == 0


class TestIndexesExist:
    def test_user_scoped_indexes_are_present(self):
        # audit P1-34: every hot query filters by user_id (+ date / month_year), and without
        # indexes each request did a full table scan.
        names = {r["name"] for r in db_rows("SELECT name FROM sqlite_master WHERE type='index'")}
        assert "ix_tx_user_date" in names
        assert "ix_tx_user_type" in names
        assert "ix_bud_user_month" in names

    def test_budgets_unique_is_per_user(self):
        # UNIQUE(category_id, month_year, user_id) — the composite is what makes the upsert
        # safe across users (audit P0-6).
        cols = [r for r in db_rows("PRAGMA index_list('Budgets')") if r["unique"] == 1]
        assert cols, "Budgets must keep its UNIQUE index"

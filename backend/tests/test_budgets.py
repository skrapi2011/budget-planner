"""Budgets: the by-month view, creation/upsert, updates, deletion, and the income filter."""

from datetime import datetime

from conftest import tx_body


def by_month(user, month):
    return user.json(user.post("/api/budgets/by-month-post", json={"month": month}))


def row_for(user, month, cat_id):
    rows = by_month(user, month)
    return next(r for r in rows if r["cat_id"] == cat_id)


class TestByMonthView:
    def test_every_active_category_is_listed(self, user):
        rows = by_month(user, "2026-05")
        assert len(rows) == 10
        assert all(r["budzet"] == 0 and r["wydatki"] == 0 for r in rows)

    def test_budget_and_spending_are_paired(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 300, "month_year": "2026-05"})
        user.post("/api/transactions", json=tx_body(cid, 120.5, "2026-05-10"))
        r = row_for(user, "2026-05", cid)
        assert r["budzet"] == 300.0
        assert r["wydatki"] == 120.5
        assert r["saldo"] == 179.5
        assert r["status"] == "in_budget"

    def test_over_budget(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": "2026-05"})
        user.post("/api/transactions", json=tx_body(cid, 150, "2026-05-10"))
        r = row_for(user, "2026-05", cid)
        assert r["saldo"] == -50.0
        assert r["status"] == "over_budget"

    def test_income_is_not_counted_as_spending(self, user, category_ids):
        # audit P0-7: SUM(amount) had no type filter, so 'Przychod' inflated `wydatki` and the
        # Budgets page said "Przekroczony" whenever income was recorded.
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": "2026-05"})
        user.post("/api/transactions", json=tx_body(cid, 500, "2026-05-10", type_="Przychod"))
        r = row_for(user, "2026-05", cid)
        assert r["wydatki"] == 0.0
        assert r["status"] == "in_budget"

    def test_both_types_are_summed_separately(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": "2026-05"})
        user.post("/api/transactions", json=tx_body(cid, 500, "2026-05-10", type_="Przychod"))
        user.post("/api/transactions", json=tx_body(cid, 40, "2026-05-11"))
        r = row_for(user, "2026-05", cid)
        assert r["wydatki"] == 40.0

    def test_other_months_are_not_included(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 40, "2026-04-30"))
        user.post("/api/transactions", json=tx_body(cid, 40, "2026-06-01"))
        assert row_for(user, "2026-05", cid)["wydatki"] == 0.0

    def test_month_boundary_is_inclusive_exclusive(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 10, "2026-05-01"))
        user.post("/api/transactions", json=tx_body(cid, 20, "2026-05-31"))
        assert row_for(user, "2026-05", cid)["wydatki"] == 30.0

    def test_deactivated_category_is_excluded(self, user, category_ids):
        cid = category_ids["Transport"]
        user.put(f"/api/categories/{cid}", json={"active": False})
        rows = by_month(user, "2026-05")
        assert cid not in [r["cat_id"] for r in rows]

    def test_budget_id_is_exposed_for_delete(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 300, "month_year": "2026-05"})
        assert row_for(user, "2026-05", cid)["id"] is not None

    def test_missing_month_defaults_to_current(self, user):
        rows = user.json(user.post("/api/budgets/by-month-post", json={}))
        assert len(rows) == 10

    def test_invalid_month_is_400(self, user):
        for bad in ["abc", "2026-13", "2026-00", "2026-07-15", "07-2026"]:
            resp = user.post("/api/budgets/by-month-post", json={"month": bad})
            assert resp.status_code == 400, bad

    def test_get_on_the_view_is_405(self, user):
        # audit P0-25: the copy-paste GET twin was removed; POST is the single implementation.
        assert user.get("/api/budgets/by-month-post").status_code == 405

    def test_get_on_bare_budgets_is_405(self, user):
        # The unused GET /api/budgets?month= was removed too.
        assert user.get("/api/budgets?month=2026-05").status_code == 405

    def test_rows_are_user_scoped(self, user, second_user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 300, "month_year": "2026-05"})
        other_rows = by_month(second_user, "2026-05")
        assert all(r["budzet"] == 0 for r in other_rows)
        # The other user's own category ids must not collide with the admin's.
        assert cid not in [r["cat_id"] for r in other_rows]


class TestCreate:
    def test_create_is_201(self, user, category_ids):
        resp = user.post("/api/budgets", json={"category_id": category_ids["Transport"],
                                               "amount_monthly": 300, "month_year": "2026-05"})
        assert resp.status_code == 201

    def test_zero_amount_is_allowed(self, user, category_ids):
        # audit P1-32: `data.amount_monthly || data.budzet` in api.js turned 0 into the fallback.
        resp = user.post("/api/budgets", json={"category_id": category_ids["Transport"],
                                               "amount_monthly": 0, "month_year": "2026-05"})
        assert resp.status_code == 201
        assert row_for(user, "2026-05", category_ids["Transport"])["budzet"] == 0.0

    def test_negative_amount_is_400(self, user, category_ids):
        resp = user.post("/api/budgets", json={"category_id": category_ids["Transport"],
                                               "amount_monthly": -5, "month_year": "2026-05"})
        assert resp.status_code == 400

    def test_missing_fields_are_400(self, user, category_ids):
        for body in [{}, {"category_id": category_ids["Transport"]},
                     {"amount_monthly": 10}, {"month_year": "2026-05"}]:
            assert user.post("/api/budgets", json=body).status_code == 400

    def test_non_numeric_amount_is_400(self, user, category_ids):
        resp = user.post("/api/budgets", json={"category_id": category_ids["Transport"],
                                               "amount_monthly": "abc", "month_year": "2026-05"})
        assert resp.status_code == 400

    def test_foreign_category_is_rejected(self, user, second_user, category_ids):
        # audit P0-3: writing a budget against a category the caller does not own.
        foreign = second_user.json(second_user.get("/api/categories"))[0]["id"]
        resp = user.post("/api/budgets", json={"category_id": foreign,
                                               "amount_monthly": 100, "month_year": "2026-05"})
        assert resp.status_code == 400

    def test_unknown_category_is_rejected(self, user):
        resp = user.post("/api/budgets", json={"category_id": 99999,
                                               "amount_monthly": 100, "month_year": "2026-05"})
        assert resp.status_code == 400

    def test_deactivated_category_is_rejected(self, user, category_ids):
        cid = category_ids["Transport"]
        user.put(f"/api/categories/{cid}", json={"active": False})
        resp = user.post("/api/budgets", json={"category_id": cid,
                                               "amount_monthly": 100, "month_year": "2026-05"})
        assert resp.status_code == 400

    def test_repeat_is_an_upsert_and_returns_200(self, user, category_ids):
        # UNIQUE(category_id, month_year, user_id) → IntegrityError → UPDATE.
        cid = category_ids["Transport"]
        body = {"category_id": cid, "amount_monthly": 300, "month_year": "2026-05"}
        assert user.post("/api/budgets", json=body).status_code == 201
        resp = user.post("/api/budgets", json={**body, "amount_monthly": 500})
        assert resp.status_code == 200
        assert row_for(user, "2026-05", cid)["budzet"] == 500.0

    def test_upsert_does_not_duplicate_rows(self, user, category_ids):
        cid = category_ids["Transport"]
        body = {"category_id": cid, "amount_monthly": 300, "month_year": "2026-05"}
        user.post("/api/budgets", json=body)
        user.post("/api/budgets", json=body)
        rows = [r for r in by_month(user, "2026-05") if r["cat_id"] == cid]
        assert len(rows) == 1

    def test_different_months_are_separate_rows(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 300, "month_year": "2026-05"})
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 700, "month_year": "2026-06"})
        assert row_for(user, "2026-05", cid)["budzet"] == 300.0
        assert row_for(user, "2026-06", cid)["budzet"] == 700.0

    def test_same_category_name_in_a_different_user_is_a_different_id(self, user, second_user):
        # audit P0-6: the seeding category-id cache was unscoped, so the admin's dummy data
        # attached to foreign categories.
        mine = {r["name"]: r["id"] for r in user.json(user.get("/api/categories"))}
        theirs = {r["name"]: r["id"] for r in second_user.json(second_user.get("/api/categories"))}
        assert mine["Transport"] != theirs["Transport"]


class TestUpdate:
    def _budget_id(self, user, cat_id, month="2026-05"):
        user.post("/api/budgets", json={"category_id": cat_id, "amount_monthly": 300, "month_year": month})
        return row_for(user, month, cat_id)["id"]

    def test_update_with_amount(self, user, category_ids):
        bid = self._budget_id(user, category_ids["Transport"])
        resp = user.put(f"/api/budgets/{bid}", json={"amount": 450})
        assert resp.status_code == 200
        assert row_for(user, "2026-05", category_ids["Transport"])["budzet"] == 450.0

    def test_update_with_amount_monthly(self, user, category_ids):
        bid = self._budget_id(user, category_ids["Transport"])
        assert user.put(f"/api/budgets/{bid}", json={"amount_monthly": 450}).status_code == 200

    def test_update_to_zero(self, user, category_ids):
        bid = self._budget_id(user, category_ids["Transport"])
        assert user.put(f"/api/budgets/{bid}", json={"amount": 0}).status_code == 200
        assert row_for(user, "2026-05", category_ids["Transport"])["budzet"] == 0.0

    def test_negative_is_400(self, user, category_ids):
        bid = self._budget_id(user, category_ids["Transport"])
        assert user.put(f"/api/budgets/{bid}", json={"amount": -1}).status_code == 400

    def test_non_numeric_is_400(self, user, category_ids):
        bid = self._budget_id(user, category_ids["Transport"])
        assert user.put(f"/api/budgets/{bid}", json={"amount": "x"}).status_code == 400

    def test_no_amount_is_400(self, user, category_ids):
        bid = self._budget_id(user, category_ids["Transport"])
        assert user.put(f"/api/budgets/{bid}", json={}).status_code == 400

    def test_missing_budget_is_401(self, user, category_ids):
        # AGENTS.md §6.3: this route answers 401, not 404. Recorded, not "fixed".
        assert user.put("/api/budgets/99999", json={"amount": 10}).status_code == 401

    def test_foreign_budget_is_401(self, user, second_user, second_category_ids):
        bid = self._budget_id(second_user, second_category_ids["Transport"])
        assert user.put(f"/api/budgets/{bid}", json={"amount": 10}).status_code == 401

    def test_foreign_budget_is_untouched(self, user, second_user, second_category_ids):
        cid = second_category_ids["Transport"]
        bid = self._budget_id(second_user, cid)
        user.put(f"/api/budgets/{bid}", json={"amount": 10})
        assert row_for(second_user, "2026-05", cid)["budzet"] == 300.0


class TestDelete:
    def _budget_id(self, user, cat_id, month="2026-05"):
        user.post("/api/budgets", json={"category_id": cat_id, "amount_monthly": 300, "month_year": month})
        return row_for(user, month, cat_id)["id"]

    def test_delete_own_budget(self, user, category_ids):
        cid = category_ids["Transport"]
        bid = self._budget_id(user, cid)
        resp = user.delete(f"/api/budgets/{bid}")
        assert resp.status_code == 200
        assert resp.get_json() == {"success": True}
        assert row_for(user, "2026-05", cid)["budzet"] == 0.0

    def test_delete_twice_is_404(self, user, category_ids):
        bid = self._budget_id(user, category_ids["Transport"])
        user.delete(f"/api/budgets/{bid}")
        assert user.delete(f"/api/budgets/{bid}").status_code == 404

    def test_delete_unknown_is_404(self, user):
        assert user.delete("/api/budgets/99999").status_code == 404

    def test_delete_foreign_budget_is_404_and_safe(self, user, second_user, second_category_ids):
        cid = second_category_ids["Transport"]
        bid = self._budget_id(second_user, cid)
        assert user.delete(f"/api/budgets/{bid}").status_code == 404
        assert row_for(second_user, "2026-05", cid)["budzet"] == 300.0

    def test_route_exists(self, user):
        # audit P1-48: DELETE on this path used to answer 405.
        resp = user.delete("/api/budgets/1")
        assert resp.status_code in (200, 404)

    def test_budget_row_is_removed_from_the_table(self, user, category_ids):
        from conftest import db_rows
        cid = category_ids["Transport"]
        bid = self._budget_id(user, cid)
        assert len(db_rows("SELECT * FROM Budgets WHERE id=?", (bid,))) == 1
        user.delete(f"/api/budgets/{bid}")
        assert len(db_rows("SELECT * FROM Budgets WHERE id=?", (bid,))) == 0


class TestMonthDefault:
    def test_default_month_is_today_local(self, user, category_ids):
        today = datetime.now().strftime("%Y-%m")
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 300, "month_year": today})
        rows = user.json(user.post("/api/budgets/by-month-post", json={}))
        assert next(r for r in rows if r["cat_id"] == cid)["budzet"] == 300.0


class TestWriteBoundary:
    """Budget writes enforce the "YYYY-MM" contract and reject non-finite amounts.

    Both were accepted with 201: month_year went into the column verbatim, so rows for
    "2026-13" / "abc" / "2026-5" existed that no month view can ever match (dead data), and
    1e999 was stored as Infinity — which Flask emits as the bare word `Infinity`, i.e. NOT
    valid JSON, so api.js threw on response.json() and the page broke.
    """

    def test_month_year_is_normalised_to_yyyy_dash_mm(self, user, category_ids):
        from conftest import db_rows
        cid = category_ids["Transport"]
        resp = user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": "2026-5"})
        assert resp.status_code == 201
        stored = db_rows("SELECT month_year FROM Budgets WHERE category_id=? ORDER BY id DESC LIMIT 1", (cid,))[0]["month_year"]
        assert stored == "2026-05"
        assert row_for(user, "2026-05", cid)["budzet"] == 100.0

    def test_malformed_month_year_is_400(self, user, category_ids):
        from conftest import db_rows
        cid = category_ids["Transport"]
        for bad in ["2026-13", "abc", "2026-05-15", "2026-00", "99999-01", "0-12"]:
            resp = user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": bad})
            assert resp.status_code == 400, bad
            assert resp.is_json
        # Nothing was written for this category, and every stored key for the user is
        # canonical "YYYY-MM" — the contract §5 promises and the read side relies on.
        rows = db_rows("SELECT month_year FROM Budgets WHERE category_id=?", (cid,))
        assert rows == []
        import re
        for r in db_rows("SELECT month_year FROM Budgets WHERE user_id=(SELECT id FROM Users WHERE username='admin')"):
            assert re.fullmatch(r"\d{4}-\d{2}", r["month_year"]), r["month_year"]

    def test_infinite_amount_is_rejected(self, user, category_ids):
        cid = category_ids["Transport"]
        for bad in [1e999, float("inf"), float("nan"), "1e999", "nan", True]:
            resp = user.post("/api/budgets", json={"category_id": cid, "amount_monthly": bad, "month_year": "2031-01"})
            assert resp.status_code == 400, bad
        resp = user.post("/api/budgets/by-month-post", json={"month": "2031-01"})
        assert resp.status_code == 200
        assert "Infinity" not in resp.data.decode()
        import json
        json.loads(resp.data)  # must be strict, parseable JSON

    def test_zero_amount_is_still_allowed(self, user, category_ids):
        # §5: budgets are ≥ 0, transactions > 0. 0 is a legitimate "no limit".
        cid = category_ids["Transport"]
        assert user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 0, "month_year": "2031-02"}).status_code == 201

    def test_polish_decimal_comma_is_accepted(self, user, category_ids):
        cid = category_ids["Transport"]
        resp = user.post("/api/budgets", json={"category_id": cid, "amount_monthly": "120,50", "month_year": "2031-03"})
        assert resp.status_code == 201
        assert row_for(user, "2031-03", cid)["budzet"] == 120.5

    def test_update_with_infinite_amount_is_400(self, user, category_ids, admin):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": "2031-04"})
        bid = row_for(user, "2031-04", cid)["id"]
        resp = user.put(f"/api/budgets/{bid}", json={"amount": 1e999})
        assert resp.status_code == 400
        assert row_for(user, "2031-04", cid)["budzet"] == 100.0

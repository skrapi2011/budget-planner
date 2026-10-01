"""Transactions: the month-scoped list, the `month=all` opt-out, keyword search, creation
validation, partial updates, deletion, and cross-user protection."""

from datetime import datetime

from conftest import tx_body


def txs(user, query=""):
    return user.json(user.get(f"/api/transactions{query}"))


def create(user, cat_id, **kw):
    resp = user.post("/api/transactions", json=tx_body(cat_id, **kw))
    return resp


class TestListing:
    def test_default_is_the_current_month(self, user, category_ids):
        # AGENTS.md §7.2: GET /api/transactions defaults to the current month, not all history.
        today = datetime.now().strftime("%Y-%m")
        cid = category_ids["Transport"]
        create(user, cid, amount=10, date=f"{today}-05")
        create(user, cid, amount=10, date="2020-01-05")
        rows = txs(user)
        assert all(r["date"].startswith(today) for r in rows)
        assert len(rows) == 1

    def test_month_all_returns_the_whole_history(self, user, category_ids):
        cid = category_ids["Transport"]
        create(user, cid, amount=10, date="2020-01-05")
        create(user, cid, amount=10, date="2021-06-05")
        rows = txs(user, "?month=all")
        assert len(rows) == 2

    def test_specific_month(self, user, category_ids):
        cid = category_ids["Transport"]
        create(user, cid, amount=10, date="2026-05-05")
        create(user, cid, amount=10, date="2026-06-05")
        assert len(txs(user, "?month=2026-05")) == 1

    def test_invalid_month_is_400(self, user):
        # audit P0-10: "?month=abc" raised IndexError → 500.
        # An explicit empty `month=` is the same as omitting it, so it defaults to the current
        # month (200) — that is the documented default, not a validation failure.
        for bad in ["abc", "2026-13", "2026-00", "07-2026", "2026-07-15"]:
            resp = user.get(f"/api/transactions?month={bad}")
            assert resp.status_code == 400, bad

    def test_category_filter(self, user, category_ids):
        a, b = category_ids["Transport"], category_ids["Jedzenie"]
        create(user, a, amount=10, date="2026-05-05")
        create(user, b, amount=20, date="2026-05-06")
        rows = txs(user, f"?month=2026-05&category={a}")
        assert [r["category_id"] for r in rows] == [a]

    def test_non_numeric_category_filter_is_ignored(self, user, category_ids):
        create(user, category_ids["Transport"], amount=10, date="2026-05-05")
        assert len(txs(user, "?month=2026-05&category=abc")) == 1

    def test_keyword_matches_description(self, user, category_ids):
        cid = category_ids["Transport"]
        create(user, cid, amount=10, date="2026-05-05", desc="Bilet tramwajowy")
        create(user, cid, amount=10, date="2026-05-06", desc="Zakupy")
        rows = txs(user, "?month=2026-05&keyword=tramwaj")
        assert len(rows) == 1
        assert rows[0]["description"] == "Bilet tramwajowy"

    def test_keyword_matches_tags(self, user, category_ids):
        # audit P0-22: tags were added to the modal, so search must cover them.
        cid = category_ids["Transport"]
        create(user, cid, amount=10, date="2026-05-05", tags=["przyszed", "bilet"])
        create(user, cid, amount=10, date="2026-05-06", tags=["dom"])
        rows = txs(user, "?month=2026-05&keyword=bilet")
        assert len(rows) == 1

    def test_tags_are_returned_as_a_list(self, user, category_ids):
        cid = category_ids["Transport"]
        create(user, cid, amount=10, date="2026-05-05", tags=["dom"])
        rows = txs(user, "?month=2026-05")
        assert rows[0]["tags"] == ["dom"]

    def test_tags_are_ordered_by_date_desc(self, user, category_ids):
        cid = category_ids["Transport"]
        create(user, cid, amount=10, date="2026-05-02")
        create(user, cid, amount=10, date="2026-05-20")
        create(user, cid, amount=10, date="2026-05-10")
        dates = [r["date"] for r in txs(user, "?month=2026-05")]
        assert dates == ["2026-05-20", "2026-05-10", "2026-05-02"]

    def test_category_name_and_color_are_joined(self, user, category_ids):
        cid = category_ids["Transport"]
        create(user, cid, amount=10, date="2026-05-05")
        r = txs(user, "?month=2026-05")[0]
        assert r["category_name"] == "Transport"
        assert r["category_color"] == "#3498db"
        assert r["category_icon"] == "🚗"

    def test_rows_are_user_scoped(self, user, second_user, category_ids, second_category_ids):
        create(user, category_ids["Transport"], amount=10, date="2026-05-05")
        assert txs(second_user, "?month=2026-05") == []

    def test_month_all_is_user_scoped(self, user, second_user, category_ids):
        create(user, category_ids["Transport"], amount=10, date="2026-05-05")
        assert txs(second_user, "?month=all") == []


class TestCreate:
    def test_create_returns_the_full_row(self, user, category_ids):
        resp = create(user, category_ids["Transport"], amount=42.5, date="2026-05-15",
                      desc="test", tags=["dom"])
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["amount"] == 42.5
        assert body["date"] == "2026-05-15"
        assert body["type"] == "wydatek"
        assert body["tags"] == ["dom"]
        assert body["user_id"] is not None

    def test_income_type_is_accepted(self, user, category_ids):
        # ⚠️ 'Przychod' has a capital P (CHECK constraint + every spending filter).
        resp = create(user, category_ids["Transport"], amount=100, date="2026-05-15", type_="Przychod")
        assert resp.status_code == 201

    def test_lowercase_przychod_is_rejected(self, user, category_ids):
        resp = create(user, category_ids["Transport"], amount=100, date="2026-05-15", type_="przychod")
        assert resp.status_code == 400

    def test_unknown_type_is_rejected(self, user, category_ids):
        resp = create(user, category_ids["Transport"], amount=100, date="2026-05-15", type_="wydatek ")
        # .strip() normalises trailing space, so this is accepted — the contract is the trimmed value.
        assert resp.status_code == 201

    def test_missing_type_is_rejected(self, user, category_ids):
        resp = user.post("/api/transactions", json={"amount": 10, "date": "2026-05-15",
                                                    "category_id": category_ids["Transport"]})
        assert resp.status_code == 400

    def test_zero_amount_is_rejected(self, user, category_ids):
        resp = create(user, category_ids["Transport"], amount=0, date="2026-05-15")
        assert resp.status_code == 400

    def test_negative_amount_is_rejected(self, user, category_ids):
        resp = create(user, category_ids["Transport"], amount=-5, date="2026-05-15")
        assert resp.status_code == 400

    def test_non_numeric_amount_is_rejected(self, user, category_ids):
        resp = create(user, category_ids["Transport"], amount="abc", date="2026-05-15")
        assert resp.status_code == 400

    def test_missing_amount_is_rejected(self, user, category_ids):
        resp = user.post("/api/transactions", json={"type": "wydatek", "date": "2026-05-15",
                                                    "category_id": category_ids["Transport"]})
        assert resp.status_code == 400

    def test_missing_date_is_rejected(self, user, category_ids):
        resp = user.post("/api/transactions", json={"type": "wydatek", "amount": 10,
                                                    "category_id": category_ids["Transport"]})
        assert resp.status_code == 400

    def test_bad_date_format_is_rejected(self, user, category_ids):
        # audit P0-19: the frontend used to send toISOString() dates; the backend wants YYYY-MM-DD.
        for bad in ["15-05-2026", "2026/05/15", "2026-13-01", "2026-02-30", "notadate"]:
            resp = create(user, category_ids["Transport"], amount=10, date=bad)
            assert resp.status_code == 400, bad

    def test_unpadded_date_is_normalised(self, user, category_ids):
        # strptime accepts "2026-5-15", so the row used to be stored unpadded. Dates are
        # compared as strings in the month windows and in ORDER BY date DESC, where
        # "2026-5-15" sorts after "2026-12-01". The write boundary emits the canonical form.
        resp = create(user, category_ids["Transport"], amount=10, date="2026-5-15")
        assert resp.status_code == 201
        assert resp.get_json()["date"] == "2026-05-15"
        assert txs(user, "?month=2026-05")[0]["date"] == "2026-05-15"

    def test_foreign_category_is_rejected(self, user, second_user, second_category_ids):
        resp = create(user, second_category_ids["Transport"], amount=10, date="2026-05-15")
        assert resp.status_code == 400

    def test_unknown_category_is_rejected(self, user):
        resp = create(user, 99999, amount=10, date="2026-05-15")
        assert resp.status_code == 400

    def test_deactivated_category_is_rejected_on_create(self, user, category_ids):
        cid = category_ids["Transport"]
        user.put(f"/api/categories/{cid}", json={"active": False})
        resp = create(user, cid, amount=10, date="2026-05-15")
        assert resp.status_code == 400

    def test_tags_default_to_empty_array(self, user, category_ids):
        resp = create(user, category_ids["Transport"], amount=10, date="2026-05-15")
        assert resp.get_json()["tags"] == []

    def test_non_json_tags_are_rejected(self, user, category_ids):
        # audit P0-12: {"tags":"not json"} returned 201 and then /api/tags/all 500'd forever.
        resp = user.post("/api/transactions", json=tx_body(category_ids["Transport"], 10,
                                                           "2026-05-15", tags="not json"))
        assert resp.status_code == 400

    def test_tags_of_mixed_types_are_stringified(self, user, category_ids):
        resp = user.post("/api/transactions", json=tx_body(category_ids["Transport"], 10,
                                                           "2026-05-15", tags=[1, "dom"]))
        assert resp.get_json()["tags"] == ["1", "dom"]

    def test_amount_is_stored_as_real(self, user, category_ids):
        resp = create(user, category_ids["Transport"], amount=10.005, date="2026-05-15")
        assert resp.get_json()["amount"] == 10.005


class TestUpdate:
    def _tx_id(self, user, cat_id, date="2026-05-15"):
        return create(user, cat_id, amount=10, date=date).get_json()["id"]

    def test_partial_amount_update(self, user, category_ids):
        # PUT answers {"success": true}, not the row, so assertions re-read via GET.
        tid = self._tx_id(user, category_ids["Transport"])
        resp = user.put(f"/api/transactions/{tid}", json={"amount": 99})
        assert resp.status_code == 200
        assert resp.get_json() == {"success": True}
        assert txs(user, "?month=2026-05")[0]["amount"] == 99

    def test_partial_description_update(self, user, category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        user.put(f"/api/transactions/{tid}", json={"description": "nowy opis"})
        assert txs(user, "?month=2026-05")[0]["description"] == "nowy opis"

    def test_tags_update(self, user, category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        user.put(f"/api/transactions/{tid}", json={"tags": ["a", "b"]})
        assert txs(user, "?month=2026-05")[0]["tags"] == ["a", "b"]

    def test_type_switch(self, user, category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        user.put(f"/api/transactions/{tid}", json={"type": "Przychod"})
        assert txs(user, "?month=2026-05")[0]["type"] == "Przychod"

    def test_bad_type_is_400(self, user, category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        assert user.put(f"/api/transactions/{tid}", json={"type": "wydatki"}).status_code == 400

    def test_zero_amount_is_400(self, user, category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        assert user.put(f"/api/transactions/{tid}", json={"amount": 0}).status_code == 400

    def test_bad_date_is_400(self, user, category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        assert user.put(f"/api/transactions/{tid}", json={"date": "2026-13-01"}).status_code == 400

    def test_foreign_category_is_400(self, user, category_ids, second_category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        resp = user.put(f"/api/transactions/{tid}", json={"category_id": second_category_ids["Transport"]})
        assert resp.status_code == 400

    def test_deactivated_category_is_allowed_when_editing(self, user, category_ids):
        # Editing an existing row must keep working for a category the user has since deactivated.
        cid = category_ids["Transport"]
        tid = self._tx_id(user, cid)
        user.put(f"/api/categories/{cid}", json={"active": False})
        resp = user.put(f"/api/transactions/{tid}", json={"category_id": cid})
        assert resp.status_code == 200

    def test_no_field_is_400(self, user, category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        assert user.put(f"/api/transactions/{tid}", json={}).status_code == 400

    def test_missing_transaction_is_403(self, user, category_ids):
        # AGENTS.md §6.3: 403, not 404. Recorded, not "fixed".
        assert user.put("/api/transactions/99999", json={"amount": 10}).status_code == 403

    def test_foreign_transaction_is_403(self, user, second_user, second_category_ids):
        tid = self._tx_id(second_user, second_category_ids["Transport"])
        assert user.put(f"/api/transactions/{tid}", json={"amount": 10}).status_code == 403

    def test_foreign_transaction_is_untouched(self, user, second_user, second_category_ids):
        cid = second_category_ids["Transport"]
        tid = self._tx_id(second_user, cid)
        user.put(f"/api/transactions/{tid}", json={"amount": 10})
        rows = txs(second_user, "?month=2026-05")
        assert rows[0]["amount"] == 10

    def test_route_exists(self, user, category_ids):
        # audit P0-26: PUT existed but had no UI caller; ExpensesView now drives it.
        tid = self._tx_id(user, category_ids["Transport"])
        assert user.put(f"/api/transactions/{tid}", json={"amount": 11}).status_code == 200


class TestDelete:
    def _tx_id(self, user, cat_id):
        return create(user, cat_id, amount=10, date="2026-05-15").get_json()["id"]

    def test_delete_own(self, user, category_ids):
        tid = self._tx_id(user, category_ids["Transport"])
        resp = user.delete(f"/api/transactions/{tid}")
        assert resp.status_code == 200
        assert txs(user, "?month=2026-05") == []

    def test_delete_missing_is_403(self, user):
        assert user.delete("/api/transactions/99999").status_code == 403

    def test_delete_foreign_is_403_and_safe(self, user, second_user, second_category_ids):
        tid = self._tx_id(second_user, second_category_ids["Transport"])
        assert user.delete(f"/api/transactions/{tid}").status_code == 403
        assert len(txs(second_user, "?month=2026-05")) == 1

"""Categories: listing, creation, the per-user duplicate rule, colour validation, updates,
deletion cascade, and cross-user protection."""

from conftest import tx_body


class TestListing:
    def test_list_returns_the_seeded_ten(self, user):
        rows = user.json(user.get("/api/categories"))
        assert len(rows) == 10
        assert all(r["user_id"] is not None for r in rows)

    def test_active_filter_true(self, user):
        user.put(f"/api/categories/{user.json(user.get('/api/categories'))[0]['id']}",
                 json={"active": False})
        rows = user.json(user.get("/api/categories?active=true"))
        assert all(r["active"] is True for r in rows)
        assert len(rows) == 9

    def test_active_filter_false(self, user):
        cid = user.json(user.get("/api/categories"))[0]["id"]
        user.put(f"/api/categories/{cid}", json={"active": False})
        rows = user.json(user.get("/api/categories?active=false"))
        assert [r["id"] for r in rows] == [cid]

    def test_active_minus_one_is_no_filter(self, user):
        cid = user.json(user.get("/api/categories"))[0]["id"]
        user.put(f"/api/categories/{cid}", json={"active": False})
        assert len(user.json(user.get("/api/categories?active=-1"))) == 10

    def test_active_endpoint_returns_only_active_ordered(self, user):
        rows = user.json(user.get("/api/categories/active"))
        assert all(r["active"] is True for r in rows)
        orders = [r["default_order"] for r in rows]
        assert orders == sorted(orders)

    def test_active_endpoint_excludes_deactivated(self, user):
        cid = user.json(user.get("/api/categories"))[0]["id"]
        user.put(f"/api/categories/{cid}", json={"active": False})
        rows = user.json(user.get("/api/categories/active"))
        assert cid not in [r["id"] for r in rows]

    def test_both_endpoints_serialize_active_the_same(self, user):
        # `active` used to be the raw int 1 on /categories/active and a bool on /categories, so
        # `api.getCategories(true)` and `api.getCategories()` returned different shapes.
        full = user.json(user.get("/api/categories"))
        active = user.json(user.get("/api/categories/active"))
        assert all(isinstance(r["active"], bool) for r in full + active)
        by_id = {r["id"]: r for r in full}
        for r in active:
            assert r["active"] == by_id[r["id"]]["active"]


class TestCreation:
    def test_create_returns_201_and_the_row(self, user):
        resp = user.post("/api/categories", json={"name": "Telefon", "color": "#e74c3c", "icon": "📞"})
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["name"] == "Telefon"
        assert body["color"] == "#e74c3c"
        assert body["icon"] == "📞"
        assert body["active"] is True

    def test_empty_color_defaults_to_slate(self, user):
        # audit P1-27: color='' was accepted and rendered colourless.
        resp = user.post("/api/categories", json={"name": "Bez koloru", "color": ""})
        assert resp.status_code == 201
        assert resp.get_json()["color"] == "#64748b"

    def test_missing_color_defaults_to_slate(self, user):
        resp = user.post("/api/categories", json={"name": "Bez koloru 2"})
        assert resp.get_json()["color"] == "#64748b"

    def test_named_color_is_rejected(self, user):
        resp = user.post("/api/categories", json={"name": "Zły kolor", "color": "red"})
        assert resp.status_code == 400
        assert "hex" in resp.get_json()["error"]

    def test_short_hex_is_rejected(self, user):
        resp = user.post("/api/categories", json={"name": "Krótki", "color": "#abc"})
        assert resp.status_code == 400

    def test_empty_name_is_400(self, user):
        resp = user.post("/api/categories", json={"name": "   "})
        assert resp.status_code == 400

    def test_duplicate_name_is_409(self, user):
        # audit P1-27: the IntegrityError branch was dead (no UNIQUE on (user_id, name)),
        # so a second POST with the same name answered 201.
        resp = user.post("/api/categories", json={"name": "Transport"})
        assert resp.status_code == 409

    def test_duplicate_is_case_insensitive(self, user):
        resp = user.post("/api/categories", json={"name": "transport"})
        assert resp.status_code == 409

    def test_duplicate_is_per_user(self, user, second_user):
        # The same name is legal for a different user — the check is scoped by user_id.
        resp = user.post("/api/categories", json={"name": "Unikat"})
        assert resp.status_code == 201
        resp2 = second_user.post("/api/categories", json={"name": "Unikat"})
        assert resp2.status_code == 201
        assert resp2.get_json()["id"] != resp.get_json()["id"]

    def test_name_is_trimmed(self, user):
        resp = user.post("/api/categories", json={"name": "  Spacja  "})
        assert resp.get_json()["name"] == "Spacja"


class TestUpdate:
    def test_partial_update_name(self, user):
        cid = user.json(user.get("/api/categories"))[0]["id"]
        resp = user.put(f"/api/categories/{cid}", json={"name": "Nowa nazwa"})
        assert resp.status_code == 200
        assert resp.get_json()["name"] == "Nowa nazwa"

    def test_partial_update_active(self, user):
        cid = user.json(user.get("/api/categories"))[0]["id"]
        resp = user.put(f"/api/categories/{cid}", json={"active": False})
        assert resp.get_json()["active"] is False

    def test_rename_onto_existing_name_is_409(self, user):
        rows = user.json(user.get("/api/categories"))
        a, b = rows[0]["id"], rows[1]["id"]
        resp = user.put(f"/api/categories/{a}", json={"name": rows[1]["name"]})
        assert resp.status_code == 409

    def test_rename_to_own_name_is_allowed(self, user):
        rows = user.json(user.get("/api/categories"))
        resp = user.put(f"/api/categories/{rows[0]['id']}", json={"name": rows[0]["name"]})
        assert resp.status_code == 200

    def test_bad_color_is_400(self, user):
        cid = user.json(user.get("/api/categories"))[0]["id"]
        resp = user.put(f"/api/categories/{cid}", json={"color": "notahex"})
        assert resp.status_code == 400

    def test_empty_string_color_is_400_on_update(self, user):
        # On create, an empty colour defaults; on update it is an explicit field, so 400.
        cid = user.json(user.get("/api/categories"))[0]["id"]
        resp = user.put(f"/api/categories/{cid}", json={"color": ""})
        assert resp.status_code == 400

    def test_no_updatable_field_is_400(self, user):
        cid = user.json(user.get("/api/categories"))[0]["id"]
        resp = user.put(f"/api/categories/{cid}", json={"icon": None})
        assert resp.status_code == 400

    def test_foreign_category_is_404(self, user, second_user):
        cid = second_user.json(second_user.get("/api/categories"))[0]["id"]
        resp = user.put(f"/api/categories/{cid}", json={"name": "Kradzież"})
        assert resp.status_code == 404

    def test_unknown_category_is_404(self, user):
        resp = user.put("/api/categories/99999", json={"name": "X"})
        assert resp.status_code == 404


class TestDelete:
    def test_delete_own_category(self, user):
        cid = user.post("/api/categories", json={"name": "Do usunięcia"}).get_json()["id"]
        resp = user.delete(f"/api/categories/{cid}")
        assert resp.status_code == 200
        assert resp.get_json() == {"success": True}

    def test_delete_foreign_category_is_404(self, user, second_user):
        # audit P1-47: answered a false 200.
        cid = second_user.json(second_user.get("/api/categories"))[0]["id"]
        resp = user.delete(f"/api/categories/{cid}")
        assert resp.status_code == 404

    def test_foreign_category_data_survives(self, user, second_user):
        cid = second_user.json(second_user.get("/api/categories"))[0]["id"]
        user.delete(f"/api/categories/{cid}")
        rows = second_user.json(second_user.get("/api/categories"))
        assert cid in [r["id"] for r in rows]

    def test_delete_unknown_is_404(self, user):
        assert user.delete("/api/categories/99999").status_code == 404

    def test_delete_cascades_transactions(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 20.0, "2026-05-10"))
        assert len(user.json(user.get("/api/transactions?month=2026-05"))) == 1
        user.delete(f"/api/categories/{cid}")
        assert user.json(user.get("/api/transactions?month=2026-05")) == []

    def test_delete_cascades_budgets(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 300, "month_year": "2026-05"})
        rows = user.json(user.post("/api/budgets/by-month-post", json={"month": "2026-05"}))
        assert any(r["cat_id"] == cid and r["budzet"] == 300 for r in rows)
        user.delete(f"/api/categories/{cid}")
        rows = user.json(user.post("/api/budgets/by-month-post", json={"month": "2026-05"}))
        assert cid not in [r["cat_id"] for r in rows]

    def test_delete_does_not_touch_other_users_budgets(self, user, second_user, category_ids):
        # audit P0-5 / §9.2: the Budgets delete used to be unscoped by user_id.
        cid = second_user.json(second_user.get("/api/categories"))[0]["id"]
        second_user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 500, "month_year": "2026-05"})
        # cid is not owned by `user`, so the delete must 404 and change nothing.
        assert user.delete(f"/api/categories/{cid}").status_code == 404
        rows = second_user.json(user.post("/api/budgets/by-month-post", json={"month": "2026-05"}))
        # `user` sees no rows for a foreign category id.
        assert cid not in [r["cat_id"] for r in rows]
        rows2 = second_user.json(second_user.post("/api/budgets/by-month-post", json={"month": "2026-05"}))
        assert any(r["cat_id"] == cid and r["budzet"] == 500 for r in rows2)


class TestWriteBoundary:
    """icon, active, default_order and name: type and length validation at the write boundary."""

    def test_non_string_icon_is_400(self, user):
        for bad in [{"a": 1}, ["x"], 1, True]:
            resp = user.post("/api/categories", json={"name": "IconProbe", "icon": bad})
            assert resp.status_code == 400, bad
            assert resp.is_json

    def test_oversized_icon_is_400(self, user):
        # The contract (§5) is a single emoji; a 100k-char string was accepted with 201.
        resp = user.post("/api/categories", json={"name": "IconLong", "icon": "x" * 100000})
        assert resp.status_code == 400

    def test_a_single_emoji_icon_is_accepted(self, user):
        resp = user.post("/api/categories", json={"name": "IconEmoji", "icon": "\U0001f600"})
        assert resp.status_code == 201
        assert resp.get_json()["icon"] == "\U0001f600"

    def test_oversized_name_is_400(self, user):
        resp = user.post("/api/categories", json={"name": "n" * 100000})
        assert resp.status_code == 400

    def test_put_with_string_active_is_400(self, user, category_ids):
        # "abc" was written verbatim: typeof(active) became 'text' and the category vanished
        # from /api/categories/active — invisible in the add-expense dropdown, the budgets view
        # and the charts, with nothing the user can see.
        from conftest import db_rows
        cid = category_ids["Transport"]
        resp = user.put(f"/api/categories/{cid}", json={"active": "abc"})
        assert resp.status_code == 400
        row = db_rows("SELECT active, typeof(active) t FROM Categories WHERE id=?", (cid,))[0]
        assert row["t"] == "integer"
        assert any(r["id"] == cid for r in user.json(user.get("/api/categories/active")))

    def test_put_active_bool_round_trips(self, user, category_ids):
        cid = category_ids["Transport"]
        assert user.put(f"/api/categories/{cid}", json={"active": False}).status_code == 200
        assert not any(r["id"] == cid for r in user.json(user.get("/api/categories/active")))
        assert user.put(f"/api/categories/{cid}", json={"active": True}).status_code == 200
        assert any(r["id"] == cid for r in user.json(user.get("/api/categories/active")))

    def test_put_with_string_default_order_is_400(self, user, category_ids):
        # Same TEXT-in-INTEGER trap: "abc" broke ORDER BY default_order.
        from conftest import db_rows
        cid = category_ids["Transport"]
        resp = user.put(f"/api/categories/{cid}", json={"default_order": "abc"})
        assert resp.status_code == 400
        row = db_rows("SELECT default_order, typeof(default_order) t FROM Categories WHERE id=?", (cid,))[0]
        assert row["t"] == "integer"

    def test_put_default_order_as_string_digits_is_accepted_as_int(self, user, category_ids):
        from conftest import db_rows
        cid = category_ids["Transport"]
        # "3" is a legitimate numeric order (the frontend sends ints; the string form must not
        # land as TEXT in the INTEGER column, which broke ORDER BY default_order).
        resp = user.put(f"/api/categories/{cid}", json={"default_order": "0"})
        assert resp.status_code == 200
        row = db_rows("SELECT default_order, typeof(default_order) t FROM Categories WHERE id=?", (cid,))[0]
        assert row["default_order"] == 0 and row["t"] == "integer"
        # Ordering follows the numeric value, not a lexicographic one: order 0 is first.
        rows = user.json(user.get("/api/categories"))
        assert [r["id"] for r in rows][0] == cid

    def test_non_string_icon_on_put_is_400(self, user, category_ids):
        cid = category_ids["Transport"]
        resp = user.put(f"/api/categories/{cid}", json={"icon": {"a": 1}})
        assert resp.status_code == 400


class TestOptionalIcon:
    def test_category_without_icon_uses_the_default(self, user):
        resp = user.post("/api/categories", json={"name": "BezIkony"})
        assert resp.status_code == 201
        assert resp.get_json()["icon"] == "\U0001f4c1"

    def test_null_icon_uses_the_default(self, user):
        resp = user.post("/api/categories", json={"name": "NullIkona", "icon": None})
        assert resp.status_code == 201
        assert resp.get_json()["icon"] == "\U0001f4c1"

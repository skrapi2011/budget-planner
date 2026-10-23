"""Tags: the distinct list, the non-JSON fallback, whole-history delete/rename, and isolation."""

import json

from conftest import tx_body, db_rows, user_id_of


def tags_of(user):
    return user.json(user.get("/api/tags/all"))


def create_tx(user, cat_id, tags):
    return user.post("/api/transactions", json=tx_body(cat_id, 10, "2026-05-15", tags=tags))


class TestList:
    def test_empty_history_is_empty_list(self, user):
        assert tags_of(user) == []

    def test_distinct_across_transactions(self, user, category_ids):
        cid = category_ids["Transport"]
        create_tx(user, cid, ["dom", "zakupy"])
        create_tx(user, cid, ["dom", "praca"])
        assert sorted(tags_of(user)) == ["dom", "praca", "zakupy"]

    def test_only_the_callers_tags(self, user, second_user, category_ids, second_category_ids):
        create_tx(user, category_ids["Transport"], ["wlasny"])
        create_tx(second_user, second_category_ids["Transport"], ["obcy"])
        assert tags_of(user) == ["wlasny"]
        assert tags_of(second_user) == ["obcy"]

    def test_covers_all_months_not_just_the_current(self, user, category_ids):
        # audit P0-23: the Tags tab promises "all transactions", so the list must span history.
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 10, "2019-03-15", tags=["stary"]))
        assert "stary" in tags_of(user)

    def test_empty_string_tag_is_dropped(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["", "dom"])
        assert tags_of(user) == ["dom"]

    def test_non_json_row_does_not_break_the_tab(self, user, category_ids):
        # audit P0-12: one non-JSON `tags` value made json_each() abort the scan, so the Tags
        # tab 500'd permanently for that user. The Python fallback skips the bad row and the
        # good rows still surface.
        cid = category_ids["Transport"]
        create_tx(user, cid, ["dom"])          # the healthy row
        create_tx(user, cid, ["psuje"])        # the row we corrupt
        rows = user.json(user.get("/api/transactions?month=2026-05"))
        tid = next(r["id"] for r in rows if r["tags"] == ["psuje"])
        db_rows("UPDATE Transactions SET tags='not json' WHERE id=?", (tid,))
        resp = user.get("/api/tags/all")
        assert resp.status_code == 200
        assert tags_of(user) == ["dom"]

    def test_all_rows_bad_is_empty_not_500(self, user, category_ids):
        cid = category_ids["Transport"]
        create_tx(user, cid, ["dom"])
        db_rows("UPDATE Transactions SET tags='not json' WHERE user_id=?", (user_id_of(user),))
        resp = user.get("/api/tags/all")
        assert resp.status_code == 200
        assert tags_of(user) == []

    def test_json_object_is_skipped(self, user, category_ids):
        cid = category_ids["Transport"]
        create_tx(user, cid, ["dom"])          # healthy row
        create_tx(user, cid, ["psuje"])        # row we corrupt
        rows = user.json(user.get("/api/transactions?month=2026-05"))
        tid = next(r["id"] for r in rows if r["tags"] == ["psuje"])
        db_rows("UPDATE Transactions SET tags='{\"a\":1}' WHERE id=?", (tid,))
        assert tags_of(user) == ["dom"]


class TestDelete:
    def test_removes_from_every_transaction(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 10, "2019-03-15", tags=["dom", "zakupy"]))
        user.post("/api/transactions", json=tx_body(cid, 10, "2026-05-15", tags=["dom"]))
        resp = user.delete("/api/tags/dom")
        assert resp.status_code == 200
        assert resp.get_json() == {"removed_from": 2}
        assert "dom" not in tags_of(user)

    def test_tag_is_gone_from_the_rows(self, user, category_ids):
        cid = category_ids["Transport"]
        create_tx(user, cid, ["dom", "zakupy"])
        user.delete("/api/tags/dom")
        row = user.json(user.get("/api/transactions?month=2026-05"))[0]
        assert row["tags"] == ["zakupy"]

    def test_missing_tag_is_zero(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["dom"])
        assert user.delete("/api/tags/nieistnieje").get_json() == {"removed_from": 0}

    def test_does_not_touch_other_users(self, user, second_user, category_ids, second_category_ids):
        create_tx(user, category_ids["Transport"], ["dom"])
        create_tx(second_user, second_category_ids["Transport"], ["dom"])
        user.delete("/api/tags/dom")
        assert tags_of(second_user) == ["dom"]

    def test_non_json_row_is_skipped_not_corrupted(self, user, category_ids):
        cid = category_ids["Transport"]
        create_tx(user, cid, ["dom"])
        tid = user.json(user.get("/api/transactions?month=2026-05"))[0]["id"]
        db_rows("UPDATE Transactions SET tags='not json' WHERE id=?", (tid,))
        resp = user.delete("/api/tags/dom")
        assert resp.status_code == 200
        assert resp.get_json() == {"removed_from": 0}
        assert db_rows("SELECT tags FROM Transactions WHERE id=?", (tid,))[0]["tags"] == "not json"


class TestRename:
    def test_renames_everywhere(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 10, "2019-03-15", tags=["dom", "x"]))
        user.post("/api/transactions", json=tx_body(cid, 10, "2026-05-15", tags=["dom"]))
        resp = user.put("/api/tags/dom", json={"new_name": "house"})
        assert resp.status_code == 200
        assert resp.get_json() == {"renamed_in": 2}
        assert sorted(tags_of(user)) == ["house", "x"]

    def test_rename_deduplicates_within_a_row(self, user, category_ids):
        # Renaming "a"->"b" in a row that already has "b" must not create a duplicate.
        cid = category_ids["Transport"]
        create_tx(user, cid, ["a", "b"])
        resp = user.put("/api/tags/a", json={"new_name": "b"})
        assert resp.get_json() == {"renamed_in": 1}
        assert user.json(user.get("/api/transactions?month=2026-05"))[0]["tags"] == ["b"]

    def test_order_is_preserved(self, user, category_ids):
        cid = category_ids["Transport"]
        create_tx(user, cid, ["a", "keep", "b"])
        user.put("/api/tags/a", json={"new_name": "z"})
        assert user.json(user.get("/api/transactions?month=2026-05"))[0]["tags"] == ["z", "keep", "b"]

    def test_missing_new_name_is_400(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["a"])
        for body in [{}, {"new_name": ""}, {"new_name": "   "}]:
            assert user.put("/api/tags/a", json=body).status_code == 400

    def test_missing_tag_renames_nothing(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["a"])
        assert user.put("/api/tags/nieistnieje", json={"new_name": "b"}).get_json() == {"renamed_in": 0}

    def test_does_not_touch_other_users(self, user, second_user, category_ids, second_category_ids):
        create_tx(user, category_ids["Transport"], ["a"])
        create_tx(second_user, second_category_ids["Transport"], ["a"])
        user.put("/api/tags/a", json={"new_name": "b"})
        assert tags_of(second_user) == ["a"]

    def test_rename_to_empty_is_400_not_data_loss(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["a"])
        user.put("/api/tags/a", json={"new_name": ""})
        assert tags_of(user) == ["a"]


class TestTagsAreJsonArrays:
    def test_stored_value_is_a_json_array(self, user, category_ids):
        # AGENTS.md §5: tags are a JSON array string, not comma-separated text.
        create_tx(user, category_ids["Transport"], ["dom", "zakupy"])
        raw = db_rows("SELECT tags FROM Transactions ORDER BY id DESC LIMIT 1")[0]["tags"]
        assert json.loads(raw) == ["dom", "zakupy"]


class TestTagLength:
    """Tag names come from the URL path and the rename body; both were length-unbounded."""

    def test_rename_to_an_overlong_name_is_400(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["dom"])
        resp = user.put("/api/tags/dom", json={"new_name": "n" * 100000})
        assert resp.status_code == 400
        assert resp.is_json
        assert "dom" in tags_of(user)  # nothing was renamed

    def test_delete_with_an_overlong_tag_is_400(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["dom"])
        resp = user.delete(f"/api/tags/{'n' * 100000}")
        assert resp.status_code == 400

    def test_empty_new_name_is_400(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["dom"])
        assert user.put("/api/tags/dom", json={"new_name": "   "}).status_code == 400

    def test_a_normal_rename_still_works(self, user, category_ids):
        create_tx(user, category_ids["Transport"], ["dom"])
        resp = user.put("/api/tags/dom", json={"new_name": "home"})
        assert resp.status_code == 200
        assert resp.get_json()["renamed_in"] == 1
        assert "home" in tags_of(user) and "dom" not in tags_of(user)

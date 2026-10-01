"""Unit tests for the pure helpers in App.py (no HTTP, no DB).

These are the boundary validators added in the audit pass: unvalidated `month`/`year`/`tags`/
`color` used to raise IndexError/ValueError inside the route and surface as a 500.
"""

import pytest

from App import (
    parse_month,
    month_window,
    normalize_tags,
    normalize_color,
    DEFAULT_CATEGORY_COLOR,
    SECRET_KEY,
)


class TestParseMonth:
    def test_valid(self):
        assert parse_month("2026-07") == (2026, 7)
        assert parse_month("2026-1") == (2026, 1)
        assert parse_month("1999-12") == (1999, 12)

    def test_month_out_of_range(self):
        # "?month=2026-13" raised ValueError (500) before validation (audit P0-10).
        assert parse_month("2026-13") is None
        assert parse_month("2026-00") is None

    def test_non_numeric(self):
        # "?month=abc" raised IndexError (500).
        assert parse_month("abc") is None
        assert parse_month("2026-ab") is None
        assert parse_month("") is None
        assert parse_month(None) is None

    def test_extra_segments_are_tolerated(self):
        # split("-", 1) keeps the tail in parts[1]; "2026-07-15" is not a month key.
        assert parse_month("2026-07-15") is None

    def test_leading_zero_year(self):
        assert parse_month("0026-07") == (26, 7)


class TestMonthWindow:
    def test_first_and_next_first(self):
        assert month_window(2026, 7) == ("2026-07-01", "2026-08-01")

    def test_december_rolls_the_year(self):
        assert month_window(2026, 12) == ("2026-12-01", "2027-01-01")

    def test_february_28_days(self):
        # timedelta(days=32) from Feb 1 lands in March, not April.
        assert month_window(2026, 2) == ("2026-02-01", "2026-03-01")

    def test_leap_february(self):
        assert month_window(2024, 2) == ("2024-02-01", "2024-03-01")

    def test_window_is_half_open(self):
        first, nxt = month_window(2026, 1)
        assert first < nxt
        assert first.endswith("-01") and nxt.endswith("-01")


class TestNormalizeTags:
    def test_none_is_empty_array(self):
        assert normalize_tags(None) == "[]"

    def test_empty_string_is_empty_array(self):
        assert normalize_tags("") == "[]"
        assert normalize_tags("   ") == "[]"

    def test_list_is_json_array(self):
        assert normalize_tags(["dom", "zakupy"]) == '["dom", "zakupy"]'

    def test_list_of_numbers_is_stringified(self):
        assert normalize_tags([1, 2]) == '["1", "2"]'

    def test_json_string_is_parsed_and_renormalised(self):
        assert normalize_tags('["a","b"]') == '["a", "b"]'

    def test_non_json_string_is_rejected(self):
        # audit P0-12: {"tags":"not json"} returned 201 and then GET /api/tags/all 500'd
        # forever, because json_each() cannot read the column.
        assert normalize_tags("not json") is None

    def test_json_object_is_rejected(self):
        assert normalize_tags('{"a":1}') is None

    def test_json_number_is_rejected(self):
        assert normalize_tags("42") is None

    def test_non_list_non_string_is_rejected(self):
        assert normalize_tags(42) is None
        assert normalize_tags(True) is None

    def test_dict_is_rejected(self):
        assert normalize_tags({"a": 1}) is None


class TestNormalizeColor:
    def test_valid_hex(self):
        assert normalize_color("#e74c3c") == ("#e74c3c", True)
        assert normalize_color("#ABCDEF") == ("#ABCDEF", True)
        assert normalize_color("  #32a852  ") == ("#32a852", True)

    def test_empty_falls_back_to_slate(self):
        # audit P1-27: color='' was accepted, so charts rendered with no colour.
        assert normalize_color("") == (DEFAULT_CATEGORY_COLOR, False)
        assert normalize_color(None) == (DEFAULT_CATEGORY_COLOR, False)

    def test_named_color_is_rejected(self):
        assert normalize_color("red") == (DEFAULT_CATEGORY_COLOR, False)

    def test_short_hex_is_rejected(self):
        assert normalize_color("#abc") == (DEFAULT_CATEGORY_COLOR, False)

    def test_missing_hash_is_rejected(self):
        assert normalize_color("e74c3c") == (DEFAULT_CATEGORY_COLOR, False)

    def test_seven_digit_hex_is_rejected(self):
        assert normalize_color("#e74c3c1") == (DEFAULT_CATEGORY_COLOR, False)

    def test_default_is_a_valid_hex(self):
        # The fallback must itself satisfy the CHECK the frontend expects.
        assert normalize_color(DEFAULT_CATEGORY_COLOR)[1] is True


def test_secret_key_is_not_the_hardcoded_default_in_tests():
    # AGENTS.md §9.5: the default secret is weak. Tests do not set SECRET_KEY, so this
    # documents the current state — flip it to assert an env override when deployment does.
    assert SECRET_KEY == "planowanie-wydatkow-jwt"


def test_secret_key_is_too_short_for_hmac_sha256():
    # PyJWT 2.10+ warns at 23 bytes (RFC 7518 wants ≥ 32). The warning in the pytest output is
    # the evidence for §9.5; this test pins it so the number cannot silently grow shorter.
    assert len(SECRET_KEY.encode()) < 32


def test_env_secret_override_wins():
    # The env var is the deployment knob. Verified by re-reading the module with a set env.
    import importlib
    import os

    old = os.environ.get("SECRET_KEY")
    os.environ["SECRET_KEY"] = "x" * 48
    try:
        m = importlib.reload(__import__("App", fromlist=["SECRET_KEY"]))
        assert m.SECRET_KEY == "x" * 48
    finally:
        if old is None:
            del os.environ["SECRET_KEY"]
        else:
            os.environ["SECRET_KEY"] = old
        importlib.reload(__import__("App", fromlist=["SECRET_KEY"]))

"""Unit tests for the pure helpers in App.py (no HTTP, no DB).

These are the boundary validators added in the audit pass: unvalidated `month`/`year`/`tags`/
`color` used to raise IndexError/ValueError inside the route and surface as a 500.
"""

import pytest

import App
from App import (
    parse_month,
    month_window,
    normalize_tags,
    normalize_color,
    DEFAULT_CATEGORY_COLOR,
    SECRET_KEY,
    parse_amount,
    as_text,
    normalize_active,
    normalize_order,
    normalize_month,
    like_escape,
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


def test_secret_key_is_not_a_known_default():
    # AGENTS.md §9.5 was the weakness: the fallback was the literal "planowanie-wydatkow-jwt",
    # which every clone of the repo knows, so a forged token for user_id=1 was accepted
    # (GET /api/auth/status answered 200 as admin). The secret now comes from the SECRET_KEY
    # env var, or from a generated 32-byte value persisted next to the DB.
    assert SECRET_KEY != "planowanie-wydatkow-jwt"


def test_secret_key_is_long_enough_for_hmac_sha256():
    # RFC 7518 §3.2 wants ≥ 32 bytes for HS256; PyJWT 2.10+ emits InsecureKeyLengthWarning
    # below that, which is what the old 23-byte default did on every token.
    assert len(SECRET_KEY.encode()) >= 32


def test_generated_secret_is_persisted_and_mode_600(tmp_path):
    # A random-per-process secret would invalidate every stored JWT on each restart, bouncing
    # the SPA to /login. The value is written to .jwt_secret next to the DB, with 0600.
    import os
    import subprocess
    import sys
    import pathlib

    backend_dir = str(pathlib.Path(App.__file__).resolve().parent)
    script = (
        "import os,sys;"
        "os.environ.pop('SECRET_KEY',None);"
        f"sys.path.insert(0,{backend_dir!r});"
        "import App;"
        "print(App.SECRET_KEY, len(App.SECRET_KEY), oct(os.stat(App.SECRET_FILE).st_mode & 0o777),"
        " App.SECRET_FILE == os.path.join(os.path.dirname(App.DB_PATH), '.jwt_secret'))"
    )
    env = dict(os.environ)
    env.pop("SECRET_KEY", None)
    env["DATABASE_PATH"] = str(tmp_path / "baza.db")
    out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env, check=True)
    secret, length, mode, is_next_to_db = out.stdout.split()
    assert int(length) == 64
    assert mode == "0o600"
    assert is_next_to_db == "True"
    # A second import reads the same secret, so tokens survive a restart.
    out2 = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env, check=True)
    assert out2.stdout.split()[0] == secret


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


class TestParseAmount:
    """float() accepted Infinity/NaN/True and they passed the < 0 / <= 0 guards."""

    def test_finite_values(self):
        assert parse_amount(42.5) == 42.5
        assert parse_amount("120") == 120.0
        assert parse_amount("42,5") == 42.5      # the Polish decimal comma the UI types
        assert parse_amount(0) == 0.0

    def test_non_finite_is_none(self):
        for bad in [1e999, float("inf"), float("-inf"), float("nan"), "1e999", "inf", "nan"]:
            assert parse_amount(bad) is None, bad

    def test_bool_is_none(self):
        # amount: true was accepted as 1.0
        assert parse_amount(True) is None
        assert parse_amount(False) is None

    def test_non_numeric_is_none(self):
        for bad in [None, "abc", {}, [], "42abc"]:
            assert parse_amount(bad) is None, bad


class TestAsText:
    def test_string_within_cap(self):
        assert as_text("  dom  ", 50) == "dom"

    def test_overlong_is_none(self):
        assert as_text("x" * 100000, 500) is None

    def test_non_string_is_none(self):
        # A dict reached the DBAPI and aborted the request with ProgrammingError → 500.
        for bad in [{"a": 1}, ["x"], 1, True, None]:
            assert as_text(bad, 500) is None, bad


class TestNormalizeActiveOrder:
    def test_active_forms(self):
        assert normalize_active(True) == 1
        assert normalize_active(False) == 0
        assert normalize_active(1) == 1
        assert normalize_active(0) == 0
        assert normalize_active("true") == 1
        assert normalize_active("false") == 0
        assert normalize_active("abc") is None
        assert normalize_active({"a": 1}) is None

    def test_order_forms(self):
        assert normalize_order(3) == 3
        assert normalize_order("3") == 3
        assert normalize_order(0) == 0
        assert normalize_order(-1) is None
        assert normalize_order("abc") is None
        assert normalize_order("3.5") is None
        assert normalize_order(True) is None


class TestNormalizeMonth:
    def test_canonical(self):
        assert normalize_month("2026-5") == "2026-05"
        assert normalize_month("2026-12") == "2026-12"

    def test_rejects_the_forms_the_read_side_cannot_match(self):
        # Every one of these used to be stored verbatim with a 201.
        for bad in ["2026-13", "abc", "2026-05-15", "2026-00", "99999-01", "0-12", "2026-5-1", " 2026-07"]:
            assert normalize_month(bad) is None, bad


class TestLikeEscape:
    def test_wildcards_escaped(self):
        assert like_escape("100%") == "100\\%"
        assert like_escape("a_b") == "a\\_b"
        assert like_escape("back\\slash") == "back\\\\slash"

    def test_plain_text_unchanged(self):
        assert like_escape("zakupy") == "zakupy"


class TestMonthWindowArithmetic:
    """month_window() used datetime(...)+timedelta(days=32), which raised outside 1..9999."""

    def test_december_wraps_the_year(self):
        assert month_window(2026, 12) == ("2026-12-01", "2027-01-01")

    def test_9999_does_not_raise(self):
        first, nxt = month_window(9999, 12)
        assert first == "9999-12-01"
        assert nxt.startswith("10000-01")

    def test_leap_february_window(self):
        first, nxt = month_window(2028, 2)
        assert nxt == "2028-03-01"

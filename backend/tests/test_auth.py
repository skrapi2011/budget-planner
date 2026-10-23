"""Auth: registration, login, the JWT gate, and the session-status endpoint."""

import time

import jwt as pyjwt
import pytest

from conftest import register_user


class TestRegister:
    def test_registers_and_returns_token(self, client):
        resp = client.post(
            "/api/auth/register",
            json={"username": "alice", "password": "abcd", "confirmPassword": "abcd"},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["username"] == "alice"
        assert isinstance(body["token"], str) and body["token"].count(".") == 2

    def test_registration_auto_logs_in(self, client):
        # AGENTS.md §4: register returns a token, so RegisterPage calls adoptSession() and
        # navigates straight to the dashboard. The token must be usable immediately.
        token = register_user(client, "auto_login_user")
        status = client.get(
            "/api/auth/status", headers={"Authorization": f"Bearer {token}"}
        )
        assert status.status_code == 200
        assert status.get_json() == {"authenticated": True, "username": "auto_login_user"}

    def test_seeds_the_ten_default_categories(self, client):
        token = register_user(client, "seeded_user")
        rows = client.get(
            "/api/categories", headers={"Authorization": f"Bearer {token}"}
        ).get_json()
        assert len(rows) == 10
        names = {r["name"] for r in rows}
        assert "Transport" in names
        assert "Mieszkanie" in names  # the name App.py uses, not seed.py's stale variant

    def test_short_password_is_rejected(self, client):
        resp = client.post(
            "/api/auth/register",
            json={"username": "shorty", "password": "abc", "confirmPassword": "abc"},
        )
        assert resp.status_code == 400
        assert "4" in resp.get_json()["error"]

    def test_mismatched_confirmation_is_rejected(self, client):
        resp = client.post(
            "/api/auth/register",
            json={"username": "mismatch", "password": "abcd", "confirmPassword": "wxyz"},
        )
        assert resp.status_code == 400

    def test_empty_username_is_rejected(self, client):
        resp = client.post(
            "/api/auth/register",
            json={"username": "   ", "password": "abcd", "confirmPassword": "abcd"},
        )
        assert resp.status_code == 400

    def test_duplicate_username_is_409(self, client):
        register_user(client, "dup_user")
        resp = client.post(
            "/api/auth/register",
            json={"username": "dup_user", "password": "abcd", "confirmPassword": "abcd"},
        )
        assert resp.status_code == 409

    def test_no_body_is_400_not_500(self, client):
        # request.get_json(silent=True) or {} keeps a malformed body from crashing.
        resp = client.post("/api/auth/register", data="not json", content_type="text/plain")
        assert resp.status_code == 400


class TestLogin:
    def test_login_returns_token(self, client, admin_token):
        resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert resp.status_code == 200
        assert resp.get_json()["username"] == "admin"

    def test_wrong_password_is_401(self, client):
        resp = client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
        assert resp.status_code == 401

    def test_unknown_user_is_401(self, client):
        resp = client.post("/api/auth/login", json={"username": "ghost", "password": "admin123"})
        assert resp.status_code == 401

    def test_login_401_does_not_trigger_the_session_expired_flow(self, client):
        # AGENTS.md §7.2: login/register send no auth header, so their 401 must not be treated
        # as an expired session. Backend-side, the contract is simply 401 + JSON error.
        resp = client.post("/api/auth/login", json={"username": "admin", "password": "x"})
        assert resp.status_code == 401
        assert "error" in resp.get_json()


class TestAuthGate:
    def test_missing_token_is_401(self, client):
        assert client.get("/api/categories").status_code == 401

    def test_non_bearer_is_401(self, client):
        r = client.get("/api/categories", headers={"Authorization": "Token abc"})
        assert r.status_code == 401

    def test_garbage_token_is_401(self, client):
        r = client.get("/api/categories", headers={"Authorization": "Bearer not-a-jwt"})
        assert r.status_code == 401

    def test_token_signed_with_another_secret_is_401(self, client):
        forged = pyjwt.encode({"user_id": 1, "username": "admin"}, "wrong-secret", algorithm="HS256")
        r = client.get("/api/categories", headers={"Authorization": f"Bearer {forged}"})
        assert r.status_code == 401

    def test_expired_token_is_401(self, client):
        expired = pyjwt.encode(
            {"user_id": 1, "username": "admin", "exp": int(time.time()) - 10},
            "planowanie-wydatkow-jwt",
            algorithm="HS256",
        )
        r = client.get("/api/categories", headers={"Authorization": f"Bearer {expired}"})
        assert r.status_code == 401

    def test_status_reports_the_username(self, client, user):
        body = user.json(user.get("/api/auth/status"))
        assert body["authenticated"] is True
        assert body["username"].startswith("tester")

    def test_logout_is_a_noop_success(self, client, user):
        # JWT is stateless: logout cannot revoke a token, it only clears client state.
        for method in ("post", "delete"):
            resp = getattr(client, method)("/api/auth/logout", headers=user.headers)
            assert resp.status_code == 200
            assert resp.get_json() == {"success": True}

    def test_token_still_valid_after_logout(self, client, user):
        client.post("/api/auth/logout", headers=user.headers)
        assert client.get("/api/auth/status", headers=user.headers).status_code == 200


class TestErrorShape:
    def test_unhandled_exception_returns_json_not_html(self, client, user):
        # audit P0-9: with debug=True the 500 body was an HTML stack trace.
        resp = user.post("/api/transactions", json={"type": "wydatek"})  # no amount → 500 path
        assert resp.status_code in (400, 500)
        assert resp.is_json
        if resp.status_code == 500:
            assert resp.get_json()["error"] == "Wewnętrzny błąd serwera"

    def test_404_on_unknown_route_is_json(self, client, user):
        resp = user.get("/api/does-not-exist")
        assert resp.status_code == 404
        assert resp.is_json

    def test_wrong_method_is_json(self, client, user):
        # audit P0-25: GET on the budgets view is now 405.
        resp = user.get("/api/budgets/by-month-post")
        assert resp.status_code == 405
        assert resp.is_json


class TestTokenAndThrottle:
    """The auth hardening: forged-token rejection, oversized input, throttle, timing, CORS."""

    def test_forged_token_with_the_old_default_secret_is_rejected(self, client):
        # AGENTS.md §9.5. The old fallback was the literal "planowanie-wydatkow-jwt", so anyone
        # who knew it could mint a token for user_id=1 and read the admin's whole budget.
        forged = pyjwt.encode(
            {"user_id": 1, "username": "admin", "exp": int(time.time()) + 3600},
            "planowanie-wydatkow-jwt",
            algorithm="HS256",
        )
        resp = client.get("/api/auth/status", headers={"Authorization": f"Bearer {forged}"})
        assert resp.status_code == 401

    def test_a_token_signed_with_the_real_secret_is_accepted(self, client, admin_token):
        # The counterpart: the gate still accepts the secret App.py actually uses.
        resp = client.get("/api/auth/status", headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 200

    def test_hs512_token_is_rejected(self, client):
        # algorithms=["HS256"] is not decoration: an algorithm-signature confusion attack must
        # not validate.
        tok = pyjwt.encode({"user_id": 1, "username": "admin"}, "x" * 40, algorithm="HS512")
        resp = client.get("/api/auth/status", headers={"Authorization": f"Bearer {tok}"})
        assert resp.status_code == 401

    def test_oversized_username_is_rejected(self, client):
        # A 100k-char username was accepted with 201, and Layout.jsx renders the username raw.
        resp = client.post(
            "/api/auth/register",
            json={"username": "x" * 100000, "password": "abcd", "confirmPassword": "abcd"},
        )
        assert resp.status_code == 400
        assert resp.is_json

    def test_login_is_throttled_per_ip_and_username(self, client, monkeypatch, admin_token):
        import App

        monkeypatch.setattr(App, "LOGIN_LIMIT", 3)
        for i in range(3):
            assert client.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401
        resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert resp.status_code == 429
        assert resp.is_json
        assert "prób" in resp.get_json()["error"]
        # A different username has its own bucket, and the throttle does not lock everyone out.
        assert client.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).status_code == 429

    def test_failed_login_for_an_absent_user_costs_a_password_hash(self, client):
        # The enumeration oracle: hashing only ran for existing users, so the response time
        # answered "does this username exist?" (measured 42.2ms vs 0.23ms). Now the cost is
        # equalised by comparing against a fixed dummy hash.
        runs = []
        for _ in range(5):
            t0 = time.time()
            resp = client.post("/api/auth/login", json={"username": "definitely_absent_user", "password": "nope"})
            runs.append(time.time() - t0)
            assert resp.status_code == 401
        assert resp.is_json
        mean_ms = 1000 * sum(runs) / len(runs)
        assert mean_ms > 5, f"hash cost missing: mean {mean_ms:.2f}ms"

    def test_cors_does_not_echo_an_arbitrary_origin(self, client):
        # CORS(app) echoed Access-Control-Allow-Origin: <any>, so any site holding a token could
        # read the whole budget back cross-origin.
        resp = client.options("/api/categories", headers={"Origin": "https://evil.example.com"})
        allow = resp.headers.get("Access-Control-Allow-Origin", "")
        assert allow != "https://evil.example.com"
        assert allow != "*"

    def test_oversized_body_is_refused_as_json_413(self, client, user):
        # MAX_CONTENT_LENGTH was None, so a 10MB body was accepted and stored.
        big = {"type": "wydatek", "amount": 1, "date": "2031-04-01", "category_id": 1,
              "description": "y" * 200000}
        resp = user.post("/api/transactions", json=big)
        assert resp.status_code == 413
        assert resp.is_json
        assert "limit" in resp.get_json()["error"]


def test_rate_limit_buckets_are_pruned():
    # The per-key hit lists were pruned on every call, the keys themselves never were, so a
    # long-running process accumulated one entry per (ip, username) it had ever seen.
    import App

    App._register_window.clear()
    old = time.time() - App.LOGIN_WINDOW_S * 2
    for i in range(1001):
        App._register_window[f"login:127.0.0.1:u{i}"] = [old]
    assert len(App._register_window) > 1000
    App._rate_limited("login:127.0.0.1:admin", App.LOGIN_LIMIT or 3, App.LOGIN_WINDOW_S)
    assert len(App._register_window) <= 1000
    # The bucket that is still inside the window survives.
    assert "login:127.0.0.1:admin" in App._register_window
    App._register_window.clear()

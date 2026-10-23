"""Pytest harness for the budget-planner backend.

⚠️ Order matters. `App.py` runs `init_db()` at module import (AGENTS.md §3), which creates
the DB file, the demo admin and ~12 months of seed data. `database.DB_PATH` is resolved at
import time from the `DATABASE_PATH` env var (audit P1-49), so the env var must be set
**before** `import App`. This module does exactly that, which makes importing App safe here
and nowhere else.

Every test runs against a throwaway DB in a temp directory; `backend/data/baza.db` is never
touched.
"""

import json
import os
import sys
import tempfile
import pathlib

import pytest

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# A per-session temp DB. NamedTemporaryFile gives a path that exists; sqlite creates the
# schema on first connection.
_fd, _db_path = tempfile.mkstemp(suffix=".db", prefix="bp_test_")
os.close(_fd)
os.unlink(_db_path)          # start empty; init_db() will create it
os.environ["DATABASE_PATH"] = _db_path

# A fixed secret for the suite: App.py now generates and persists a random secret when
# SECRET_KEY is unset, so a test that decodes a token needs the value App.py will use. Set it
# before import (same reason as DATABASE_PATH) and ≥ 32 bytes, so PyJWT does not emit
# InsecureKeyLengthWarning for every token in the suite.
os.environ["SECRET_KEY"] = "test-secret-for-the-suite-32-bytes!"
# The login/register throttle is disabled for the suite: the fixtures create a fresh user per
# test from one IP, and 5 registrations per 60s is exactly what they exhaust.
os.environ["LOGIN_LIMIT"] = "0"
os.environ["REGISTER_LIMIT"] = "0"

import App  # noqa: E402  (side-effect import is the point of this conftest)


def pytest_sessionstart(session):
    pass


def pytest_sessionfinish(session, exitstatus):
    try:
        os.unlink(_db_path)
    except OSError:
        pass


@pytest.fixture(scope="session")
def app():
    App.app.config["TESTING"] = True
    return App.app


@pytest.fixture(scope="session")
def db_path():
    return _db_path


@pytest.fixture(scope="session")
def client(app):
    # Session-scoped: admin_token (session) depends on it, and a Flask test client is cheap to
    # reuse — each request opens and closes its own DB connection (AGENTS.md §6.1).
    return app.test_client()


class AuthedClient:
    """Thin wrapper that attaches `Authorization: Bearer <token>` to every request."""

    def __init__(self, client, token):
        self._client = client
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}

    def get(self, path):
        return self._client.get(path, headers=self.headers)

    def post(self, path, json=None):
        return self._client.post(path, json=json, headers=self.headers)

    def put(self, path, json=None):
        return self._client.put(path, json=json, headers=self.headers)

    def delete(self, path):
        return self._client.delete(path, headers=self.headers)

    def json(self, resp):
        return resp.get_json()


def register_user(client, username, password="secret123"):
    resp = client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "confirmPassword": password},
    )
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["token"]


# The DB is session-scoped, so a fixture registering a fixed username would 409 on the second
# test. A counter gives every test its own user.
_counter = 0


def _next_name(prefix):
    global _counter
    _counter += 1
    return f"{prefix}{_counter}"


@pytest.fixture(scope="session")
def admin_token(client):
    """The seeded demo user (admin/admin123) — has 10 categories and 12 months of data."""
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return resp.get_json()["token"]


@pytest.fixture
def admin(client, admin_token):
    return AuthedClient(client, admin_token)


@pytest.fixture
def user(client, admin_token):
    """A brand-new user: no transactions, no budgets, 10 seeded categories."""
    token = register_user(client, _next_name("tester"))
    return AuthedClient(client, token)


@pytest.fixture
def second_user(client, admin_token):
    token = register_user(client, _next_name("other"))
    return AuthedClient(client, token)


@pytest.fixture
def category_ids(user):
    """{name: id} for the user's seeded categories — tests read ids, never hardcode them."""
    rows = user.json(user.get("/api/categories"))
    return {r["name"]: r["id"] for r in rows}


@pytest.fixture
def second_category_ids(second_user):
    """The second user's own ids. Category ids are global, so a foreign id is a real number
    that must never be reused as "the other user's Transport"."""
    rows = second_user.json(second_user.get("/api/categories"))
    return {r["name"]: r["id"] for r in rows}


def tx_body(cat_id, amount=10.0, date="2026-06-15", type_="wydatek", tags=None, desc=""):
    return {
        "type": type_,
        "amount": amount,
        "date": date,
        "category_id": cat_id,
        "description": desc,
        "tags": tags or [],
    }


def json_of(resp):
    return resp.get_json()


def ids_of(resp):
    """Extract the numeric id from a create response (POST /api/transactions returns the row)."""
    body = resp.get_json()
    return body.get("id") if isinstance(body, dict) else None


def user_id_for_token(token):
    """The numeric user id behind a JWT, decoded with the secret App.py is using."""
    import jwt as pyjwt
    return pyjwt.decode(token, App.SECRET_KEY, algorithms=["HS256"])["user_id"]


def user_id_of(user):
    """The numeric user id behind an AuthedClient, read from its JWT."""
    return user_id_for_token(user.token)


def db_rows(sql, params=()):
    """Direct DB read/write for assertions the API cannot express (cascade effects, indexes, and
    injecting a legacy non-JSON `tags` value that the write boundary now rejects). Commits, so
    the change is visible to the next request."""
    import sqlite3
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(sql, params)
        conn.commit()
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

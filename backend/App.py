import os
import json
import re
import calendar
import random
import jwt as pyjwt
from datetime import datetime, timedelta, timezone

import sqlite3
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from database import create_tables, get_connection, DB_PATH
from functools import wraps
from flask_cors import CORS


SECRET_KEY = os.environ.get("SECRET_KEY", "planowanie-wydatkow-jwt")

# Audit P0-9 / P0-38: with debug=True the Werkzeug debugger is reachable over the
# network (interactive console, PIN derived from username+PID) and every unhandled
# exception is returned as an HTML page, which api.js cannot parse as JSON.
# Off by default; opt in with FLASK_DEBUG=1 for local work.
DEBUG = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")

app = Flask(__name__)
CORS(app)
app.config["SECRET_KEY"] = SECRET_KEY


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Brak lub nieprawidłowy token"}), 401
        token = auth_header.split(" ", 1)[1]
        try:
            payload = __decode_jwt(token)
            g.current_user_id = payload["user_id"]
            g.current_username = payload["username"]
        except Exception:
            return jsonify({"error": "Nieprawidłowy lub wygasły token"}), 401
        return f(*args, **kwargs)
    return decorated


def __decode_jwt(token):
    return pyjwt.decode(token, SECRET_KEY, algorithms=["HS256"])


def generate_token(user_id, username):
    payload = {
        "user_id": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
    }
    return pyjwt.encode(payload, SECRET_KEY, algorithm="HS256")


def rows_to_list(rows):
    result = []
    for row in rows:
        d = {}
        for key in row.keys():
            val = row[key]
            if hasattr(val, "isoformat"):
                val = val.isoformat()
            d[key] = val
        result.append(d)
    return result


def owns_category(conn, cat_id, user_id, require_active=False):
    """Row-level isolation guard: a write may only target a category owned by the caller.

    Every Categories row belongs to exactly one user, so an un-owned category_id is
    either a foreign user's row (cross-user write) or a dangling id that makes the
    saved row invisible to everyone ("dead data").
    """
    try:
        cid = int(cat_id)
    except (ValueError, TypeError):
        return False
    sql = "SELECT id FROM Categories WHERE id=? AND user_id=?"
    if require_active:
        sql += " AND COALESCE(active,1)=1"
    return conn.execute(sql, (cid, user_id)).fetchone() is not None


def parse_month(month):
    """Validate a "YYYY-MM" month key; return (year, mon) ints, or None if malformed.

    Unvalidated params used to blow up: "?month=abc" raised IndexError, "?month=2026-13"
    raised ValueError — both surfaced as 500 (audit P0-10). Validate at the boundary and
    answer 400 with JSON instead.
    """
    parts = (month or "").split("-", 1)
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return None
    year, mon = int(parts[0]), int(parts[1])
    if mon < 1 or mon > 12:
        return None
    return (year, mon)


def month_window(year, mon):
    """First day of year-mon and the first day of the next month, as "YYYY-MM-DD"."""
    first = f"{year}-{mon:02d}-01"
    nxt = datetime(year, mon, 1) + timedelta(days=32)
    return first, f"{nxt.year}-{nxt.month:02d}-01"


def normalize_date(raw):
    """Return a canonical "YYYY-MM-DD", or None if the value is not a real date.

    `datetime.strptime("2026-5-15", "%Y-%m-%d")` accepts non-zero-padded input, so the row was
    stored as "2026-5-15". Dates are compared as strings in every month window
    (`date>=? AND date<?`) and in `ORDER BY t.date DESC`, so an unpadded value sorts between
    May and December: `"2026-5-15" > "2026-12-01"` is True. Normalise at the write boundary so
    the column always has the format the format contract (AGENTS.md §5) promises.
    """
    s = (raw or "").strip()
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def normalize_tags(raw):
    """Return a JSON-array string for Transactions.tags, or None if the value is unusable.

    The column is read back with SQLite's json_each() in /api/tags/all, so one non-JSON
    value breaks the Tags tab for that user permanently (audit P0-12: PUT with
    {"tags":"not json"} returned 201 and then GET /api/tags/all 500'd forever).
    Validate at the write boundary.
    """
    if raw is None:
        return "[]"
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return "[]"
        try:
            parsed = json.loads(s)
        except Exception:
            return None
        if not isinstance(parsed, list):
            return None
        return json.dumps([str(x) for x in parsed])
    if isinstance(raw, list):
        return json.dumps([str(x) for x in raw])
    return None


HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_CATEGORY_COLOR = "#64748b"


def normalize_color(raw):
    """Return a `#rrggbb` colour, falling back to a neutral slate when the value is
    empty or malformed (audit P1-27: `color=''` was accepted, so charts and the legend
    rendered with no colour). Returns (color, ok) where ok is False for unusable input.
    """
    s = (raw or "").strip()
    if not s:
        return DEFAULT_CATEGORY_COLOR, False
    if HEX_COLOR_RE.match(s):
        return s, True
    return DEFAULT_CATEGORY_COLOR, False


def find_duplicate_category(conn, user_id, name, exclude_id=None):
    """Case-insensitive duplicate check per user (audit P1-27).

    The schema has no UNIQUE on (user_id, name), so `except IntegrityError -> 409` in
    create_category was dead code: a second POST with the same name returned 201.
    """
    row = conn.execute(
        "SELECT id, name FROM Categories WHERE user_id=? AND name COLLATE NOCASE = ?",
        (user_id, name.strip()),
    ).fetchone()
    if row and (exclude_id is None or row["id"] != exclude_id):
        return row
    return None


def seed_categories(conn):
    _seed_categories_for_user(conn, 1)


CATEGORY_NAMES = ["Jedzenie", "Transport", "Mieszkanie", "Rozrywka", "Zdrowie",
                  "Edukacja", "Ubrania", "Telefon / Internet", "Czynsz", "Prezent"]

# Polish month names in calendar order — mirrors MONTH_NAMES in frontend/src/utils/date.js
# (audit P1-30: the list was duplicated in 4 frontend pages plus this one).
MONTH_NAMES_PL = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
                  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"]

SEED_BASE_AMOUNT = 150.0


def seed_dummy_data(conn, user_id):
    """Seed realistic dummy transactions + budgets for the demo admin account."""
    # --- 1) Budgets for last 12 months (even split per category) ---
    now_y, now_m = datetime.now().year, datetime.now().month

    already_has_budget = conn.execute(
        "SELECT id FROM Budgets WHERE user_id=? LIMIT 1", (user_id,)
    ).fetchone()

    if not already_has_budget:
        for m_offset in range(12):
            tgt_y = now_y
            tgt_m = now_m - m_offset
            while tgt_m <= 0:
                tgt_m += 12
                tgt_y -= 1
            month_str = f"{tgt_y}-{str(tgt_m).zfill(2)}"

            for cid in CATEGORY_IDS_CACHE:
                rng_seed = abs(hash((user_id, cid[0], month_str))) % (2**32)
                rng = random.Random(rng_seed)
                amt = round(SEED_BASE_AMOUNT * 1.1 + rng.randint(-20, 40), 2)
                try:
                    conn.execute(
                        "INSERT INTO Budgets (category_id, amount_monthly, month_year, user_id) VALUES (?,?,?,?)",
                        (cid[0], amt, month_str, user_id),
                    )
                except Exception:
                    pass

        # --- 2) Transactions for last 12 months per category (even distribution with noise) ---
        dummy_rows = []
        for m_offset in range(12):
            tgt_y = now_y
            tgt_m = now_m - m_offset
            while tgt_m <= 0:
                tgt_m += 12
                tgt_y -= 1
            month_str_base = f"{tgt_y}-{str(tgt_m).zfill(2)}"

            for i, cid in enumerate(CATEGORY_IDS_CACHE):
                cat_name = CATEGORY_NAMES[i % len(CATEGORY_NAMES)]
                rng_seed = abs(hash((user_id, cid[0], month_str_base))) % (2**32)
                rng = random.Random(rng_seed)
                base_amt = SEED_BASE_AMOUNT + rng.randint(-30, 80)
                n_txns = max(1, rng.randint(2, 4))

                for t_idx in range(n_txns):
                    day = rng.randint(1, 28)
                    date_str = f"{month_str_base}-{str(day).zfill(2)}"
                    try:
                        dt_obj = datetime.strptime(date_str, "%Y-%m-%d")
                    except ValueError:
                        continue

                    pct = rng.uniform(0.4, 1.6)
                    amt = max(10.0, round(base_amt / n_txns * pct, 2))

                    dummy_rows.append((
                        user_id, cid[0], dt_obj.strftime("%Y-%m-%d"),
                        amt, "wydatek", cat_name,
                    ))

        conn.executemany(
            """INSERT INTO Transactions (user_id, category_id, date, amount, type, description)
               VALUES (?, ?, ?, ?, ?, ?)""",
            dummy_rows,
        )

    conn.commit()


# Cache: populated once at init time from Categories table.
CATEGORY_IDS_CACHE = []


def _seed_categories_for_user(conn, user_id):
    defaults = [
        ("Jedzenie", "#e74c3c", "\U0001f354"),
        ("Transport", "#3498db", "\U0001f697"),
        ("Mieszkanie", "#2ecc71", "\U0001f3e0"),
        ("Rozrywka", "#e67e22", "\U0001f3ae"),
        ("Zdrowie", "#1abc9c", "\u2764\ufe0f"),
        ("Edukacja", "#9b59b6", "\U0001f4da"),
        ("Ubrania", "#f39c12", "\U0001f455"),
        ("Telefon / Internet", "#8e44ad", "\U0001f4f1"),
        ("Czynsz", "#d35400", "\U0001f3e1"),
        ("Prezent", "#16a085", "\U0001f381"),
    ]
    order = 1
    for name, color, icon in defaults:
        try:
            conn.execute(
                "INSERT INTO Categories (name, color, icon, default_order, user_id) VALUES (?,?,?,?,?)",
                (name, color, icon, order, user_id),
            )
        except sqlite3.IntegrityError:
            pass
        order += 1


def init_db():
    create_tables()
    conn = get_connection()
    try:
        admin = conn.execute(
            "SELECT id FROM Users WHERE username=?", ("admin",)
        ).fetchone()
        admin_id = None
        if not admin:
            h = generate_password_hash("admin123")
            cur = conn.execute(
                "INSERT INTO Users (username, password_hash) VALUES (?,?)",
                ("admin", h),
            )
            admin_id = cur.lastrowid
            seed_categories(conn)
        else:
            admin_id = admin["id"]
            existing = conn.execute(
                "SELECT id FROM Categories WHERE user_id=?", (admin_id,)
            ).fetchone()
            if not existing:
                _seed_categories_for_user(conn, admin_id)

        # Populate category ID cache once for seeding — scoped to the demo admin.
        # Audit P0-6: the unscoped query picked up every user's categories, so seeding
        # attached the admin's dummy data to foreign categories.
        global CATEGORY_IDS_CACHE
        cat_rows = conn.execute(
            "SELECT id FROM Categories WHERE user_id=? ORDER BY default_order ASC",
            (admin_id,),
        ).fetchall()
        CATEGORY_IDS_CACHE = [[int(c["id"])] for c in cat_rows]

        seed_dummy_data(conn, admin_id)
        conn.commit()
    finally:
        conn.close()


# ---- AUTH ROUTES ----

@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    confirm_password = data.get("confirmPassword") or ""
    if not username:
        return jsonify({"error": "Nazwa użytkownika jest wymagana"}), 400
    if len(password) < 4:
        return jsonify({"error": "Hasło musi mieć co najmniej 4 znaki"}), 400
    if password != confirm_password:
        return jsonify({"error": "Hasła nie są identyczne"}), 400

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM Users WHERE username=?", (username,)
        ).fetchone()
        if existing:
            return jsonify({"error": "Taki użytkownik już istnieje"}), 409

        pwd_hash = generate_password_hash(password)
        cur = conn.execute(
            "INSERT INTO Users (username, password_hash) VALUES (?,?)",
            (username, pwd_hash),
        )
        user_id = cur.lastrowid
        token = generate_token(user_id, username)
        _seed_categories_for_user(conn, user_id)
        conn.commit()
        return jsonify({"token": token, "username": username}), 201
    except sqlite3.IntegrityError:
        conn.rollback()
        return jsonify({"error": "Taki użytkownik już istnieje"}), 409
    finally:
        conn.close()


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    conn = get_connection()
    try:
        user = conn.execute(
            "SELECT id, password_hash FROM Users WHERE username=?",
            (username,),
        ).fetchone()
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "Nieprawidłowa nazwa użytkownika lub hasło"}), 401

        token = generate_token(user["id"], username)
        return jsonify({"token": token, "username": username}), 200
    finally:
        conn.close()


@app.route("/api/auth/logout", methods=["DELETE", "POST"])
def logout_endpoint():
    return jsonify({"success": True}), 200


@app.route("/api/auth/status", methods=["GET"])
@require_auth
def auth_status():
    return jsonify({
        "authenticated": True,
        "username": g.current_username,
    })


# ---- CATEGORIES ROUTES ----

@app.route("/api/categories", methods=["GET"])
@require_auth
def get_categories():
    active_filter = request.args.get("active")
    conn = get_connection()
    try:
        where_clause = "WHERE user_id=?"
        params_list = [g.current_user_id]

        if active_filter is not None and active_filter != "-1":
            is_active = 1 if active_filter and active_filter.lower() in ('true', '1') else 0
            where_clause += " AND active=?"
            params_list.append(is_active)

        query = f"SELECT * FROM Categories {where_clause} ORDER BY default_order ASC, id ASC"

        rows = conn.execute(query, params_list).fetchall()
        cats = []
        for r in rows:
            cats.append({
                "id": r["id"],
                "name": r["name"],
                "color": r["color"],
                "icon": r["icon"],
                "default_order": r["default_order"],
                "active": r["active"] == 1,
                "user_id": r["user_id"],
            })
        return jsonify(cats), 200
    finally:
        conn.close()


@app.route("/api/categories/active", methods=["GET"])
@require_auth
def get_active_categories():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM Categories WHERE user_id=? AND active=1 ORDER BY default_order ASC",
            (g.current_user_id,),
        ).fetchall()
        cats = []
        for r in rows:
            cats.append({
                "id": r["id"],
                "name": r["name"],
                "color": r["color"],
                "icon": r["icon"],
                "default_order": r["default_order"],
                # Serialised as a bool, exactly like GET /api/categories. It used to be the raw
                # int 1, so the same field had two shapes depending on which endpoint the caller
                # used (api.getCategories(true) hits this one). CategoriesView copes with both,
                # but one contract should have one shape.
                "active": r["active"] == 1,
                "user_id": r["user_id"],
            })
        return jsonify(cats), 200
    finally:
        conn.close()


@app.route("/api/categories", methods=["POST"])
@require_auth
def create_category():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Nazwa kategorii jest wymagana"}), 400

    color = (data.get("color") or "").strip()
    icon = data.get("icon", "\U0001f4c1")

    conn = get_connection()
    try:
        # Audit P1-27: the IntegrityError -> 409 branch was dead (no UNIQUE on
        # (user_id, name)), so duplicates were accepted with 201.
        dup = find_duplicate_category(conn, g.current_user_id, name)
        if dup:
            return jsonify({"error": f"Kategoria „{dup['name']}” już istnieje"}), 409
        raw_color = color
        color, color_ok = normalize_color(raw_color)
        if not color_ok and raw_color:
            # Empty color is silently defaulted; an explicit non-hex value is rejected.
            return jsonify({"error": "Kolor musi być wartością hex, np. #e74c3c"}), 400
        cur = conn.execute(
            "INSERT INTO Categories (name, color, icon, user_id) VALUES (?,?,?,?)",
            (name, color, icon, g.current_user_id),
        )
        conn.commit()
        new_row = conn.execute(
            "SELECT * FROM Categories WHERE id=?", (cur.lastrowid,)
        ).fetchone()
        return jsonify({
            "id": new_row["id"],
            "name": new_row["name"],
            "color": new_row["color"],
            "icon": new_row["icon"],
            "default_order": new_row["default_order"],
            "active": new_row["active"] == 1,
            "user_id": new_row["user_id"],
        }), 201
    except sqlite3.IntegrityError:
        conn.rollback()
        return jsonify({"error": "Kategoria już istnieje"}), 409
    finally:
        conn.close()


@app.route("/api/categories/<int:cid>", methods=["PUT"])
@require_auth
def update_category(cid):
    data = request.get_json(silent=True) or {}
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM Categories WHERE id=? AND user_id=?",
            (cid, g.current_user_id),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Nie znaleziono kategorii"}), 404

        # Audit P1-27: renaming onto an existing category name was allowed.
        if data.get("name") is not None:
            new_name = str(data["name"]).strip()
            if not new_name:
                return jsonify({"error": "Nazwa kategorii jest wymagana"}), 400
            dup = find_duplicate_category(conn, g.current_user_id, new_name, exclude_id=cid)
            if dup:
                return jsonify({"error": f"Kategoria „{dup['name']}” już istnieje"}), 409
            data["name"] = new_name

        if data.get("color") is not None:
            norm, color_ok = normalize_color(data["color"])
            if not color_ok:
                return jsonify({"error": "Kolor musi być wartością hex, np. #e74c3c"}), 400
            data["color"] = norm

        up_keys = ["name", "color", "icon", "default_order", "active"]
        set_clauses = []
        params = []
        for k in up_keys:
            if k in data and data[k] is not None:
                set_clauses.append(k + "=?" )
                params.append(data[k])

        if not set_clauses:
            return jsonify({"error": "Brak pola do aktualizacji"}), 400

        query_text = "UPDATE Categories SET " + ", ".join(set_clauses) + " WHERE id=? AND user_id=?"
        params.extend([cid, g.current_user_id])
        conn.execute(query_text, params)
        conn.commit()

        updated = conn.execute("SELECT * FROM Categories WHERE id=?", (cid,)).fetchone()
        return jsonify({
            "id": updated["id"],
            "name": updated["name"],
            "color": updated["color"],
            "icon": updated["icon"],
            "default_order": updated["default_order"],
            "active": updated["active"] == 1,
            "user_id": updated["user_id"],
        }), 200
    finally:
        conn.close()


@app.route("/api/categories/<int:cid>", methods=["DELETE"])
@require_auth
def delete_category(cid):
    uid = g.current_user_id
    conn = get_connection()
    try:
        # Audit P1-47: the deletes are scoped by user_id, so a foreign id removed nothing,
        # but the route answered 200 {"success": true} — a false success. PUT on the same
        # path answers 404, so align them.
        if not conn.execute(
            "SELECT id FROM Categories WHERE id=? AND user_id=?", (cid, uid)
        ).fetchone():
            return jsonify({"error": "Nie znaleziono kategorii"}), 404
        conn.execute("DELETE FROM Budgets WHERE category_id=? AND user_id=?", (cid, uid))
        conn.execute(
            "DELETE FROM Transactions WHERE user_id=? AND category_id=?",
            (uid, cid),
        )
        conn.execute("DELETE FROM Categories WHERE id=? AND user_id=?", (cid, uid))
        conn.commit()
        return jsonify({"success": True}), 200
    finally:
        conn.close()


# ---- BUDGETS ROUTES ----

def _budgets_view(conn, user_id, month_key):
    """Active categories + budget + spending + saldo + status for one month.

    Shared by the POST endpoint. The GET twin was an exact copy-paste (AGENTS.md §9.4)
    with no caller in the frontend (audit P0-25), so it is removed and this is the single
    implementation. Audit P0-7: SUM(amount) without a type filter counted 'Przychod' as
    spending, so the Budgets page reported "Przekroczony" whenever income was recorded.
    """
    first_of_month, next_first = month_window(*parse_month(month_key))

    budget_rows = conn.execute(
        """SELECT c.id AS cat_id, c.name, c.color, c.icon, b.id AS budget_id,
                COALESCE(b.amount_monthly, 0) AS budzet
        FROM Categories c
        LEFT JOIN Budgets b ON b.category_id=c.id AND b.month_year=? AND b.user_id=?
        WHERE c.user_id=? AND COALESCE(c.active,1)=1""",
        (month_key, user_id, user_id),
    ).fetchall()

    spending_rows = conn.execute(
        """SELECT category_id AS cat_id, ROUND(SUM(amount), 2) AS wydatki
           FROM Transactions
           WHERE user_id=? AND type='wydatek' AND date>=? AND date<?
           GROUP BY category_id""",
        (user_id, first_of_month, next_first),
    ).fetchall()

    spending_map = {}
    for sr in spending_rows:
        if sr["cat_id"] is not None and sr["wydatki"] is not None:
            spending_map[sr["cat_id"]] = float(sr["wydatki"])

    result = []
    for br in budget_rows:
        wydatki = spending_map.get(br["cat_id"], 0.0) or 0.0
        saldo = round(float(br["budzet"]) - wydatki, 2)
        status_note = "in_budget" if saldo >= 0 else "over_budget"
        result.append({
            "id": br["budget_id"],
            "cat_id": br["cat_id"],
            "category_id": br["cat_id"],
            "category_name": br["name"],
            "color": br["color"],
            "icon": br["icon"],
            "budzet": float(br["budzet"]),
            "wydatki": wydatki,
            "saldo": saldo,
            "status": status_note,
            "active": True,
        })
    return result


@app.route("/api/budgets/by-month-post", methods=["POST"])
@require_auth
def budgets_by_month_post():
    data = request.get_json(silent=True) or {}
    month = (data.get("month") or "").strip()
    if not month:
        month = datetime.now().strftime("%Y-%m")

    parsed = parse_month(month)
    if not parsed:
        return jsonify({"error": "Nieprawidłowy parametr miesiąca (oczekiwano YYYY-MM)"}), 400
    month_key = f"{parsed[0]}-{parsed[1]:02d}"

    conn = get_connection()
    try:
        return jsonify(_budgets_view(conn, g.current_user_id, month_key)), 200
    finally:
        conn.close()


@app.route("/api/budgets", methods=["POST"])
@require_auth
def create_budget():
    data = request.get_json(silent=True) or {}
    cat_id = data.get("category_id")
    amt = data.get("amount_monthly")
    my_str = (data.get("month_year") or "").strip()

    if cat_id is None or amt is None or not my_str:
        return jsonify({"error": "Brak wymaganych pól"}), 400

    try:
        cat_id = int(cat_id)
        amt = float(amt)
    except (ValueError, TypeError):
        return jsonify({"error": "Nieprawidłowy format"}), 400

    if amt < 0:
        return jsonify({"error": "Kwota budżetu nie może być ujemna"}), 400

    conn = get_connection()
    try:
        if not owns_category(conn, cat_id, g.current_user_id, require_active=True):
            return jsonify({"error": "Nie znaleziono kategorii"}), 400
        cur = conn.execute(
            "INSERT INTO Budgets (category_id, amount_monthly, month_year, user_id) VALUES (?,?,?,?)",
            (cat_id, amt, my_str, g.current_user_id),
        )
        conn.commit()
        return jsonify({"success": True}), 201
    except sqlite3.IntegrityError:
        conn.rollback()
        try:
            conn.execute(
                "UPDATE Budgets SET amount_monthly=? WHERE category_id=? AND month_year=? AND user_id=?",
                (amt, cat_id, my_str, g.current_user_id),
            )
            conn.commit()
            return jsonify({"success": True}), 200
        except Exception:
            conn.rollback()
            return jsonify({"error": "Aktualizacja nie powiodła się"}), 500
    finally:
        conn.close()


@app.route("/api/budgets/<int:bid>", methods=["PUT"])
@require_auth
def update_budget(bid):
    data = request.get_json(silent=True) or {}

    amt = None
    if "amount" in data or "amount_monthly" in data:
        try:
            amt = float(data.get("amount", data.get("amount_monthly")))
        except (ValueError, TypeError):
            return jsonify({"error": "Nieprawidłowy format"}), 400
        if amt < 0:
            return jsonify({"error": "Kwota nie może być ujemna"}), 400

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM Budgets WHERE id=? AND user_id=?",
            (bid, g.current_user_id),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Nie znaleziono budżetu"}), 401

        set_parts = []
        params_final = []
        if amt is not None:
            set_parts.append("amount_monthly=?")
            params_final.append(amt)

        params_final.extend([bid, g.current_user_id])

        if not set_parts:
            return jsonify({"error": "Brak pola do aktualizacji"}), 400

        query_text = "UPDATE Budgets SET " + ", ".join(set_parts) + " WHERE id=? AND user_id=?"
        conn.execute(query_text, params_final)
        conn.commit()
        return jsonify({"success": True}), 200
    finally:
        conn.close()


@app.route("/api/budgets/<int:bid>", methods=["DELETE"])
@require_auth
def delete_budget(bid):
    """Delete one budget row. Audit P1-48: this route did not exist, so a budget could only
    be zeroed and DELETE on the path answered 405. Uses 404 (not the PUT route's 401 quirk,
    which AGENTS.md §6.3 records as a legacy inconsistency).
    """
    conn = get_connection()
    try:
        if not conn.execute(
            "SELECT id FROM Budgets WHERE id=? AND user_id=?", (bid, g.current_user_id)
        ).fetchone():
            return jsonify({"error": "Nie znaleziono budżetu"}), 404
        conn.execute("DELETE FROM Budgets WHERE id=? AND user_id=?", (bid, g.current_user_id))
        conn.commit()
        return jsonify({"success": True}), 200
    finally:
        conn.close()


# ---- TRANSACTIONS ROUTES ----

@app.route("/api/transactions", methods=["GET"])
@require_auth
def get_transactions():
    month = request.args.get("month") or datetime.now().strftime("%Y-%m")
    cat_filter = request.args.get("category")
    keyword = request.args.get("keyword")

    if month == "all":
        # Explicit opt-out of the date filter (Tags tab needs the full history to match
        # its "all transactions" copy; the default is current-month, AGENTS.md §7.2).
        date_range = None
    else:
        parsed = parse_month(month)
        if not parsed:
            return jsonify({"error": "Nieprawidłowy parametr miesiąca (oczekiwano YYYY-MM)"}), 400
        date_range = month_window(*parsed)

    conn = get_connection()
    try:
        query_text = """SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
                   FROM Transactions t
                   JOIN Categories c ON c.id=t.category_id
                   WHERE t.user_id=?"""
        params = [g.current_user_id]
        if date_range:
            query_text += " AND t.date>=? AND t.date<?"
            params.extend(date_range)

        if cat_filter:
            try:
                cf_val = int(cat_filter)
                query_text += " AND t.category_id=?"
                params.append(cf_val)
            except (ValueError, TypeError):
                pass

        if keyword:
            kw_pattern = "%" + keyword + "%"
            query_text += " AND (t.description LIKE ? OR t.tags LIKE ?)"
            params.extend([kw_pattern, kw_pattern])

        query_text += " ORDER BY t.date DESC"

        rows = conn.execute(query_text, params).fetchall()
        result = []
        for r in rows:
            rd = {}
            for k in r.keys():
                v = r[k]
                if hasattr(v, "isoformat"):
                    v = v.isoformat()
                elif isinstance(v, str) and k == "tags":
                    try:
                        v = json.loads(v)
                    except Exception:
                        v = []
                rd[k] = v
            result.append(rd)
        return jsonify(result), 200
    finally:
        conn.close()


@app.route("/api/transactions", methods=["POST"])
@require_auth
def create_transaction():
    data = request.get_json(silent=True) or {}
    txn_type = (data.get("type") or "").strip()

    if txn_type not in ("wydatek", "Przychod"):
        return jsonify({"error": "Typ musi być „wydatek” lub „Przychod”"}), 400

    try:
        amt = float(data["amount"])
    except (ValueError, TypeError, KeyError):
        return jsonify({"error": "Kwota jest wymagana i musi być dodatnia"}), 400

    if amt <= 0:
        return jsonify({"error": "Kwota musi być większa od zera"}), 400

    date_str = (data.get("date") or "").strip()
    if not date_str:
        return jsonify({"error": "Data jest wymagana"}), 400
    date_str = normalize_date(date_str)
    if date_str is None:
        return jsonify({"error": "Nieprawidłowy format"}), 400

    cat_id = data.get("category_id")
    if cat_id is None:
        return jsonify({"error": "ID kategorii jest wymagane"}), 400
    try:
        cat_id = int(cat_id)
    except (ValueError, TypeError):
        return jsonify({"error": "Nieprawidłowe ID kategorii"}), 400

    description = data.get("description") or ""

    tags_raw = data.get("tags", [])
    tags_json_val = normalize_tags(tags_raw)
    if tags_json_val is None:
        return jsonify({"error": "Tagi muszą być tablicą JSON tekstów"}), 400

    conn = get_connection()
    try:
        if not owns_category(conn, cat_id, g.current_user_id, require_active=True):
            return jsonify({"error": "Nie znaleziono kategorii"}), 400
        cur = conn.execute(
            """INSERT INTO Transactions (user_id, category_id, date, amount, type, description, tags)
               VALUES (?,?,?,?,?,?,?)""",
            (g.current_user_id, cat_id, date_str, amt, txn_type, description, tags_json_val),
        )
        conn.commit()

        new_row = conn.execute("SELECT * FROM Transactions WHERE id=?", (cur.lastrowid,)).fetchone()
        rd = {}
        for k in new_row.keys():
            v = new_row[k]
            if hasattr(v, "isoformat"):
                v = v.isoformat()
            rd[k] = v

        try:
            rd["tags"] = json.loads(rd.get("tags", "[]"))
        except Exception:
            rd["tags"] = []

        return jsonify(rd), 201
    finally:
        conn.close()


@app.route("/api/transactions/<int:tid>", methods=["PUT"])
@require_auth
def update_transaction(tid):
    data = request.get_json(silent=True) or {}

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM Transactions WHERE id=? AND user_id=?",
            (tid, g.current_user_id),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Nie znaleziono transakcji"}), 403

        set_parts = []
        params_final = []

        if "type" in data:
            txn_type_val = data["type"]
            if txn_type_val not in ("wydatek", "Przychod"):
                return jsonify({"error": "Typ musi być „wydatek” lub „Przychod”"}), 400
            set_parts.append("type=?")
            params_final.append(txn_type_val)

        if "amount" in data:
            try:
                amt_val = float(data["amount"])
            except (ValueError, TypeError):
                return jsonify({"error": "Nieprawidłowy format"}), 400
            if amt_val <= 0:
                return jsonify({"error": "Kwota musi być większa od zera"}), 400
            set_parts.append("amount=?")
            params_final.append(amt_val)

        if "date" in data:
            dstr = normalize_date(data["date"])
            if dstr is None:
                return jsonify({"error": "Nieprawidłowy format"}), 400
            set_parts.append("date=?")
            params_final.append(dstr)

        if "category_id" in data:
            try:
                cid = int(data["category_id"])
            except (ValueError, TypeError):
                return jsonify({"error": "Nieprawidłowy format"}), 400
            # Ownership check (active not required: editing an existing row must keep working
            # for categories the user has since deactivated).
            if not owns_category(conn, cid, g.current_user_id):
                return jsonify({"error": "Nie znaleziono kategorii"}), 400
            set_parts.append("category_id=?")
            params_final.append(cid)

        if "description" in data:
            set_parts.append("description=?")
            params_final.append(data["description"])

        if "tags" in data:
            tags_json_val = normalize_tags(data["tags"])
            if tags_json_val is None:
                return jsonify({"error": "Tagi muszą być tablicą JSON tekstów"}), 400
            set_parts.append("tags=?")
            params_final.append(tags_json_val)

        if not set_parts:
            return jsonify({"error": "Brak pola do aktualizacji"}), 400

        query_text = "UPDATE Transactions SET " + ", ".join(set_parts) + " WHERE id=? AND user_id=?"
        params_final.extend([tid, g.current_user_id])
        conn.execute(query_text, params_final)
        conn.commit()
        return jsonify({"success": True}), 200
    finally:
        conn.close()


@app.route("/api/transactions/<int:tid>", methods=["DELETE"])
@require_auth
def delete_transaction(tid):
    uid = g.current_user_id
    conn = get_connection()
    try:
        chk = conn.execute(
            "SELECT id FROM Transactions WHERE id=? AND user_id=?",
            (tid, uid),
        ).fetchone()
        if not chk:
            return jsonify({"error": "Nie znaleziono transakcji"}), 403

        conn.execute("DELETE FROM Transactions WHERE id=?", (tid,))
        conn.commit()
        return jsonify({"success": True}), 200
    finally:
        conn.close()


@app.route("/api/tags/all", methods=["GET"])
@require_auth
def get_all_tags():
    conn = get_connection()
    try:
        try:
            # json_type()='array' is not decoration: json_each() on a JSON *object* succeeds and
            # yields its values, so a legacy row holding '{"a":1}' surfaced `1` (an int) as a tag
            # name. The write boundary rejects objects, so only pre-validation rows can hit this.
            rows = conn.execute(
                """SELECT DISTINCT json_each.value AS tag_name
                   FROM Transactions, json_each(Transactions.tags)
                   WHERE Transactions.user_id=? AND json_type(Transactions.tags)='array'""",
                (g.current_user_id,),
            ).fetchall()
        except sqlite3.OperationalError:
            # A legacy row holds a non-JSON `tags` value: json_each() aborts the whole scan,
            # which used to break the Tags tab permanently (audit P0-12). Parse in Python
            # and skip the bad row.
            rows = []
            for r in conn.execute(
                "SELECT tags FROM Transactions WHERE user_id=?", (g.current_user_id,)
            ).fetchall():
                try:
                    arr = json.loads(r["tags"])
                except Exception:
                    continue
                if isinstance(arr, list):
                    rows.extend([{"tag_name": str(x)} for x in arr])
        tags_list = [row["tag_name"] for row in rows if row["tag_name"]]
        return jsonify(tags_list), 200
    finally:
        conn.close()


def _transform_user_tags(conn, user_id, fn):
    """Apply fn(tags_list) -> new list to every transaction of `user_id`; write back changed rows.

    Tags are stored as a JSON array string, so set operations are far easier in Python
    than in SQL. Used by the delete/rename endpoints, which must cover the user's whole
    history — not just the current month (audit P0-23).
    """
    changed = 0
    for r in conn.execute(
        "SELECT id, tags FROM Transactions WHERE user_id=?", (user_id,)
    ).fetchall():
        try:
            arr = json.loads(r["tags"]) if r["tags"] else []
        except Exception:
            continue
        if not isinstance(arr, list):
            continue
        new = fn([str(x) for x in arr])
        if new != arr:
            conn.execute(
                "UPDATE Transactions SET tags=? WHERE id=? AND user_id=?",
                (json.dumps(new), r["id"], user_id),
            )
            changed += 1
    return changed


@app.route("/api/tags/<tag>", methods=["DELETE"])
@require_auth
def delete_tag(tag):
    conn = get_connection()
    try:
        n = _transform_user_tags(conn, g.current_user_id, lambda a: [x for x in a if x != tag])
        conn.commit()
        return jsonify({"removed_from": n}), 200
    finally:
        conn.close()


@app.route("/api/tags/<tag>", methods=["PUT"])
@require_auth
def rename_tag(tag):
    data = request.get_json(silent=True) or {}
    new_name = (data.get("new_name") or "").strip()
    if not new_name:
        return jsonify({"error": "Nowa nazwa tagu jest wymagana"}), 400
    conn = get_connection()
    try:
        # dict.fromkeys keeps order and dedups: renaming "a"->"b" in a transaction that
        # already carries "b" must not create a duplicate tag (audit P0-23).
        n = _transform_user_tags(
            conn, g.current_user_id,
            lambda a: list(dict.fromkeys([new_name if x == tag else x for x in a])),
        )
        conn.commit()
        return jsonify({"renamed_in": n}), 200
    finally:
        conn.close()


# ---- STATS ROUTES ----

@app.route("/api/stats/dashboard-data", methods=["POST"])
@require_auth
def dashboard_data():
    data = request.get_json(silent=True) or {}
    month_str = (data.get("month") or "").strip()

    now = datetime.now()
    if not month_str:
        # Audit P0-11: the old "default to current month" branch never set year_s/mon_s,
        # so the route 500'd with UnboundLocalError. Normalise the month up front.
        month_str = f"{now.year}-{str(now.month).zfill(2)}"

    parsed = parse_month(month_str)
    if not parsed:
        return jsonify({"error": "Nieprawidłowy parametr miesiąca (oczekiwano YYYY-MM)"}), 400
    year_s, mon_s = parsed[0], parsed[1]
    month_key = f"{year_s}-{mon_s:02d}"
    current_month_start, next_month_start = month_window(year_s, mon_s)

    conn = get_connection()
    try:
        total_row = conn.execute(
            "SELECT SUM(amount) AS t FROM Transactions WHERE user_id=? AND type='wydatek'",
            (g.current_user_id,),
        ).fetchone()
        total_spending_all_time = round(float(total_row["t"]) if total_row["t"] else 0, 2)

        month_rows = conn.execute(
            "SELECT SUM(amount) AS t FROM Transactions WHERE user_id=? AND type='wydatek' AND date>=? AND date<?",
            (g.current_user_id, current_month_start, next_month_start),
        ).fetchone()
        month_spending = round(float(month_rows["t"]) if month_rows["t"] else 0, 2)

        # Audit P1-46: `planned_all_time` and `chart_data` were computed here and never read
        # by the frontend (Dashboard uses total_all_time / month_total / prev_month_total /
        # current_planned / monthly_history, and the budget bars come from
        # POST /api/budgets/by-month-post). Both queries removed.

        # Previous month spending for comparison
        prev_first_month = int(mon_s) == 1
        if prev_first_month:
            prev_year_val = int(year_s) - 1
            prev_mon_val = 12
        else:
            prev_year_val = int(year_s)
            prev_mon_val = int(mon_s) - 1
        
        prev_month_start = f"{prev_year_val}-{str(prev_mon_val).zfill(2)}-01"
        nxt_prev_dt = datetime(prev_year_val, prev_mon_val, 1) + timedelta(days=32)
        prev_next_month = f"{nxt_prev_dt.year}-{str(nxt_prev_dt.month).zfill(2)}-01"

        prev_row = conn.execute(
            "SELECT SUM(amount) AS t FROM Transactions WHERE user_id=? AND type='wydatek' AND date>=? AND date<?",
            (g.current_user_id, prev_month_start, prev_next_month),
        ).fetchone()
        prev_month_spending = round(float(prev_row["t"]) if prev_row and prev_row["t"] else 0, 2)

      # Current month planned budgets only
        current_planned_row = conn.execute(
            """SELECT COALESCE(SUM(amount_monthly), 0) AS t FROM Budgets 
               WHERE user_id=? AND amount_monthly > 0 AND month_year=?""",
            (g.current_user_id, month_key),
        ).fetchone()
        current_planned = round(float(current_planned_row["t"]) if current_planned_row["t"] else 0, 2)

        # Historical monthly data (past 12 months + current)
        year_month_list = []
        for m_off in range(13):
            base_year = now.year + (now.month - 1 - m_off) // 12
            base_mon = ((now.month - 1 - m_off) % 12) + 1
            # Polish labels: the Dashboard renders these on the history chart, and the
            # surrounding cards use monthLabel() from utils/date.js. calendar.month_name
            # gave "October 26" in an otherwise Polish UI (audit P1-46).
            year_month_list.append((base_year, base_mon, MONTH_NAMES_PL[base_mon - 1]))

        # Audit P1-33: this loop used to run 2 queries per month (26 per request).
        # One grouped query per table covers the whole 13-month window.
        year_month_list.reverse()
        oldest_y, oldest_m = year_month_list[0][0], year_month_list[0][1]
        newest_y, newest_m = year_month_list[-1][0], year_month_list[-1][1]
        window_first = f"{oldest_y}-{str(oldest_m).zfill(2)}-01"
        nxt_after_newest = datetime(newest_y, newest_m, 1) + timedelta(days=32)
        window_end = f"{nxt_after_newest.year}-{str(nxt_after_newest.month).zfill(2)}-01"

        spend_by_month = {
            r["ym"]: float(r["t"]) if r["t"] else 0.0
            for r in conn.execute(
                """SELECT strftime('%Y-%m', date) AS ym, SUM(amount) AS t
                   FROM Transactions
                   WHERE user_id=? AND type='wydatek' AND date>=? AND date<?
                   GROUP BY ym""",
                (g.current_user_id, window_first, window_end),
            ).fetchall()
        }
        budget_by_month = {
            r["my"]: float(r["t"]) if r["t"] else 0.0
            for r in conn.execute(
                """SELECT month_year AS my, SUM(amount_monthly) AS t
                   FROM Budgets
                   WHERE user_id=? AND month_year>=? AND month_year<?
                   GROUP BY month_year""",
                (g.current_user_id, window_first[:7], window_end[:7]),
            ).fetchall()
        }

        months_history = []
        for yy, mm, mon_name in year_month_list:
            key = f"{yy}-{str(mm).zfill(2)}"
            months_history.append({
                "label": mon_name + " " + str(yy)[-2:],
                "actual": round(spend_by_month.get(key, 0.0), 2),
                "planned": round(budget_by_month.get(key, 0.0), 2),
            })

        return jsonify({
                "total_all_time": total_spending_all_time,
                "month_total": month_spending,
                "prev_month_total": prev_month_spending,
                "current_planned": current_planned,
                "monthly_history": months_history,
            }), 200
    finally:
        conn.close()



@app.route("/api/stats/year-summary", methods=["POST"])
@require_auth
def year_summary():
    data = request.get_json(silent=True) or {}
    # str() before .strip(): the frontend sends String(year), so an int year raised
    # AttributeError -> 500. The contract accepts both shapes.
    year_str = str(data.get("year") or "").strip()
    if not year_str or not str(year_str).isdigit():
        return jsonify({"error": "Parametr roku jest wymagany"}), 400

    conn = get_connection()
    try:
        start_year = int(year_str)
        next_year_start_date = f"{start_year + 1}-01-01"

        # Total spending for year
        total_row = conn.execute(
            "SELECT SUM(amount) AS t FROM Transactions WHERE user_id=? AND type='wydatek' AND date>=? AND date<?",
            (g.current_user_id, f"{start_year}-01-01", next_year_start_date),
        ).fetchone()
        total_spending = round(float(total_row["t"]) if total_row and total_row["t"] else 0, 2)

        # Total budget for year
        budget_total_row = conn.execute(
            "SELECT COALESCE(SUM(amount_monthly), 0) AS t FROM Budgets WHERE user_id=? AND month_year>=? AND month_year<?",
            (g.current_user_id, f"{start_year}-01", f"{start_year + 1}-01"),
        ).fetchone()
        total_budgeted = round(float(budget_total_row["t"]) if budget_total_row and budget_total_row["t"] else 0, 2)

        variance = round(total_budgeted - total_spending, 2)

        # Average monthly spending (by months with data)
        avg_rows = conn.execute(
            """SELECT SUM(amount) AS total_spend, COUNT(DISTINCT strftime('%Y-%m', date)) AS months_count
               FROM Transactions WHERE user_id=? AND type='wydatek' AND date>=? AND date<?""",
            (g.current_user_id, f"{start_year}-01-01", next_year_start_date),
        ).fetchone()

        total_spend_for_avg = float(avg_rows["total_spend"]) if avg_rows and avg_rows["total_spend"] else 0
        months_count = int(avg_rows["months_count"]) if avg_rows and avg_rows["months_count"] else 12
        avg_monthly_spending = round(total_spend_for_avg / max(months_count, 1), 2)
        avg_monthly_budgeted = round(total_budgeted / 12, 2) if total_budgeted > 0 else 0

        spend_rate = None
        if total_budgeted > 0:
            spend_rate = round((total_spending / total_budgeted) * 100, 1)

        # Monthly breakdown with budget and spending per month
        monthly_summary_raw = conn.execute(
            """SELECT b.month_year, SUM(b.amount_monthly) AS budg
               FROM Budgets b 
               WHERE b.user_id=? AND LENGTH(b.month_year)=7 AND b.month_year>=? AND b.month_year<?
               GROUP BY b.month_year""",
            (g.current_user_id, f"{start_year}-01", f"{start_year + 1}-01"),
        ).fetchall()

        budget_map = {}
        for br in monthly_summary_raw:
            val = float(br["budg"]) if br["budg"] else 0.0
            mk = br["month_year"][:7]
            budget_map[mk] = val

        month_names_pl = MONTH_NAMES_PL

        now = datetime.now()
        
        # Audit P1-33: one grouped query replaces the 12 per-month SUM(amount) queries.
        spend_by_month = {
            r["ym"]: float(r["t"]) if r["t"] else 0.0
            for r in conn.execute(
                """SELECT strftime('%Y-%m', date) AS ym, SUM(amount) AS t
                   FROM Transactions
                   WHERE user_id=? AND type='wydatek' AND date>=? AND date<?
                   GROUP BY ym""",
                (g.current_user_id, f"{start_year}-01-01", next_year_start_date),
            ).fetchall()
        }

        monthly_summary = []
        for m in range(1, 13):
            month_key = f"{start_year}-{str(m).zfill(2)}"
            
            if start_year == now.year and m > now.month:
                break
                
            mon_budgeted = budget_map.get(month_key, 0)
            actual = round(spend_by_month.get(month_key, 0.0), 2)
            monthly_summary.append({
                "month": m,
                "label": month_names_pl[m - 1],
                "spending": actual,
                "budget": mon_budgeted,
                "balance": round(mon_budgeted - actual, 2),
                "on_budget": False if (mon_budgeted == 0 and actual > 0) else (True if (mon_budgeted == 0) else (actual <= mon_budgeted)),
            })

      # Category variance for the year (top deviation per active category)
        cat_rows = conn.execute(
            """SELECT c.id AS cid, c.name, c.color, 
                  COALESCE(SUM(t.amount), 0) AS total_spend
               FROM Categories c
               LEFT JOIN Transactions t ON t.category_id=c.id AND t.user_id=? AND t.type='wydatek' AND t.date>=? AND t.date<?
               WHERE c.active=1 AND c.user_id=?
               GROUP BY c.id""",
            (g.current_user_id, f"{start_year}-01-01", next_year_start_date, g.current_user_id),
        ).fetchall()

        cr_budget_rows = conn.execute(
            """SELECT category_id AS cid, SUM(amount_monthly) AS total_budg
               FROM Budgets 
               WHERE user_id=? AND month_year>=? AND month_year<?
               GROUP BY category_id""",
            (g.current_user_id, f"{start_year}-01", f"{start_year + 1}-01"),
        ).fetchall()

        budget_map_cat = {}
        for brb in cr_budget_rows:
            budget_map_cat[int(brb["cid"])] = float(brb["total_budg"]) if brb["total_budg"] else 0.0

        cat_variance = []
        for cr in cat_rows:
            cid = int(cr["cid"])
            spend_val = round(float(cr["total_spend"]) if cr["total_spend"] else 0, 2)
            bval = budget_map_cat.get(cid, 0.0)
            var_val = round(bval - spend_val, 2)

            cat_variance.append({
                "name": cr["name"],
                "color": cr["color"] or "#94a3b8",
                "cid": cid,
                "spending": abs(spend_val),
                "budgeted": round(bval, 2),
                "variance": var_val,
            })

        cat_variance.sort(key=lambda x: abs(x["variance"]), reverse=True)

        return jsonify({
            "year": start_year,
            "total_spending": total_spending,
            "total_budgeted": total_budgeted,
            "variance": variance,
            "avg_monthly_spending": avg_monthly_spending,
            "avg_monthly_budgeted": avg_monthly_budgeted,
            "spend_rate": spend_rate,
            "monthly_summary": monthly_summary,
            "category_variance": cat_variance,
        }), 200
    finally:
        conn.close()


# ---- ERROR HANDLERS ----

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Nie znaleziono zasobu"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    # AGENTS.md §6.1: errors are JSON. Without this handler Flask answers an HTML 405, which
    # `api.js` cannot read (`data.error` is undefined → the toast shows "undefined").
    # Reached by GET on POST-only routes, e.g. /api/budgets/by-month-post (audit P0-25).
    return jsonify({"error": "Metoda nie jest dozwolona"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Wewnętrzny błąd serwera"}), 500


# ---- APP STARTUP ----


init_db()

if __name__ == "__main__":
    app.run(debug=DEBUG, host="127.0.0.1", port=3001)

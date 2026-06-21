import os
import json
import calendar
import random
import jwt as pyjwt
from datetime import datetime, timedelta, timezone

import sqlite3
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from database import create_tables, get_connection, DB_PATH
from functools import wraps


SECRET_KEY = os.environ.get("SECRET_KEY", "planowanie-wydatkow-jwt")

app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid token"}), 401
        token = auth_header.split(" ", 1)[1]
        try:
            payload = __decode_jwt(token)
            g.current_user_id = payload["user_id"]
            g.current_username = payload["username"]
        except Exception:
            return jsonify({"error": "Invalid or expired token"}), 401
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


def seed_categories(conn):
    _seed_categories_for_user(conn, 1)


CATEGORY_NAMES = ["Jedzenie", "Transport", "Mieszkanie", "Rozrywka", "Zdrowie",
                  "Edukacja", "Ubrania", "Telefon / Internet", "Czynsz", "Prezent"]

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

        # Populate category ID cache once for seeding
        global CATEGORY_IDS_CACHE
        cat_rows = conn.execute(
            "SELECT id FROM Categories ORDER BY default_order ASC"
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
        return jsonify({"error": "Username required"}), 400
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters"}), 400
    if password != confirm_password:
        return jsonify({"error": "Passwords do not match"}), 400

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM Users WHERE username=?", (username,)
        ).fetchone()
        if existing:
            return jsonify({"error": "User already exists"}), 409

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
        return jsonify({"error": "User already exists"}), 409
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
            return jsonify({"error": "Bad username/password"}), 401

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
                "active": 1,
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
        return jsonify({"error": "Name required"}), 400

    color = (data.get("color") or "").strip()
    icon = data.get("icon", "\U0001f4c1")

    conn = get_connection()
    try:
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
        return jsonify({"error": "Category already exists"}), 409
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
            return jsonify({"error": "Not found"}), 404

        up_keys = ["name", "color", "icon", "default_order", "active"]
        set_clauses = []
        params = []
        for k in up_keys:
            if k in data and data[k] is not None:
                set_clauses.append(k + "=?" )
                params.append(data[k])

        if not set_clauses:
            return jsonify({"error": "No valid fields to update"}), 400

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
        conn.execute("DELETE FROM Budgets WHERE category_id=?", (cid,))
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

@app.route("/api/budgets", methods=["GET"])
@require_auth
def get_budgets():
    month = request.args.get("month")
    if not month:
        return jsonify({"error": "Month parameter required"}), 400

    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT b.id, b.amount_monthly AS budzet, b.month_year,
                      c.name AS category_name, c.color, c.active, c.icon
               FROM Budgets b
               JOIN Categories c ON c.id=b.category_id
               WHERE b.user_id=? AND b.month_year=?
               ORDER BY c.default_order ASC""",
            (g.current_user_id, month),
        ).fetchall()

        result = []
        for r in rows:
            result.append({
                "id": r["id"],
                "budzet": r["budzet"],
                "month_year": r["month_year"],
                "category_name": r["category_name"],
                "color": r["color"],
                "active": r["active"] == 1,
                "icon": r["icon"],
            })
        return jsonify(result), 200
    finally:
        conn.close()


@app.route("/api/budgets/by-month", methods=["GET"])
@require_auth
def budgets_by_month():
    month = request.args.get("month")
    if not month:
        month = datetime.now().strftime("%Y-%m")

    conn = get_connection()
    try:
        parts = month.split("-", 1)
        year_str, mon_str = parts[0], parts[1]
        first_of_month = "{:s}-{:02d}-01".format(year_str, int(mon_str))
        nxt = datetime(int(year_str), int(mon_str), 1) + timedelta(days=32)
        next_first = nxt.strftime("%Y-%m") + "-01"

        budget_rows = conn.execute(
            """SELECT c.id AS cat_id, c.name, c.color, c.icon, b.id AS budget_id,
                    COALESCE(b.amount_monthly, 0) AS budzet
            FROM Categories c
            LEFT JOIN Budgets b ON b.category_id=c.id AND b.month_year=? AND b.user_id=?
            WHERE c.user_id=?""",
            (month, g.current_user_id, g.current_user_id),
        ).fetchall()

        spending_rows = conn.execute(
            """SELECT category_id AS cat_id, ROUND(SUM(amount), 2) AS wydatki
               FROM Transactions
               WHERE user_id=? AND date>=? AND date<?
               GROUP BY category_id""",
            (g.current_user_id, first_of_month, next_first),
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

        return jsonify(result), 200
    finally:
        conn.close()


@app.route("/api/budgets/by-month-post", methods=["POST"])
@require_auth
def budgets_by_month_post():
    data = request.get_json(silent=True) or {}
    month = (data.get("month") or "").strip()
    if not month:
        month = datetime.now().strftime("%Y-%m")

    conn = get_connection()
    try:
        parts = month.split("-", 1)
        year_str, mon_str = parts[0], parts[1]
        first_of_month = "{:s}-{:02d}-01".format(year_str, int(mon_str))
        nxt = datetime(int(year_str), int(mon_str), 1) + timedelta(days=32)
        next_first = nxt.strftime("%Y-%m") + "-01"

        budget_rows = conn.execute(
            """SELECT c.id AS cat_id, c.name, c.color, c.icon, b.id AS budget_id,
                    COALESCE(b.amount_monthly, 0) AS budzet
            FROM Categories c
            LEFT JOIN Budgets b ON b.category_id=c.id AND b.month_year=? AND b.user_id=?
            WHERE c.user_id=?""",
            (month, g.current_user_id, g.current_user_id),
        ).fetchall()

        spending_rows = conn.execute(
            """SELECT category_id AS cat_id, ROUND(SUM(amount), 2) AS wydatki
               FROM Transactions
               WHERE user_id=? AND date>=? AND date<?
               GROUP BY category_id""",
            (g.current_user_id, first_of_month, next_first),
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

        return jsonify(result), 200
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
        return jsonify({"error": "Missing required fields"}), 400

    try:
        cat_id = int(cat_id)
        amt = float(amt)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid format"}), 400

    if amt < 0:
        return jsonify({"error": "amount_monthly cannot be negative"}), 400

    conn = get_connection()
    try:
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
            return jsonify({"error": "Update failed"}), 500
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
            return jsonify({"error": "Invalid format"}), 400
        if amt < 0:
            return jsonify({"error": "amount cannot be negative"}), 400

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM Budgets WHERE id=? AND user_id=?",
            (bid, g.current_user_id),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Not found"}), 401

        set_parts = []
        params_final = []
        if amt is not None:
            set_parts.append("amount_monthly=?")
            params_final.append(amt)

        params_final.extend([bid, g.current_user_id])

        if not set_parts:
            return jsonify({"error": "No valid fields to update"}), 400

        query_text = "UPDATE Budgets SET " + ", ".join(set_parts) + " WHERE id=? AND user_id=?"
        conn.execute(query_text, params_final)
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

    parts = month.split("-", 1)
    year_s, mon_s = parts[0], parts[1]
    first_of_month = "{:s}-{:02d}-01".format(year_s, int(mon_s))
    nxt = datetime(int(year_s), int(mon_s), 1) + timedelta(days=32)
    next_first = nxt.strftime("%Y-%m") + "-01"

    conn = get_connection()
    try:
        query_text = """SELECT t.*, c.name AS category_name, c.color, c.icon
                   FROM Transactions t
                   JOIN Categories c ON c.id=t.category_id
                   WHERE t.user_id=? AND t.date>=? AND t.date<?"""
        params = [g.current_user_id, first_of_month, next_first]

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
        return jsonify({"error": "Type must be wydatek or Przychod"}), 400

    try:
        amt = float(data["amount"])
    except (ValueError, TypeError, KeyError):
        return jsonify({"error": "Amount is required and must be positive"}), 400

    if amt <= 0:
        return jsonify({"error": "Amount must be greater than 0"}), 400

    date_str = (data.get("date") or "").strip()
    if not date_str:
        return jsonify({"error": "Date is required"}), 400
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Invalid format"}), 400

    cat_id = data.get("category_id")
    if cat_id is None:
        return jsonify({"error": "Category ID required"}), 400

    description = data.get("description") or ""

    tags_raw = data.get("tags", [])
    if isinstance(tags_raw, list):
        tags_json_val = json.dumps(tags_raw)
    elif isinstance(tags_raw, str):
        tags_json_val = tags_raw
    else:
        tags_json_val = "[]"

    conn = get_connection()
    try:
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
            return jsonify({"error": "Not found"}), 403

        set_parts = []
        params_final = []

        if "type" in data:
            txn_type_val = data["type"]
            if txn_type_val not in ("wydatek", "Przychod"):
                return jsonify({"error": "Type must be wydatek or Przychod"}), 400
            set_parts.append("type=?")
            params_final.append(txn_type_val)

        if "amount" in data:
            try:
                amt_val = float(data["amount"])
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid format"}), 400
            if amt_val <= 0:
                return jsonify({"error": "Amount must be greater than 0"}), 400
            set_parts.append("amount=?")
            params_final.append(amt_val)

        if "date" in data:
            dstr = data["date"]
            try:
                datetime.strptime(dstr, "%Y-%m-%d")
            except ValueError:
                return jsonify({"error": "Invalid format"}), 400
            set_parts.append("date=?")
            params_final.append(dstr)

        if "category_id" in data:
            try:
                cid = int(data["category_id"])
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid format"}), 400
            set_parts.append("category_id=?")
            params_final.append(cid)

        if "description" in data:
            set_parts.append("description=?")
            params_final.append(data["description"])

        if "tags" in data:
            tj = data["tags"]
            if isinstance(tj, list):
                tags_json_val = json.dumps(tj)
            elif isinstance(tj, str):
                tags_json_val = tj
            else:
                tags_json_val = "[]"
            set_parts.append("tags=?")
            params_final.append(tags_json_val)

        if not set_parts:
            return jsonify({"error": "No fields to update"}), 400

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
            return jsonify({"error": "Not found"}), 403

        conn.execute("DELETE FROM Transactions WHERE id=?", (tid,))
        conn.commit()
        return jsonify({"success": True}), 200
    finally:
        conn.close()


@app.route("/api/transactions/recent", methods=["GET"])
@require_auth
def recent_transactions():
    try:
        limit_val = int(request.args.get("limit") or 10)
    except (ValueError, TypeError):
        limit_val = 10

    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT t.*, c.name AS category_name, c.color, c.icon
               FROM Transactions t
               JOIN Categories c ON c.id=t.category_id
               WHERE t.user_id=?
               ORDER BY t.created_at DESC
               LIMIT ?""",
            (g.current_user_id, limit_val),
        ).fetchall()

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


# ---- TAGS ROUTES ----

@app.route("/api/tags/all", methods=["GET"])
@require_auth
def get_all_tags():
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT DISTINCT json_each.value AS tag_name
               FROM Transactions, json_each(Transactions.tags)
               WHERE Transactions.user_id=?""",
            (g.current_user_id,),
        ).fetchall()
        tags_list = [row["tag_name"] for row in rows if row["tag_name"]]
        return jsonify(tags_list), 200
    finally:
        conn.close()


# ---- STATS ROUTES ----

@app.route("/api/stats/month-summary", methods=["POST"])
@require_auth
def month_summary_stats():
    data = request.get_json(silent=True) or {}
    month = (data.get("month") or "").strip()
    if not month:
        return jsonify({"error": "Month parameter required"}), 400

    parts = month.split("-", 1)
    year_s, mon_s = parts[0], parts[1]
    first_of_month = "{:s}-{:02d}-01".format(year_s, int(mon_s))
    nxt = datetime(int(year_s), int(mon_s), 1) + timedelta(days=32)
    next_first = nxt.strftime("%Y-%m") + "-01"

    conn = get_connection()
    try:
        cat_rows = conn.execute(
            """SELECT c.id AS cat_id, c.name, c.color, COALESCE(b.amount_monthly, 0) AS budget
               FROM Categories c
               LEFT JOIN Budgets b ON b.category_id=c.id AND b.month_year=? AND b.user_id=?
               WHERE c.active=1""",
            (month, g.current_user_id),
        ).fetchall()

        spend_rows = conn.execute(
            """SELECT category_id AS cat_id, SUM(amount) AS expenditure
               FROM Transactions
               WHERE user_id=? AND date>=? AND date<?
               GROUP BY category_id""",
            (g.current_user_id, first_of_month, next_first),
        ).fetchall()

        spend_map = {}
        for sr in spend_rows:
            if sr["cat_id"] is not None and sr["expenditure"] is not None:
                spend_map[sr["cat_id"]] = float(sr["expenditure"])

        categories_out = []
        total_remaining_budzet = 0.0
        real_total_spending = 0.0

        for cr in cat_rows:
            expenditure = spend_map.get(cr["cat_id"], 0.0) or 0.0
            budget_val = float(cr["budget"])
            balance = round(budget_val - expenditure, 2)
            status_str = "in_budget" if balance >= 0 else "over_budget"

            categories_out.append({
                "name": cr["name"],
                "color": cr["color"],
                "expenditure": round(expenditure, 2),
                "budget": budget_val,
                "status": status_str,
                "balance": balance,
            })

            total_remaining_budzet += max(0.0, balance)
            real_total_spending += expenditure

        return jsonify({
            "categories": categories_out,
            "total_remaining_budzet": round(total_remaining_budzet, 2),
            "real_total_spending": round(real_total_spending, 2),
        }), 200
    finally:
        conn.close()


@app.route("/api/stats/dashboard-data", methods=["POST"])
@require_auth
def dashboard_data():
    data = request.get_json(silent=True) or {}
    month_str = (data.get("month") or "").strip()

    now = datetime.now()
    current_month_start = f"{now.year}-{str(now.month).zfill(2)}-01"
    nxt_dt = (datetime(now.year, now.month, 1) + timedelta(days=32))
    next_month_start = f"{nxt_dt.year}-{str(nxt_dt.month).zfill(2)}-01"

    if month_str:
        parts_splitted = month_str.split("-", 1)
        year_s, mon_s = parts_splitted[0], parts_splitted[1]
        current_month_start = f"{year_s}-{mon_s}-01"
        nxt_dt2 = datetime(int(year_s), int(mon_s), 1) + timedelta(days=32)
        next_month_start = f"{nxt_dt2.year}-{str(nxt_dt2.month).zfill(2)}-01"

    conn = get_connection()
    try:
        # Total wydatki all time
        total_row = conn.execute(
            "SELECT SUM(amount) AS t FROM Transactions WHERE user_id=? AND type='wydatek'",
            (g.current_user_id,),
        ).fetchone()
        total_spending_all_time = round(float(total_row["t"]) if total_row["t"] else 0, 2)

        # Wydatki w tym miesiącu
        month_rows = conn.execute(
            "SELECT SUM(amount) AS t FROM Transactions WHERE user_id=? AND type='wydatek' AND date>=? AND date<?",
            (g.current_user_id, current_month_start, next_month_start),
        ).fetchone()
        month_spending = round(float(month_rows["t"]) if month_rows["t"] else 0, 2)

        # Planowane wydatki (aktywne budżety + bieżący miesiąc przyszłych lub aktualny)
        planned_row_all_time = conn.execute(
            """SELECT COALESCE(SUM(amount_monthly), 0) AS t FROM Budgets 
               WHERE user_id=? AND amount_monthly > 0""",
            (g.current_user_id,),
        ).fetchone()
        planned_total_all_time = round(float(planned_row_all_time["t"]) if planned_row_all_time["t"] else 0, 2)

        # Current month planned budgets only
        current_planned_row = conn.execute(
            """SELECT COALESCE(SUM(amount_monthly), 0) AS t FROM Budgets 
               WHERE user_id=? AND amount_monthly > 0 AND month_year=?""",
            (g.current_user_id, f"{now.year}-{str(now.month).zfill(2)}"),
        ).fetchone()
        current_planned = round(float(current_planned_row["t"]) if current_planned_row["t"] else 0, 2)

        # Per-category breakdown for chart (all time by category with colors)
        cat_trend_rows = conn.execute(
            """SELECT c.name, c.color, COALESCE(SUM(t.amount), 0) AS total,
                      COUNT(t.id) as cnt
               FROM Categories c
               LEFT JOIN Transactions t ON t.category_id=c.id AND t.user_id=? AND t.type='wydatek'
               WHERE c.active=1
               GROUP BY c.id ORDER BY total DESC LIMIT 20""",
            (g.current_user_id,),
        ).fetchall()

        chart_data = []
        for cr in cat_trend_rows:
            if cr["total"] > 0:
                chart_data.append({
                    "name": cr["name"],
                    "color": cr["color"],
                    "value": round(float(cr["total"]), 2),
                })

        # Historical monthly data (past 12 months + current)
        year_month_list = []
        for m_off in range(13):
            base_year = now.year + (now.month - 1 - m_off) // 12
            base_mon = ((now.month - 1 - m_off) % 12) + 1
            year_month_list.append((base_year, base_mon, calendar.month_name[base_mon]))

        months_history = []
        for yy, mm, mon_name in reversed(year_month_list):
            first_d = f"{yy}-{str(mm).zfill(2)}-01"
            nxt_d_dt = datetime(yy, mm, 1) + timedelta(days=32)
            next_d = f"{nxt_d_dt.year}-{str(nxt_d_dt.month).zfill(2)}-01"

            row = conn.execute(
                "SELECT SUM(amount) AS t FROM Transactions WHERE user_id=? AND type='wydatek' AND date>=? AND date<?",
                (g.current_user_id, first_d, next_d),
            ).fetchone()

            budget_row = conn.execute(
                "SELECT COALESCE(SUM(amount_monthly), 0) AS t FROM Budgets WHERE user_id=? AND month_year=?",
                (g.current_user_id, f"{yy}-{str(mm).zfill(2)}"),
            ).fetchone()

            months_history.append({
                "label": mon_name + " " + str(yy)[-2:],
                "actual": round(float(row["t"]) if row and row["t"] else 0, 2),
                "planned": round(float(budget_row["t"]) if budget_row and budget_row["t"] else 0, 2),
            })

        return jsonify({
            "total_all_time": total_spending_all_time,
            "month_total": month_spending,
            "planned_all_time": planned_total_all_time,
            "current_planned": current_planned,
            "chart_data": chart_data,
            "monthly_history": months_history,
        }), 200
    finally:
        conn.close()


# ---- ERROR HANDLERS ----

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


# ---- APP STARTUP ----


init_db()

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=3001)

import sqlite3
import os


APP_ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_ROOT, 'data', 'baza.db')


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate_budgets_fk(conn):
    """Rebuild Budgets so a deleted category cascades instead of SET NULL.

    The original DDL combined `NOT NULL` with `ON DELETE SET NULL`: deleting a category
    tried to null out its budgets, which violates NOT NULL and aborts the whole delete
    with IntegrityError (audit P0-8 — reproduced as a 500). `CREATE TABLE IF NOT EXISTS`
    never alters an existing table, so existing databases need an explicit rebuild.
    """
    row = conn.execute(
        "SELECT `sql` FROM sqlite_master WHERE type='table' AND name='Budgets'"
    ).fetchone()
    if not row:
        return
    ddl = row[0] if not isinstance(row, dict) else row["sql"]
    if "ON DELETE CASCADE" in (ddl or ""):
        return

    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute(
        """CREATE TABLE Budgets_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL REFERENCES Categories(id) ON DELETE CASCADE,
            amount_monthly REAL DEFAULT 0 CHECK(amount_monthly >= 0),
            month_year TEXT NOT NULL,
            user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
            UNIQUE(category_id, month_year, user_id)
        )"""
    )
    conn.execute("INSERT INTO Budgets_new SELECT * FROM Budgets")
    conn.execute("DROP TABLE Budgets")
    conn.execute("ALTER TABLE Budgets_new RENAME TO Budgets")
    conn.execute("PRAGMA foreign_key_check")
    conn.execute("PRAGMA foreign_keys = ON")


def create_tables():
    conn = get_connection()
    cursor = conn.cursor()

    for stmt in SCHEMA:
        cursor.execute(stmt)
    _migrate_budgets_fk(conn)

    conn.commit()
    conn.close()


SCHEMA = [
    """CREATE TABLE IF NOT EXISTS Users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",

    """CREATE TABLE IF NOT EXISTS Categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT DEFAULT '📁',
        default_order INTEGER DEFAULT 999,
        active INTEGER DEFAULT 1,
        user_id INTEGER REFERENCES Users(id) ON DELETE SET NULL
    )""",

    """CREATE TABLE IF NOT EXISTS Budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES Categories(id) ON DELETE CASCADE,
        amount_monthly REAL DEFAULT 0 CHECK(amount_monthly >= 0),
        month_year TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
        UNIQUE(category_id, month_year, user_id)
    )""",

    """CREATE TABLE IF NOT EXISTS Transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES Users(id) ON DELETE SET NULL,
        category_id INTEGER REFERENCES Categories(id) ON DELETE SET NULL,
        date DATE NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0),
        type TEXT NOT NULL CHECK(type IN ('wydatek', 'Przychod')),
        description TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )"""
]

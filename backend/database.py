import sqlite3
import os


APP_ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_ROOT, 'data', 'baza.db')


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def create_tables():
    conn = get_connection()
    cursor = conn.cursor()

    for stmt in SCHEMA:
        cursor.execute(stmt)

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
        category_id INTEGER NOT NULL REFERENCES Categories(id) ON DELETE SET NULL,
        amount_monthly REAL DEFAULT 0 CHECK(amount_monthly >= 0),
        month_year TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE SET NULL,
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

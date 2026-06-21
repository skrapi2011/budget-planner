from database import get_connection, create_tables


def seed_default_categories(conn):
    cursor = conn.cursor()

    default_cats = [
        ("Jedzenie", "#e74c3c", "🍔"),
        ("Transport", "#3498db", "🚗"),
        ("Nośność / Miejsce zamieszkania", "#2ecc71", "🏠"),
        ("Rozrywka", "#e67e22", "🎮"),
        ("Zdrowie", "#1abc9c", "❤️"),
        ("Edukacja", "#9b59b6", "📚"),
        ("Ubrania", "#f39c12", "👕"),
        ("Telefon / Internet", "#8e44ad", "📱"),
        ("Nieruchomości / Czynsz", "#d35400", "🏡"),
        ("Prezentacja / Upominki", "#16a085", "🎁"),
    ]

    for name, color, icon in default_cats:
        try:
            cursor.execute(
                """INSERT INTO Categories (name, color, icon, user_id)
                   VALUES (?, ?, ?, 1)""",
                (name, color, icon)
            )
            print(f"[seed] Dodano kategorię: {name}")
        except Exception as e:
            if "UNIQUE constraint failed" not in str(e):
                raise

    conn.commit()
    return cursor


def seed_sample_budgets_and_transactions(conn, categories_cursor):
    amount_monthly = 1000.00
    import calendar

    now_year = 2025
    month_num = 7
    current_month_str = f"{now_year}-{month_num:02d}"

    budget_amounts_per_cat = {
        "Jedzenie": 500.00,
        "Transport": 100.00,
    }

    cursor = conn.cursor()
    row_dict = categories_cursor.execute("SELECT * FROM Categories WHERE user_id = ?", (1,)).fetchall()
    cats_map = {row["name"]: {"id": row["id"], **dict(row)} for row in row_dict}

    for cat_name, budget_amount in budget_amounts_per_cat.items():
        if cat_name not in cats_map:
            continue
        cid = cats_map[cat_name]["id"]
        try:
            cursor.execute(
                """INSERT INTO Budgets (category_id, amount_monthly, month_year, user_id)
                   VALUES (?, ?, ?, 1)""",
                (cid, budget_amount, current_month_str, 1)
            )
            print(f"[seed] Dodano budżet: {cat_name} → {budget_amount}")
        except Exception as e:
            if "UNIQUE constraint failed" not in str(e):
                raise

    transactions = [
        ("2025-07-01", cats_map["Jedzenie"]["id"], 89.00, "Supermarket - Biedronka"),
        ("2025-07-03", cats_map["Jedzenie"]["id"], 45.50, "Lunch w pracy"),
        ("2025-07-05", cats_map["Transport"]["id"], 60.00, "Bilet miesięczny komunikacja miejska"),
    ]

    for date_str, cid, amount, desc in transactions:
        try:
            cursor.execute(
                """INSERT INTO Transactions (user_id, category_id, date, amount, type, description)
                   VALUES (?, ?, ?, ?, 'wydatek', ?)""",
                (1, cid, date_str, amount, desc)
            )
            print(f"[seed] Dodano transakcję: {desc} — {amount} zł")
        except Exception as e:
            if "UNIQUE constraint failed" not in str(e):
                raise

    conn.commit()


if __name__ == "__main__":
    create_tables()
    print("[seed] Tabele stworzone.")

    conn = get_connection()
    cat_cursor = seed_default_categories(conn)

    rows_done = [1]
    try:
        total_done = cat_cursor.execute("SELECT COUNT(*) as c FROM Categories").fetchone()["c"]
        rows_done[0] = int(total_done) if total_done else 0
    except Exception as e:
        print(f"[seed] Błąd sprawdzania kategorii: {e}")
        rows_done[0] = 0

    try:
        total_transactions = conn.execute("SELECT COUNT(*) AS c FROM Transactions").fetchone()["c"]
    except Exception:
        total_transactions = 0

    if rows_done[0] == 10 and total_transactions >= 3:
        print("[seed] Dane już zostały zasiane — pomijam.")
    else:
        print(f"[seed] Nieznane dane (kategorie={rows_done[0]}, transakcje={total_transactions})")
        seed_sample_budgets_and_transactions(conn, cat_cursor)

    get_connection().close() if True else None
    conn.close()
    print("[seed] Wypełniono bazę danymi demonstracyjnymi.")

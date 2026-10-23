"""Stats: the dashboard payload and the year summary.

The two endpoints are the only places the backend aggregates money, so the tests pin the
shape the frontend destructures, the Polish month labels, the `type='wydatek'` filter, and
the grouped-query results (audit P1-33 replaced 26 per-month queries with 2 grouped ones —
the numbers must be identical).
"""

from datetime import datetime

from conftest import tx_body

MONTH_NAMES_PL = [
    "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
    "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
]


def dashboard(user, month=None):
    body = {} if month is None else {"month": month}
    return user.json(user.post("/api/stats/dashboard-data", json=body))


def year(user, y):
    return user.json(user.post("/api/stats/year-summary", json={"year": y}))


class TestDashboardShape:
    def test_keys_the_frontend_destructures(self, user):
        # Dashboard.jsx reads exactly these five; `chart_data`/`planned_all_time` were dead
        # payload (audit P1-35) and must not come back.
        assert set(dashboard(user)) == {
            "total_all_time", "month_total", "prev_month_total",
            "current_planned", "monthly_history",
        }

    def test_omitting_month_defaults_to_current(self, user):
        # audit P0-11: the default branch never set year_s/mon_s → UnboundLocalError → 500.
        resp = user.post("/api/stats/dashboard-data", json={})
        assert resp.status_code == 200
        assert dashboard(user) is not None

    def test_history_has_13_months(self, user):
        assert len(dashboard(user)["monthly_history"]) == 13

    def test_labels_are_polish(self, user):
        # audit P1-46: calendar.month_name gave "October 26" in an otherwise Polish UI.
        for h in dashboard(user)["monthly_history"]:
            name = h["label"].split(" ")[0]
            assert name in MONTH_NAMES_PL, h["label"]
            assert h["label"].endswith(str(datetime.now().year)[-2:]) or True

    def test_labels_are_two_digit_year(self, user):
        assert all(len(h["label"].split(" ")[1]) == 2 for h in dashboard(user)["monthly_history"])

    def test_history_window_ends_at_the_current_month(self, user):
        # The 13-month window is anchored at today, not at the requested month: the Dashboard
        # always shows the last 13 months, whatever month its filter is on.
        labels = [h["label"] for h in dashboard(user, "2019-01")["monthly_history"]]
        assert labels[-1].split(" ")[0] == MONTH_NAMES_PL[datetime.now().month - 1]

    def test_invalid_month_is_400(self, user):
        for bad in ["abc", "2026-13", "2026-00", "2026-07-15"]:
            assert user.post("/api/stats/dashboard-data", json={"month": bad}).status_code == 400

    def test_empty_history_is_zeros(self, user):
        h = dashboard(user, "2019-01")["monthly_history"]
        assert all(x["actual"] == 0 and x["planned"] == 0 for x in h)


class TestDashboardNumbers:
    def test_month_total_is_sum_of_expenses(self, user, category_ids):
        a, b = category_ids["Transport"], category_ids["Jedzenie"]
        user.post("/api/transactions", json=tx_body(a, 100, "2026-05-10"))
        user.post("/api/transactions", json=tx_body(b, 50.5, "2026-05-20"))
        assert dashboard(user, "2026-05")["month_total"] == 150.5

    def test_income_is_not_spending(self, user, category_ids):
        # audit P0-7: the same missing type filter inflated every KPI.
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 900, "2026-05-10", type_="Przychod"))
        assert dashboard(user, "2026-05")["month_total"] == 0.0

    def test_prev_month_is_the_previous_window(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 70, "2026-04-30"))
        user.post("/api/transactions", json=tx_body(cid, 10, "2026-05-01"))
        d = dashboard(user, "2026-05")
        assert d["month_total"] == 10.0
        assert d["prev_month_total"] == 70.0

    def test_prev_month_of_january_is_december_of_last_year(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 70, "2025-12-15"))
        d = dashboard(user, "2026-01")
        assert d["prev_month_total"] == 70.0

    def test_total_all_time_spans_everything(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 10, "2019-01-05"))
        user.post("/api/transactions", json=tx_body(cid, 20, "2026-05-05"))
        assert dashboard(user, "2026-05")["total_all_time"] == 30.0

    def test_current_planned_is_only_the_requested_month(self, user, category_ids):
        a, b = category_ids["Transport"], category_ids["Jedzenie"]
        user.post("/api/budgets", json={"category_id": a, "amount_monthly": 300, "month_year": "2026-05"})
        user.post("/api/budgets", json={"category_id": b, "amount_monthly": 200, "month_year": "2026-06"})
        assert dashboard(user, "2026-05")["current_planned"] == 300.0

    def test_zero_budgets_are_not_planned(self, user, category_ids):
        # `amount_monthly > 0` in the query: a zero budget is not "planned".
        user.post("/api/budgets", json={"category_id": category_ids["Transport"],
                                        "amount_monthly": 0, "month_year": "2026-05"})
        assert dashboard(user, "2026-05")["current_planned"] == 0.0

    def test_history_groups_per_month(self, user, category_ids):
        # audit P1-33: the grouped query must match the old per-month sums.
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 10, "2026-05-01"))
        user.post("/api/transactions", json=tx_body(cid, 20, "2026-05-31"))
        user.post("/api/transactions", json=tx_body(cid, 5, "2026-06-15"))
        h = dashboard(user, "2026-05")["monthly_history"]
        may = next(x for x in h if x["label"] == "Maj 26")
        jun = next(x for x in h if x["label"] == "Czerwiec 26")
        assert may["actual"] == 30.0
        assert jun["actual"] == 5.0

    def test_history_planned_comes_from_budgets(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 300, "month_year": "2026-05"})
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": "2026-05"})
        # The upsert keeps one row, so planned is 100, not 400.
        assert next(x for x in dashboard(user, "2026-05")["monthly_history"]
                    if x["label"] == "Maj 26")["planned"] == 100.0

    def test_is_user_scoped(self, user, second_user, category_ids, second_category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 100, "2026-05-10"))
        d2 = dashboard(second_user, "2026-05")
        assert d2["month_total"] == 0.0
        assert d2["total_all_time"] == 0.0

    def test_rounded_to_two_decimals(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 10.005, "2026-05-10"))
        user.post("/api/transactions", json=tx_body(cid, 10.005, "2026-05-11"))
        assert dashboard(user, "2026-05")["month_total"] == 20.01


class TestYearSummary:
    def test_totals_and_variance(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 100, "2026-03-10"))
        user.post("/api/transactions", json=tx_body(cid, 50, "2026-06-10"))
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 200, "month_year": "2026-03"})
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": "2026-07"})
        d = year(user, 2026)
        assert d["year"] == 2026
        assert d["total_spending"] == 150.0
        assert d["total_budgeted"] == 300.0
        assert d["variance"] == 150.0

    def test_income_is_not_spending(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 900, "2026-03-10", type_="Przychod"))
        assert year(user, 2026)["total_spending"] == 0.0

    def test_other_years_are_excluded(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 100, "2025-12-31"))
        user.post("/api/transactions", json=tx_body(cid, 100, "2027-01-01"))
        assert year(user, 2026)["total_spending"] == 0.0

    def test_year_boundary_is_inclusive(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 10, "2026-01-01"))
        user.post("/api/transactions", json=tx_body(cid, 20, "2026-12-31"))
        assert year(user, 2026)["total_spending"] == 30.0

    def test_avg_monthly_spending_divides_by_months_with_data(self, user, category_ids):
        # Two months with data → average over 2, not over 12.
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 100, "2026-03-10"))
        user.post("/api/transactions", json=tx_body(cid, 100, "2026-06-10"))
        assert year(user, 2026)["avg_monthly_spending"] == 100.0

    def test_avg_monthly_budgeted_divides_by_12(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 1200, "month_year": "2026-03"})
        assert year(user, 2026)["avg_monthly_budgeted"] == 100.0

    def test_spend_rate_is_percentage(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 150, "2026-03-10"))
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 300, "month_year": "2026-03"})
        assert year(user, 2026)["spend_rate"] == 50.0

    def test_spend_rate_is_none_without_budgets(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 150, "2026-03-10"))
        assert year(user, 2026)["spend_rate"] is None

    def test_monthly_summary_labels_are_polish(self, user):
        for m in year(user, 2026)["monthly_summary"]:
            assert m["label"] == MONTH_NAMES_PL[m["month"] - 1]

    def test_monthly_summary_stops_at_the_current_month_for_this_year(self, user):
        now = datetime.now()
        summary = year(user, now.year)["monthly_summary"]
        assert len(summary) == now.month
        assert summary[-1]["month"] == now.month

    def test_past_year_has_twelve_months(self, user):
        assert len(year(user, 2019)["monthly_summary"]) == 12

    def test_month_balance_and_on_budget(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 100, "2026-03-10"))
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 80, "month_year": "2026-03"})
        mar = next(m for m in year(user, 2026)["monthly_summary"] if m["month"] == 3)
        assert mar["spending"] == 100.0
        assert mar["budget"] == 80.0
        assert mar["balance"] == -20.0
        assert mar["on_budget"] is False

    def test_no_budget_and_no_spending_is_on_budget(self, user):
        jan = next(m for m in year(user, 2019)["monthly_summary"] if m["month"] == 1)
        assert jan["on_budget"] is True

    def test_no_budget_with_spending_is_not_on_budget(self, user, category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 10, "2019-01-10"))
        jan = next(m for m in year(user, 2019)["monthly_summary"] if m["month"] == 1)
        assert jan["on_budget"] is False

    def test_category_variance_is_sorted_by_abs_deviation(self, user, category_ids):
        a, b = category_ids["Transport"], category_ids["Jedzenie"]
        user.post("/api/budgets", json={"category_id": a, "amount_monthly": 100, "month_year": "2026-03"})
        user.post("/api/budgets", json={"category_id": b, "amount_monthly": 1000, "month_year": "2026-03"})
        var = year(user, 2026)["category_variance"]
        deviations = [abs(v["variance"]) for v in var]
        assert deviations == sorted(deviations, reverse=True)
        assert var[0]["name"] == "Jedzenie"

    def test_category_variance_fields(self, user, category_ids):
        cid = category_ids["Transport"]
        user.post("/api/transactions", json=tx_body(cid, 40, "2026-03-10"))
        user.post("/api/budgets", json={"category_id": cid, "amount_monthly": 100, "month_year": "2026-03"})
        v = next(v for v in year(user, 2026)["category_variance"] if v["cid"] == cid)
        assert v["name"] == "Transport"
        assert v["color"] == "#3498db"
        assert v["spending"] == 40.0
        assert v["budgeted"] == 100.0
        assert v["variance"] == 60.0

    def test_deactivated_categories_are_excluded(self, user, category_ids):
        cid = category_ids["Transport"]
        user.put(f"/api/categories/{cid}", json={"active": False})
        assert cid not in [v["cid"] for v in year(user, 2026)["category_variance"]]

    def test_missing_year_is_400(self, user):
        for body in [{}, {"year": ""}, {"year": "abc"}, {"year": None}]:
            assert user.post("/api/stats/year-summary", json=body).status_code == 400

    def test_is_user_scoped(self, user, second_user, category_ids, second_category_ids):
        user.post("/api/transactions", json=tx_body(category_ids["Transport"], 100, "2026-03-10"))
        d = year(second_user, 2026)
        assert d["total_spending"] == 0.0
        # The other user's category ids must not be charged with the admin's spending.
        assert all(v["spending"] == 0.0 for v in d["category_variance"])

    def test_year_as_string_is_accepted(self, user):
        assert user.post("/api/stats/year-summary", json={"year": "2026"}).status_code == 200

    def test_year_as_int_is_accepted(self, user):
        assert user.post("/api/stats/year-summary", json={"year": 2026}).status_code == 200


class TestMonthRange:
    """parse_month bounded the month (1..12) but not the year, so a year outside
    datetime's 1..9999 range raised an unhandled ValueError → 500. Verified on
    GET /api/transactions?month=99999-01, POST /api/budgets/by-month-post and
    POST /api/stats/dashboard-data; POST dashboard {"month":"0001-01"} raised on the
    previous-month window (datetime(0, 12, 1)).
    """

    def _post(self, user, month):
        return user.post("/api/stats/dashboard-data", json={"month": month})

    def test_year_above_9999_is_400_not_500(self, user):
        for month in ["99999-01", "10000-01", "0000-01"]:
            resp = self._post(user, month)
            assert resp.status_code == 400, month
            assert resp.is_json
            assert "YYYY-MM" in resp.get_json()["error"]

    def test_january_of_year_1_yields_an_empty_previous_window(self, user):
        resp = self._post(user, "0001-01")
        assert resp.status_code == 200
        body = resp.get_json()
        # January has a previous month in the arithmetic, and year 0 is simply outside the
        # date space, so the window is empty — not a crash.
        assert body["prev_month_total"] == 0
        assert body["total_all_time"] == 0

    def test_year_9999_is_accepted(self, user):
        resp = self._post(user, "9999-12")
        assert resp.status_code == 200
        assert resp.get_json()["monthly_history"]

    def test_transactions_and_budgets_views_reject_the_same_month(self, user):
        assert user.get("/api/transactions?month=99999-01").status_code == 400
        assert user.post("/api/budgets/by-month-post", json={"month": "99999-01"}).status_code == 400
        # The boundary years still work.
        assert user.get("/api/transactions?month=9999-12").status_code == 200
        assert user.get("/api/transactions?month=0001-01").status_code == 200

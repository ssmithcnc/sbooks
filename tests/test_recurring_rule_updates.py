from __future__ import annotations

import sqlite3
import unittest
from contextlib import contextmanager

import app as app_module
import db as db_module


class RecurringRuleFutureUpdateTest(unittest.TestCase):
  def setUp(self):
    self._original_app_db = app_module.db
    self.conn = sqlite3.connect(":memory:")
    self.conn.row_factory = sqlite3.Row
    self.conn.executescript(db_module.SCHEMA_SQL)

    cur = self.conn.execute("SELECT COUNT(*) AS n FROM accounts")
    if cur.fetchone()["n"] == 0:
      self.conn.execute("INSERT INTO accounts(name, kind) VALUES (?, ?)", ("Personal Checking", "checking"))
      self.conn.execute("INSERT INTO accounts(name, kind) VALUES (?, ?)", ("Business Checking", "checking"))
    self.conn.commit()

    @contextmanager
    def test_db():
      try:
        yield self.conn
        self.conn.commit()
      finally:
        pass

    app_module.db = test_db
    self.client = app_module.app.test_client()

    with app_module.db() as conn:
      for paycheck_date in (
        "2025-12-31",
        "2026-01-15",
        "2026-01-31",
        "2026-02-15",
        "2026-02-28",
        "2026-03-15",
        "2026-03-31",
        "2026-04-15",
        "2026-04-30",
        "2026-05-15",
        "2026-05-31",
        "2026-06-15",
      ):
        conn.execute(
          "INSERT INTO paychecks(account_id, date, amount, is_primary) VALUES (?, ?, ?, ?)",
          (1, paycheck_date, 1000.0, 1),
        )

  def tearDown(self):
    self.client = None
    app_module.db = self._original_app_db
    self.conn.close()

  def test_editing_rule_updates_future_records_without_duplicates(self):
    create_response = self.client.post(
      "/api/recurring_rules",
      json={
        "account_id": 1,
        "cadence": "monthly",
        "description": "Old mortgage",
        "amount": -1200.0,
        "day_of_month": 5,
        "start_date": "2026-01-05",
        "due_day": 5,
        "by_day_of_month": False,
        "url": "https://old.example.com",
        "is_active": True,
      },
    )
    self.assertEqual(create_response.status_code, 200, create_response.get_data(as_text=True))
    rule_id = create_response.get_json()["id"]

    generate_response = self.client.post(
      f"/api/recurring_rules/{rule_id}/generate",
      json={"to_date": "2026-06-30"},
    )
    self.assertEqual(generate_response.status_code, 200, generate_response.get_data(as_text=True))
    self.assertEqual(generate_response.get_json()["created"], 6)

    patch_response = self.client.patch(
      f"/api/recurring_rules/{rule_id}",
      json={
        "account_id": 1,
        "cadence": "monthly",
        "description": "Updated mortgage",
        "amount": -1350.0,
        "day_of_month": 7,
        "start_date": "2026-01-05",
        "due_day": 7,
        "by_day_of_month": False,
        "url": "https://new.example.com",
        "is_active": True,
      },
    )
    self.assertEqual(patch_response.status_code, 200, patch_response.get_data(as_text=True))

    update_response = self.client.post(
      f"/api/recurring_rules/{rule_id}/update_future",
      json={
        "to_date": "2026-06-30",
        "from_date": "2026-04-18",
      },
    )
    self.assertEqual(update_response.status_code, 200, update_response.get_data(as_text=True))
    self.assertEqual(update_response.get_json()["created"], 2)
    self.assertEqual(update_response.get_json()["deleted"], 2)

    with app_module.db() as conn:
      rows = conn.execute(
        """SELECT effective_date, amount, description, url, due_day
           FROM transactions
           WHERE recurring_rule_id=?
           ORDER BY effective_date""",
        (rule_id,),
      ).fetchall()

    self.assertEqual(
      [row["effective_date"] for row in rows],
      [
        "2026-01-05",
        "2026-02-05",
        "2026-03-05",
        "2026-04-05",
        "2026-05-07",
        "2026-06-07",
      ],
    )

    for row in rows[:4]:
      self.assertEqual(row["description"], "Old mortgage")
      self.assertEqual(row["amount"], -1200.0)
      self.assertEqual(row["url"], "https://old.example.com")
      self.assertEqual(row["due_day"], 5)

    for row in rows[4:]:
      self.assertEqual(row["description"], "Updated mortgage")
      self.assertEqual(row["amount"], -1350.0)
      self.assertEqual(row["url"], "https://new.example.com")
      self.assertEqual(row["due_day"], 7)


if __name__ == "__main__":
  unittest.main()

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import app as app_module
import db as db_module


class ArchiveCarryoverProjectionTest(unittest.TestCase):
  def setUp(self):
    self._tmpdir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    self._original_db_path = db_module.DB_PATH
    db_module.DB_PATH = Path(self._tmpdir.name) / "cashflow-test.db"
    db_module.init_db()
    self.client = app_module.app.test_client()

    with db_module.db() as conn:
      conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)",
        ("anchor_date", "2026-01-01"),
      )
      conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)",
        ("horizon_days", "60"),
      )
      conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)",
        ("paycheck_account_id", "1"),
      )
      conn.execute(
        "INSERT OR REPLACE INTO account_anchors(account_id, anchor_date, anchor_balance) VALUES (?, ?, ?)",
        (1, "2026-01-01", 1000.0),
      )

      for paycheck_date in ("2026-01-01", "2026-01-15", "2026-01-29"):
        conn.execute(
          "INSERT INTO paychecks(account_id, date, amount, is_primary) VALUES (?, ?, ?, ?)",
          (1, paycheck_date, 1000.0, 1),
        )

      conn.execute(
        """INSERT INTO transactions
           (account_id, recurring_rule_id, effective_date, amount, description, url, due_day, due_label,
            funding_bucket, funding_paycheck_id, status, sort_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
          1,
          None,
          "2026-01-05",
          -200.0,
          "Reconciled payment",
          None,
          None,
          None,
          "ONE_OFF",
          None,
          "planned",
          0,
          "2026-01-01T00:00:00",
          "2026-01-01T00:00:00",
        ),
      )

  def tearDown(self):
    self.client = None
    db_module.DB_PATH = self._original_db_path
    try:
      self._tmpdir.cleanup()
    except PermissionError:
      pass

  def _projection(self):
    response = self.client.get("/api/projection")
    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    return response.get_json()

  @staticmethod
  def _account(period: dict, account_id: int) -> dict:
    return next(account for account in period["accounts"] if int(account["account_id"]) == account_id)

  def test_archiving_hides_period_but_preserves_balance_carryover(self):
    baseline = self._projection()
    self.assertEqual(len(baseline["periods"]), 3)
    self.assertEqual(self._account(baseline["periods"][1], 1)["start_balance"], 1800.0)

    archive_response = self.client.post("/api/pay_periods/2026-01-01/archive", json={})
    self.assertEqual(archive_response.status_code, 200, archive_response.get_data(as_text=True))

    archived = self._projection()
    self.assertEqual([period["start_date"] for period in archived["periods"]], ["2026-01-15", "2026-01-29"])
    self.assertEqual(self._account(archived["periods"][0], 1)["start_balance"], 1800.0)


if __name__ == "__main__":
  unittest.main()

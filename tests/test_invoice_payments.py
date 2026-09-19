from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import app as app_module
import db as db_module


class InvoicePaymentsTest(unittest.TestCase):
  def setUp(self):
    self._tmpdir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    self._original_db_path = db_module.DB_PATH
    db_module.DB_PATH = Path(self._tmpdir.name) / "cashflow-invoice-payments-test.db"
    db_module.init_db()
    self.client = app_module.app.test_client()

    with db_module.db() as conn:
      cur = conn.execute(
        """INSERT INTO customers
           (name, contact_name, email, phone, billing_address, notes, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
        ("Acme Fabrication", "", "billing@example.com", "", "", "", 1),
      )
      self.customer_id = int(cur.lastrowid)

  def tearDown(self):
    self.client = None
    db_module.DB_PATH = self._original_db_path
    try:
      self._tmpdir.cleanup()
    except PermissionError:
      pass

  def test_invoice_amount_paid_persists_and_returns_balance_due(self):
    response = self.client.post(
      "/api/documents",
      json={
        "type": "invoice",
        "customer_id": self.customer_id,
        "issue_date": "2026-09-16",
        "due_date": "2026-09-30",
        "status": "open",
        "tax_rate": 0,
        "amount_paid": 125,
        "lines": [
          {
            "description": "Project work",
            "quantity": 1,
            "unit_price": 500,
            "taxable": False,
          }
        ],
      },
    )
    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    invoice_id = response.get_json()["document"]["id"]

    document = self.client.get(f"/api/documents/{invoice_id}").get_json()
    self.assertEqual(document["amount_paid"], 125.0)
    self.assertEqual(document["balance_due"], 375.0)

    listing = self.client.get("/api/documents").get_json()
    self.assertEqual(listing[0]["amount_paid"], 125.0)
    self.assertEqual(listing[0]["balance_due"], 375.0)


if __name__ == "__main__":
  unittest.main()

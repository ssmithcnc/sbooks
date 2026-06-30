from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit

import app as app_module
import db as db_module


class EstimateAcceptanceFlowTest(unittest.TestCase):
  def setUp(self):
    self._tmpdir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    self._original_db_path = db_module.DB_PATH
    db_module.DB_PATH = Path(self._tmpdir.name) / "cashflow-estimate-test.db"
    db_module.init_db()
    self.client = app_module.app.test_client()

    with db_module.db() as conn:
      cur = conn.execute(
        """INSERT INTO customers
           (name, contact_name, email, phone, billing_address, notes, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
        (
          "Acme Fabrication",
          "Avery Approver",
          "avery@example.com",
          "830-555-0100",
          "100 Foundry Rd",
          "",
          1,
        ),
      )
      self.customer_id = int(cur.lastrowid)

  def tearDown(self):
    self.client = None
    db_module.DB_PATH = self._original_db_path
    try:
      self._tmpdir.cleanup()
    except PermissionError:
      pass

  def _create_estimate(self) -> dict:
    response = self.client.post(
      "/api/documents",
      json={
        "type": "estimate",
        "customer_id": self.customer_id,
        "issue_date": "2026-06-30",
        "due_date": "2026-07-15",
        "tax_rate": 10,
        "notes": "Fabrication and coating package.",
        "terms": "Balance due before delivery.",
        "acceptance_enabled": True,
        "acceptance_deposit_type": "percent",
        "acceptance_deposit_value": 50,
        "accept_manual_ach": True,
        "accept_stripe_card": True,
        "accept_stripe_ach": True,
        "lines": [
          {
            "description": "Main project scope",
            "quantity": 1,
            "unit_price": 1000,
            "taxable": True,
          }
        ],
      },
    )
    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    return response.get_json()["document"]

  def _accept_estimate(self, estimate_id: int):
    document_response = self.client.get(f"/api/documents/{estimate_id}")
    self.assertEqual(document_response.status_code, 200, document_response.get_data(as_text=True))
    document = document_response.get_json()
    acceptance_path = urlsplit(document["acceptance_url"]).path
    response = self.client.post(
      acceptance_path,
      data={"name": "Avery Approver", "email": "avery@example.com"},
      follow_redirects=False,
    )
    return response

  def test_accepting_estimate_creates_deposit_invoice_and_redirects_to_payment(self):
    estimate = self._create_estimate()

    response = self._accept_estimate(estimate["id"])
    self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
    self.assertIn("/pay/", response.headers["Location"])

    with db_module.db() as conn:
      refreshed_estimate = app_module.fetch_document(conn, estimate["id"])
      self.assertEqual(refreshed_estimate["status"], "accepted")
      self.assertIsNotNone(refreshed_estimate["accepted_at"])
      self.assertEqual(refreshed_estimate["accepted_by_name"], "Avery Approver")
      self.assertIsNotNone(refreshed_estimate["deposit_invoice_document_id"])

      deposit_invoice = app_module.fetch_document(conn, refreshed_estimate["deposit_invoice_document_id"])
      self.assertEqual(deposit_invoice["type"], "invoice")
      self.assertEqual(deposit_invoice["status"], "open")
      self.assertEqual(deposit_invoice["subtotal"], 500.0)
      self.assertEqual(deposit_invoice["tax_amount"], 50.0)
      self.assertEqual(deposit_invoice["total"], 550.0)

  def test_convert_after_paid_deposit_adds_credit_lines(self):
    estimate = self._create_estimate()
    self._accept_estimate(estimate["id"])

    with db_module.db() as conn:
      refreshed_estimate = app_module.fetch_document(conn, estimate["id"])
      deposit_invoice_id = refreshed_estimate["deposit_invoice_document_id"]
      conn.execute(
        "UPDATE documents SET status='paid', updated_at=? WHERE id=?",
        (app_module.now_iso(), deposit_invoice_id),
      )

    response = self.client.post(f"/api/documents/{estimate['id']}/convert_to_invoice", json={})
    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    invoice = response.get_json()["document"]

    self.assertEqual(invoice["type"], "invoice")
    self.assertEqual(invoice["subtotal"], 500.0)
    self.assertEqual(invoice["tax_amount"], 50.0)
    self.assertEqual(invoice["total"], 550.0)
    self.assertEqual(len(invoice["lines"]), 2)
    self.assertEqual(invoice["lines"][0]["description"], "Main project scope")
    self.assertEqual(invoice["lines"][1]["description"], "Deposit credit - 50% deposit for Estimate EST-1001")
    self.assertEqual(invoice["lines"][1]["line_total"], -500.0)


if __name__ == "__main__":
  unittest.main()

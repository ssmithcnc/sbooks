import sqlite3
from contextlib import contextmanager
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
import os

DATA_DIR = BASE_DIR / "data"

# Persist DB outside the app folder so new app versions don't create new DBs.
# Set CASHFLOW_DB to override.
if os.name == "nt":
  DEFAULT_DB = Path(r"C:\cashflow_data") / "cashflow.db"
else:
  DEFAULT_DB = Path.home() / ".cashflow_planner" / "cashflow.db"

DB_PATH = Path(os.environ.get("CASHFLOW_DB", str(DEFAULT_DB)))
SCHEMA_SQL = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'checking'
);

CREATE TABLE IF NOT EXISTS account_anchors (
  account_id INTEGER NOT NULL,
  anchor_date TEXT NOT NULL,
  anchor_balance REAL NOT NULL,
  PRIMARY KEY(account_id, anchor_date),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS paychecks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1,
  UNIQUE(account_id, date),
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  url TEXT,
  amount REAL NOT NULL,
  cadence TEXT NOT NULL,
  day_of_month INTEGER,
  by_day_of_month INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT,
  due_day INTEGER,
  funding_bucket_override TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  recurring_rule_id INTEGER,
  effective_date TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  url TEXT,
  due_day INTEGER,
  due_label TEXT,
  funding_bucket TEXT NOT NULL,
  funding_paycheck_id INTEGER,
  status TEXT NOT NULL DEFAULT 'planned',
  sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(recurring_rule_id) REFERENCES recurring_rules(id),
  FOREIGN KEY(funding_paycheck_id) REFERENCES paychecks(id)
);
CREATE TABLE IF NOT EXISTS cc_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  balance REAL NOT NULL,
  side TEXT NOT NULL DEFAULT 'personal',
  url TEXT
);

CREATE TABLE IF NOT EXISTS business_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  billing_address TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  external_source TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_external
ON customers(external_source, external_id)
WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  default_unit_price REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  external_source TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_external
ON products(external_source, external_id)
WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  number TEXT NOT NULL,
  customer_id INTEGER NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  imported INTEGER NOT NULL DEFAULT 0,
  source_system TEXT,
  source_id TEXT,
  payment_url TEXT,
  cloud_public_id TEXT,
  cloud_sync_status TEXT NOT NULL DEFAULT 'local_only',
  cloud_synced_at TEXT,
  accept_manual_ach INTEGER NOT NULL DEFAULT 1,
  accept_stripe_card INTEGER NOT NULL DEFAULT 1,
  accept_stripe_ach INTEGER NOT NULL DEFAULT 1,
  accept_paypal INTEGER NOT NULL DEFAULT 0,
  accept_venmo INTEGER NOT NULL DEFAULT 0,
  use_full_portal INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT,
  last_sent_to TEXT,
  last_email_error TEXT,
  converted_from_document_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(customer_id) REFERENCES customers(id),
  FOREIGN KEY(converted_from_document_id) REFERENCES documents(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_type_number
ON documents(type, number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_source
ON documents(source_system, source_id)
WHERE source_system IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS document_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  product_id INTEGER,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 1,
  line_total REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id)
);"""

def connect():
  # Ensure DB folder exists
  DB_PATH.parent.mkdir(parents=True, exist_ok=True)
  conn = sqlite3.connect(DB_PATH)
  conn.row_factory = sqlite3.Row
  # Ensure tables exist (CREATE IF NOT EXISTS) and run migrations (idempotent)
  try:
    schema_path = BASE_DIR / "schema.sql"
    if schema_path.exists():
      conn.executescript(schema_path.read_text())
  except Exception:
    pass
  try:
    migrate_db(conn)
    conn.commit()
  except Exception:
    pass
  return conn

def init_db():
  with connect() as conn:
    conn.executescript(SCHEMA_SQL)
    cur = conn.execute("SELECT COUNT(*) AS n FROM accounts")
    if cur.fetchone()["n"] == 0:
      conn.execute("INSERT INTO accounts(name, kind) VALUES (?,?)", ("Personal Checking", "checking"))
      conn.execute("INSERT INTO accounts(name, kind) VALUES (?,?)", ("Business Checking", "checking"))
    defaults = {
      "company_name": "My Business",
      "company_address": "",
      "company_phone": "",
      "company_email": "",
      "company_logo_path": r"C:\Users\smith\Downloads\CNCPOWDER - Sbooks.jpg",
      "company_website": "https://cncpowder.com",
      "smtp_provider": "custom",
      "smtp_host": "",
      "smtp_port": "587",
      "smtp_username": "",
      "smtp_password": "",
      "smtp_use_tls": "1",
      "smtp_from_name": "",
      "invoice_payment_url_base": "",
      "supabase_url": "",
      "supabase_publishable_key": "",
      "supabase_secret_key": "",
      "stripe_publishable_key": "",
      "stripe_secret_key": "",
      "stripe_webhook_secret": "",
      "manual_bank_instructions": "",
      "default_accept_manual_ach": "1",
      "default_accept_stripe_card": "1",
      "default_accept_stripe_ach": "1",
      "default_accept_paypal": "0",
      "default_accept_venmo": "0",
      "invoice_prefix": "INV-",
      "estimate_prefix": "EST-",
      "next_invoice_number": "1001",
      "next_estimate_number": "1001",
      "default_tax_rate": "0",
      "default_terms": "Due on receipt",
    }
    for key, value in defaults.items():
      conn.execute(
        "INSERT OR IGNORE INTO business_settings(key, value) VALUES (?, ?)",
        (key, value)
      )
    conn.commit()

@contextmanager
def db():
  conn = connect()
  try:
    yield conn
    conn.commit()
  finally:
    conn.close()


def migrate_db(conn):
  """Lightweight schema migrations (idempotent)."""

  try:
    conn.executescript(
      """
      CREATE TABLE IF NOT EXISTS business_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact_name TEXT,
        email TEXT,
        phone TEXT,
        billing_address TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        external_source TEXT,
        external_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_external
      ON customers(external_source, external_id)
      WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        sku TEXT,
        default_unit_price REAL NOT NULL DEFAULT 0,
        taxable INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        external_source TEXT,
        external_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_external
      ON products(external_source, external_id)
      WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        number TEXT NOT NULL,
        customer_id INTEGER NOT NULL,
        issue_date TEXT NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        subtotal REAL NOT NULL DEFAULT 0,
        tax_rate REAL NOT NULL DEFAULT 0,
        tax_amount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        notes TEXT,
        terms TEXT,
        imported INTEGER NOT NULL DEFAULT 0,
        source_system TEXT,
        source_id TEXT,
        payment_url TEXT,
        last_sent_at TEXT,
        last_sent_to TEXT,
        last_email_error TEXT,
        converted_from_document_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_id) REFERENCES customers(id),
        FOREIGN KEY(converted_from_document_id) REFERENCES documents(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_type_number
      ON documents(type, number);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_source
      ON documents(source_system, source_id)
      WHERE source_system IS NOT NULL AND source_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS document_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        product_id INTEGER,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL DEFAULT 0,
        taxable INTEGER NOT NULL DEFAULT 1,
        line_total REAL NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id)
      );
      """
    )
  except Exception:
    pass

  try:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(documents)").fetchall()]
    if "payment_url" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN payment_url TEXT")
    if "cloud_public_id" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN cloud_public_id TEXT")
    if "cloud_sync_status" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN cloud_sync_status TEXT NOT NULL DEFAULT 'local_only'")
    if "cloud_synced_at" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN cloud_synced_at TEXT")
    if "accept_manual_ach" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN accept_manual_ach INTEGER NOT NULL DEFAULT 1")
    if "accept_stripe_card" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN accept_stripe_card INTEGER NOT NULL DEFAULT 1")
    if "accept_stripe_ach" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN accept_stripe_ach INTEGER NOT NULL DEFAULT 1")
    if "accept_paypal" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN accept_paypal INTEGER NOT NULL DEFAULT 0")
    if "accept_venmo" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN accept_venmo INTEGER NOT NULL DEFAULT 0")
    if "use_full_portal" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN use_full_portal INTEGER NOT NULL DEFAULT 0")
    if "last_sent_at" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN last_sent_at TEXT")
    if "last_sent_to" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN last_sent_to TEXT")
    if "last_email_error" not in cols:
      conn.execute("ALTER TABLE documents ADD COLUMN last_email_error TEXT")
  except Exception:
    pass

  # Pay period archives (hide historical pay periods from the timeline).
  # Non-destructive: we keep all underlying paychecks/transactions/snapshots.
  try:
    conn.execute(
      """CREATE TABLE IF NOT EXISTS pay_period_archives (
           start_date TEXT PRIMARY KEY,
           archived_at TEXT NOT NULL
         )"""
    )
  except Exception:
    pass
  try:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(cc_snapshots)").fetchall()]
    if "side" not in cols:
      conn.execute("ALTER TABLE cc_snapshots ADD COLUMN side TEXT DEFAULT 'personal'")
  except Exception:
    pass


  # Add 'url' columns (manage-payment link) if missing
  try:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(transactions)").fetchall()]
    if "url" not in cols:
      conn.execute("ALTER TABLE transactions ADD COLUMN url TEXT")
  except Exception:
    pass

  try:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(recurring_rules)").fetchall()]
    if "url" not in cols:
      conn.execute("ALTER TABLE recurring_rules ADD COLUMN url TEXT")
  except Exception:
    pass

  try:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(cc_snapshots)").fetchall()]
    if "url" not in cols:
      conn.execute("ALTER TABLE cc_snapshots ADD COLUMN url TEXT")
  except Exception:
    pass


  # Add legacy 'due_date' (optional) if missing (kept for backward compatibility)
  try:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(cc_snapshots)").fetchall()]
    if "due_date" not in cols:
      conn.execute("ALTER TABLE cc_snapshots ADD COLUMN due_date TEXT")
  except Exception:
    pass

  # Card-level due day-of-month (two digits: '01'..'31') stored on card-definition rows.
  # We store card definitions as snapshot rows with snapshot_date='0000-00-00'.
  try:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(cc_snapshots)").fetchall()]
    if "due_day" not in cols:
      conn.execute("ALTER TABLE cc_snapshots ADD COLUMN due_day TEXT")
  except Exception:
    pass

  # Per-paycheck payment status for CC snapshot rows ("pay" | "paid" | "reconciled").
  try:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(cc_snapshots)").fetchall()]
    if "pay_status" not in cols:
      conn.execute("ALTER TABLE cc_snapshots ADD COLUMN pay_status TEXT")
  except Exception:
    pass

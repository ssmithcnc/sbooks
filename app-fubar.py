from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional, Tuple

from flask import Flask, jsonify, request, render_template, send_from_directory

from db import init_db, db

APP_TITLE = "Cashflow Pay-Period Planner"
FIRST_OF_MONTH_MAX_DAY = 15

def iso(d: date) -> str:
  return d.isoformat()

def parse_date(s: str) -> date:
  """Parse a date from ISO (YYYY-MM-DD) or common US format (MM/DD/YYYY)."""
  s = (s or "").strip()
  try:
    return date.fromisoformat(s)
  except Exception:
    try:
      return datetime.strptime(s, "%m/%d/%Y").date()
    except Exception:
      # Re-raise a clear error for API callers
      raise ValueError(f"Invalid date: {s!r}")

def now_iso() -> str:
  return datetime.now().replace(microsecond=0).isoformat()


def _archived_period_starts(conn) -> set[str]:
  try:
    rows = conn.execute("SELECT start_date FROM pay_period_archives").fetchall()
    return {r["start_date"] for r in rows}
  except Exception:
    return set()

def bucket_from_due_day(due_day: Optional[int]) -> str:
  if due_day is None:
    return "ONE_OFF"
  return "FIRST_OF_MONTH" if 1 <= due_day <= FIRST_OF_MONTH_MAX_DAY else "MID_MONTH"

def prev_month(y: int, m: int) -> Tuple[int, int]:
  if m == 1:
    return (y - 1, 12)
  return (y, m - 1)

def first_last_paycheck_ids(paychecks: List[dict], year: int, month: int) -> Tuple[Optional[int], Optional[int]]:
  in_month = [p for p in paychecks if parse_date(p["date"]).year == year and parse_date(p["date"]).month == month]
  if not in_month:
    return None, None
  in_month.sort(key=lambda p: p["date"])
  return in_month[0]["id"], in_month[-1]["id"]

def assign_funding_paycheck_id(tx_year: int, tx_month: int, bucket: str, paychecks: List[dict]) -> Optional[int]:
  if bucket == "ONE_OFF":
    return None
  if bucket == "FIRST_OF_MONTH":
    py, pm = prev_month(tx_year, tx_month)
    _, last_id = first_last_paycheck_ids(paychecks, py, pm)
    return last_id
  if bucket == "MID_MONTH":
    first_id, _ = first_last_paycheck_ids(paychecks, tx_year, tx_month)
    return first_id
  return None

def daterange(start: date, end: date):
  d = start
  while d <= end:
    yield d
    d += timedelta(days=1)


# Card definitions are stored in cc_snapshots as rows with this special date.
# This allows safe, ALTER-only migrations while keeping card metadata (name/url/due_day)
# separate from per-paycheck balances.
CC_CARDDEF_DATE = "0000-00-00"


def cc_latest_by_name(conn, as_of_iso: str, side: str = "personal"):
  """
  Returns latest snapshot per card name with snapshot_date <= as_of_iso for a given side.
  Includes snapshot id + url for edit/delete.
  """
  rows = conn.execute(
    """SELECT cs.id, cs.name, cs.balance, cs.snapshot_date, cs.url
       FROM cc_snapshots cs
       JOIN (
         SELECT name, MAX(snapshot_date) AS snapshot_date
         FROM cc_snapshots
         WHERE snapshot_date <= ? AND side = ?
         GROUP BY name
       ) m
       ON cs.name = m.name AND cs.snapshot_date = m.snapshot_date
       WHERE cs.side = ?
       ORDER BY cs.name""",
    (as_of_iso, side, side)
  ).fetchall()

  cards = []
  total = 0.0
  for r in rows:
    bal = float(r["balance"])
    total += bal
    cards.append({
      "id": int(r["id"]),
      "name": r["name"],
      "balance": bal,
      "snapshot_date": r["snapshot_date"],
      "url": r["url"]
    })
  return cards, round(total, 2)


def cc_card_names(conn, side: str):
  """Return the authoritative card list for a side.

  Card-definition rows (snapshot_date == CC_CARDDEF_DATE) are the source of
  truth for which cards exist. This prevents old/renamed cards from showing up
  as "ghost" duplicates in later pay periods.

  If no card-definition rows exist yet, fall back to distinct names from
  existing snapshots.
  """
  defs = conn.execute(
    """SELECT name FROM cc_snapshots
         WHERE side = ? AND snapshot_date = ?
         ORDER BY name""",
    (side, CC_CARDDEF_DATE)
  ).fetchall()
  if defs:
    return [r["name"] for r in defs]

  rows = conn.execute(
    "SELECT DISTINCT name FROM cc_snapshots WHERE side = ? ORDER BY name",
    (side,)
  ).fetchall()
  return [r["name"] for r in rows]

def cc_latest_url(conn, name: str, as_of_iso: str, side: str):
  row = conn.execute(
    """SELECT url FROM cc_snapshots
         WHERE name = ? AND side = ? AND snapshot_date <= ? AND url IS NOT NULL AND url != ''
         ORDER BY snapshot_date DESC
         LIMIT 1""",
    (name, side, as_of_iso)
  ).fetchone()
  return row["url"] if row else None

def cc_latest_due_day(conn, name: str, as_of_iso: str, side: str):
  """Two-digit due day-of-month ('01'..'31') card metadata."""
  row = conn.execute(
    """SELECT due_day FROM cc_snapshots
         WHERE name = ? AND side = ? AND snapshot_date <= ? AND due_day IS NOT NULL AND due_day != ''
         ORDER BY snapshot_date DESC
         LIMIT 1""",
    (name, side, as_of_iso)
  ).fetchone()
  return row["due_day"] if row else None


def cc_card_defs(conn, side: str):
  """Return card definitions (name, url, due_day) from CC_CARDDEF_DATE rows."""
  rows = conn.execute(
    """SELECT id, name, url, due_day
         FROM cc_snapshots
         WHERE side = ? AND snapshot_date = ?
         ORDER BY name""",
    (side, CC_CARDDEF_DATE)
  ).fetchall()
  cards = []
  for r in rows:
    cards.append({
      "id": int(r["id"]),
      "name": r["name"],
      "url": r["url"],
      "due_day": r["due_day"]
    })
  return cards

def cc_cards_for_paycheck(conn, payday_iso: str, side: str = "personal"):
  """
  Returns one entry per card name for this side, for the *exact* payday snapshot_date.

  - If a card has a snapshot row exactly on payday_iso, uses it (id present).
  - If missing for this payday, returns a zero-balance placeholder (id=None),
    keeping the most recent known url (if any) so the Pay link still works.

  This prevents later pay periods from 'reusing' earlier snapshot rows and keeps
  balances independent per pay period.
  """
  names = cc_card_names(conn, side)
  cards = []
  total = 0.0
  for nm in names:
    r = conn.execute(
      """SELECT id, name, balance, snapshot_date, url, pay_status
           FROM cc_snapshots
           WHERE side = ? AND name = ? AND snapshot_date = ?
           LIMIT 1""",
      (side, nm, payday_iso)
    ).fetchone()

    due_day = cc_latest_due_day(conn, nm, payday_iso, side)

    if r:
      bal = float(r["balance"])
      total += bal
      url = r["url"] or cc_latest_url(conn, nm, payday_iso, side)
      cards.append({
        "id": int(r["id"]),
        "name": r["name"],
        "balance": bal,
        "snapshot_date": r["snapshot_date"],
        "url": url,
        "due_day": due_day,
        "pay_status": r["pay_status"]
      })
    else:
      url = cc_latest_url(conn, nm, payday_iso, side)
      cards.append({
        "id": None,
        "name": nm,
        "balance": 0.0,
        "snapshot_date": payday_iso,
        "url": url,
        "due_day": due_day,
        "pay_status": None
      })
  return cards, round(total, 2)


app = Flask(__name__, static_folder="static", template_folder="templates")

@app.get("/")
def index():
  return render_template("index.html", title=APP_TITLE)

@app.get("/static/<path:path>")
def static_proxy(path):
  return send_from_directory("static", path)

@app.post("/api/setup")
def setup():
  payload = request.get_json(force=True)
  anchor_date = parse_date(payload["anchor_date"])
  paycheck_amount = float(payload.get("paycheck_amount", 0))
  paycheck_account_id = int(payload.get("paycheck_account_id", 1))
  horizon_days = int(payload.get("horizon_days", 365))
  anchor_balances = payload.get("anchor_balances", [])

  end_date = anchor_date + timedelta(days=horizon_days)

  with db() as conn:
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", ("anchor_date", iso(anchor_date)))
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", ("horizon_days", str(horizon_days)))
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", ("paycheck_amount", str(paycheck_amount)))
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", ("paycheck_account_id", str(paycheck_account_id)))

    for item in anchor_balances:
      conn.execute(
        "INSERT OR REPLACE INTO account_anchors(account_id, anchor_date, anchor_balance) VALUES (?,?,?)",
        (int(item["account_id"]), iso(anchor_date), float(item["anchor_balance"]))
      )

    conn.execute("DELETE FROM paychecks WHERE account_id=? AND date>=?", (paycheck_account_id, iso(anchor_date)))
    d = anchor_date
    while d <= end_date:
      conn.execute(
        "INSERT OR IGNORE INTO paychecks(account_id,date,amount,is_primary) VALUES(?,?,?,1)",
        (paycheck_account_id, iso(d), paycheck_amount)
      )
      d += timedelta(days=14)

  return jsonify({"ok": True})

@app.get("/api/settings")
def get_settings():
  with db() as conn:
    rows = conn.execute("SELECT key,value FROM settings").fetchall()
    settings = {r["key"]: r["value"] for r in rows}
  return jsonify(settings)

@app.get("/api/accounts")
def list_accounts():
  with db() as conn:
    accounts = [dict(r) for r in conn.execute("SELECT * FROM accounts ORDER BY id").fetchall()]
  return jsonify(accounts)


@app.get("/api/archives")
def list_archives():
  """List archived pay periods (by start_date)."""
  with db() as conn:
    try:
      rows = conn.execute(
        "SELECT start_date, archived_at FROM pay_period_archives ORDER BY start_date DESC"
      ).fetchall()
      items = [dict(r) for r in rows]
    except Exception:
      items = []
  return jsonify({"archives": items})


@app.post("/api/pay_periods/<start_date>/archive")
def archive_pay_period(start_date: str):
  """Archive a pay period by its start_date (YYYY-MM-DD)."""
  # Validate
  try:
    _ = parse_date(start_date)
  except Exception:
    return jsonify({"ok": False, "error": "Invalid start_date"}), 400
  with db() as conn:
    try:
      conn.execute(
        "INSERT OR IGNORE INTO pay_period_archives(start_date, archived_at) VALUES (?,?)",
        (start_date, now_iso()),
      )
    except Exception as e:
      return jsonify({"ok": False, "error": str(e)}), 500
  return jsonify({"ok": True})


@app.delete("/api/pay_periods/<start_date>/archive")
def unarchive_pay_period(start_date: str):
  """Undo archive for a pay period by its start_date."""
  try:
    _ = parse_date(start_date)
  except Exception:
    return jsonify({"ok": False, "error": "Invalid start_date"}), 400
  with db() as conn:
    try:
      conn.execute("DELETE FROM pay_period_archives WHERE start_date=?", (start_date,))
    except Exception as e:
      return jsonify({"ok": False, "error": str(e)}), 500
  return jsonify({"ok": True})

@app.post("/api/accounts/anchor")
def set_anchor():
  payload = request.get_json(force=True)
  account_id = int(payload["account_id"])
  anchor_date = payload["anchor_date"]
  anchor_balance = float(payload["anchor_balance"])
  with db() as conn:
    conn.execute(
      "INSERT OR REPLACE INTO account_anchors(account_id, anchor_date, anchor_balance) VALUES (?,?,?)",
      (account_id, anchor_date, anchor_balance)
    )
  return jsonify({"ok": True})

@app.get("/api/recurring_rules")
def list_rules():
  with db() as conn:
    rules = [dict(r) for r in conn.execute("SELECT * FROM recurring_rules ORDER BY id DESC").fetchall()]
  return jsonify(rules)

@app.post("/api/recurring_rules")
def create_rule():
  p = request.get_json(force=True)
  url = (p.get("url") or "").strip() or None
  with db() as conn:
    cur = conn.execute(
      """INSERT INTO recurring_rules
         (account_id, description, url, amount, cadence, day_of_month, by_day_of_month, start_date, end_date, due_day, funding_bucket_override, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
      (
        int(p["account_id"]),
        p["description"],
        url,
        float(p["amount"]),
        p["cadence"],
        p.get("day_of_month"),
        int(bool(p.get("by_day_of_month", False))),
        p["start_date"],
        p.get("end_date"),
        p.get("due_day"),
        p.get("funding_bucket_override"),
        1
      )
    )
    rule_id = cur.lastrowid
  return jsonify({"ok": True, "id": rule_id})


@app.patch("/api/recurring_rules/<int:rule_id>")
def update_rule(rule_id: int):
  p = request.get_json(force=True)
  allowed = {
    "account_id",
    "description",
    "url",
    "amount",
    "cadence",
    "day_of_month",
    "by_day_of_month",
    "start_date",
    "end_date",
    "due_day",
    "funding_bucket_override",
    "is_active",
  }
  fields = []
  params = []
  for key, val in p.items():
    if key not in allowed:
      continue
    if key == "url":
      val = (val or "").strip() or None
    if key == "by_day_of_month":
      val = int(bool(val))
    if key == "is_active":
      val = int(bool(val))
    fields.append(f"{key}=?")
    params.append(val)
  if not fields:
    return jsonify({"ok": True})
  params.append(rule_id)
  with db() as conn:
    row = conn.execute("SELECT id FROM recurring_rules WHERE id=?", (rule_id,)).fetchone()
    if not row:
      return jsonify({"ok": False, "error": "Rule not found"}), 404
    conn.execute(f"UPDATE recurring_rules SET {', '.join(fields)} WHERE id=?", params)
  return jsonify({"ok": True})


@app.delete("/api/recurring_rules/<int:rule_id>")
def delete_rule(rule_id: int):
  with db() as conn:
    conn.execute("DELETE FROM recurring_rules WHERE id=?", (rule_id,))
  return jsonify({"ok": True})

@app.post("/api/recurring_rules/<int:rule_id>/generate")
def generate_from_rule(rule_id: int):
  p = request.get_json(force=True)
  to_date = parse_date(p["to_date"])
  with db() as conn:
    rule = conn.execute("SELECT * FROM recurring_rules WHERE id=?", (rule_id,)).fetchone()
    if not rule:
      return jsonify({"ok": False, "error": "Rule not found"}), 404

    start = parse_date(rule["start_date"])
    end = parse_date(rule["end_date"]) if rule["end_date"] else to_date
    end = min(end, to_date)

    paychecks = [dict(r) for r in conn.execute("SELECT id,date FROM paychecks ORDER BY date").fetchall()]

    created = 0
    if rule["cadence"] == "monthly":
      dom = int(rule["day_of_month"] or 1)
      occ = date(start.year, start.month, 1)
      while occ <= end:
        next_month = (occ.replace(day=28) + timedelta(days=4)).replace(day=1)
        last_day = (next_month - timedelta(days=1)).day
        day = min(dom, last_day)
        eff = date(occ.year, occ.month, day)
        if eff < start:
          occ = next_month
          continue
        if eff > end:
          break

        due_day = int(rule["due_day"] or day)
        bucket = rule["funding_bucket_override"] or bucket_from_due_day(due_day)
        fp_id = assign_funding_paycheck_id(eff.year, eff.month, bucket, paychecks)
        due_label = f"by the {due_day}th" if rule["by_day_of_month"] else f"{due_day}th"

        conn.execute(
          """INSERT INTO transactions
             (account_id, recurring_rule_id, effective_date, amount, description, url, due_day, due_label, funding_bucket, funding_paycheck_id, status, sort_key, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (
            rule["account_id"], rule["id"], iso(eff), float(rule["amount"]), rule["description"], (rule["url"] if ("url" in rule.keys()) else None),
            due_day, due_label, bucket, fp_id, "planned", 0, now_iso(), now_iso()
          )
        )
        created += 1
        occ = next_month

    elif rule["cadence"] == "biweekly":
      d = start
      while d <= end:
        due_day = int(rule["due_day"] or d.day)
        bucket = rule["funding_bucket_override"] or bucket_from_due_day(due_day)
        fp_id = assign_funding_paycheck_id(d.year, d.month, bucket, paychecks)

        conn.execute(
          """INSERT INTO transactions
             (account_id, recurring_rule_id, effective_date, amount, description, url, due_day, due_label, funding_bucket, funding_paycheck_id, status, sort_key, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (
            rule["account_id"], rule["id"], iso(d), float(rule["amount"]), rule["description"], (rule["url"] if ("url" in rule.keys()) else None),
            due_day, None, bucket, fp_id, "planned", 0, now_iso(), now_iso()
          )
        )
        created += 1
        d += timedelta(days=14)
    else:
      return jsonify({"ok": False, "error": "Cadence not implemented in MVP"}), 400

  return jsonify({"ok": True, "created": created})

@app.get("/api/transactions")
def list_transactions():
  account_id = request.args.get("account_id")
  date_from = request.args.get("from")
  date_to = request.args.get("to")
  q = "SELECT * FROM transactions WHERE 1=1"
  params = []
  if account_id:
    q += " AND account_id=?"
    params.append(int(account_id))
  if date_from:
    q += " AND effective_date>=?"
    params.append(date_from)
  if date_to:
    q += " AND effective_date<=?"
    params.append(date_to)
  q += " ORDER BY effective_date, sort_key, id"
  with db() as conn:
    txs = [dict(r) for r in conn.execute(q, params).fetchall()]
  return jsonify(txs)

@app.post("/api/transactions")
def create_transaction():
  p = request.get_json(force=True)
  eff = parse_date(p["effective_date"])
  due_day_raw = p.get("due_day")
  due_day = int(due_day_raw) if due_day_raw not in (None, "", "null") else None
  bucket = p.get("funding_bucket") or bucket_from_due_day(due_day)
  url = (p.get("url") or "").strip() or None

  with db() as conn:
    paychecks = [dict(r) for r in conn.execute("SELECT id,date FROM paychecks ORDER BY date").fetchall()]
    fp_id = p.get("funding_paycheck_id")
    if fp_id in (None, "", "null"):
      fp_id = assign_funding_paycheck_id(eff.year, eff.month, bucket, paychecks)

    cur = conn.execute(
      """INSERT INTO transactions
         (account_id, recurring_rule_id, effective_date, amount, description, url, due_day, due_label, funding_bucket, funding_paycheck_id, status, sort_key, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
      (
        int(p["account_id"]),
        p.get("recurring_rule_id"),
        iso(eff),
        float(p["amount"]),
        p["description"],
        url,
        due_day,
        p.get("due_label"),
        bucket,
        int(fp_id) if fp_id else None,
        p.get("status", "planned"),
        int(p.get("sort_key", 0)),
        now_iso(),
        now_iso()
      )
    )
    tx_id = cur.lastrowid
  return jsonify({"ok": True, "id": tx_id})

@app.patch("/api/transactions/<int:tx_id>")
def update_transaction(tx_id: int):
  p = request.get_json(force=True)
  allowed = {"account_id","effective_date","amount","description","url","due_day","due_label","funding_bucket","funding_paycheck_id","status","sort_key"}
  fields = []
  params = []
  for key, val in p.items():
    if key in allowed:
      fields.append(f"{key}=?")
      params.append(val)
  fields.append("updated_at=?")
  params.append(now_iso())
  params.append(tx_id)
  with db() as conn:
    conn.execute(f"UPDATE transactions SET {', '.join(fields)} WHERE id=?", params)
  return jsonify({"ok": True})

@app.delete("/api/transactions/<int:tx_id>")
def delete_transaction(tx_id: int):
  with db() as conn:
    conn.execute("DELETE FROM transactions WHERE id=?", (tx_id,))
  return jsonify({"ok": True})

@app.post("/api/transactions/recompute_funding")
def recompute_funding():
  p = request.get_json(force=True)
  date_from = p.get("from", "1900-01-01")
  date_to = p.get("to", "2999-12-31")
  with db() as conn:
    paychecks = [dict(r) for r in conn.execute("SELECT id,date FROM paychecks ORDER BY date").fetchall()]
    txs = conn.execute(
      "SELECT id,effective_date,due_day FROM transactions WHERE effective_date>=? AND effective_date<=? ORDER BY id",
      (date_from, date_to)
    ).fetchall()
    updated = 0
    for r in txs:
      eff = parse_date(r["effective_date"])
      bucket = bucket_from_due_day(r["due_day"])
      fp_id = assign_funding_paycheck_id(eff.year, eff.month, bucket, paychecks)
      conn.execute("UPDATE transactions SET funding_bucket=?, funding_paycheck_id=?, updated_at=? WHERE id=?",
                   (bucket, fp_id, now_iso(), r["id"]))
      updated += 1
  return jsonify({"ok": True, "updated": updated})



@app.patch("/api/cc_snapshots/<int:snapshot_id>")
def update_cc_snapshot(snapshot_id: int):
  p = request.get_json(force=True)
  name = (p.get("name") or "").strip()
  snapshot_date = (p.get("snapshot_date") or "").strip()
  side = (p.get("side") or "personal").strip()
  url = (p.get("url") or "").strip() or None
  # Card due day is card-level metadata and only applies to card-definition rows.
  due_day = (p.get("due_day") or "").strip() or None
  pay_status = (p.get("pay_status") or "").strip() or None
  try:
    balance = float(p.get("balance") or 0)
  except Exception:
    balance = 0.0

  if not name:
    return jsonify({"ok": False, "error": "Name is required"}), 400
  if not snapshot_date:
    return jsonify({"ok": False, "error": "Snapshot date is required"}), 400

  with db() as conn:
    row = conn.execute("SELECT id FROM cc_snapshots WHERE id=?", (snapshot_id,)).fetchone()
    if not row:
      return jsonify({"ok": False, "error": "Not found"}), 404
    cols = [r[1] for r in conn.execute("PRAGMA table_info(cc_snapshots)").fetchall()]
    has_pay_status = "pay_status" in cols

    # Only allow editing due_day on card-definition rows.
    if snapshot_date == CC_CARDDEF_DATE:
      conn.execute(
        "UPDATE cc_snapshots SET name=?, snapshot_date=?, balance=?, side=?, url=?, due_day=? WHERE id=?",
        (name, snapshot_date, balance, side, url, due_day, snapshot_id)
      )
    else:
      if has_pay_status:
        conn.execute(
          "UPDATE cc_snapshots SET name=?, snapshot_date=?, balance=?, side=?, url=?, pay_status=? WHERE id=?",
          (name, snapshot_date, balance, side, url, pay_status, snapshot_id)
        )
      else:
        conn.execute(
          "UPDATE cc_snapshots SET name=?, snapshot_date=?, balance=?, side=?, url=? WHERE id=?",
          (name, snapshot_date, balance, side, url, snapshot_id)
        )
  return jsonify({"ok": True})

@app.delete("/api/cc_snapshots/<int:snapshot_id>")
def delete_cc_snapshot(snapshot_id: int):
  with db() as conn:
    conn.execute("DELETE FROM cc_snapshots WHERE id=?", (snapshot_id,))
  return jsonify({"ok": True})

# ---------------- Credit Card Snapshots ----------------

@app.get("/api/cc_snapshots")
def list_cc_snapshots():
  as_of = request.args.get("as_of")
  side = request.args.get("side") or "personal"
  with db() as conn:
    if as_of:
      cards, total = cc_cards_for_paycheck(conn, as_of, side=side)
      return jsonify({"as_of": as_of, "cards": cards, "total": total})
    rows = conn.execute("SELECT * FROM cc_snapshots WHERE side=? ORDER BY snapshot_date DESC, name", (side,)).fetchall()
    return jsonify([dict(r) for r in rows])

@app.post("/api/cc_snapshots/save")
def save_cc_snapshots():
  p = request.get_json(force=True)
  snap_date = p.get("snapshot_date") or date.today().isoformat()
  side = p.get("side") or "personal"
  cards = p.get("cards", [])
  with db() as conn:
    for c in cards:
      name = (c.get("name") or "").strip()
      if not name:
        continue
      url = (c.get("url") or "").strip() or None
      bal = float(c.get("balance") or 0)
      pay_status = (c.get("pay_status") or "").strip() or None
      # Keep one row per (name, snapshot_date, side)
      conn.execute(
        "DELETE FROM cc_snapshots WHERE name=? AND snapshot_date=? AND side=?",
        (name, snap_date, side)
      )
      conn.execute(
        "INSERT INTO cc_snapshots(name, snapshot_date, balance, side, url, pay_status) VALUES (?,?,?,?,?,?)",
        (name, snap_date, bal, side, url, pay_status)
      )
  return jsonify({"ok": True})


# ---------------- Card Definitions (name/url/due_day) ----------------

@app.get("/api/cc_cards")
def list_cc_cards():
  side = request.args.get("side") or "personal"
  with db() as conn:
    defs = cc_card_defs(conn, side)
    # If no explicit card-def rows exist yet, infer from existing snapshots.
    if not defs:
      names = cc_card_names(conn, side)
      today_iso = date.today().isoformat()
      defs = []
      for nm in names:
        defs.append({
          "id": None,
          "name": nm,
          "url": cc_latest_url(conn, nm, today_iso, side),
          "due_day": cc_latest_due_day(conn, nm, today_iso, side)
        })
    return jsonify({"side": side, "cards": defs})


def _normalize_due_day(v: str | None):
  if not v:
    return None
  s = str(v).strip()
  if not s:
    return None
  # Accept '5' -> '05'
  if s.isdigit() and len(s) in (1, 2):
    n = int(s)
    if 1 <= n <= 31:
      return f"{n:02d}"
  return None


@app.post("/api/cc_cards/save")
def save_cc_cards():
  p = request.get_json(force=True)
  side = p.get("side") or "personal"
  cards = p.get("cards", [])
  with db() as conn:
    # Rewrite card-definition rows for this side (non-destructive to pay-period snapshots).
    conn.execute("DELETE FROM cc_snapshots WHERE side=? AND snapshot_date=?", (side, CC_CARDDEF_DATE))
    for c in cards:
      name = (c.get("name") or "").strip()
      if not name:
        continue
      url = (c.get("url") or "").strip() or None
      due_day = _normalize_due_day(c.get("due_day"))
      conn.execute(
        "INSERT INTO cc_snapshots(name, snapshot_date, balance, side, url, due_day) VALUES (?,?,?,?,?,?)",
        (name, CC_CARDDEF_DATE, 0.0, side, url, due_day)
      )
  return jsonify({"ok": True})

@app.post("/api/cc/create_payment")
def create_cc_payment():
  p = request.get_json(force=True)
  period_start = parse_date(p["period_start"])
  offset_days = int(p.get("offset_days", 6))
  side = p.get("side") or "personal"
  account_id = int(p.get("account_id", 1 if side=="personal" else 2))
  desc = p.get("description", "cc" if side=="personal" else "cc-biz")
  eff = period_start + timedelta(days=offset_days)

  with db() as conn:
    cards, total = cc_cards_for_paycheck(conn, iso(period_start), side=side)
    if total == 0:
      return jsonify({"ok": False, "error": "CC total is $0.00 (no snapshots as of that date)"}), 400

    existing = conn.execute(
      "SELECT id FROM transactions WHERE account_id=? AND effective_date=? AND description=?",
      (account_id, iso(eff), desc)
    ).fetchone()
    if existing:
      return jsonify({"ok": True, "id": existing["id"], "skipped": True, "amount": -total})

    cur = conn.execute(
      """INSERT INTO transactions
         (account_id, recurring_rule_id, effective_date, amount, description, url, due_day, due_label, funding_bucket, funding_paycheck_id, status, sort_key, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
      (
        account_id, None, iso(eff), float(-total), desc, None,
        None, None, "ONE_OFF", None, "planned", 50, now_iso(), now_iso()
      )
    )
    return jsonify({"ok": True, "id": cur.lastrowid, "amount": -total, "cards": cards, "total": total})

@app.get("/api/projection")
def projection():
  q_from = request.args.get("from")
  q_to = request.args.get("to")

  with db() as conn:
    settings = {r["key"]: r["value"] for r in conn.execute("SELECT key,value FROM settings").fetchall()}
    anchor_date = parse_date(settings.get("anchor_date", date.today().isoformat()))
    horizon_days = int(settings.get("horizon_days", "365"))
    to_default = anchor_date + timedelta(days=horizon_days)

    date_from = parse_date(q_from) if q_from else anchor_date
    date_to = parse_date(q_to) if q_to else to_default

    accounts = [dict(r) for r in conn.execute("SELECT * FROM accounts ORDER BY id").fetchall()]
    paychecks = [dict(r) for r in conn.execute("SELECT id,account_id,date,amount FROM paychecks ORDER BY date").fetchall()]

    primary_account_id = int(settings.get("paycheck_account_id", "1"))
    primary = [p for p in paychecks if p["account_id"] == primary_account_id]
    primary.sort(key=lambda p: p["date"])

    archived_starts = _archived_period_starts(conn)

    periods = []
    for i, p in enumerate(primary):
      start = parse_date(p["date"])
      end = parse_date(primary[i+1]["date"]) - timedelta(days=1) if i + 1 < len(primary) else (start + timedelta(days=13))
      if end < date_from or start > date_to:
        continue
      if iso(start) in archived_starts:
        continue
      periods.append({"start_date": iso(start), "end_date": iso(end), "paycheck": p})

    count_by_month = {}
    for p in primary:
      d = parse_date(p["date"])
      key = f"{d.year:04d}-{d.month:02d}"
      count_by_month[key] = count_by_month.get(key, 0) + 1

    tx_rows = conn.execute(
      """SELECT * FROM transactions
         WHERE effective_date>=? AND effective_date<=?
         ORDER BY effective_date, sort_key, id""",
      (iso(date_from - timedelta(days=1)), iso(date_to + timedelta(days=1)))
    ).fetchall()
    txs = [dict(r) for r in tx_rows]

    anchors = conn.execute("SELECT * FROM account_anchors WHERE anchor_date=?", (settings.get("anchor_date", iso(anchor_date)),)).fetchall()
    anchor_by_account = {r["account_id"]: float(r["anchor_balance"]) for r in anchors}

    current_start = {a["id"]: anchor_by_account.get(a["id"], 0.0) for a in accounts}

    out_periods = []
    for period in periods:
      ps = parse_date(period["start_date"])
      pe = parse_date(period["end_date"])
      month_key = f"{ps.year:04d}-{ps.month:02d}"
      three_paycheck_month = (count_by_month.get(month_key, 0) == 3)

      period_out = {
        "start_date": period["start_date"],
        "end_date": period["end_date"],
        "three_paycheck_month": three_paycheck_month,
        "paycheck": period["paycheck"],
        "accounts": [],
        "cc": {"cards": [], "total": 0.0},
        "cc_biz": {"cards": [], "total": 0.0}
      }

      cc_cards, cc_total = cc_cards_for_paycheck(conn, iso(ps), side="personal")
      period_out["cc"] = {"cards": cc_cards, "total": cc_total}
      cc2_cards, cc2_total = cc_cards_for_paycheck(conn, iso(ps), side="business")
      period_out["cc_biz"] = {"cards": cc2_cards, "total": cc2_total}

      for a in accounts:
        acct_txs = [t for t in txs if t["account_id"] == a["id"] and ps <= parse_date(t["effective_date"]) <= pe]
        paycheck_tx = None
        if period["paycheck"]["account_id"] == a["id"]:
          paycheck_tx = {
            "id": f"paycheck-{period['paycheck']['id']}",
            "effective_date": period["start_date"],
            "amount": float(period["paycheck"]["amount"]),
            "description": "Paycheck",
            "due_label": None,
            "status": "planned",
            "sort_key": -999
          }

        tx_by_day = {}
        for t in acct_txs:
          tx_by_day.setdefault(t["effective_date"], []).append(t)
        if paycheck_tx:
          tx_by_day.setdefault(paycheck_tx["effective_date"], []).insert(0, paycheck_tx)

        bal = float(current_start[a["id"]])
        days = []
        for d in daterange(ps, pe):
          ds = iso(d)
          items = tx_by_day.get(ds, [])
          items_sorted = sorted(items, key=lambda x: (int(x.get("sort_key", 0)), str(x.get("id"))))
          start_bal = bal
          for it in items_sorted:
            bal += float(it["amount"])
          days.append({"date": ds, "items": items_sorted, "balance": round(bal, 2), "start_balance": round(start_bal, 2)})

        current_start[a["id"]] = bal
        start_balance = days[0]["start_balance"] if days else round(bal, 2)

        period_out["accounts"].append({
          "account_id": a["id"],
          "account_name": a["name"],
          "start_balance": round(start_balance, 2),
          "end_balance": round(bal, 2),
          "days": days
        })

      out_periods.append(period_out)

  return jsonify({"settings": settings, "accounts": accounts, "periods": out_periods})

def main():
  init_db()
  app.run(host="127.0.0.1", port=5000, debug=False)

if __name__ == "__main__":
  main()


@app.route("/api/export/google_sheet", methods=["POST"])
def export_google_sheet():
  """Export visible pay periods to a Google Sheet.
  Requires environment variables:
  GOOGLE_SHEETS_ID
  GOOGLE_SERVICE_ACCOUNT_JSON
  """
  import os
  sheet_id = os.environ.get("GOOGLE_SHEETS_ID")
  cred_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
  if not sheet_id or not cred_path:
    return jsonify({"error":"Google Sheets not configured"}),400

  try:
    import gspread
    from google.oauth2.service_account import Credentials

    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_file(cred_path, scopes=scopes)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(sheet_id)
    ws = sheet.worksheet("PayPeriods") if "PayPeriods" in [w.title for w in sheet.worksheets()] else sheet.add_worksheet("PayPeriods",1000,20)

    conn = db()
    periods = conn.execute("SELECT * FROM pay_periods ORDER BY start_date").fetchall()

    rows = [["Start","End","Payday"]]
    for p in periods:
      rows.append([p["start_date"], p["end_date"], p["payday_date"]])

    ws.clear()
    ws.update(rows)

    return jsonify({"status":"ok","rows":len(rows)})
  except Exception as e:
    return jsonify({"error":str(e)}),500

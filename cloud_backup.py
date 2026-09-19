"""Versioned, private disaster-recovery snapshots; never modifies business records."""
import hashlib
import io
import json
import sqlite3
import tempfile
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

BUCKET = "sbooks-private-backups"
INTERVAL = 900
_started = False
_guard = threading.Lock()


@contextmanager
def open_db(path):
    conn = sqlite3.connect(path, timeout=15)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


@contextmanager
def connection(path):
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS cloud_backup_control (
        id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
        lease REAL NOT NULL DEFAULT 0, attempted REAL NOT NULL DEFAULT 0,
        succeeded TEXT, object_name TEXT, error TEXT, digest TEXT)""")
    conn.execute("INSERT OR IGNORE INTO cloud_backup_control(id) VALUES(1)")
    conn.commit()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def status(path):
    with connection(path) as conn:
        result = dict(conn.execute("SELECT * FROM cloud_backup_control WHERE id=1").fetchone())
        settings = dict(conn.execute("SELECT key,value FROM business_settings"))
    result["enabled"] = bool(result["enabled"])
    result["running"] = result.pop("lease") > time.time()
    result["configured"] = bool(settings.get("supabase_url") and settings.get("supabase_secret_key"))
    result["bucket"] = BUCKET
    return result


def set_enabled(path, enabled):
    with connection(path) as conn:
        conn.execute("UPDATE cloud_backup_control SET enabled=?, attempted=0 WHERE id=1", (int(enabled),))


def storage(settings, method, route, payload=None, binary=False):
    base = settings.get("supabase_url", "").rstrip("/")
    if urlparse(base).scheme != "https" or not settings.get("supabase_secret_key"):
        raise ValueError("Save a Supabase HTTPS URL and secret key in Business Profile first.")
    key = settings["supabase_secret_key"]
    headers = {"apikey": key, "Content-Type": "application/zip" if binary else "application/json"}
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + key
    data = payload if binary else json.dumps(payload).encode() if payload is not None else None
    req = Request(base + "/storage/v1/" + route, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=90) as response:
            return response.read()
    except HTTPError as exc:
        # Never expose response bodies or credentials in the UI/logs.
        raise RuntimeError(f"Supabase Storage returned HTTP {exc.code}.") from None


def private_bucket(settings):
    buckets = json.loads(storage(settings, "GET", "bucket"))
    bucket = next((b for b in buckets if b["id"] == BUCKET), None)
    if bucket is None:
        storage(settings, "POST", "bucket", {"id": BUCKET, "name": BUCKET, "public": False})
    elif bucket.get("public"):
        raise ValueError("Backup bucket is public. Make it private before backing up.")


def make_snapshot(path):
    with tempfile.TemporaryDirectory() as temp:
        snapshot = Path(temp) / "cashflow.db"
        with open_db(path) as source, open_db(snapshot) as dest:
            source.backup(dest)
            dest.execute("PRAGMA secure_delete=ON")
            settings = dict(dest.execute("SELECT key,value FROM business_settings"))
            for key in settings:
                if any(word in key.lower() for word in ("password", "secret", "token")):
                    dest.execute("UPDATE business_settings SET value='' WHERE key=?", (key,))
            dest.execute("DROP TABLE IF EXISTS cloud_backup_control")
            dest.commit()
            dest.execute("VACUUM")
            if dest.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("SQLite snapshot failed integrity verification.")
            tables = [r[0] for r in dest.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            counts = {t: dest.execute('SELECT COUNT(*) FROM "' + t.replace('"', '""') + '"').fetchone()[0] for t in tables}
        files = {"cashflow.db": snapshot.read_bytes()}
        logo = Path(settings.get("company_logo_path", ""))
        if logo.is_file():
            files["assets/company-logo" + logo.suffix.lower()] = logo.read_bytes()
        manifest = {"version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
                    "counts": counts, "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
                    "note": "Service secrets excluded. Cloud-hosted receipts are not included. Local company logo included when available."}
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in files.items():
                archive.writestr(name, data)
            archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        return output.getvalue(), settings


def verify_archive(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        for name, digest in manifest["files"].items():
            if hashlib.sha256(archive.read(name)).hexdigest() != digest:
                raise ValueError("Backup checksum mismatch.")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "verify.db"
            path.write_bytes(archive.read("cashflow.db"))
            with open_db(path) as conn:
                if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Downloaded database failed integrity verification.")
                for table, count in manifest["counts"].items():
                    actual = conn.execute('SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0]
                    if actual != count:
                        raise ValueError("Restored record counts differ.")
    return manifest


def run_backup(path, manual=False):
    now = time.time()
    with connection(path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM cloud_backup_control WHERE id=1").fetchone()
        if row["lease"] > now or (not manual and (not row["enabled"] or now - row["attempted"] < INTERVAL)):
            return
        conn.execute("UPDATE cloud_backup_control SET lease=?,attempted=?,error=NULL WHERE id=1", (now + 600, now))
    try:
        data, settings = make_snapshot(path)
        private_bucket(settings)
        name = datetime.now(timezone.utc).strftime("%Y/%m/%d/%H%M%S-") + uuid.uuid4().hex + ".zip"
        route = "object/" + BUCKET + "/" + name
        storage(settings, "POST", route, data, binary=True)
        downloaded = storage(settings, "GET", route)
        if hashlib.sha256(data).digest() != hashlib.sha256(downloaded).digest():
            raise ValueError("Uploaded backup differs from local snapshot.")
        verify_archive(downloaded)
        with connection(path) as conn:
            conn.execute("UPDATE cloud_backup_control SET succeeded=?,object_name=?,digest=?,error=NULL WHERE id=1",
                         (datetime.now(timezone.utc).isoformat(), name, hashlib.sha256(data).hexdigest()))
    except Exception as exc:
        with connection(path) as conn:
            conn.execute("UPDATE cloud_backup_control SET error=? WHERE id=1", (str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Backup failed. Check network access and Supabase settings.",))
        raise
    finally:
        with connection(path) as conn:
            conn.execute("UPDATE cloud_backup_control SET lease=0 WHERE id=1")


def start_worker(path):
    global _started
    with _guard:
        if _started:
            return
        _started = True
    def worker():
        while True:
            try:
                run_backup(path)
            except Exception:
                pass  # Persisted error is displayed by the backup controls.
            time.sleep(60)
    threading.Thread(target=worker, daemon=True, name="sbooks-backup").start()


def register(app, path):
    from flask import jsonify, request, send_file

    @app.before_request
    def ensure_backup_worker():
        if not app.testing:
            start_worker(path)

    @app.get("/api/cloud_backup")
    def backup_status():
        return jsonify(status(path))

    @app.post("/api/cloud_backup")
    def backup_action():
        # Local-only administration; reject cross-origin form/API requests.
        if request.remote_addr not in ("127.0.0.1", "::1") or not request.is_json:
            return jsonify(error="Backup controls require local JSON requests."), 403
        body = request.get_json()
        if "enabled" in body:
            if not isinstance(body["enabled"], bool):
                return jsonify(error="enabled must be a boolean"), 400
            set_enabled(path, body["enabled"])
        if body.get("backup_now"):
            try:
                run_backup(path, manual=True)
            except Exception:
                return jsonify(status(path)), 502
        return jsonify(status(path))

    @app.get("/api/cloud_backup/download")
    def download_backup():
        if request.remote_addr not in ("127.0.0.1", "::1"):
            return jsonify(error="Local access required."), 403
        current = status(path)
        if not current["object_name"]:
            return jsonify(error="No verified backup yet."), 404
        with open_db(path) as conn:
            settings = dict(conn.execute("SELECT key,value FROM business_settings"))
        data = storage(settings, "GET", "object/" + BUCKET + "/" + quote(current["object_name"], safe="/"))
        verify_archive(data)
        return send_file(io.BytesIO(data), mimetype="application/zip", as_attachment=True, download_name="sbooks-recovery.zip")

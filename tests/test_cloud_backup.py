import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import cloud_backup as backup
from restore_backup import restore


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "source.db"
        with backup.open_db(self.path) as conn:
            conn.executescript("CREATE TABLE business_settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE transactions(id INTEGER,amount REAL);")
            conn.execute("INSERT INTO transactions VALUES(1,123.45)")
            conn.execute("INSERT INTO business_settings VALUES('smtp_password','private')")

    def test_restore_preserves_records_and_excludes_secrets(self):
        data, _ = backup.make_snapshot(self.path)
        archive = self.root / "backup.zip"
        archive.write_bytes(data)
        target = restore(archive, self.root / "recovered")
        with backup.open_db(target) as conn:
            self.assertEqual(conn.execute("SELECT amount FROM transactions").fetchone()[0], 123.45)
            self.assertEqual(conn.execute("SELECT value FROM business_settings").fetchone()[0], "")
        with backup.open_db(self.path) as conn:
            self.assertEqual(conn.execute("SELECT value FROM business_settings").fetchone()[0], "private")
        with self.assertRaises(FileExistsError):
            restore(archive, self.root / "recovered")

    def test_off_prevents_automatic_upload(self):
        with patch.object(backup, "storage") as storage:
            backup.run_backup(self.path)
            storage.assert_not_called()

    def test_verified_upload_records_success(self):
        objects = {}
        def storage(settings, method, route, payload=None, binary=False):
            if route == "bucket":
                return json.dumps([{"id": backup.BUCKET, "public": False}]).encode()
            if method == "POST":
                objects[route] = payload
                return b"{}"
            return objects[route]
        with patch.object(backup, "storage", side_effect=storage):
            backup.run_backup(self.path, manual=True)
        result = backup.status(self.path)
        self.assertTrue(result["succeeded"])
        self.assertFalse(result["running"])

    def test_public_bucket_rejected(self):
        with patch.object(backup, "storage", return_value=json.dumps([{"id": backup.BUCKET, "public": True}]).encode()):
            with self.assertRaises(ValueError):
                backup.run_backup(self.path, manual=True)
        self.assertIsNone(backup.status(self.path)["succeeded"])

    def test_corrupt_download_does_not_mark_success(self):
        with patch.object(backup, "private_bucket"), patch.object(backup, "storage", return_value=b"corrupt"):
            with self.assertRaises(ValueError):
                backup.run_backup(self.path, manual=True)
        result = backup.status(self.path)
        self.assertIsNone(result["succeeded"])
        self.assertTrue(result["error"])


if __name__ == "__main__":
    unittest.main()

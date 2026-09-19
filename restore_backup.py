"""Restore an S-Books ZIP to a NEW folder; never overwrite working data."""
import argparse
import io
import sqlite3
import zipfile
from pathlib import Path
from cloud_backup import verify_archive, open_db


def restore(archive_path, destination):
    data = Path(archive_path).read_bytes()
    manifest = verify_archive(data)
    destination = Path(destination).resolve()
    names = list(manifest["files"])
    for name in names:
        target = (destination / name).resolve()
        if not target.is_relative_to(destination):
            raise ValueError("Invalid archive path")
    destination.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in names:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
    logo = next((n for n in names if n.startswith("assets/company-logo")), None)
    if logo:
        with open_db(destination / "cashflow.db") as conn:
            conn.execute("UPDATE business_settings SET value=? WHERE key='company_logo_path'", (str(destination / logo),))
    return destination / "cashflow.db"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("destination", help="New, non-existing recovery folder")
    args = parser.parse_args()
    print(restore(args.archive, args.destination))

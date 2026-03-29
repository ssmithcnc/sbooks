from __future__ import annotations

from pathlib import Path
from textwrap import wrap


PAGE_W = 612
PAGE_H = 792
LEFT = 42
RIGHT = PAGE_W - 42
TOP = PAGE_H - 42
COLUMN_GAP = 20
COLUMN_W = (RIGHT - LEFT - COLUMN_GAP) / 2


def pdf_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


class Canvas:
    def __init__(self) -> None:
        self.ops: list[str] = []

    def text(self, x: float, y: float, size: int, text: str, font: str = "F1") -> None:
        self.ops.append(f"BT /{font} {size} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm ({pdf_escape(text)}) Tj ET")

    def rule(self, x1: float, y1: float, x2: float, y2: float, width: float = 1.0) -> None:
        self.ops.append(f"{width:.2f} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def rect(self, x: float, y: float, w: float, h: float, fill_gray: float | None = None) -> None:
        if fill_gray is None:
            self.ops.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re S")
        else:
            self.ops.append(f"q {fill_gray:.2f} g {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f Q")

    def render(self) -> bytes:
        return "\n".join(self.ops).encode("latin-1", "replace")


def add_wrapped(canvas: Canvas, x: float, y: float, width: float, text: str, size: int = 9, font: str = "F1", leading: int = 11) -> float:
    max_chars = max(20, int(width / (size * 0.52)))
    lines = wrap(text, width=max_chars, break_long_words=False, break_on_hyphens=False)
    for line in lines:
        canvas.text(x, y, size, line, font=font)
        y -= leading
    return y


def add_bullets(canvas: Canvas, x: float, y: float, width: float, items: list[str], size: int = 9, leading: int = 11) -> float:
    bullet_indent = 10
    text_width = width - bullet_indent
    max_chars = max(18, int(text_width / (size * 0.52)))
    for item in items:
        lines = wrap(item, width=max_chars, break_long_words=False, break_on_hyphens=False)
        if not lines:
            continue
        canvas.text(x, y, size, chr(149))
        canvas.text(x + bullet_indent, y, size, lines[0])
        y -= leading
        for line in lines[1:]:
            canvas.text(x + bullet_indent, y, size, line)
            y -= leading
        y -= 1
    return y


def add_heading(canvas: Canvas, x: float, y: float, text: str) -> float:
    canvas.text(x, y, 11, text.upper(), font="F2")
    return y - 14


def build_pdf_bytes(stream: bytes) -> bytes:
    objects = []

    def add(obj: bytes) -> int:
        objects.append(obj)
        return len(objects)

    add(b"<< /Type /Catalog /Pages 2 0 R >>")
    add(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    add(
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
        f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>".encode("ascii")
    )
    add(f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream")
    add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{i} 0 obj\n".encode("ascii"))
        out.extend(obj)
        out.extend(b"\nendobj\n")

    xref_start = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    out.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode("ascii")
    )
    return bytes(out)


def main() -> None:
    canvas = Canvas()
    canvas.rect(LEFT, PAGE_H - 78, RIGHT - LEFT, 34, fill_gray=0.92)
    canvas.text(LEFT + 12, PAGE_H - 58, 20, "Cashflow Pay-Period Planner", font="F2")
    canvas.text(LEFT + 12, PAGE_H - 72, 9, "One-page repo summary generated from app.py, db.py, README.md, templates/index.html, static/app.js")

    left_x = LEFT
    right_x = LEFT + COLUMN_W + COLUMN_GAP
    y_left = PAGE_H - 104
    y_right = PAGE_H - 104

    y_left = add_heading(canvas, left_x, y_left, "What it is")
    y_left = add_wrapped(
        canvas,
        left_x,
        y_left,
        COLUMN_W,
        "A local-only web app for planning income, bills, and cash balances around 14-day pay periods. "
        "It uses Flask, a single-page JavaScript front end, and SQLite to project account balances and organize expenses by paycheck funding rules.",
    )
    y_left -= 8

    y_left = add_heading(canvas, left_x, y_left, "Who it's for")
    y_left = add_wrapped(
        canvas,
        left_x,
        y_left,
        COLUMN_W,
        "Primary persona: someone paid bi-weekly who wants to forecast cash flow across upcoming pay periods, including separate personal and business checking activity.",
    )
    y_left -= 8

    y_left = add_heading(canvas, left_x, y_left, "What it does")
    y_left = add_bullets(
        canvas,
        left_x,
        y_left,
        COLUMN_W,
        [
            "Sets an anchor payday, paycheck amount, horizon length, and starting balances by account.",
            "Generates bi-weekly paychecks and groups the timeline into pay-period cards.",
            "Tracks recurring rules and can materialize them into transactions through a target date.",
            "Lets users add, edit, delete, and status-toggle manual transactions in projected periods.",
            "Stores personal and business credit-card definitions plus per-paycheck balance snapshots.",
            "Builds projected balances per account and flags three-paycheck months in the timeline.",
            "Can archive old pay periods and includes an optional Google Sheets export endpoint.",
        ],
    )

    y_right = add_heading(canvas, right_x, y_right, "How it works")
    y_right = add_bullets(
        canvas,
        right_x,
        y_right,
        COLUMN_W,
        [
            "Browser UI: templates/index.html serves one shell page; static/app.js renders the timeline, modals, and forms.",
            "Web layer: app.py exposes JSON endpoints for setup, accounts, recurring rules, transactions, CC snapshots/cards, archives, export, and /api/projection.",
            "Data layer: db.py manages SQLite schema + migrations for settings, accounts, anchors, paychecks, recurring_rules, transactions, cc_snapshots, and pay_period_archives.",
            "Projection flow: the client requests /api/projection; the server loads paychecks, transactions, anchors, and CC data, computes period windows and funding buckets, then returns assembled period JSON for rendering.",
            "Storage: database defaults to C:\\cashflow_data\\cashflow.db on Windows, with CASHFLOW_DB override support.",
            "Integration note: Google Sheets export exists in code, but the OAuth client path points to C:\\projects\\cash16\\google_oauth.json, which is outside this repo.",
        ],
    )
    y_right -= 8

    y_right = add_heading(canvas, right_x, y_right, "How to run")
    y_right = add_bullets(
        canvas,
        right_x,
        y_right,
        COLUMN_W,
        [
            "Install Python 3.10+ (README requirement).",
            "From the repo root, run run.bat.",
            "run.bat creates/uses .venv, installs requirements.txt, sets CASHFLOW_DB if needed, and launches py app.py.",
            "Open http://127.0.0.1:5000 in a browser.",
        ],
    )
    y_right -= 8

    y_right = add_heading(canvas, right_x, y_right, "Repo gaps")
    y_right = add_bullets(
        canvas,
        right_x,
        y_right,
        COLUMN_W,
        [
            "No automated test suite or deployment docs found in repo.",
            "README says run_local.bat, but the repo contains run.bat instead.",
            "No in-repo OAuth client secret file found for Google Sheets export.",
        ],
    )

    output_path = Path(__file__).resolve().parent / "cashflow-app-summary.pdf"
    output_path.write_bytes(build_pdf_bytes(canvas.render()))
    print(output_path)


if __name__ == "__main__":
    main()

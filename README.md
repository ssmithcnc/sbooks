# Cashflow Pay-Period Planner (Local)

Local-only web app to plan & forecast income/bills in 14-day pay periods (bi-weekly).
Uses Flask + SQLite and runs on your computer.

## Quick start (Windows)
1. Install Python 3.10+ (check "Add Python to PATH")
2. Unzip this folder
3. Double-click `run_local.bat`
4. Open http://127.0.0.1:5000

## Notes
- Data is stored locally in `data/app.db`
- Rule: due day 1–15 = "1st-of-month" bucket; 16–EOM = "mid-month" bucket
- Funding rule:
  - 1st-of-month bills (1–15) are funded by previous month’s last paycheck
  - mid-month bills (16–EOM) are funded by current month’s first paycheck

## Database location
- Default (Windows): `C:\\cashflow_data\\cashflow.db`
- Override with env var: `CASHFLOW_DB=...`

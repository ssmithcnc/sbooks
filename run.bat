@echo off
setlocal
cd /d %~dp0

if not exist .venv (
  echo Creating virtual environment...
  py -m venv .venv
)

set "VENV_PYTHON=%~dp0.venv\Scripts\python.exe"
set "VENV_PIP=%~dp0.venv\Scripts\pip.exe"

if not exist "%VENV_PYTHON%" (
  echo Virtual environment is missing python.exe. Recreating...
  rmdir /s /q .venv
  py -m venv .venv
)

echo Installing requirements...
"%VENV_PYTHON%" -m pip install --upgrade pip >nul
"%VENV_PIP%" install -r requirements.txt

echo Starting app...

REM Persist DB outside app folder so updates don't reset data
if "%CASHFLOW_DB%"=="" set CASHFLOW_DB=C:\cashflow_data\cashflow.db

"%VENV_PYTHON%" app.py

endlocal

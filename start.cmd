@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [trans] project: %cd%

if not exist .env (
  if exist .env.example (
    copy /Y .env.example .env >nul
    echo [trans] Created .env from .env.example — edit GEMINI_API_KEY or PORT if needed.
  ) else (
    echo [trans] Warning: .env.example not found.
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo [trans] Node.js is not in PATH. Install Node 22.5+ from https://nodejs.org/
  pause
  exit /b 1
)

call npm install
if errorlevel 1 (
  echo [trans] npm install failed.
  pause
  exit /b 1
)

echo [trans] Starting server... (npm prestart clears data/uploads) Press Ctrl+C to stop.
call npm start
pause

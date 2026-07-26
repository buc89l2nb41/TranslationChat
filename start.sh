#!/usr/bin/env bash
# Windows PowerShell/CMD: use .\start.cmd or pwsh -File .\start.ps1
# Git Bash/WSL/macOS/Linux: chmod +x start.sh && ./start.sh
set -e
cd "$(dirname "$0")"

echo "[trans] project: $(pwd)"

if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  cp .env.example .env
  echo "[trans] Created .env from .env.example — edit GEMINI_API_KEY or PORT if needed."
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[trans] Node.js not found. Install Node 22.5+ from https://nodejs.org/"
  exit 1
fi

npm install
echo "[trans] Starting server... (npm prestart clears data/uploads) Press Ctrl+C to stop."
exec npm start

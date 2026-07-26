# Windows PowerShell — same as start.cmd
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[trans] project: $(Get-Location)"

if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
  Copy-Item ".env.example" ".env"
  Write-Host "[trans] Created .env from .env.example — edit GEMINI_API_KEY or PORT if needed."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "[trans] Node.js is not in PATH. Install Node 22.5+ from https://nodejs.org/"
  exit 1
}

npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[trans] Starting server... (npm prestart clears data/uploads) Press Ctrl+C to stop."
npm start

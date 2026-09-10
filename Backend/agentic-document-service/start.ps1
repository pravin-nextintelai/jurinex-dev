# Agentic Document Service - must run on port 8092 (frontend default).
# Do NOT use 8095 (that port is reserved for AI Chatbot in apiConfig).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONUNBUFFERED = "1"

if (-not (Test-Path ".venv\Scripts\uvicorn.exe")) {
  Write-Error "Virtual env missing. Run: python -m venv .venv && .venv\Scripts\pip install -r requirements.txt"
}

Write-Host "Starting agentic-document-service on http://localhost:8092 ..."
Write-Host "Wait for Application startup complete. First boot can take 30-90s."
& .\.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8092 --reload --reload-dir app --reload-dir agents

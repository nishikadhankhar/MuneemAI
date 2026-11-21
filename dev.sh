#!/usr/bin/env bash
# Start Muneem on macOS / Linux.
#   ./dev.sh             backend on :$PORT (default 8000) + web app on :5173
#   ./dev.sh --backend   backend only
#   ./dev.sh --test      backend test suite
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8000}"
PY="$ROOT/backend/.venv/bin/python"

if [[ ! -x "$PY" ]]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "$ROOT/backend/.venv"
  "$PY" -m pip install --upgrade pip -q
  "$PY" -m pip install -r "$ROOT/backend/requirements.txt" -q
fi
[[ -f "$ROOT/.env" ]] || echo "No .env found - running without ArangoDB and without AI (copy .env.example to .env)."

if [[ "${1:-}" == "--test" ]]; then
  cd "$ROOT/backend" && exec "$PY" -m pytest
fi
if [[ "${1:-}" == "--backend" ]]; then
  cd "$ROOT/backend" && exec "$PY" -m uvicorn app.main:app --reload --port "$PORT"
fi

(cd "$ROOT/backend" && "$PY" -m uvicorn app.main:app --reload --port "$PORT") &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT
[[ -d "$ROOT/frontend/node_modules" ]] || (cd "$ROOT/frontend" && npm install)
echo "Open http://localhost:5173"
cd "$ROOT/frontend" && MUNEEM_API="http://127.0.0.1:$PORT" npm run dev

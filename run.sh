#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── load .env if present ──
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^\s*#' "$SCRIPT_DIR/.env" | grep -v '^\s*$' | xargs)
fi

cleanup() { kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit; }
trap cleanup SIGINT SIGTERM

# ── free ports ──
lsof -ti tcp:8080 | xargs kill -9 2>/dev/null || true
lsof -ti tcp:5173 | xargs kill -9 2>/dev/null || true

echo "┌──────────────────────────────────────┐"
echo "│  DevTool Loop — starting…            │"
echo "└──────────────────────────────────────┘"

# ── backend (orchestrator) ──
PORT="${PORT:-8080}"
echo "  Backend  → http://localhost:$PORT"
node "$SCRIPT_DIR/orchestrator/index.mjs" &
BACKEND_PID=$!

# ── frontend (Vite) ──
if [ -d "$SCRIPT_DIR/rantify-ui" ]; then
  VITE_API_URL="${VITE_API_URL:-http://localhost:$PORT}"
  echo "  Frontend → http://localhost:5173  (VITE_API_URL=$VITE_API_URL)"
  VITE_API_URL="$VITE_API_URL" npm --prefix "$SCRIPT_DIR/rantify-ui" run dev &
  FRONTEND_PID=$!
else
  echo "  Frontend skipped (rantify-ui/ not found)"
fi

echo ""
echo "  Press Ctrl+C to stop both"
echo ""

wait

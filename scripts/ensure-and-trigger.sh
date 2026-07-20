#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# ensure-and-trigger.sh
# Called by launchd at login AND at 1:45 PM IST Mon–Fri.
#
# Purpose: Guarantee the Swami Dashboard backend is running.
#   1. If backend is healthy  → exit immediately (catch-up logic inside Node.js
#      will detect & submit any missed jobs on its own).
#   2. If backend is DOWN     → start all services via start.sh, then wait up
#      to 60 s for the backend to become healthy. Once it is, the Node.js
#      catch-up logic fires automatically.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BASE/logs"
LOG="$LOG_DIR/ensure-and-trigger.log"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S IST')] $*" | tee -a "$LOG"; }

HEALTH_URL="http://localhost:3001/api/health"

# ── Check if backend is already up ───────────────────────────────
if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  log "Backend is healthy — no action needed. Catch-up logic handles any missed jobs."
  exit 0
fi

log "Backend is NOT responding at $HEALTH_URL — starting all services..."

# ── Start all services ────────────────────────────────────────────
# Run start.sh detached (it backgrounds its own children and exits)
bash "$BASE/start.sh" >> "$LOG" 2>&1 || true

# ── Wait for backend to become healthy (up to 60 s) ──────────────
for i in $(seq 1 60); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    log "Backend is healthy after ${i}s. Catch-up logic will submit any missed jobs."
    exit 0
  fi
  sleep 1
done

log "WARNING: Backend did not start within 60 s. Check $LOG_DIR/backend.log for errors."
exit 1

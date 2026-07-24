#!/bin/zsh
BASE="/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
LOG="$BASE/logs"
mkdir -p "$LOG"

# Load env
set -a
source "$BASE/.env" 2>/dev/null
set +a

# Python services
cd "$BASE/services/photon"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8011 >> "$LOG/photon.log" 2>&1 &

cd "$BASE/services/boots-ki"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8012 >> "$LOG/boots-ki.log" 2>&1 &

sleep 3

# Backend (blocks — launchd keeps it alive via KeepAlive)
cd "$BASE/backend"
exec node --experimental-sqlite dist/index.js >> "$LOG/backend.log" 2>&1

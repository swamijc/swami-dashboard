#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Swami's Portfolio Dashboard — Start All Services
# ─────────────────────────────────────────────────────────────
set -e

BASE="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$BASE/logs"
mkdir -p "$LOG_DIR"

if [ ! -f "$BASE/.env" ] && [ -f "$BASE/.env.example" ]; then
  cp "$BASE/.env.example" "$BASE/.env"
  echo "[*] Created local .env from .env.example. Update live secrets in .env when needed."
fi

if [ -f "$BASE/.env" ]; then
  set -a
  . "$BASE/.env"
  set +a
fi

# Always use absolute DB path regardless of which directory node starts from
export DB_PATH="$BASE/backend/data/dashboard.db"

install_node_deps() {
  local dir="$1"
  cd "$dir"
  if [ ! -d node_modules ]; then
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
  fi
}

echo ""
echo "======================================================"
echo "  Swami's Portfolio Dashboard — Starting All Services"
echo "======================================================"

# Kill any stale processes on our ports
echo "[*] Cleaning up ports 3001, 8011, 8012, 5173..."
lsof -ti :3001 | xargs kill -9 2>/dev/null || true
lsof -ti :8011 | xargs kill -9 2>/dev/null || true
lsof -ti :8012 | xargs kill -9 2>/dev/null || true
lsof -ti :8013 | xargs kill -9 2>/dev/null || true
lsof -ti :5173 | xargs kill -9 2>/dev/null || true
sleep 1

# Start Photon service
echo "[1/4] Starting Photon Timesheet Service (port 8011)..."
cd "$BASE/services/photon"
python3 -m pip install -r requirements.txt -q 2>/dev/null
python3 -m uvicorn main:app --host 0.0.0.0 --port 8011 \
  >> "$LOG_DIR/photon.log" 2>&1 &
PHOTON_PID=$!

# Start Boots KI service
echo "[2/5] Starting Boots KI Service (port 8012)..."
cd "$BASE/services/boots-ki"
python3 -m pip install -r requirements.txt -q 2>/dev/null
python3 -m uvicorn main:app --host 0.0.0.0 --port 8012 \
  >> "$LOG_DIR/boots-ki.log" 2>&1 &
BOOTS_PID=$!

# Start Time Tracking service
echo "[3/5] Starting Time Tracking Service (port 8013)..."
cd "$BASE/services/time-tracking"
python3 -m pip install -r requirements.txt -q 2>/dev/null
python3 -m uvicorn main:app --host 0.0.0.0 --port 8013 \
  >> "$LOG_DIR/time-tracking.log" 2>&1 &
TRACKING_PID=$!

# Wait for Python services
sleep 2

# Start Node.js backend
echo "[4/5] Starting API Gateway (port 3001)..."
cd "$BASE/backend"
install_node_deps "$BASE/backend"
npm run build >/dev/null
node --experimental-sqlite dist/index.js \
  >> "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for backend to initialise DB
sleep 3

# Start React frontend
echo "[5/5] Starting Frontend (port 5173)..."
cd "$BASE/frontend"
install_node_deps "$BASE/frontend"
npm run dev >> "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

sleep 3

# ── Optional Cloudflare Tunnel ───────────────────────────────────
TUNNEL_URL=""
if command -v cloudflared >/dev/null 2>&1; then
  echo "[+] Starting Cloudflare Tunnel (port 5173)..."
  TUNNEL_LOG="$LOG_DIR/tunnel.log"
  cloudflared tunnel --url http://localhost:5173 \
    --no-autoupdate \
    >> "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  # Wait up to 15s for tunnel URL to appear in log
  for i in $(seq 1 15); do
    TUNNEL_URL=$(strings "$TUNNEL_LOG" 2>/dev/null | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -1 || true)
    [ -n "$TUNNEL_URL" ] && break
    sleep 1
  done
  if [ -n "$TUNNEL_URL" ]; then
    # Inject URL into .env so the backend allows CORS from it
    if grep -q '^EXTRA_ORIGINS=' "$BASE/.env" 2>/dev/null; then
      sed -i '' "s|^EXTRA_ORIGINS=.*|EXTRA_ORIGINS=$TUNNEL_URL|" "$BASE/.env"
    else
      echo "EXTRA_ORIGINS=$TUNNEL_URL" >> "$BASE/.env"
    fi
    # Restart backend with updated EXTRA_ORIGINS
    kill $BACKEND_PID 2>/dev/null || true
    sleep 1
    cd "$BASE/backend"
    export EXTRA_ORIGINS="$TUNNEL_URL"
    node --experimental-sqlite dist/index.js \
      >> "$LOG_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    sleep 2
  fi
else
  echo "[*] cloudflared not found — skipping tunnel (run: brew install cloudflared)"
fi

echo ""
echo "======================================================"
echo "  All services started!"
echo "======================================================"
echo "  Frontend   → http://localhost:5173"
if [ -n "$TUNNEL_URL" ]; then
echo "  External   → $TUNNEL_URL  ← access from anywhere"
fi
echo "  API Gateway → http://localhost:3001/api/health"
echo "  Photon Svc  → http://localhost:8011/health"
echo "  Boots KI    → http://localhost:8012/health"
echo ""
echo "  Login: admin / Admin@1234!"
echo ""
echo "  PIDs: backend=$BACKEND_PID  photon=$PHOTON_PID  boots=$BOOTS_PID  tracking=$TRACKING_PID  frontend=$FRONTEND_PID"
[ -n "$TUNNEL_PID" ] && echo "  Tunnel PID: $TUNNEL_PID  (log: $LOG_DIR/tunnel.log)"
echo "  Logs: $LOG_DIR/"
echo "======================================================"
echo ""

# Health check
sleep 2
echo "[*] Health checks:"
curl -s -m 3 http://localhost:8011/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  Photon  ✓  {d[\"service\"]}')" 2>/dev/null || echo "  Photon  ✗ (check logs/photon.log)"
curl -s -m 3 http://localhost:8012/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  Boots   ✓  {d[\"service\"]}')" 2>/dev/null || echo "  Boots   ✗ (check logs/boots-ki.log)"
curl -s -m 3 http://localhost:8013/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  Tracker ✓  {d[\"service\"]}')" 2>/dev/null || echo "  Tracker ✗ (check logs/time-tracking.log)"
curl -s -m 5 http://localhost:3001/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  Backend ✓  {d[\"service\"]}')" 2>/dev/null || echo "  Backend ✗ (check logs/backend.log)"
curl -s -m 5 -o /dev/null -w "  Frontend ✓  HTTP %{http_code}\n" http://localhost:5173 2>/dev/null || echo "  Frontend ✗ (check logs/frontend.log)"
echo ""

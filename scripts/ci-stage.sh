#!/usr/bin/env bash
set -euo pipefail

STAGE="${1:-dev}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE_LABEL="$(printf '%s' "$STAGE" | tr '[:lower:]' '[:upper:]')"
PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "======================================================"
echo "  Swami Dashboard CI/CD Stage: $STAGE_LABEL"
echo "======================================================"

cd "$ROOT/backend"
npm ci
npm run build
npm run test:coverage
npm audit --omit=dev

cd "$ROOT/frontend"
npm ci
if [[ "${SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]]; then
  npx playwright install --with-deps chromium
fi
cd "$ROOT"
node scripts/release-report.mjs "$STAGE"
cd "$ROOT/frontend"
npm run build
npm run test:e2e
npm audit --omit=dev

cd "$ROOT"
"$PYTHON_BIN" -m pip install --upgrade pip
"$PYTHON_BIN" -m pip install -r services/photon/requirements.txt
"$PYTHON_BIN" -m pip install -r services/boots-ki/requirements.txt
"$PYTHON_BIN" -m pip install -r services/time-tracking/requirements.txt
"$PYTHON_BIN" -m compileall services/photon services/boots-ki services/time-tracking

if [[ "${SKIP_DOCKER:-0}" != "1" ]]; then
  docker compose build
else
  echo "Skipping Docker image build because SKIP_DOCKER=1"
fi

echo "$STAGE_LABEL stage completed successfully."
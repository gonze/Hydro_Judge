#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${INSTALL_DIR}/.env}"

load_env_file() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

load_env_file

JUDGE_PORT="${JUDGE_PORT:-5000}"
SERVICE_NAME="${SERVICE_NAME:-hydro-judge-worker}"
EXECUTION_HOST="${EXECUTION_HOST:-local}"
GO_JUDGE_CONTAINER="${GO_JUDGE_CONTAINER:-go-judge}"

echo "[1/2] Stopping Hydro_Judge worker service (${SERVICE_NAME})..."
if command -v sudo >/dev/null 2>&1; then
  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
else
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
fi
echo "Worker service stopped."

if [ "$EXECUTION_HOST" != "local" ]; then
  echo "[2/2] Stopping go-judge container (${GO_JUDGE_CONTAINER})..."
  if command -v docker >/dev/null 2>&1; then
    sudo docker stop "$GO_JUDGE_CONTAINER" 2>/dev/null || true
    echo "go-judge container stopped."
  else
    echo "[2/2] Docker not available, skipping go-judge container stop."
  fi
else
  echo "[2/2] Using local execution backend. No go-judge container to stop."
fi

echo
echo "All judge services have been stopped."

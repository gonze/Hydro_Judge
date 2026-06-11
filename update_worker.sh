#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-master}"
FORCE="${FORCE:-0}"
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

generate_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64
  fi
}

write_env_file() {
  umask 077
  cat >"$ENV_FILE" <<EOF
JUDGE_PORT=${JUDGE_PORT}
JUDGE_TOKEN=${JUDGE_TOKEN}
JUDGE_DATA_DIR=${JUDGE_DATA_DIR}
SERVICE_NAME=${SERVICE_NAME}
EOF
}

load_env_file
JUDGE_PORT="${JUDGE_PORT:-5000}"
JUDGE_DATA_DIR="${JUDGE_DATA_DIR:-/var/oj/judge-data}"
SERVICE_NAME="${SERVICE_NAME:-hydro-judge-worker}"
if [ -z "${JUDGE_TOKEN:-}" ] || [ "${JUDGE_TOKEN:-}" = "change-this-token" ]; then
  JUDGE_TOKEN="$(generate_token)"
  echo "Generated new JUDGE_TOKEN and saved it to ${ENV_FILE}."
fi
write_env_file

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required. Please run this script on Ubuntu with sudo access." >&2
  exit 1
fi

cd "$INSTALL_DIR"

echo "[1/6] Checking repository state..."
if [ -n "$(git status --porcelain)" ] && [ "$FORCE" != "1" ]; then
  echo "Working tree has local changes. Commit/stash them, or rerun with FORCE=1." >&2
  git status --short >&2
  exit 1
fi

echo "[2/6] Stopping ${SERVICE_NAME}..."
sudo systemctl stop "$SERVICE_NAME" || true

echo "[3/6] Pulling latest code..."
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "[4/6] Updating Node dependencies..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "[5/6] Refreshing systemd service config..."
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=Hydro Judge HTTP Worker
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
Environment=JUDGE_PORT=${JUDGE_PORT}
Environment=JUDGE_TOKEN=${JUDGE_TOKEN}
Environment=JUDGE_DATA_DIR=${JUDGE_DATA_DIR}
ExecStart=/usr/bin/node judge/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo "[6/6] Restarting worker..."
JUDGE_PORT="$JUDGE_PORT" \
JUDGE_TOKEN="$JUDGE_TOKEN" \
JUDGE_DATA_DIR="$JUDGE_DATA_DIR" \
SERVICE_NAME="$SERVICE_NAME" \
"$INSTALL_DIR/start_worker.sh"

echo "Hydro_Judge update completed."

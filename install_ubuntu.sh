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
  echo "sudo is required. Please run this script on a normal Ubuntu server user with sudo access." >&2
  exit 1
fi

echo "[1/6] Installing system dependencies..."
sudo apt update
sudo apt install -y git curl ca-certificates build-essential gcc g++ python3 python3-pip nodejs npm docker.io

echo "[2/6] Enabling Docker..."
sudo systemctl enable --now docker
if ! groups "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER" || true
  echo "Added $USER to docker group. You may need to log out and back in for non-sudo docker commands."
fi

echo "[3/6] Installing Node dependencies..."
cd "$INSTALL_DIR"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "[4/6] Preparing judge data directory..."
sudo mkdir -p "$JUDGE_DATA_DIR"
sudo chown -R "$USER:$USER" "$(dirname "$JUDGE_DATA_DIR")"

echo "[5/6] Writing systemd service..."
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

echo "[6/6] Reloading systemd..."
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

cat <<EOF

Install complete.

Next step:
  ./start_worker.sh

Current config:
  SERVICE_NAME=${SERVICE_NAME}
  JUDGE_PORT=${JUDGE_PORT}
  JUDGE_TOKEN=${JUDGE_TOKEN}
  JUDGE_DATA_DIR=${JUDGE_DATA_DIR}

After start_worker.sh succeeds, copy the displayed address and token into:
  getcode -> Problem Config -> Judge Service Config

Token file:
  ${ENV_FILE}

To rotate the token later:
  JUDGE_TOKEN="your-long-random-token" ./start_worker.sh
EOF

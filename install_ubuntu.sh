#!/usr/bin/env bash
set -euo pipefail

JUDGE_PORT="${JUDGE_PORT:-5000}"
JUDGE_TOKEN="${JUDGE_TOKEN:-change-this-token}"
JUDGE_DATA_DIR="${JUDGE_DATA_DIR:-/var/oj/judge-data}"
SERVICE_NAME="${SERVICE_NAME:-hydro-judge-worker}"
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
  JUDGE_TOKEN="${JUDGE_TOKEN}" ./start_worker.sh

Current config:
  SERVICE_NAME=${SERVICE_NAME}
  JUDGE_PORT=${JUDGE_PORT}
  JUDGE_TOKEN=${JUDGE_TOKEN}
  JUDGE_DATA_DIR=${JUDGE_DATA_DIR}

Important:
  If this is a shared LAN, replace the default token before starting:
  JUDGE_TOKEN="your-long-random-token" ./install_ubuntu.sh
EOF

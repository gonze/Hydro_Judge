#!/usr/bin/env bash
set -euo pipefail

JUDGE_PORT="${JUDGE_PORT:-5000}"
JUDGE_TOKEN="${JUDGE_TOKEN:-change-this-token}"
JUDGE_DATA_DIR="${JUDGE_DATA_DIR:-/var/oj/judge-data}"
SERVICE_NAME="${SERVICE_NAME:-hydro-judge-worker}"
GO_JUDGE_IMAGE="${GO_JUDGE_IMAGE:-criyle/go-judge:latest}"
GO_JUDGE_CONTAINER="${GO_JUDGE_CONTAINER:-go-judge}"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required. Please run this script on Ubuntu with sudo access." >&2
  exit 1
fi

echo "[1/4] Ensuring go-judge container is running..."
if sudo docker ps -a --format '{{.Names}}' | grep -qx "$GO_JUDGE_CONTAINER"; then
  sudo docker start "$GO_JUDGE_CONTAINER" >/dev/null
else
  sudo docker run -d \
    --name "$GO_JUDGE_CONTAINER" \
    --restart unless-stopped \
    --privileged \
    --network host \
    "$GO_JUDGE_IMAGE" >/dev/null
fi

echo "[2/4] Ensuring judge data directory exists..."
sudo mkdir -p "$JUDGE_DATA_DIR"
sudo chown -R "$USER:$USER" "$(dirname "$JUDGE_DATA_DIR")"

echo "[3/4] Refreshing and starting ${SERVICE_NAME}..."
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
sudo systemctl enable "$SERVICE_NAME" >/dev/null
sudo systemctl restart "$SERVICE_NAME"

echo "[4/4] Health checking worker..."
for i in $(seq 1 20); do
  if curl -fsS -H "Authorization: Bearer ${JUDGE_TOKEN}" "http://127.0.0.1:${JUDGE_PORT}/status" >/tmp/hydro-judge-status.json; then
    echo "Hydro Judge Worker is online:"
    cat /tmp/hydro-judge-status.json
    echo
    exit 0
  fi
  sleep 1
done

echo "Worker did not pass health check." >&2
echo "Service status:" >&2
sudo systemctl status "$SERVICE_NAME" --no-pager >&2 || true
echo "Recent logs:" >&2
sudo journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2 || true
exit 1

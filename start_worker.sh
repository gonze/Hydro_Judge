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
FILES_DIR=${FILES_DIR}
SERVICE_NAME=${SERVICE_NAME}
EXECUTION_HOST=${EXECUTION_HOST}
GO_JUDGE_IMAGE=${GO_JUDGE_IMAGE}
GO_JUDGE_CONTAINER=${GO_JUDGE_CONTAINER}
EOF
}

detect_host_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
  fi
  if [ -z "$ip" ]; then
    ip="127.0.0.1"
  fi
  printf '%s' "$ip"
}

print_connection_info() {
  local host_ip
  host_ip="$(detect_host_ip)"
  cat <<EOF

Hydro_Judge worker is ready.

Fill this in getcode -> Problem Config -> Judge Service Config:
  Hydro_Judge URL: http://${host_ip}:${JUDGE_PORT}
  Token: ${JUDGE_TOKEN}

Local test:
  curl -H "Authorization: Bearer ${JUDGE_TOKEN}" http://127.0.0.1:${JUDGE_PORT}/status

Token file:
  ${ENV_FILE}

EOF
}

load_env_file
JUDGE_PORT="${JUDGE_PORT:-5000}"
JUDGE_DATA_DIR="${JUDGE_DATA_DIR:-/var/oj/judge-data}"
FILES_DIR="${FILES_DIR:-/var/oj/files/judge}"
SERVICE_NAME="${SERVICE_NAME:-hydro-judge-worker}"
EXECUTION_HOST="${EXECUTION_HOST:-local}"
GO_JUDGE_IMAGE="${GO_JUDGE_IMAGE:-criyle/go-judge:latest}"
GO_JUDGE_CONTAINER="${GO_JUDGE_CONTAINER:-go-judge}"
if [ -z "${JUDGE_TOKEN:-}" ] || [ "${JUDGE_TOKEN:-}" = "change-this-token" ]; then
  JUDGE_TOKEN="$(generate_token)"
  echo "Generated new JUDGE_TOKEN and saved it to ${ENV_FILE}."
fi
write_env_file

TESTLIB_SOURCE="${INSTALL_DIR}/examples/testlib.h"

ensure_data_and_support_files() {
  sudo mkdir -p "$JUDGE_DATA_DIR"
  sudo chown -R "$USER:$USER" "$(dirname "$JUDGE_DATA_DIR")"
  sudo mkdir -p "$FILES_DIR"
  if [ ! -f "${FILES_DIR}/testlib.h" ]; then
    if [ ! -f "$TESTLIB_SOURCE" ]; then
      echo "Missing ${TESTLIB_SOURCE}. Please keep examples/testlib.h with Hydro_Judge." >&2
      exit 1
    fi
    sudo cp "$TESTLIB_SOURCE" "${FILES_DIR}/testlib.h"
    echo "Installed testlib.h to ${FILES_DIR}/testlib.h"
  else
    echo "testlib.h already exists at ${FILES_DIR}/testlib.h"
  fi
  sudo chown -R "$USER:$USER" "$FILES_DIR"
}

check_go_judge_toolchain() {
  if ! sudo docker exec "$GO_JUDGE_CONTAINER" sh -lc 'command -v g++ >/dev/null 2>&1'; then
    cat >&2 <<EOF
go-judge container is running, but g++ was not found inside it.
The default criyle/go-judge image may not include contest compilers.

Use local mode:
  EXECUTION_HOST=local ./start_worker.sh

Or run a custom go-judge image that includes g++/gcc/python3/java and set:
  GO_JUDGE_IMAGE=your-go-judge-with-compilers:latest EXECUTION_HOST=http://127.0.0.1:5050 ./start_worker.sh
EOF
    exit 1
  fi
}

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required. Please run this script on Ubuntu with sudo access." >&2
  exit 1
fi

echo "[1/4] Ensuring judge data and support files exist..."
echo "JUDGE_DATA_DIR=${JUDGE_DATA_DIR}"
echo "FILES_DIR=${FILES_DIR}"
ensure_data_and_support_files

if [ "$EXECUTION_HOST" = "local" ]; then
  echo "[2/4] Using local execution backend. Skipping go-judge container."
else
  echo "[2/4] Ensuring go-judge container is running..."
  if sudo docker ps -a --format '{{.Names}}' | grep -qx "$GO_JUDGE_CONTAINER"; then
    sudo docker stop "$GO_JUDGE_CONTAINER" >/dev/null 2>&1 || true
    sudo docker rm "$GO_JUDGE_CONTAINER" >/dev/null
  fi
  sudo docker run -d \
    --name "$GO_JUDGE_CONTAINER" \
    --restart unless-stopped \
    --privileged \
    --network host \
    -v "${JUDGE_DATA_DIR}:${JUDGE_DATA_DIR}:ro" \
    -v "${FILES_DIR}:${FILES_DIR}:ro" \
    "$GO_JUDGE_IMAGE" >/dev/null
  check_go_judge_toolchain
fi

echo "[3/4] Refreshing and starting ${SERVICE_NAME}..."
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
Environment=FILES_DIR=${FILES_DIR}
Environment=EXECUTION_HOST=${EXECUTION_HOST}
ExecStart=/usr/bin/node judge/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" >/dev/null
sudo systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
sudo systemctl restart "$SERVICE_NAME"

echo "[4/4] Health checking worker..."
for i in $(seq 1 20); do
  if curl -fsS -H "Authorization: Bearer ${JUDGE_TOKEN}" "http://127.0.0.1:${JUDGE_PORT}/status" >/tmp/hydro-judge-status.json; then
    echo "Hydro Judge Worker is online:"
    cat /tmp/hydro-judge-status.json
    echo
    print_connection_info
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

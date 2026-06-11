#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${INSTALL_DIR}/.env}"
BUILD_DIR="${BUILD_DIR:-${INSTALL_DIR}/.go-judge-image}"
GO_JUDGE_IMAGE="${GO_JUDGE_IMAGE:-local/go-judge:cpp-python}"
BASE_GO_JUDGE_IMAGE="${BASE_GO_JUDGE_IMAGE:-criyle/go-judge:latest}"
INSTALL_JAVA="${INSTALL_JAVA:-0}"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required. Please run this script on Ubuntu with sudo access." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed. Installing docker.io first..."
  sudo apt update
  sudo apt install -y ca-certificates curl docker.io
fi

sudo systemctl enable --now docker >/dev/null
mkdir -p "$BUILD_DIR"

PACKAGES="gcc g++ python3 python3-pip libc6-dev make"
if [ "$INSTALL_JAVA" = "1" ]; then
  PACKAGES="${PACKAGES} openjdk-17-jdk"
fi

cat >"${BUILD_DIR}/Dockerfile" <<EOF
FROM ${BASE_GO_JUDGE_IMAGE}

USER root

RUN apt-get update \\
    && apt-get install -y --no-install-recommends \\
        ${PACKAGES} \\
    && rm -rf /var/lib/apt/lists/*

USER root
EOF

echo "[1/3] Building go-judge image: ${GO_JUDGE_IMAGE}"
sudo docker build -t "$GO_JUDGE_IMAGE" "$BUILD_DIR"

echo "[2/3] Verifying compiler toolchain..."
sudo docker run --rm "$GO_JUDGE_IMAGE" sh -lc 'g++ --version && gcc --version && python3 --version'

echo "[3/3] Writing go-judge settings to ${ENV_FILE}"
touch "$ENV_FILE"
if grep -q '^EXECUTION_HOST=' "$ENV_FILE"; then
  sed -i 's#^EXECUTION_HOST=.*#EXECUTION_HOST=http://127.0.0.1:5050#' "$ENV_FILE"
else
  printf '\nEXECUTION_HOST=http://127.0.0.1:5050\n' >>"$ENV_FILE"
fi
if grep -q '^GO_JUDGE_IMAGE=' "$ENV_FILE"; then
  sed -i "s#^GO_JUDGE_IMAGE=.*#GO_JUDGE_IMAGE=${GO_JUDGE_IMAGE}#" "$ENV_FILE"
else
  printf 'GO_JUDGE_IMAGE=%s\n' "$GO_JUDGE_IMAGE" >>"$ENV_FILE"
fi

cat <<EOF

go-judge image is ready.

Image:
  ${GO_JUDGE_IMAGE}

Next steps:
  ./install_ubuntu.sh
  ./start_worker.sh

If you need Java support later:
  INSTALL_JAVA=1 ./build_go_judge_image.sh

EOF

#!/usr/bin/env bash
# Hydro_Judge one-line installer for Linux (Ubuntu / Debian / CentOS).
# Usage:
#   curl -fsSL https://gitee.com/gonze/Hydro_Judge/raw/master/install.sh | bash
#   or (GitHub mirror):
#   curl -fsSL https://raw.githubusercontent.com/gonze/Hydro_Judge/master/install.sh | bash
# Environment variables:
#   INSTALL_DIR   install directory (default: $HOME/Hydro_Judge)
#   BRANCH        git branch (default: master)
#   REPO_URL      git repo URL (override default gitee/github selection)
#   SKIP_BUILD    set to 1 to skip building the custom go-judge image

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { printf "${GREEN}[INFO]${NC} $*\n"; }
log_warn()    { printf "${YELLOW}[WARN]${NC} $*\n"; }
log_error()   { printf "${RED}[ERROR]${NC} $*\n"; }
log_step()    { printf "${CYAN}==== $* ====${NC}\n\n"; }

INSTALL_DIR="${INSTALL_DIR:-$HOME/Hydro_Judge}"
BRANCH="${BRANCH:-master}"
SKIP_BUILD="${SKIP_BUILD:-0}"

if [[ "$(uname -s)" != "Linux" ]]; then
  log_error "This installer currently supports Linux only (detected: $(uname -s))."
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  log_error "sudo is required. Please run this script on a normal Linux user with sudo access."
  exit 1
fi

detect_repo_url() {
  if [[ -n "${REPO_URL:-}" ]]; then
    printf '%s' "$REPO_URL"
    return
  fi
  local candidates=(
    "https://gitee.com/gonze/Hydro_Judge.git"
    "https://github.com/gonze/Hydro_Judge.git"
  )
  for url in "${candidates[@]}"; do
    if curl -fsSL --connect-timeout 5 "$url" >/dev/null 2>&1; then
      printf '%s' "$url"
      return
    fi
  done
  printf '%s' "${candidates[0]}"
}

REPO_URL="$(detect_repo_url)"

log_info "Install directory : ${INSTALL_DIR}"
log_info "Branch           : ${BRANCH}"
log_info "Repository       : ${REPO_URL}"

if command -v git >/dev/null 2>&1; then
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log_step "Existing installation detected, updating"
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$BRANCH" 2>/dev/null || true
    git pull origin "$BRANCH"
  else
    log_step "Cloning repository"
    git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
else
  log_warn "git not found, downloading tarball instead"
  mkdir -p "$INSTALL_DIR"
  TARBALL_URL="${REPO_URL%.git}/archive/${BRANCH}.tar.gz"
  curl -fsSL "$TARBALL_URL" -o /tmp/hydro_judge.tar.gz
  tar -xzf /tmp/hydro_judge.tar.gz -C /tmp
  src_dir="$(tar -tzf /tmp/hydro_judge.tar.gz | head -1 | cut -d/ -f1)"
  if [[ -d "/tmp/${src_dir}" ]]; then
    cp -r "/tmp/${src_dir}/." "$INSTALL_DIR/"
  fi
  rm -f /tmp/hydro_judge.tar.gz
  rm -rf "/tmp/${src_dir}"
  cd "$INSTALL_DIR"
fi

chmod +x install_ubuntu.sh start_worker.sh update_worker.sh build_go_judge_image.sh 2>/dev/null || true

log_step "Running install_ubuntu.sh"
./install_ubuntu.sh

if [[ "$SKIP_BUILD" != "1" ]] && command -v docker >/dev/null 2>&1; then
  log_step "Building custom go-judge image (set SKIP_BUILD=1 to skip)"
  ./build_go_judge_image.sh || log_warn "Image build failed, continuing with default image"
fi

log_step "Starting Hydro_Judge worker"
./start_worker.sh

echo
log_info "All done."
log_info "To view status: sudo systemctl status hydro-judge-worker --no-pager"
log_info "To view logs  : sudo journalctl -u hydro-judge-worker -f"
log_info "To stop       : sudo systemctl stop hydro-judge-worker"
log_info "To restart    : sudo systemctl restart hydro-judge-worker"
log_info "To update     : ./update_worker.sh"

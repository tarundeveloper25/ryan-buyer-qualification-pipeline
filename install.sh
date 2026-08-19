#!/usr/bin/env bash
set -euo pipefail

OWNER="go-code-bot"
REPO="pipeline-builder"
BRANCH="main"
RAW_BASE="https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}"
TARGET_DIR="${1:-.}"

log() { echo "  $*"; }
fail() { echo "  $*" >&2; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js 16+ is required."
fi

NODE_MAJOR="$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")"
if [ "${NODE_MAJOR}" -lt 16 ]; then
  fail "Node.js 16+ is required."
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

log "Downloading pipeline-builder skill CLI..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "${RAW_BASE}/cli.js" -o "${TMP_DIR}/cli.js"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "${TMP_DIR}/cli.js" "${RAW_BASE}/cli.js"
else
  fail "curl or wget is required."
fi

log "Installing pipeline-builder skill into ${TARGET_DIR}..."
node "${TMP_DIR}/cli.js" add "${TARGET_DIR}"

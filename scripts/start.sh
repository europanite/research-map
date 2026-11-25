#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if ! command -v docker >/dev/null 2>&1; then
  echo 'ERROR: Docker Engine and Docker Compose are required.' >&2
  exit 1
fi
docker compose up -d --build frontend
echo 'Research Map (browser-only): http://localhost:5173'
echo 'OpenAlex requests are sent directly from your browser; no backend or DB is started.'

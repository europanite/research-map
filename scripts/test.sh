#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
docker compose -f docker-compose.test.yml run --rm --build backend_test
docker compose -f docker-compose.test.yml run --rm --build frontend_build

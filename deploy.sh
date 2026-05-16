#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Updating repository..."
git pull --ff-only

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example."
  echo "Edit .env and set ADMIN_PIN to a private value, then run ./deploy.sh again."
  exit 1
fi

admin_pin="$(
  grep -E '^[[:space:]]*ADMIN_PIN[[:space:]]*=' .env \
    | tail -n 1 \
    | cut -d= -f2- \
    | tr -d '"' \
    | xargs || true
)"

case "$admin_pin" in
  ""|"1234"|"change-this-before-deploying"|"use-a-real-private-pin")
    echo "ADMIN_PIN is missing or still a placeholder in .env."
    echo "Set ADMIN_PIN to a private value, then run ./deploy.sh again."
    exit 1
    ;;
esac

echo "Rebuilding and restarting Docker Compose services..."
docker compose up -d --build

echo "Deployment complete."
docker compose ps

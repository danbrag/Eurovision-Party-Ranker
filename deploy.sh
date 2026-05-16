#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Updating repository..."
git pull --ff-only

echo "Rebuilding and restarting Docker Compose services..."
docker compose up -d --build

echo "Deployment complete."
docker compose ps

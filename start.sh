#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Edit GMI_API_KEY if new-api will not pass Authorization."
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose up -d --build
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d --build
else
  echo "Docker Compose is required. Install Docker Desktop, Docker Engine with compose plugin, or docker-compose." >&2
  exit 127
fi

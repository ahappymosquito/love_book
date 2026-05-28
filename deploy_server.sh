#!/usr/bin/env bash
# Server one-click deployment script for the prebuilt GHCR images.
# It renders .env, Caddyfile, and docker-compose.yml on the target server,
# then pulls images and starts backend, frontend, and Caddy.

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/love_book}"
PROJECT_NAME="${PROJECT_NAME:-love-book}"

BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/ahappymosquito/love_book-backend:latest}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.io/ahappymosquito/love_book-frontend:latest}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2-alpine}"

APP_DOMAIN="${APP_DOMAIN:-qrqto.club}"
APP_DOMAIN_WWW="${APP_DOMAIN_WWW:-www.qrqto.club}"
APP_WEB_URL="${APP_WEB_URL:-https://qrqto.club}"

DATABASE_URL="${DATABASE_URL:-}"
ADMIN_KEY="${ADMIN_KEY:-}"
MAX_VOICE_BYTES="${MAX_VOICE_BYTES:-10485760}"
MAX_IMAGE_BYTES="${MAX_IMAGE_BYTES:-10485760}"
MEDIA_ROOT="${MEDIA_ROOT:-/app/media}"
MEDIA_STORAGE="${MEDIA_STORAGE:-local}"
SQLITE_SOURCE_URL="${SQLITE_SOURCE_URL:-sqlite:///./pair_events.db}"

MYSQL_HOST="${MYSQL_HOST:-db.example.com}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-db_user}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-love_book}"

SMTP_HOST="${SMTP_HOST:-smtp.qq.com}"
SMTP_PORT="${SMTP_PORT:-465}"
SMTP_USER="${SMTP_USER:-you@example.com}"
SMTP_PASS="${SMTP_PASS:-}"
SMTP_FROM="${SMTP_FROM:-${SMTP_USER}}"
SMTP_FROM_NAME="${SMTP_FROM_NAME:-Love Book}"
SMTP_USE_SSL="${SMTP_USE_SSL:-1}"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
RESET=$'\033[0m'

info() { printf "%s[INFO]%s %s\n" "${BLUE}" "${RESET}" "$*"; }
ok() { printf "%s[ OK ]%s %s\n" "${GREEN}" "${RESET}" "$*"; }
warn() { printf "%s[WARN]%s %s\n" "${YELLOW}" "${RESET}" "$*"; }
fail() { printf "%s[FAIL]%s %s\n" "${RED}" "${RESET}" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage:
  ADMIN_KEY=... DATABASE_URL=... MYSQL_PASSWORD=... SMTP_PASS=... ./deploy_server.sh up
  ./deploy_server.sh --env-file ./server.env up
  ./deploy_server.sh status
  ./deploy_server.sh logs [service]

Commands:
  init      Render .env, Caddyfile, and docker-compose.yml only
  up        Render files, pull images, and start services
  pull      Pull backend/frontend/Caddy images
  restart   Restart services
  down      Stop and remove containers, keep named volumes
  status    Show service status
  logs      Follow logs, optionally for a service name
  config    Render and print the merged Compose config
EOF
}

load_optional_env_file() {
    if [[ "${1:-}" == "--env-file" ]]; then
        local env_file="${2:-}"
        [[ -n "${env_file}" ]] || fail "--env-file requires a path"
        [[ -f "${env_file}" ]] || fail "Env file not found: ${env_file}"
        set -o allexport
        # shellcheck disable=SC1090
        source "${env_file}"
        set +o allexport
        shift 2
    fi
    COMMAND="${1:-up}"
    shift || true
    COMMAND_ARGS=("$@")
}

detect_compose() {
    if docker compose version >/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        fail "Docker Compose is required. Install Docker Engine with compose plugin first."
    fi
}

require_commands() {
    command -v docker >/dev/null 2>&1 || fail "Docker is required."
    COMPOSE="$(detect_compose)"
}

require_config() {
    [[ -n "${ADMIN_KEY}" ]] || fail "ADMIN_KEY is required."
    [[ -n "${DATABASE_URL}" ]] || fail "DATABASE_URL is required."
    [[ -n "${MYSQL_PASSWORD}" ]] || fail "MYSQL_PASSWORD is required."
    [[ -n "${SMTP_PASS}" ]] || fail "SMTP_PASS is required."

    case "${APP_WEB_URL}" in
        http://localhost*|http://127.0.0.1*|*localhost*)
            fail "APP_WEB_URL must be a public URL, got ${APP_WEB_URL}"
            ;;
    esac

    if [[ "${DATABASE_URL}" != mysql+pymysql://* ]]; then
        warn "DATABASE_URL is not mysql+pymysql://..., current value: ${DATABASE_URL}"
    fi
}

render_env() {
    umask 077
    cat > "${PROJECT_DIR}/.env" <<EOF
ADMIN_KEY=${ADMIN_KEY}
DATABASE_URL=${DATABASE_URL}
MAX_VOICE_BYTES=${MAX_VOICE_BYTES}
MAX_IMAGE_BYTES=${MAX_IMAGE_BYTES}
MEDIA_ROOT=${MEDIA_ROOT}
MEDIA_STORAGE=${MEDIA_STORAGE}

MYSQL_HOST=${MYSQL_HOST}
MYSQL_PORT=${MYSQL_PORT}
MYSQL_USER=${MYSQL_USER}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
MYSQL_DATABASE=${MYSQL_DATABASE}

SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=${SMTP_FROM}
SMTP_FROM_NAME=${SMTP_FROM_NAME}
SMTP_USE_SSL=${SMTP_USE_SSL}

APP_WEB_URL=${APP_WEB_URL}
SQLITE_SOURCE_URL=${SQLITE_SOURCE_URL}
EOF
}

render_caddyfile() {
    cat > "${PROJECT_DIR}/Caddyfile" <<EOF
${APP_DOMAIN}, ${APP_DOMAIN_WWW} {
	encode zstd gzip

	@api path /api /api/*
	handle @api {
		uri strip_prefix /api
		reverse_proxy backend:8000
	}

	handle /docs {
		reverse_proxy backend:8000
	}

	handle /openapi.json {
		reverse_proxy backend:8000
	}

	handle {
		reverse_proxy frontend:3000
	}
}
EOF
}

render_compose() {
    cat > "${PROJECT_DIR}/docker-compose.yml" <<EOF
name: ${PROJECT_NAME}

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "5"

services:
  backend:
    image: ${BACKEND_IMAGE}
    container_name: love-book-backend
    restart: unless-stopped
    env_file:
      - .env
    environment:
      PYTHONPATH: /app
      MEDIA_ROOT: /app/media
      MEDIA_STORAGE: local
    volumes:
      - love_book_media:/app/media
    expose:
      - "8000"
    networks:
      - love-book-net
    extra_hosts:
      - "host.docker.internal:host-gateway"
    logging: *default-logging

  frontend:
    image: ${FRONTEND_IMAGE}
    container_name: love-book-frontend
    restart: unless-stopped
    environment:
      NODE_ENV: production
    expose:
      - "3000"
    depends_on:
      - backend
    networks:
      - love-book-net
    logging: *default-logging

  caddy:
    image: ${CADDY_IMAGE}
    container_name: love-book-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - backend
      - frontend
    networks:
      - love-book-net
    logging: *default-logging

networks:
  love-book-net:
    name: love-book-net
    driver: bridge

volumes:
  love_book_media:
  caddy_data:
  caddy_config:
EOF
}

render_files() {
    require_config
    mkdir -p "${PROJECT_DIR}"
    render_env
    render_caddyfile
    render_compose
    ok "Rendered deployment files in ${PROJECT_DIR}"
}

compose() {
    (cd "${PROJECT_DIR}" && ${COMPOSE} "$@")
}

warn_ports() {
    if command -v ss >/dev/null 2>&1; then
        if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ':80$|:443$' >/dev/null; then
            warn "Host port 80 or 443 is already in use. Caddy may fail to start."
        fi
    fi
}

cmd_up() {
    require_commands
    warn_ports
    render_files
    compose pull
    compose up -d --remove-orphans
    compose ps
    ok "Deployment started: ${APP_WEB_URL}"
}

cmd_init() {
    render_files
}

cmd_pull() {
    require_commands
    render_files
    compose pull
}

cmd_restart() {
    require_commands
    compose restart
    compose ps
}

cmd_down() {
    require_commands
    compose down
}

cmd_status() {
    require_commands
    compose ps
}

cmd_logs() {
    require_commands
    compose logs -f --tail=200 "${COMMAND_ARGS[@]}"
}

cmd_config() {
    require_commands
    render_files
    compose config
}

load_optional_env_file "$@"

case "${COMMAND}" in
    init) cmd_init ;;
    up|deploy) cmd_up ;;
    pull) cmd_pull ;;
    restart) cmd_restart ;;
    down|stop) cmd_down ;;
    status|ps) cmd_status ;;
    logs) cmd_logs ;;
    config) cmd_config ;;
    -h|--help|help) usage ;;
    *) usage; exit 1 ;;
esac

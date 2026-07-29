#!/usr/bin/env bash
# Safely update a running Love Book deployment to matching stable-latest frontend/backend images.

set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-${HOME}/love-book}"
APP_WEB_URL="${APP_WEB_URL:-https://qrqto.club}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/ahappymosquito/love_book-backend:latest}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.io/ahappymosquito/love_book-frontend:latest}"
BACKUP_COMMAND="${BACKUP_COMMAND:-${HOME}/bin/love-book-backup}"
CURL_COMMAND="${CURL_COMMAND:-curl}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-2}"
LOCK_FILE="${UPDATE_LOCK_FILE:-${PROJECT_DIR}/.update.lock}"
OVERRIDE_FILE="${PROJECT_DIR}/docker-compose.override.yml"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
RESET=$'\033[0m'

info() { printf "%s[INFO]%s %s\n" "${BLUE}" "${RESET}" "$*"; }
ok() { printf "%s[ OK ]%s %s\n" "${GREEN}" "${RESET}" "$*"; }
warn() { printf "%s[WARN]%s %s\n" "${YELLOW}" "${RESET}" "$*"; }
fail() { printf "%s[FAIL]%s %s\n" "${RED}" "${RESET}" "$*" >&2; return 1; }

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

compose() {
    (cd "${PROJECT_DIR}" && docker compose "$@")
}

image_label() {
    local image="$1"
    local label="$2"
    docker image inspect --format "{{ index .Config.Labels \"${label}\" }}" "${image}"
}

health_version() {
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

write_latest_override() {
    cat >"${OVERRIDE_FILE}" <<EOF
# Stable-latest image override managed by update.sh; runtime secrets and volumes remain in docker-compose.yml.
services:
  backend:
    image: ${BACKEND_IMAGE}
  frontend:
    image: ${FRONTEND_IMAGE}
EOF
}

show_diagnostics() {
    warn "Update failed; current containers were not automatically rolled back."
    compose ps || true
    compose logs --tail=80 backend frontend caddy || true
}

on_error() {
    local status=$?
    trap - ERR
    show_diagnostics
    exit "${status}"
}

trap on_error ERR

require_command docker
require_command flock
require_command sed
[[ -x "${CURL_COMMAND}" ]] || command -v "${CURL_COMMAND}" >/dev/null 2>&1 \
    || fail "Curl command is not executable: ${CURL_COMMAND}"

[[ -d "${PROJECT_DIR}" ]] || fail "Deployment directory not found: ${PROJECT_DIR}"
[[ -f "${PROJECT_DIR}/docker-compose.yml" ]] || fail "Base Compose file not found in ${PROJECT_DIR}"
[[ -x "${BACKUP_COMMAND}" ]] || fail "Backup command is not executable: ${BACKUP_COMMAND}"
[[ "${HEALTH_ATTEMPTS}" =~ ^[1-9][0-9]*$ ]] || fail "HEALTH_ATTEMPTS must be a positive integer"
[[ "${HEALTH_DELAY_SECONDS}" =~ ^[0-9]+$ ]] || fail "HEALTH_DELAY_SECONDS must be a non-negative integer"

docker info >/dev/null
docker compose version >/dev/null

exec 9>"${LOCK_FILE}"
flock -n 9 || fail "Another Love Book update is already running"

info "Checking stable-latest images"
docker pull "${BACKEND_IMAGE}"
docker pull "${FRONTEND_IMAGE}"

backend_version="$(image_label "${BACKEND_IMAGE}" "org.opencontainers.image.version")"
frontend_version="$(image_label "${FRONTEND_IMAGE}" "org.opencontainers.image.version")"

[[ "${backend_version}" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
    || fail "Backend latest image has invalid version label: ${backend_version}"
[[ "${frontend_version}" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
    || fail "Frontend latest image has invalid version label: ${frontend_version}"
[[ "${backend_version}" == "${frontend_version}" ]] \
    || fail "Stable-latest images do not match: backend=${backend_version}, frontend=${frontend_version}"

target_version="${backend_version}"
write_latest_override

current_health="$("${CURL_COMMAND}" -fsS "${APP_WEB_URL%/}/api/health" 2>/dev/null || true)"
current_version="$(printf '%s' "${current_health}" | health_version)"
if [[ "${current_version}" == "${target_version}" ]]; then
    ok "Love Book ${target_version} is already running"
    compose images
    trap - ERR
    exit 0
fi

info "Updating Love Book ${current_version:-unknown} -> ${target_version}"
"${BACKUP_COMMAND}" pre-release
ok "Pre-release backup completed"

compose up -d --remove-orphans

observed_version=""
for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    health_json="$("${CURL_COMMAND}" -fsS "${APP_WEB_URL%/}/api/health" 2>/dev/null || true)"
    observed_version="$(printf '%s' "${health_json}" | health_version)"
    if [[ "${observed_version}" == "${target_version}" ]]; then
        break
    fi
    sleep "${HEALTH_DELAY_SECONDS}"
done

[[ "${observed_version}" == "${target_version}" ]] \
    || fail "Backend health version is ${observed_version:-unavailable}, expected ${target_version}"
"${CURL_COMMAND}" -fsS -o /dev/null "${APP_WEB_URL%/}/"

compose ps
compose images
ok "Update completed: Love Book ${target_version}"
trap - ERR

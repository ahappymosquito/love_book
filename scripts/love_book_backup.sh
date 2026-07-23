#!/usr/bin/env bash
# Create validated Love Book MySQL, media-volume, and production-environment restore points.

set -Eeuo pipefail

BACKUP_KIND="${1:-weekly}"
case "${BACKUP_KIND}" in
    weekly|pre-release|emergency) ;;
    *)
        echo "Usage: $0 [weekly|pre-release|emergency]" >&2
        exit 2
        ;;
esac

BACKUP_ROOT="${LOVE_BOOK_BACKUP_ROOT:-${HOME}/backups/love_book}"
BACKEND_CONTAINER="${LOVE_BOOK_BACKEND_CONTAINER:-}"
COMPOSE_PROJECT="${LOVE_BOOK_COMPOSE_PROJECT:-love-book}"
COMPOSE_SERVICE="${LOVE_BOOK_COMPOSE_SERVICE:-backend}"
MYSQL_DEFAULTS_FILE="${LOVE_BOOK_MYSQL_DEFAULTS_FILE:-${HOME}/.my.cnf}"
MYSQL_DATABASE="${LOVE_BOOK_MYSQL_DATABASE:-love_book}"
ARCHIVE_IMAGE="${LOVE_BOOK_ARCHIVE_IMAGE:-alpine:3.22}"
MIN_FREE_KB="${LOVE_BOOK_MIN_FREE_KB:-1048576}"
KEEP_WEEKLY="${LOVE_BOOK_KEEP_WEEKLY:-4}"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

safe_remove_restore_point() {
    local candidate="$1"
    local root_real candidate_parent
    root_real="$(realpath -m -- "${BACKUP_ROOT}")"
    candidate_parent="$(dirname -- "$(realpath -m -- "${candidate}")")"
    [[ "${root_real}" != "/" && "${candidate_parent}" == "${root_real}" ]] \
        || fail "Refusing to remove path outside backup root: ${candidate}"
    rm -rf -- "${candidate}"
}

cleanup_partial() {
    if [[ -n "${PARTIAL_DIR:-}" && -d "${PARTIAL_DIR}" ]]; then
        safe_remove_restore_point "${PARTIAL_DIR}"
    fi
}

for command_name in awk cp date df docker find flock grep gzip mysqldump realpath sha256sum sort stat tail tar; do
    require_command "${command_name}"
done

[[ "${KEEP_WEEKLY}" =~ ^[1-9][0-9]*$ ]] || fail "LOVE_BOOK_KEEP_WEEKLY must be a positive integer"
[[ "${MIN_FREE_KB}" =~ ^[0-9]+$ ]] || fail "LOVE_BOOK_MIN_FREE_KB must be a non-negative integer"
[[ -f "${MYSQL_DEFAULTS_FILE}" ]] || fail "MySQL defaults file not found: ${MYSQL_DEFAULTS_FILE}"

mysql_mode="$(stat -c '%a' "${MYSQL_DEFAULTS_FILE}")"
[[ "${mysql_mode}" == "600" ]] || fail "${MYSQL_DEFAULTS_FILE} must have mode 0600, found ${mysql_mode}"

umask 077
mkdir -p -- "${BACKUP_ROOT}"
chmod 700 -- "${BACKUP_ROOT}"

exec 9>"${BACKUP_ROOT}/.backup.lock"
flock -n 9 || fail "Another Love Book backup is already running"

if [[ -z "${BACKEND_CONTAINER}" ]]; then
    mapfile -t backend_candidates < <(
        docker ps -a \
            --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
            --filter "label=com.docker.compose.service=${COMPOSE_SERVICE}" \
            --format '{{.Names}}'
    )
    (( ${#backend_candidates[@]} == 1 )) \
        || fail "Expected one ${COMPOSE_PROJECT}/${COMPOSE_SERVICE} container, found ${#backend_candidates[@]}; set LOVE_BOOK_BACKEND_CONTAINER explicitly"
    BACKEND_CONTAINER="${backend_candidates[0]}"
fi

docker inspect "${BACKEND_CONTAINER}" >/dev/null 2>&1 \
    || fail "Backend container not found: ${BACKEND_CONTAINER}"
docker image inspect "${ARCHIVE_IMAGE}" >/dev/null 2>&1 \
    || fail "Archive image is not available locally; run: docker pull ${ARCHIVE_IMAGE}"

MEDIA_VOLUME="$(
    docker inspect --format \
        '{{range .Mounts}}{{if eq .Destination "/app/media"}}{{.Name}}{{end}}{{end}}' \
        "${BACKEND_CONTAINER}"
)"
[[ -n "${MEDIA_VOLUME}" ]] || fail "Could not resolve the Docker volume mounted at /app/media"

DEPLOY_DIR="$(
    docker inspect --format \
        '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' \
        "${BACKEND_CONTAINER}"
)"
[[ -n "${DEPLOY_DIR}" && "${DEPLOY_DIR}" != "<no value>" ]] \
    || fail "Could not resolve the Compose working directory from ${BACKEND_CONTAINER}"
ENV_FILE="${LOVE_BOOK_ENV_FILE:-${DEPLOY_DIR}/.env}"
[[ -f "${ENV_FILE}" ]] || fail "Production environment file not found: ${ENV_FILE}"

volume_kb="$(
    docker run --rm \
        -v "${MEDIA_VOLUME}:/source:ro" \
        "${ARCHIVE_IMAGE}" \
        sh -c 'du -sk /source | cut -f1'
)"
[[ "${volume_kb}" =~ ^[0-9]+$ ]] || fail "Could not measure media volume size"
available_kb="$(df -Pk "${BACKUP_ROOT}" | awk 'NR == 2 { print $4 }')"
required_kb=$((volume_kb + MIN_FREE_KB))
(( available_kb >= required_kb )) \
    || fail "Insufficient disk space: ${available_kb} KiB available, ${required_kb} KiB required"

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
restore_point="${timestamp}_${BACKUP_KIND}"
PARTIAL_DIR="${BACKUP_ROOT}/.${restore_point}.partial"
FINAL_DIR="${BACKUP_ROOT}/${restore_point}"
[[ ! -e "${PARTIAL_DIR}" && ! -e "${FINAL_DIR}" ]] || fail "Restore point already exists: ${restore_point}"
mkdir -- "${PARTIAL_DIR}"
trap cleanup_partial EXIT

echo "Creating MySQL dump for ${MYSQL_DATABASE}"
mysqldump \
    --defaults-extra-file="${MYSQL_DEFAULTS_FILE}" \
    --single-transaction \
    --quick \
    --routines \
    --triggers \
    --events \
    --hex-blob \
    --no-tablespaces \
    --default-character-set=utf8mb4 \
    "${MYSQL_DATABASE}" \
    | gzip -9 >"${PARTIAL_DIR}/love_book.sql.gz"
gzip -t "${PARTIAL_DIR}/love_book.sql.gz"
gzip -cd "${PARTIAL_DIR}/love_book.sql.gz" \
    | tail -n 20 \
    | grep -q -- '-- Dump completed on' \
    || fail "MySQL dump completion marker is missing"

echo "Archiving media volume ${MEDIA_VOLUME}"
docker run --rm \
    -v "${MEDIA_VOLUME}:/source:ro" \
    -v "${PARTIAL_DIR}:/backup" \
    "${ARCHIVE_IMAGE}" \
    tar -czf /backup/love_book_media.tar.gz -C /source .
tar -tzf "${PARTIAL_DIR}/love_book_media.tar.gz" >/dev/null

cp -- "${ENV_FILE}" "${PARTIAL_DIR}/production.env"
chmod 600 "${PARTIAL_DIR}/production.env"

backend_image="$(docker inspect --format '{{.Config.Image}}' "${BACKEND_CONTAINER}")"
backend_image_id="$(docker image inspect --format '{{.Id}}' "${backend_image}")"
health_json="$(docker exec "${BACKEND_CONTAINER}" curl -fsS http://127.0.0.1:8000/health 2>/dev/null || true)"
cat >"${PARTIAL_DIR}/metadata.txt" <<EOF
created_at_utc=${timestamp}
backup_kind=${BACKUP_KIND}
database=${MYSQL_DATABASE}
backend_container=${BACKEND_CONTAINER}
backend_image=${backend_image}
backend_image_id=${backend_image_id}
media_volume=${MEDIA_VOLUME}
media_volume_size_kb=${volume_kb}
compose_working_dir=${DEPLOY_DIR}
health=${health_json}
consistency=online-best-effort-database-before-media
EOF

(
    cd "${PARTIAL_DIR}"
    sha256sum love_book.sql.gz love_book_media.tar.gz production.env metadata.txt >manifest.sha256
    sha256sum -c manifest.sha256
)
touch "${PARTIAL_DIR}/SUCCESS"
mv -- "${PARTIAL_DIR}" "${FINAL_DIR}"
PARTIAL_DIR=""

if [[ "${BACKUP_KIND}" == "weekly" ]]; then
    mapfile -t weekly_points < <(
        find "${BACKUP_ROOT}" -mindepth 2 -maxdepth 2 -type f -name SUCCESS -path '*_weekly/SUCCESS' \
            -printf '%h\n' | sort -r
    )
    if (( ${#weekly_points[@]} > KEEP_WEEKLY )); then
        for old_point in "${weekly_points[@]:KEEP_WEEKLY}"; do
            safe_remove_restore_point "${old_point}"
        done
    fi

    while IFS= read -r release_point; do
        [[ -n "${release_point}" ]] && safe_remove_restore_point "${release_point}"
    done < <(
        find "${BACKUP_ROOT}" -mindepth 2 -maxdepth 2 -type f -name SUCCESS -path '*_pre-release/SUCCESS' \
            -printf '%h\n'
    )
fi

trap - EXIT
echo "Backup completed: ${FINAL_DIR}"

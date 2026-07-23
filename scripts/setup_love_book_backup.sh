#!/usr/bin/env bash
# Install the Love Book backup script and its weekly cron entry for the current server user.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
INSTALL_DIR="${LOVE_BOOK_BACKUP_BIN_DIR:-${HOME}/bin}"
BACKUP_ROOT="${LOVE_BOOK_BACKUP_ROOT:-${HOME}/backups/love_book}"
ARCHIVE_IMAGE="${LOVE_BOOK_ARCHIVE_IMAGE:-alpine:3.22}"
CRON_MARKER="# love-book-weekly-backup"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v mysqldump >/dev/null 2>&1 || fail "mysqldump is required"
command -v crontab >/dev/null 2>&1 || fail "crontab is required"
docker info >/dev/null 2>&1 \
    || fail "Current user cannot access Docker. Add this trusted operations user to the docker group and log in again."

[[ -f "${HOME}/.my.cnf" ]] || fail "Create ${HOME}/.my.cnf before installation"
[[ "$(stat -c '%a' "${HOME}/.my.cnf")" == "600" ]] || fail "${HOME}/.my.cnf must have mode 0600"

umask 077
mkdir -p -- "${INSTALL_DIR}" "${BACKUP_ROOT}"
chmod 700 -- "${INSTALL_DIR}" "${BACKUP_ROOT}"
install -m 700 "${SCRIPT_DIR}/love_book_backup.sh" "${INSTALL_DIR}/love-book-backup"

docker image inspect "${ARCHIVE_IMAGE}" >/dev/null 2>&1 || docker pull "${ARCHIVE_IMAGE}"

cron_line="0 4 * * 1 ${INSTALL_DIR}/love-book-backup weekly >>${BACKUP_ROOT}/backup.log 2>&1 ${CRON_MARKER}"
existing_cron="$(crontab -l 2>/dev/null || true)"
{
    printf '%s\n' "${existing_cron}" | grep -Fv "${CRON_MARKER}" || true
    printf '%s\n' "${cron_line}"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Installed ${INSTALL_DIR}/love-book-backup"
echo "Installed weekly cron: ${cron_line}"
echo "Run a first backup now with: ${INSTALL_DIR}/love-book-backup weekly"

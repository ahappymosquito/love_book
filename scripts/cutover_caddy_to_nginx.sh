#!/usr/bin/env bash
# 一次性把 qrqto.club / www / cdn 从 Docker Caddy 切到主机 Nginx。
# 失败会停 Nginx 并重新拉起 Caddy。禁止 docker compose down -v。

set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/home/ts3/love-book}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ROOT="${BACKUP_ROOT:-/root/love-book-nginx-cutover-${STAMP}}"
CADDY_CERT_ROOT="/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${HEALTH_URL:-https://qrqto.club/api/health}"
CDN_URL="${CDN_URL:-https://cdn.qrqto.club/packages.json}"
WWW_URL="${WWW_URL:-https://www.qrqto.club/}"

log() { printf '[cutover] %s\n' "$*"; }
fail() { printf '[cutover] FAIL %s\n' "$*" >&2; exit 1; }

if [[ "${EUID}" -ne 0 ]]; then
    fail "Run as root on the production host"
fi
[[ -f "${COMPOSE_DIR}/docker-compose.yml" ]] || fail "Compose file missing: ${COMPOSE_DIR}"
command -v docker >/dev/null || fail "docker is required"
command -v nginx >/dev/null || fail "nginx is required"
command -v curl >/dev/null || fail "curl is required"

compose() {
    (cd "${COMPOSE_DIR}" && docker compose "$@")
}

http_code() {
    curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 "$1" || true
}

expect_200() {
    local url="$1"
    local code
    code="$(http_code "${url}")"
    [[ "${code}" == "200" ]] || fail "${url} returned ${code:-none}, expected 200"
}

rollback() {
    log "Rolling back to Caddy"
    systemctl stop nginx || true
    compose up -d caddy || true
    sleep 2
    log "After rollback: qrqto=$(http_code https://qrqto.club/) cdn=$(http_code "${CDN_URL}")"
}

on_error() {
    local status=$?
    trap - ERR
    rollback
    exit "${status}"
}

log "Backup directory ${BACKUP_ROOT}"
install -d -m 0700 "${BACKUP_ROOT}"
cp -a "${COMPOSE_DIR}/docker-compose.yml" "${BACKUP_ROOT}/"
[[ -f "${COMPOSE_DIR}/docker-compose.override.yml" ]] && cp -a "${COMPOSE_DIR}/docker-compose.override.yml" "${BACKUP_ROOT}/"
[[ -f "${COMPOSE_DIR}/Caddyfile" ]] && cp -a "${COMPOSE_DIR}/Caddyfile" "${BACKUP_ROOT}/"
[[ -f "${COMPOSE_DIR}/.env" ]] && cp -a "${COMPOSE_DIR}/.env" "${BACKUP_ROOT}/"
tar -C /etc -czf "${BACKUP_ROOT}/etc-nginx.tar.gz" nginx
ss -ltnp >"${BACKUP_ROOT}/listen.txt" || true
compose ps >"${BACKUP_ROOT}/compose-ps.txt" || true
{
    echo "qrqto.club $(http_code https://qrqto.club/)"
    echo "www $(http_code https://www.qrqto.club/)"
    echo "health $(http_code "${HEALTH_URL}")"
    echo "cdn $(http_code "${CDN_URL}")"
} >"${BACKUP_ROOT}/pre-http.txt"

if [[ -x /home/ts3/bin/love-book-backup ]]; then
    log "Creating pre-release application backup as ts3"
    runuser -u ts3 -- env HOME=/home/ts3 /home/ts3/bin/love-book-backup pre-release
else
    log "WARN application backup command is missing; compose/nginx files are still copied"
fi

log "Exporting Caddy certificates"
CADDY_CID="$(compose ps -q caddy)"
[[ -n "${CADDY_CID}" ]] || fail "Caddy container is not running; abort so we do not drop HTTPS"
for name in qrqto.club www.qrqto.club cdn.qrqto.club; do
    dest="/etc/nginx/certs/${name}"
    bak="${BACKUP_ROOT}/caddy-certs/${name}"
    install -d -m 0700 "${bak}" "${dest}"
    docker cp "${CADDY_CID}:${CADDY_CERT_ROOT}/${name}/${name}.crt" "${dest}/fullchain.pem"
    docker cp "${CADDY_CID}:${CADDY_CERT_ROOT}/${name}/${name}.key" "${dest}/privkey.pem"
    chmod 0644 "${dest}/fullchain.pem"
    chmod 0600 "${dest}/privkey.pem"
    cp -a "${dest}/fullchain.pem" "${dest}/privkey.pem" "${bak}/"
done

log "Installing nginx site files"
bash "${REPO_ROOT}/scripts/install_nginx_gateway.sh"

log "Publishing Love Book loopback ports while Caddy still owns 80/443"
python3 - "${COMPOSE_DIR}/docker-compose.yml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
changed = False

def ensure_ports(text, service, mapping):
    marker = f"\n  {service}:"
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f"service {service} not found")
    start += 1
    nxt = len(text)
    for token in ("\n  frontend:", "\n  backend:", "\n  caddy:", "\nvolumes:", "\nnetworks:"):
        pos = text.find(token, start + len(marker))
        if pos != -1:
            nxt = min(nxt, pos)
    block = text[start:nxt]
    host_port = mapping.split(":")[1]
    if "127.0.0.1:" in block and host_port in block:
        return text, False
    if "\n    ports:\n" in block:
        return text, False
    insert = f"    ports:\n      - \"{mapping}\"\n"
    for needle in ("    expose:\n", "    environment:\n", "    env_file:\n"):
        idx = block.find(needle)
        if idx != -1:
            abs_idx = start + idx
            return text[:abs_idx] + insert + text[abs_idx:], True
    return text[:nxt] + insert + text[nxt:], True

text, c1 = ensure_ports(text, "backend", "127.0.0.1:8000:8000")
text, c2 = ensure_ports(text, "frontend", "127.0.0.1:3000:3000")
if c1 or c2:
    path.write_text(text, encoding="utf-8")
    print("loopback ports added")
else:
    print("loopback ports already present")
PY
compose up -d backend frontend
backend_ok=0
frontend_ok=0
for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 http://127.0.0.1:8000/health >/dev/null 2>&1; then
        backend_ok=1
    fi
    if curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3000/ >/dev/null 2>&1; then
        frontend_ok=1
    fi
    if [[ "${backend_ok}" -eq 1 && "${frontend_ok}" -eq 1 ]]; then
        break
    fi
    sleep 2
done
[[ "${backend_ok}" -eq 1 ]] || fail "backend loopback /health failed before cutover"
[[ "${frontend_ok}" -eq 1 ]] || fail "frontend loopback failed before cutover"

nginx -t || fail "nginx -t failed; Caddy left running"

trap on_error ERR

log "Stopping Caddy and starting host nginx"
compose stop caddy
systemctl start nginx
systemctl enable nginx >/dev/null

sleep 1
ss -ltnp | grep -E ':80|:443' | grep -q nginx || fail "nginx is not listening on 80/443"
ss -ltnp | grep -E ':80|:443' | grep -q caddy && fail "Caddy is still bound to 80/443"

expect_200 "${HEALTH_URL}"
expect_200 "https://qrqto.club/"
expect_200 "${WWW_URL}"
expect_200 "${CDN_URL}"
expect_200 "https://cdn.qrqto.club/"
expect_200 "https://cdn.qrqto.club/app/latest.json"

log "Removing Caddy from compose (keep volume and image)"
python3 - "${COMPOSE_DIR}/docker-compose.yml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
start = text.find("\n  caddy:")
if start < 0:
    start = text.find("\n  caddy:\n")
if start < 0:
    print("caddy service already absent")
    raise SystemExit(0)
# drop caddy service through the next top-level key
rest = text[start + 1:]
end_rel = None
for token in ("\nvolumes:", "\nnetworks:", "\n  backend:", "\n  frontend:"):
    pos = rest.find(token)
    if pos != -1:
        end_rel = pos if end_rel is None else min(end_rel, pos)
if end_rel is None:
    new = text[:start]
else:
    new = text[:start] + rest[end_rel:]
# drop unused caddy volumes if they are only declared
lines = []
skip_caddy_vol = False
for line in new.splitlines(True):
    if line.startswith("  caddy_data:") or line.startswith("  caddy_config:"):
        continue
    lines.append(line)
path.write_text("".join(lines), encoding="utf-8")
print("caddy service removed from compose")
PY
compose up -d --remove-orphans backend frontend

expect_200 "${HEALTH_URL}"
expect_200 "${CDN_URL}"

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 "${REPO_ROOT}/scripts/nginx_tls_renew.sh" /usr/local/sbin/love-book-nginx-renew
cat >/etc/letsencrypt/renewal-hooks/deploy/love-book-nginx.sh <<'EOF'
#!/bin/sh
exec /usr/local/sbin/love-book-nginx-renew
EOF
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/love-book-nginx.sh

trap - ERR
log "Cutover succeeded. Backup is ${BACKUP_ROOT}"
log "Next: install certbot and run webroot issuance, then certbot renew --dry-run"
log "Keep the stopped Caddy volume for 24h rollback."

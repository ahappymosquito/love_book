#!/usr/bin/env bash
# 在主机 Nginx 已对外后，用 webroot 把证书交给 Let's Encrypt 并同步到 /etc/nginx/certs。
# 用法：CERTBOT_EMAIL=you@example.com ./scripts/issue_nginx_certs.sh

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    echo "Run as root" >&2
    exit 1
fi
command -v certbot >/dev/null || { echo "certbot is not installed" >&2; exit 1; }

WEBROOT="${WEBROOT:-/var/www/certbot}"
install -d -m 0755 "${WEBROOT}/.well-known/acme-challenge"

email_args=()
if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
    email_args=(--email "${CERTBOT_EMAIL}" --agree-tos)
else
    email_args=(--register-unsafely-without-email --agree-tos)
fi

certbot certonly --webroot -w "${WEBROOT}" --non-interactive \
    "${email_args[@]}" --keep-until-expiring \
    -d tingle272.xyz -d www.tingle272.xyz -d cdn.tingle272.xyz

sync_pair() {
    local live="$1"
    local dest="$2"
    install -d -m 0755 "${dest}"
    install -m 0644 "${live}/fullchain.pem" "${dest}/fullchain.pem"
    install -m 0600 "${live}/privkey.pem" "${dest}/privkey.pem"
}

sync_pair /etc/letsencrypt/live/tingle272.xyz /etc/nginx/certs/tingle272.xyz

nginx -t
systemctl reload nginx
echo "Let's Encrypt certificates installed and nginx reloaded"

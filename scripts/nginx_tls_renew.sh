#!/usr/bin/env bash
# 用 certbot webroot 续期 Love Book / CDN 证书，校验后 reload 主机 Nginx。
# 失败不改正在运行的 worker。不要使用 certbot --nginx。

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    echo "Run as root" >&2
    exit 1
fi
command -v certbot >/dev/null || { echo "certbot is not installed" >&2; exit 1; }
command -v nginx >/dev/null || { echo "nginx is not installed" >&2; exit 1; }

install -d -m 0755 /var/www/certbot/.well-known/acme-challenge

sync_live_cert() {
    local name="$1"
    local live="/etc/letsencrypt/live/${name}"
    local dest="/etc/nginx/certs/${name}"
    if [[ -f "${live}/fullchain.pem" && -f "${live}/privkey.pem" ]]; then
        install -d -m 0755 "${dest}"
        install -m 0644 "${live}/fullchain.pem" "${dest}/fullchain.pem"
        install -m 0600 "${live}/privkey.pem" "${dest}/privkey.pem"
    fi
}

certbot renew --webroot -w /var/www/certbot --quiet --deploy-hook true

for name in qrqto.club www.qrqto.club cdn.qrqto.club; do
    sync_live_cert "${name}"
done

nginx -t
systemctl reload nginx
echo "TLS renew finished"

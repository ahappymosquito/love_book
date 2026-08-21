#!/usr/bin/env bash
# 把仓库里的主机 Nginx 站点装到 /etc/nginx，不启动、不抢 80/443。
# 仅在 root 下运行。Caddy 仍可继续对外。

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_SRC="${REPO_ROOT}/deploy/nginx"

if [[ "${EUID}" -ne 0 ]]; then
    echo "Run as root" >&2
    exit 1
fi
command -v nginx >/dev/null || { echo "nginx is not installed" >&2; exit 1; }
[[ -d "${NGINX_SRC}/sites" ]] || { echo "Missing ${NGINX_SRC}" >&2; exit 1; }

install -d -m 0755 /var/www/certbot/.well-known/acme-challenge
install -d -m 0755 /etc/nginx/certs/qrqto.club
install -d -m 0755 /etc/nginx/certs/www.qrqto.club
install -d -m 0755 /etc/nginx/certs/cdn.qrqto.club
install -d -m 0755 /etc/nginx/snippets

install -m 0644 "${NGINX_SRC}/snippets/love-book-ssl.conf" /etc/nginx/snippets/love-book-ssl.conf
install -m 0644 "${NGINX_SRC}/snippets/love-book-proxy.conf" /etc/nginx/snippets/love-book-proxy.conf
install -m 0644 "${NGINX_SRC}/sites/qrqto.club.conf" /etc/nginx/sites-available/qrqto.club
install -m 0644 "${NGINX_SRC}/sites/cdn.qrqto.club.conf" /etc/nginx/sites-available/cdn.qrqto.club

ln -sfn /etc/nginx/sites-available/qrqto.club /etc/nginx/sites-enabled/qrqto.club
ln -sfn /etc/nginx/sites-available/cdn.qrqto.club /etc/nginx/sites-enabled/cdn.qrqto.club

if [[ -L /etc/nginx/sites-enabled/love || -e /etc/nginx/sites-enabled/love ]]; then
    rm -f /etc/nginx/sites-enabled/love
    echo "Disabled leftover default_server site: love"
fi

echo "Nginx gateway files installed. Do not start nginx until Caddy has released 80/443."
echo "Place certificates in /etc/nginx/certs/<name>/{fullchain.pem,privkey.pem} then run nginx -t."

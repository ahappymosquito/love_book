"""Host nginx gateway configs must reverse-proxy Love Book and keep the CDN vhost."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
NGINX = PROJECT_ROOT / "deploy" / "nginx"


def test_compose_no_longer_publishes_caddy_on_80_443() -> None:
    compose = (PROJECT_ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert "caddy:" not in compose
    assert "80:80" not in compose
    assert "443:443" not in compose
    assert "127.0.0.1:8000:8000" in compose
    assert "127.0.0.1:3000:3000" in compose


def test_love_book_vhost_strips_api_and_uses_loopback() -> None:
    proxy = (NGINX / "snippets" / "love-book-proxy.conf").read_text(encoding="utf-8")
    site = (NGINX / "sites" / "qrqto.club.conf").read_text(encoding="utf-8")

    assert "proxy_pass http://127.0.0.1:8000/;" in proxy
    assert "location /api/" in proxy
    assert "location = /docs" in proxy
    assert "proxy_pass http://127.0.0.1:3000" in proxy
    assert "client_max_body_size 25m" in proxy
    assert "acme-challenge" in proxy
    assert "server_name qrqto.club www.qrqto.club" in site
    assert "ssl_certificate     /etc/nginx/certs/qrqto.club/fullchain.pem" in site


def test_cdn_vhost_keeps_host_root_and_short_cache() -> None:
    site = (NGINX / "sites" / "cdn.qrqto.club.conf").read_text(encoding="utf-8")

    assert "server_name cdn.qrqto.club" in site
    assert "root /var/www/cdn.qrqto.club" in site
    assert 'Cache-Control "public, max-age=300"' in site
    assert "Access-Control-Allow-Origin" in site
    assert "backend:8000" not in site

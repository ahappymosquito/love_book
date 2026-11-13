"""Host nginx gateway configs: reverse-proxy Love Book, send security headers, hide API docs, keep the CDN vhost."""

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
NGINX = PROJECT_ROOT / "deploy" / "nginx"
SECURITY_INCLUDE = "include /etc/nginx/snippets/love-book-security-headers.conf;"


def location_blocks(conf: str) -> dict[str, str]:
    """Map each `location ... {` header to its body; snippets here never nest braces."""
    return {
        match.group(1).strip(): match.group(2)
        for match in re.finditer(r"location\s+([^{]+)\{([^{}]*)\}", conf)
    }


def server_blocks(conf: str) -> list[str]:
    return re.findall(r"server\s*\{(.*?)\n\}", conf, flags=re.S)


def test_compose_no_longer_publishes_caddy_on_80_443() -> None:
    compose = (PROJECT_ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert "caddy:" not in compose
    assert "80:80" not in compose
    assert "443:443" not in compose
    assert "127.0.0.1:8000:8000" in compose
    assert "127.0.0.1:3000:3000" in compose


def test_love_book_vhost_strips_api_and_uses_loopback() -> None:
    proxy = (NGINX / "snippets" / "love-book-proxy.conf").read_text(encoding="utf-8")
    site = (NGINX / "sites" / "tingle272.xyz.conf").read_text(encoding="utf-8")
    headers = (NGINX / "snippets" / "love-book-proxy-headers.conf").read_text(encoding="utf-8")

    assert "proxy_pass http://127.0.0.1:8000/;" in proxy
    assert "location /api/" in proxy
    assert "proxy_pass http://127.0.0.1:3000" in proxy
    assert "client_max_body_size 25m" in proxy
    assert "acme-challenge" in proxy
    assert "love-book-proxy-headers.conf" in proxy
    assert "proxy_set_header Host $host;" in headers
    assert "X-Forwarded-Proto" in headers
    assert "server_name tingle272.xyz www.tingle272.xyz" in site
    assert "ssl_certificate     /etc/letsencrypt/live/tingle272.xyz/fullchain.pem" in site


def test_security_headers_snippet_values() -> None:
    headers = (NGINX / "snippets" / "love-book-security-headers.conf").read_text(encoding="utf-8")

    assert 'Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' in headers
    assert 'X-Content-Type-Options "nosniff" always;' in headers
    assert 'Referrer-Policy "strict-origin-when-cross-origin" always;' in headers
    assert 'X-Frame-Options "SAMEORIGIN" always;' in headers
    assert "camera=()" in headers
    assert "microphone=()" in headers
    assert "geolocation=(self)" in headers


def test_security_headers_reach_every_https_server_and_add_header_location() -> None:
    site = (NGINX / "sites" / "tingle272.xyz.conf").read_text(encoding="utf-8")
    proxy = (NGINX / "snippets" / "love-book-proxy.conf").read_text(encoding="utf-8")

    https_servers = [block for block in server_blocks(site) if "listen 443" in block]
    assert len(https_servers) == 2
    for block in https_servers:
        assert SECURITY_INCLUDE in block

    for header, body in location_blocks(proxy).items():
        if "add_header" in body:
            assert SECURITY_INCLUDE in body, header


def test_install_script_ships_security_headers_snippet() -> None:
    installer = (PROJECT_ROOT / "scripts" / "install_nginx_gateway.sh").read_text(encoding="utf-8")

    assert "love-book-security-headers.conf" in installer


def test_api_docs_are_not_public() -> None:
    proxy = (NGINX / "snippets" / "love-book-proxy.conf").read_text(encoding="utf-8")
    blocks = location_blocks(proxy)

    assert "proxy_pass http://127.0.0.1:8000/docs" not in proxy
    assert "proxy_pass http://127.0.0.1:8000/openapi.json" not in proxy
    regexes = {
        header.removeprefix("~").strip(): body
        for header, body in blocks.items()
        if header.startswith("~")
    }
    assert regexes, "expected regex locations that hide docs"
    for path in ("/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json",
                 "/api/docs", "/api/redoc", "/api/openapi.json"):
        hits = [body for pattern, body in regexes.items() if re.search(pattern, path)]
        assert hits and all("return 404;" in body for body in hits), path
    for path in ("/api/health", "/api/auth/me", "/timeline", "/documents"):
        assert not any(re.search(pattern, path) for pattern in regexes), path


def test_caddy_leftovers_are_removed() -> None:
    assert not (PROJECT_ROOT / "deploy" / "caddy").exists()
    assert not (PROJECT_ROOT / "scripts" / "cutover_caddy_to_nginx.sh").exists()
    env_example = (PROJECT_ROOT / ".env.example").read_text(encoding="utf-8")
    assert "Caddy" not in env_example


def test_compose_frontend_waits_for_healthy_backend() -> None:
    import yaml

    compose = yaml.safe_load((PROJECT_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    frontend = compose["services"]["frontend"]
    backend = compose["services"]["backend"]

    assert frontend["depends_on"]["backend"]["condition"] == "service_healthy"
    assert "127.0.0.1:3000" in " ".join(frontend["healthcheck"]["test"])
    assert "love_book_media:/app/media" in backend["volumes"]
    assert "host.docker.internal:host-gateway" in backend["extra_hosts"]


def test_cdn_vhost_keeps_host_root_and_short_cache() -> None:
    site = (NGINX / "sites" / "cdn.tingle272.xyz.conf").read_text(encoding="utf-8")

    assert "server_name cdn.tingle272.xyz" in site
    assert "root /var/www/cdn.qrqto.club" in site
    assert 'Cache-Control "public, max-age=300"' in site
    assert "Access-Control-Allow-Origin" in site
    assert "backend:8000" not in site

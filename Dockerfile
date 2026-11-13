# Backend image using Poetry's lock file. A build stage compiles the venv; the runtime stage keeps only
# Python, curl (healthcheck) and Node/npx for the AMap MCP server, without compilers or gnupg.
# Runs as root on purpose: the production love_book_media named volume is root-owned.
# Uvicorn trusts proxy headers only from loopback and private Docker bridge ranges (FORWARDED_ALLOW_IPS).

FROM ubuntu:24.04 AS python-deps

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        ca-certificates \
        build-essential \
        libssl-dev \
        libffi-dev \
    ; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 -m venv /opt/poetry \
    && /opt/poetry/bin/pip install --no-cache-dir poetry==2.2.1 \
    && python3 -m venv /app/.venv

ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:/opt/poetry/bin:${PATH}" \
    POETRY_VIRTUALENVS_CREATE=false

COPY pyproject.toml poetry.lock ./
RUN poetry sync --only main --no-root --no-interaction

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

ARG APP_GIT_SHA=development
ENV APP_GIT_SHA=${APP_GIT_SHA}

# apt reads the ASCII-armored NodeSource key directly (.asc), so gnupg is not needed.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        python3 \
        ca-certificates \
        tzdata \
        curl \
    ; \
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        -o /etc/apt/keyrings/nodesource.asc; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_22.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends nodejs; \
    npm config set fund false; \
    npm config set audit false; \
    ln -sf /usr/share/zoneinfo/${TZ} /etc/localtime; \
    echo "${TZ}" > /etc/timezone; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=python-deps /app/.venv /app/.venv

# Host Nginx reaches the loopback-published port through the Docker bridge gateway (private range).
ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:${PATH}" \
    FORWARDED_ALLOW_IPS="127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

COPY VERSION ./VERSION
COPY app ./app
COPY scripts ./scripts

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health >/dev/null || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers"]

# Backend runtime image using Poetry's lock file; Node/npx runs the AMap MCP server.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

ARG APP_GIT_SHA=development
ENV APP_GIT_SHA=${APP_GIT_SHA}

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        ca-certificates \
        tzdata \
        curl \
        gnupg \
        build-essential \
        libssl-dev \
        libffi-dev \
    ; \
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends nodejs; \
    npm config set fund false; \
    npm config set audit false; \
    ln -sf /usr/share/zoneinfo/${TZ} /etc/localtime; \
    echo "${TZ}" > /etc/timezone; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 -m venv /opt/poetry \
    && /opt/poetry/bin/pip install --no-cache-dir poetry==2.2.1 \
    && python3 -m venv /app/.venv

ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:/opt/poetry/bin:${PATH}" \
    POETRY_VIRTUALENVS_CREATE=false

COPY pyproject.toml poetry.lock ./
RUN poetry sync --only main --no-root --no-interaction \
    && rm -rf /opt/poetry \
    && rm -rf /root/.cache/pypoetry

COPY VERSION ./VERSION
COPY app ./app
COPY scripts ./scripts

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health >/dev/null || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*"]

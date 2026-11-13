# Frontend production image for the Next.js app; build-time API routing points to /api
# so host Nginx can serve the UI and reverse-proxy backend requests from the same origin.
# The runner keeps only production dependencies and runs `next start` as the unprivileged nextjs user.

ARG NODE_MAJOR=22

FROM ubuntu:24.04 AS base
ARG NODE_MAJOR
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8
# apt reads the ASCII-armored NodeSource key directly (.asc), so gnupg is not needed.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl tzdata; \
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        -o /etc/apt/keyrings/nodesource.asc; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends nodejs; \
    ln -sf /usr/share/zoneinfo/${TZ} /etc/localtime; \
    echo "${TZ}" > /etc/timezone; \
    npm config set fund false; \
    npm config set audit false; \
    rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE=/api
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ 在仓库中可能为空：git 不跟踪空目录、Next.js 又会去 build trace 它，
# 这里兜底创建一下，避免 runner 阶段 COPY --from=builder /app/public 失败。
RUN mkdir -p /app/public
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 10001 nextjs \
    && useradd --system --uid 10001 --gid nextjs --home-dir /app --no-create-home --shell /usr/sbin/nologin nextjs

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/public ./public
COPY --from=prod-deps /app/node_modules ./node_modules
# next start writes its image/fetch cache under .next/cache at runtime.
COPY --from=builder --chown=nextjs:nextjs /app/.next ./.next

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

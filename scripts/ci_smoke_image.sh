#!/usr/bin/env bash
# 发布前镜像冒烟（release-images 工作流在推送任何版本标签之前调用）。
# backend：启动容器（隔离的 SQLite），/health 的 version 必须等于 VERSION，git_sha 必须等于构建提交。
# frontend：启动容器，首页必须返回 HTTP 200。两者都核对 OCI 版本标签，失败时输出容器日志。
# 用法：bash scripts/ci_smoke_image.sh backend|frontend IMAGE EXPECTED_VERSION [EXPECTED_GIT_SHA]

set -euo pipefail

component="${1:?component (backend|frontend) required}"
image="${2:?image reference required}"
expected_version="${3:?expected version required}"
expected_sha="${4:-}"
name="love-book-smoke-${component}-$$"
attempts=45

cleanup() {
    local status=$?
    if [[ ${status} -ne 0 ]]; then
        echo "--- ${name} logs ---" >&2
        docker logs "${name}" >&2 2>&1 || true
    fi
    docker rm -f "${name}" >/dev/null 2>&1 || true
    exit "${status}"
}
trap cleanup EXIT

label_version="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "${image}")"
if [[ "${label_version}" != "${expected_version}" ]]; then
    echo "OCI version label ${label_version:-<missing>} != ${expected_version}" >&2
    exit 1
fi

case "${component}" in
    backend)
        docker run -d --name "${name}" \
            -p 127.0.0.1:18000:8000 \
            -e DATABASE_URL=sqlite:////tmp/love-book-smoke.db \
            -e ADMIN_KEY=ci-smoke-only \
            -e APP_WEB_URL=http://localhost:3000 \
            "${image}" >/dev/null
        body=""
        for _ in $(seq "${attempts}"); do
            if body="$(curl -fsS http://127.0.0.1:18000/health)"; then
                break
            fi
            body=""
            sleep 2
        done
        [[ -n "${body}" ]] || { echo "backend /health never became ready" >&2; exit 1; }
        echo "health=${body}"
        HEALTH_BODY="${body}" EXPECTED_VERSION="${expected_version}" EXPECTED_SHA="${expected_sha}" python3 - <<'PY'
import json
import os
import sys

payload = json.loads(os.environ["HEALTH_BODY"])
expected = os.environ["EXPECTED_VERSION"]
expected_sha = os.environ["EXPECTED_SHA"]
if payload.get("status") != "ok":
    sys.exit(f"health status is {payload.get('status')!r}")
if payload.get("version") != expected:
    sys.exit(f"health version {payload.get('version')!r} != VERSION {expected!r}")
if expected_sha and payload.get("git_sha") != expected_sha:
    sys.exit(f"health git_sha {payload.get('git_sha')!r} != {expected_sha!r}")
print(f"backend_smoke_ok version={expected}")
PY
        ;;
    frontend)
        docker run -d --name "${name}" -p 127.0.0.1:13000:3000 "${image}" >/dev/null
        code=""
        for _ in $(seq "${attempts}"); do
            code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:13000/ || true)"
            [[ "${code}" == "200" ]] && break
            sleep 2
        done
        [[ "${code}" == "200" ]] || { echo "frontend / returned ${code:-no response}" >&2; exit 1; }
        echo "frontend_smoke_ok version=${expected_version}"
        ;;
    *)
        echo "unknown component ${component}" >&2
        exit 2
        ;;
esac

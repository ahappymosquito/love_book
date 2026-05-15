#!/usr/bin/env bash
# love-book 一键部署脚本（适用于 Ubuntu 24.04 等 Linux）
# 用法：
#   ./deploy.sh check     仅做打包前检查，不部署
#   ./deploy.sh build     构建镜像
#   ./deploy.sh up        构建并启动（后台）
#   ./deploy.sh down      停止并移除容器
#   ./deploy.sh restart   重启
#   ./deploy.sh logs      跟随日志
#   ./deploy.sh status    查看运行状态
#   ./deploy.sh pull-only 仅拉镜像（适用于已 build 的产物 registry 场景）

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "${SCRIPT_DIR}"

# ─────────────────────────────────────────────────────────────────────────────
# 颜色 & 工具
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
info()  { printf "${BLUE}[INFO]${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}[ OK ]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[FAIL]${RESET} %s\n" "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# 选用 docker compose 还是 docker-compose
detect_compose() {
    if docker compose version >/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        fail "未检测到 docker compose / docker-compose"
    fi
}

COMPOSE="$(detect_compose)"
PROJECT="love-book"

# ─────────────────────────────────────────────────────────────────────────────
# 打包前检查
preflight() {
    info "===== 打包前检查 ====="

    command -v docker >/dev/null 2>&1 || fail "未安装 docker"
    ok "docker: $(docker --version)"
    ok "compose 命令: ${COMPOSE}"

    [[ -f .env ]] || fail "缺少 .env，请复制 .env.example 修改后再部署"
    ok ".env 存在"

    # 必填字段
    local required=(ADMIN_KEY DATABASE_URL APP_WEB_URL)
    set -o allexport
    # shellcheck disable=SC1091
    source .env
    set +o allexport

    for k in "${required[@]}"; do
        local v="${!k:-}"
        [[ -n "$v" ]] || fail ".env 缺少 $k"
    done
    ok "必填环境变量已就绪：${required[*]}"

    # APP_WEB_URL 校验：不能是 localhost
    case "${APP_WEB_URL}" in
        http://localhost*|http://127.0.0.1*|*localhost*)
            fail "APP_WEB_URL=${APP_WEB_URL} 仍指向本地，邮件链接会无法打开。请改成 https://db.example.com"
            ;;
    esac
    ok "APP_WEB_URL=${APP_WEB_URL}"

    # DATABASE_URL 形如 mysql+pymysql://user:pass@host:port/db
    case "${DATABASE_URL}" in
        mysql+pymysql://*) ok "DATABASE_URL 使用 mysql+pymysql" ;;
        sqlite://*) warn "DATABASE_URL 仍是 sqlite，生产建议改为 mysql" ;;
        *) fail "DATABASE_URL 格式不识别：${DATABASE_URL}" ;;
    esac

    # ADMIN_KEY 不可为弱密钥
    if [[ "${ADMIN_KEY}" =~ ^(change-me|123456|admin|tiantian)$ ]]; then
        warn "ADMIN_KEY 似乎是默认 / 弱口令：${ADMIN_KEY}，强烈建议替换"
    fi

    # 必备文件
    local files=(
        Dockerfile
        web/Dockerfile
        docker-compose.yml
        deploy/nginx/nginx.conf
        deploy/nginx/conf.d/db.example.com.conf
        requirements.txt
        web/package.json
    )
    for f in "${files[@]}"; do
        [[ -f "$f" ]] || fail "缺少文件：$f"
    done
    ok "关键部署文件齐全"

    # 检查前端代码里是否还残留 localhost 入口链接（旧代码 / 调试输出）
    if grep -Rn "window.location.origin" web/src/app/admin >/dev/null 2>&1; then
        ok "admin 入口链接：已切换至 NEXT_PUBLIC_APP_URL 优先 + origin 兜底"
    fi
    if grep -Rn "http://localhost:3000" web/src 2>/dev/null | grep -v ".env" >/dev/null; then
        warn "在 web/src 中检测到 http://localhost:3000 字面量，请确认是否是无害的注释/示例"
    fi

    # 端口冲突预警
    if command -v ss >/dev/null 2>&1; then
        if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ':80$|:443$' >/dev/null; then
            warn "宿主机 80/443 端口已被占用，请先释放或修改 docker-compose.yml 的端口映射"
        fi
    fi

    ok "打包前检查通过"
}

cmd_check() { preflight; }

cmd_build() {
    preflight
    info "===== 构建镜像 ====="
    $COMPOSE build --pull
    ok "构建完成"
}

cmd_up() {
    preflight
    info "===== 构建并启动 ====="
    $COMPOSE up -d --build --remove-orphans
    sleep 2
    $COMPOSE ps
    ok "服务已启动"
    cat <<EOF

${BOLD}下一步：${RESET}
  - 站点入口：     http://${APP_PUBLIC_DOMAIN:-db.example.com}/
  - 管理控制台：   http://${APP_PUBLIC_DOMAIN:-db.example.com}/admin
  - 后端文档：     http://${APP_PUBLIC_DOMAIN:-db.example.com}/docs
  - 跟随日志：     ./deploy.sh logs

如需 HTTPS：
  1. 把证书放在 deploy/nginx/certs/db.example.com.{crt,key}
  2. 编辑 deploy/nginx/conf.d/db.example.com.conf，启用 443 段并打开 80→443 重定向
  3. ./deploy.sh restart
EOF
}

cmd_down() {
    info "===== 停止并移除容器 ====="
    $COMPOSE down
    ok "已停止"
}

cmd_restart() {
    info "===== 重启 ====="
    $COMPOSE restart
    $COMPOSE ps
}

cmd_logs() {
    $COMPOSE logs -f --tail=200 "$@"
}

cmd_status() {
    $COMPOSE ps
}

cmd_pull_only() {
    $COMPOSE pull
}

usage() {
    sed -n '2,12p' "$0"
}

case "${1:-up}" in
    check)     cmd_check ;;
    build)     cmd_build ;;
    up|deploy) cmd_up ;;
    down|stop) cmd_down ;;
    restart)   cmd_restart ;;
    logs)      shift; cmd_logs "$@" ;;
    status|ps) cmd_status ;;
    pull-only) cmd_pull_only ;;
    -h|--help|help) usage ;;
    *) usage; exit 1 ;;
esac

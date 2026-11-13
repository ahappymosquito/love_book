# Love Book 部署

本仓库用 Docker Compose 运行后端和前端。公网 80/443 由**宿主机 Nginx** 暴露，并为 `tingle272.xyz`、`www.tingle272.xyz`、`cdn.tingle272.xyz` 提供 HTTPS。TLS 用 certbot webroot 续期，80/443 只留给主机 Nginx。

- **域名**：`tingle272.xyz`（含 `www.tingle272.xyz`）；静态 CDN 为 `cdn.tingle272.xyz`
- **公网入口**：主机 Nginx。`/api/*` 去掉 `/api` 前缀后反代 `127.0.0.1:8000`，其它请求反代 `127.0.0.1:3000`；CDN 直接读 `/var/www/cdn.qrqto.club`
- **数据库**：由 `.env` 的 `DATABASE_URL` 提供连接信息；生产使用 MySQL，本地开发默认 SQLite
- **媒体文件**：图片原图和缩略图保存在后端 `/app/media`，由 Docker named volume `love_book_media` 持久化
- **管理员复制入口链接**：前端运行时读取浏览器当前 `window.location.origin`
- **邮件通知链接**：后端使用 `.env` 的 `APP_WEB_URL`，生产应设为 `https://tingle272.xyz`

生产更新器和备份程序已经安装在服务器部署目录，不随本仓库分发。真实密码和 SMTP 授权码只放服务器 `.env`。智能体从开发机发布时，只读 `LOVE_BOOK_SSH_HOSTS`，再用 `python scripts/deploy_host.py`；私钥只放本机 `~/.ssh/config`。

## 镜像构建与版本标签

本项目由根目录 `VERSION` 统一维护前后端语义化版本。GitHub Actions 只接受与该文件一致的完整稳定版 Git 标签 `vX.Y.Z`；GHCR 镜像标签不带 `v`，为裸 `X.Y.Z`。

- 普通分支 push、pull request 和手动 dispatch 都不会构建或推送镜像。
- 本地创建标签不会触发远程构建；只有显式推送匹配标签时才会触发。
- 标签应指向已经通过测试、且 `VERSION`、前端清单和 Changelog 均一致的提交。
- `release-images`（`.github/workflows/docker-build.yml`）依次执行 `verify`（版本、后端测试、前端构建）→ `smoke` → `publish` → `promote-latest` → `release`。`smoke` 先在本地构建候选镜像并运行 `scripts/ci_smoke_image.sh`：后端用隔离 SQLite 启动，`/health` 的 `version` 必须等于 `VERSION`、`git_sha` 必须等于构建提交；前端首页必须返回 200；两者都核对 OCI 版本标签。冒烟通过后才推送不可变标签 `X.Y.Z` 与 `sha-xxxxxxx`。
- `latest` 只是便捷指针，在冒烟和发布都成功后才移动；生产不以 `latest` 为准。普通 `master` push 不会移动 `latest`。`promote-latest.yml` 只用于手动把已有稳定版本重新指向 `latest`，不重新构建。
- 所有工作流顶层权限为 `contents: read`，只有推送 GHCR 的 job 才拿 `packages: write`，创建 Release 的 job 才拿 `contents: write`；每个 job 都设置了 `timeout-minutes`。第三方 Actions 目前仍按大版本标签引用，尚未固定到 commit SHA。

```powershell
python scripts/version.py check --tag v0.5.0
git tag -a v0.5.0 -m "Love Book 0.5.0"
git push origin v0.5.0
```

未经当次明确授权，不推送标签或镜像。

## 智能体：从打包到发布

智能体不要手写 `ssh user@ip`，也不要让用户填远程路径、镜像或能力列表。`.env` / `.env.example` 只需要 SSH 名字，必须和本机 `~/.ssh/config` 的 `Host` 一致：

| 命名主机 | SSH 别名 | 远程用户 | 用途 |
| --- | --- | --- | --- |
| `cn-ts3` | `cn-ts3` | `ts3` | 默认检查入口：连通性、Compose 状态、备份查看 |
| `cn` | `cn` | `root` | 生产更新入口：带 `LOVE_BOOK_IMAGE_TAG` 运行已安装的 `/home/ts3/love-book/update.sh` |

`ts3` 属于 `docker` 和 `sudo` 组，但不能免密 sudo，也不能拉取私有 GHCR 镜像，`docker-compose.override.yml` 由 root 拥有。因此状态检查走 `cn-ts3`，真正发布走 `cn`。`~/.ssh/config` 没有单独写出这两个 Host 时，脚本仍把 `cn-ts3` 当作 `ts3`、把 `cn` 当作 `root`，打包提示里的更新命令保持 `--host cn`。

本机 SSH 配置示例（密钥路径按本机实际文件修改，不要提交私钥）：

```sshconfig
Host cn-ts3
    HostName 111.229.87.40
    User ts3
    IdentityFile ~/.ssh/ts3_qrqto/ts3_qrqto
    IdentitiesOnly yes

Host cn
    HostName 111.229.87.40
    User root
    IdentityFile ~/.ssh/root_qrqto/root_qrqto
    IdentitiesOnly yes
```

常用命令：

```powershell
python scripts/deploy_host.py list
python scripts/deploy_host.py recipe
python scripts/deploy_host.py package --tag v0.9.1
python scripts/deploy_host.py check --host cn-ts3
python scripts/deploy_host.py status --host cn-ts3
python scripts/deploy_host.py update --host cn --dry-run
python scripts/deploy_host.py update --host cn --yes
```

从默认主入口转发到更新主机：

```powershell
python scripts/deploy_host.py update --host cn-ts3 --follow-update-host --dry-run
```

`run` 在 `User=root` 的发布主机上必须加 `--yes` 才会执行，可先用 `--dry-run` 只打印远程命令：

```powershell
python scripts/deploy_host.py run --host cn --dry-run -- docker compose ps
```

用户只需配置：

```env
LOVE_BOOK_SSH_HOSTS=cn-ts3,cn
```

第一项是默认检查入口。`~/.ssh/config` 里 `User=root` 的主机用来发布。远程目录、备份命令、健康检查地址由脚本内置，不必再配。再加一台只把名字写进去，例如 `LOVE_BOOK_SSH_HOSTS=cn-ts3,cn,lab_tingle`。

完整发布顺序：

1. 整理 `VERSION` 与 `CHANGELOG.md`，运行 `python scripts/version.py sync`。
2. `python scripts/deploy_host.py package --tag vX.Y.Z`，再跑后端测试和前端生产构建。
3. 经用户明确授权后创建并推送 `vX.Y.Z` annotated tag，等待 GitHub Actions `release-images` 成功（冒烟通过后才有 `X.Y.Z` 镜像）。
4. `python scripts/deploy_host.py check --host cn-ts3` 与 `status`。
5. `python scripts/deploy_host.py update --host cn --dry-run` 核对远程命令。
6. 再次获得授权后 `python scripts/deploy_host.py update --host cn --yes`。

`update --yes` 在远端执行 `LOVE_BOOK_IMAGE_TAG='X.Y.Z' bash /home/ts3/love-book/update.sh`（`X.Y.Z` 取自本地 `VERSION`），结束后轮询 `/api/health`，`version` 与 `VERSION` 不一致即以非零退出。

生产 Compose 工作目录是 `/home/ts3/love-book`。更新器核对前后端 OCI 版本标签、仅在发现新版本时以 `ts3` 身份做 `pre-release` 备份，再启动并验证 `/api/health` 与首页。已经是目标版本时不会备份或重启。失败只输出状态和日志，不自动回滚，也绝不会执行 `docker compose down -v`。

### 待办：服务器 `update.sh` 改为按固定标签拉取

`update.sh` 不在仓库里。服务器上的现有版本仍按 `latest` 拉取，需要在服务器侧改为读取 `LOVE_BOOK_IMAGE_TAG` 并拉取 `:${TAG}`，否则 `deploy_host.py` 传入的版本不会生效。改动要点：

```bash
TAG="${LOVE_BOOK_IMAGE_TAG:?LOVE_BOOK_IMAGE_TAG is required}"
[[ "$TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid image tag: $TAG" >&2; exit 2; }
docker pull "ghcr.io/ahappymosquito/love_book-backend:${TAG}"
docker pull "ghcr.io/ahappymosquito/love_book-frontend:${TAG}"
export LOVE_BOOK_IMAGE_TAG="$TAG"
```

`docker-compose.override.yml` 同步改为引用该变量，缺失时直接报错而不是回落到 `latest`：

```yaml
services:
  backend:
    image: ghcr.io/ahappymosquito/love_book-backend:${LOVE_BOOK_IMAGE_TAG:?}
  frontend:
    image: ghcr.io/ahappymosquito/love_book-frontend:${LOVE_BOOK_IMAGE_TAG:?}
```

## 1. 目录结构

```text
.
├── Dockerfile                    # 后端镜像（多阶段）
├── docker-compose.yml            # 后端 / 前端（loopback 8000/3000）
├── deploy/
│   └── nginx/                    # 主机 Nginx 站点、反代、TLS 与安全头片段
├── scripts/
│   ├── deploy_host.py            # 按 LOVE_BOOK_SSH_HOSTS 做打包检查与远程发布
│   ├── ci_smoke_image.sh         # 发布前镜像冒烟
│   └── nginx_tls_renew.sh        # certbot webroot 续期
├── web/
│   └── Dockerfile                # 前端镜像
├── .env                          # 实际运行配置，不提交
└── .env.example                  # 占位模板；含智能体 SSH 发布主机
```

## 2. 前置条件

服务器建议使用 Ubuntu 24.04 LTS，并满足：

| 组件 | 要求 |
| --- | --- |
| Docker Engine | 24.x 或更新，带 `docker compose` v2 |
| 公网 DNS | `tingle272.xyz`、`www.tingle272.xyz` 的 A / AAAA 记录指向本机 |
| 防火墙 | 公网可访问 80 和 443，供主机 Nginx 和 certbot webroot |
| 数据库 | 生产建议 MySQL 5.7+ / 8.x；本地可用 SQLite |

如果 80/443 已被其它服务占用，主机 Nginx 无法启动。不要再让任何容器监听这两个端口。

## 3. 配置 `.env`

```bash
cp .env.example .env
```

至少检查这些变量：

| 变量 | 推荐值 | 说明 |
| --- | --- | --- |
| `ADMIN_KEY` | 32 位以上随机字符串 | 管理后台密钥。`APP_ENV=production` 时为空或占位值（`change-me`、`change-me-please`）会让 `/admin/*` 与 `/admin/auth` 返回 503 |
| `APP_ENV` | `production` | Compose 默认 `${APP_ENV:-production}`；本地开发可设 `development`，此时占位 `ADMIN_KEY` 只在启动时警告 |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` | 镜像默认值；Uvicorn 只信任这些来源的 `X-Forwarded-*` |
| `DATABASE_URL` | `mysql+pymysql://user:pass@host.docker.internal:3306/love_book?charset=utf8mb4` | 同机 MySQL 必须走 Docker 网关；不要写已过期的公网主机名 |
| `APP_WEB_URL` | `https://tingle272.xyz` | 邮件通知中的前端入口链接 |
| `MEDIA_ROOT` | `/app/media` | 图片媒体根目录 |
| `MEDIA_STORAGE` | `local` | 当前图片存储后端 |
| `SMTP_*` | 你自己的邮件服务 | 用于事件 / 评论通知 |
| `AMAP_MAPS_API_KEY` | 高德 Web 服务 Key | `/todo` 搜索与附近抽奖；管理端可覆盖 |
| `LLM_*` | 你自己的模型服务 | 管理端获取模型列表和测试连接 |
| `LOVE_BOOK_SSH_HOSTS` | `cn-ts3,cn` | 开发机给智能体看的 SSH Host 名；生产容器不读取。私钥仍放 `~/.ssh/config` |

真实密钥只放 `.env` 或服务器环境变量。管理端 AI / 模型配置会写入数据库，迁移服务器时需要和业务数据一起备份。开发机 `.env` 里的 `LOVE_BOOK_SSH_HOSTS` 只给智能体发布流程使用，不要写进生产 Compose。

## 4. 部署命令

从源码构建并启动：

```bash
docker compose up -d --build --remove-orphans
```

使用已发布的 GHCR 镜像时，前后端必须固定为同一个不可变版本标签（裸 `X.Y.Z`，不带 `v`）或对应 digest，不得使用 `latest`。可用 override 指定：

```yaml
services:
  backend:
    image: ghcr.io/ahappymosquito/love_book-backend:0.9.1
  frontend:
    image: ghcr.io/ahappymosquito/love_book-frontend:0.9.1
```

Compose 默认给后端设置 `APP_ENV=${APP_ENV:-production}`。前端自带 healthcheck（请求本机 `/`），并在后端 healthcheck 通过（`service_healthy`）后才启动。

后端镜像为多阶段构建：构建阶段编译 Poetry 虚拟环境，运行阶段只保留 Python、curl（健康检查）和 Node.js / npx（高德 MCP）。后端容器仍以 root 运行，因为生产 `love_book_media` volume 归 root 所有。前端镜像只装生产依赖，以非 root 用户 `nextjs`（uid 10001）运行。

常用命令：

```bash
docker compose ps
docker compose logs -f
docker compose restart
docker compose down
```

`docker compose down` 会停止容器并保留 named volume。禁止对生产执行 `docker compose down -v`。

主机 Nginx 证书目录是 `/etc/nginx/certs/<name>/{fullchain.pem,privkey.pem}`，由 certbot webroot 写入 Let's Encrypt 后再同步过去。续期：`/usr/local/sbin/love-book-nginx-renew`。后端图片媒体文件仍持久化到 `love_book_media`。CDN 文件在 `/var/www/cdn.qrqto.club`，不进 Love Book volume。

## 5. 验收地址

| 地址 | 期望 |
| --- | --- |
| `https://tingle272.xyz/` | Next.js 登录页 |
| `https://tingle272.xyz/admin` | 管理控制台 |
| `https://tingle272.xyz/docs` | 404（API 文档不对公网开放） |
| `https://tingle272.xyz/api/health` | `version` 与 `VERSION` 一致 |
| `https://tingle272.xyz/api/auth/me`（带 token） | 返回当前用户 JSON |

需要查看 Swagger UI 时用 SSH 隧道访问本机后端：`ssh -L 8000:127.0.0.1:8000 cn-ts3`，再打开 `http://127.0.0.1:8000/docs`。

管理后台“复制入口链接”按当前页面的协议和域名生成。Clipboard API 不可用时使用隐藏 textarea 降级复制。

## 6. 主机 Nginx 反向代理

站点文件在 `deploy/nginx/`，安装到 `/etc/nginx/sites-available`：

- `tingle272.xyz` / `www.tingle272.xyz`：`/api/` 去前缀反代 `127.0.0.1:8000`，其余反代 `127.0.0.1:3000`。`/docs`、`/redoc`、`/openapi.json` 及其 `/api/` 前缀版本对公网直接返回 404。每个 `proxy_pass` location 都要带 `Host` 与 `X-Forwarded-*`。
- 安全头片段 `deploy/nginx/snippets/love-book-security-headers.conf`：HSTS（含 `includeSubDomains`）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: SAMEORIGIN`、`Permissions-Policy: camera=(), microphone=(), geolocation=(self)`。两个 443 server 都 include 它；Nginx 在声明了自己 `add_header` 的 location 里不继承上层头，所以 `/_next/static/` 也要再 include 一次。
- `cdn.tingle272.xyz`：`root /var/www/cdn.qrqto.club`，`Cache-Control: public, max-age=300`，CORS `*`。
- `/.well-known/acme-challenge/` 都指向 `/var/www/certbot`。
- `client_max_body_size 25m`。

修改站点后：`nginx -t && systemctl reload nginx`。不要运行 `certbot --nginx`。续期脚本是 `scripts/nginx_tls_renew.sh`。

## 7. 数据库与媒体

应用启动时 `app.core.database.init_db()` 会自动建表，并对老库做轻量补列。新上传图片写入 `MEDIA_ROOT`，数据库只保存相对 storage key；旧 BLOB 记录仍可回退读取。

迁移服务器时必须同时备份数据库和 `love_book_media` volume。语音能力已经移除；已有部署中的 `voices` 表和文件会作为不可达备份保留。

后端镜像安装 Node.js 22 以运行高德 MCP，图片缩略图依赖 Pillow。

## 8. 故障排查

| 现象 | 排查 |
| --- | --- |
| Nginx 无法签发或续期证书 | 确认 DNS 指向本机，80 上的 ACME webroot 可访问，跑 `certbot renew --dry-run` |
| HTTPS 打不开 | `systemctl status nginx`、`nginx -t`、确认 80/443 没有被其它进程占用 |
| `/admin` 接口返回 503 | 生产 `ADMIN_KEY` 为空或仍是占位值，改成随机强密钥后重启 backend |
| `update --yes` 报线上版本不一致 | 服务器 `update.sh` 还没按 `LOVE_BOOK_IMAGE_TAG` 拉取，或镜像未发布；见上文待办 |
| 前端能打开但 `/api/*` 失败 | 检查 `love-book-proxy.conf` 与 `curl -fsS http://127.0.0.1:8000/health` |
| CDN 打不开 | 确认 `/var/www/cdn.qrqto.club` 和 `cdn.tingle272.xyz` 站点，不要改安装包文件 |
| 页面能开但登录/时间线/Todo 全超时 | 后端 `DATABASE_URL` 必须指向本机 MySQL（`host.docker.internal`），不要再用已过期的 `qrqto.group` |
| 邮件链接还是 localhost | 修改 `.env` 的 `APP_WEB_URL` 后重启 backend |
| 数据库连接 timeout | 确认 MySQL 地址、端口、用户授权和安全组 |

## 9. 当前部署相关文件

| 功能 | 文件 |
| --- | --- |
| Docker 编排 | `docker-compose.yml` |
| 命名 SSH 发布主机 | `.env.example` / `.env` 的 `LOVE_BOOK_SSH_HOSTS` |
| 智能体打包/发布 CLI | `scripts/deploy_host.py` |
| 图片媒体 volume | `love_book_media:/app/media` |
| 备份与恢复说明 | [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) |
| 主机 Nginx HTTPS 与反代 | `deploy/nginx/` |
| 浏览器安全头 | `deploy/nginx/snippets/love-book-security-headers.conf` |
| TLS 续期 | `scripts/nginx_tls_renew.sh` |
| 发布镜像工作流 / 冒烟 | `.github/workflows/docker-build.yml` / `scripts/ci_smoke_image.sh` |
| 前端 API 同源配置 | `NEXT_PUBLIC_API_BASE=/api` |
| 邮件入口域名 | `.env` 的 `APP_WEB_URL` |

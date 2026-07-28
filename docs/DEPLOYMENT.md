# Love Book 部署

本仓库支持 Docker Compose 一键部署：后端、前端和 Caddy 三个容器共同运行。公网入口由 Caddy 暴露 80/443，并为 `qrqto.club`、`www.qrqto.club` 自动申请和续期 HTTPS 证书。

- **域名**：`qrqto.club`（含 `www.qrqto.club`）
- **公网入口**：Caddy 自动 HTTPS，`/api/*` 去掉 `/api` 前缀后反代到 FastAPI，其它请求反代到 Next.js
- **MySQL**：由 `.env` 的 `DATABASE_URL` 提供连接信息，示例使用 `qrqto.club:3306`
- **媒体文件**：图片原图和缩略图保存在后端 `/app/media`，由 Docker named volume `love_book_media` 持久化
- **管理员复制入口链接**：前端运行时读取浏览器当前 `window.location.origin`，访问 HTTP 就复制 HTTP，访问 HTTPS 就复制 HTTPS
- **邮件通知链接**：后端仍使用 `.env` 的 `APP_WEB_URL`，生产环境应设置为 `https://qrqto.club`

## 镜像构建与版本标签

本项目由根目录 `VERSION` 统一维护前后端语义化版本。GitHub Actions 只接受与该文件一致的完整稳定版标签 `vX.Y.Z`，例如 `v0.5.0`。

- 普通分支 push、pull request 和手动 dispatch 都不会构建或推送镜像。
- 本地创建标签不会触发远程构建；只有显式推送匹配标签时才会触发。
- 标签应指向已经通过测试、且 `VERSION`、前端清单和 Changelog 均一致的提交。

```powershell
python scripts/version.py check --tag v0.5.0
git tag -a v0.5.0 -m "Love Book 0.5.0"
git push origin v0.5.0
```

未经当次明确授权，不推送标签或镜像。

## 1. 目录结构

```text
.
├── Dockerfile                    # 后端镜像
├── docker-compose.yml            # 后端 / 前端 / Caddy 三件套
├── deploy.sh                     # Linux 部署脚本
├── deploy_server.sh              # 服务器预构建镜像一键部署脚本
├── deploy.bat                    # Windows 包装脚本
├── deploy/
│   └── caddy/
│       └── Caddyfile             # qrqto.club 自动 HTTPS 和反向代理配置
├── web/
│   └── Dockerfile                # 前端镜像
├── .env                          # 实际运行配置
└── .env.example                  # 配置模板
```

当前生产入口以 `deploy/caddy/Caddyfile` 和 `docker-compose.yml` 中的 `caddy` 服务为准。

服务器直接使用预构建镜像时，通过 `LOVE_BOOK_VERSION=0.5.0 ./deploy_server.sh up` 固定拉取同版本前后端。脚本会在服务器部署目录生成 `.env`、`Caddyfile`、`docker-compose.yml`；不得使用 `latest`。备份、验证与回滚步骤见 [`VERSIONING.md`](VERSIONING.md)。

## 2. 前置条件

服务器建议使用 Ubuntu 24.04 LTS，并满足：

| 组件 | 要求 |
| --- | --- |
| Docker Engine | 24.x 或更新，带 `docker compose` v2 |
| 公网 DNS | `qrqto.club`、`www.qrqto.club` 的 A / AAAA 记录指向本机 |
| 防火墙 | 公网可访问 80 和 443，供 Caddy 完成 ACME 校验和 HTTPS 访问 |
| 数据库 | MySQL 5.7+ / 8.x 或项目支持的 SQLite；生产建议 MySQL |

如果 80/443 已被其它服务占用，Caddy 无法启动或无法签发证书。首次部署前应先释放端口。

## 3. 配置 `.env`

```bash
cp .env.example .env
vim .env
```

至少检查这些变量：

| 变量 | 推荐值 | 说明 |
| --- | --- | --- |
| `ADMIN_KEY` | 32 位以上随机字符串 | 管理后台密钥 |
| `DATABASE_URL` | `mysql+pymysql://user:pass@qrqto.club:3306/love_book?charset=utf8mb4` | 数据库连接，密码特殊字符需 URL 编码 |
| `APP_WEB_URL` | `https://qrqto.club` | 邮件通知中的前端入口链接 |
| `MEDIA_ROOT` | `/app/media` | 图片媒体根目录，Docker 中挂载 `love_book_media` volume |
| `MEDIA_STORAGE` | `local` | 当前图片存储后端 |
| `SMTP_*` | 邮件服务配置 | 用于事件 / 评论通知 |
| `AMAP_MAPS_API_KEY` | 高德 Web 服务 Key | `/todo` 餐厅搜索、详情解析和附近抽奖使用；管理端可覆盖保存 |
| `LLM_OPENAI_BASE_URL` / `LLM_ANTHROPIC_BASE_URL` | 模型服务地址 | 管理端获取模型列表和测试连接使用；管理端可覆盖保存 |
| `LLM_API_KEY` | 模型服务 Key | 初始模型 token；管理端可覆盖保存 |
| `LLM_PROTOCOL` / `LLM_MODEL` | `openai` / 模型 ID | 初始全站模型配置；管理端可覆盖保存 |
前端生产请求通过 `NEXT_PUBLIC_API_BASE=/api` 走同源 Caddy 反代。管理端复制入口链接不再依赖 `NEXT_PUBLIC_APP_URL`，因此换域名或 HTTP/HTTPS 协议时不需要为了复制链接重建前端。

管理端 AI / 模型配置会写入数据库，包含协议、OpenAI / Anthropic 地址、token、选中模型和高德 key。迁移服务器时需要和业务数据一起备份数据库；`.env` 仍作为首次初始化和配置缺失时的兜底来源。

## 4. 部署命令

```bash
./deploy.sh check
./deploy.sh up
```

常用命令：

```bash
./deploy.sh status
./deploy.sh logs
./deploy.sh logs caddy
./deploy.sh restart
./deploy.sh down
./deploy.sh build
```

`./deploy.sh up` 会执行 `docker compose up -d --build --remove-orphans`。首次启动时 Caddy 会自动向 Let's Encrypt 申请证书，并把证书数据持久化到 Docker volume `caddy_data` / `caddy_config`；后端图片媒体文件会持久化到 `love_book_media`。

### 4.1 服务器预构建镜像一键部署

服务器只需要 Docker，不需要仓库源码构建时，先在服务器准备一个不提交到 Git 的 `server.env`：

```bash
ADMIN_KEY=your-admin-key
DATABASE_URL=mysql+pymysql://db_user:PASSWORD_URL_ENCODED@db.example.com:3306/love_book?charset=utf8mb4
MYSQL_PASSWORD=your-mysql-password
SMTP_PASS=your-smtp-auth-code
APP_WEB_URL=https://qrqto.club

MYSQL_HOST=db.example.com
MYSQL_PORT=3306
MYSQL_USER=db_user
MYSQL_DATABASE=love_book
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=you@example.com
SMTP_FROM=you@example.com
SMTP_FROM_NAME=Love Book
SMTP_USE_SSL=1

AMAP_MAPS_API_KEY=your-amap-key
LLM_OPENAI_BASE_URL=https://api.example.com/v1
LLM_ANTHROPIC_BASE_URL=https://api.example.com/anthropic
LLM_API_KEY=your-llm-key
LLM_PROTOCOL=openai
LLM_MODEL=mimo-v2.5-pro
```

然后执行：

```bash
chmod +x deploy_server.sh
./deploy_server.sh --env-file ./server.env up
```

脚本默认生成到 `/opt/love_book`，可用 `PROJECT_DIR=/path/to/app` 覆盖。生成的 Compose 会使用 `love_book_media:/app/media` 保存图片媒体文件，不再使用旧 `UPLOAD_DIR` / `./uploads:/app/uploads` 配置。

## 5. 验收地址

| 地址 | 期望 |
| --- | --- |
| `https://qrqto.club/` | Next.js 登录页 |
| `https://qrqto.club/admin` | 管理控制台 |
| `https://qrqto.club/docs` | FastAPI Swagger UI |
| `https://qrqto.club/api/auth/me`（带 token） | 返回当前用户 JSON |

管理后台“复制入口链接”在 `https://qrqto.club/admin` 下应复制出 `https://qrqto.club/?token=...`；如果通过 `http://.../admin` 或本地开发地址访问，则会按当前页面的协议和域名生成链接。Clipboard API 不可用时仍会使用隐藏 textarea 降级复制。

## 6. Caddy 反向代理

当前 `deploy/caddy/Caddyfile` 的关键行为：

- `qrqto.club, www.qrqto.club` 自动启用 HTTPS。
- `/api` 和 `/api/*` 去掉 `/api` 前缀后转发到 `backend:8000`。
- `/docs`、`/openapi.json` 转发到后端。
- 其它所有路由转发到 `frontend:3000`。

修改 Caddyfile 后执行：

```bash
./deploy.sh restart
```

## 7. 数据库与媒体

应用启动时 `app.core.database.init_db()` 会自动建表，并对老库做轻量补列。新上传图片的原图和缩略图写入 `MEDIA_ROOT`，数据库只保存 `images.storage_key` / `images.thumb_storage_key` 等相对 key 和元数据；旧 `images.data` / `images.thumb_data` BLOB 记录仍可回退读取。

历史图片迁出数据库时，先备份数据库和 `love_book_media` volume，再执行：

```bash
python scripts/migrate_images_to_media.py
```

旧“爱的回执”升级为收礼事件时，可在挂载生产媒体卷的后端容器中先审计再执行：

```bash
python3 scripts/migrate_love_receipts_to_gifts.py
python3 scripts/migrate_love_receipts_to_gifts.py --apply
```

命令会保留旧表和旧媒体，只为标准事件创建确定性文件副本与唯一图片映射；返回的 `unmapped_legacy_images` 应为 `0`。

默认只导出文件并回填 key，不清空旧 BLOB。确认接口读取正常后，可执行：

```bash
python scripts/migrate_images_to_media.py --clear-blobs --compact
```

迁移服务器时必须同时备份数据库和 `love_book_media` volume，否则新图片文件会丢失。生产每周备份、Windows 手工拉取、季度恢复演练和正式恢复步骤统一见 [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md)。

语音能力已经移除。已有部署中的 `voices` 表和 `MEDIA_ROOT/voices` 文件会作为不可达备份保留，升级过程不会自动删除；如需清理，必须先备份数据库和 `love_book_media` volume，再由运维显式处理。

后端镜像安装 Node.js 22 以运行 `@amap/amap-maps-mcp-server` 高德 MCP，图片缩略图依赖 Python 包 `Pillow`。

## 8. 故障排查

| 现象 | 排查 |
| --- | --- |
| Caddy 无法签发证书 | 确认 `qrqto.club` / `www.qrqto.club` DNS 指向本机，公网 80/443 未被拦截 |
| HTTPS 打不开 | 查看 `./deploy.sh logs caddy`，确认 Caddy 容器已启动且端口映射正常 |
| 前端能打开但 `/api/*` 失败 | 检查 `deploy/caddy/Caddyfile` 的 `/api` 反代和 backend 容器状态 |
| 邮件链接还是 localhost 或旧域名 | 修改 `.env` 的 `APP_WEB_URL=https://qrqto.club` 后重启 backend |
| 管理后台复制出的域名不对 | 确认浏览器当前访问的就是目标域名；复制逻辑使用当前页面 origin |
| 数据库连接 timeout | 在宿主机确认 MySQL 地址、端口、用户授权和安全组规则 |

## 9. 当前部署相关文件

| 功能 | 文件 |
| --- | --- |
| Docker 编排 | `docker-compose.yml` |
| 图片媒体与旧媒体备份 volume | `docker-compose.yml` 的 `love_book_media:/app/media` |
| 备份与恢复手册 | `BACKUP_RESTORE.md` |
| 服务器备份工具 | `scripts/love_book_backup.sh` / `scripts/setup_love_book_backup.sh` |
| Windows 拉取与恢复校验 | `scripts/pull_love_book_backup.ps1` / `scripts/verify_backup_restore.py` |
| 历史图片迁移 | `scripts/migrate_images_to_media.py` |
| Caddy HTTPS 与反代 | `deploy/caddy/Caddyfile` |
| 本机构建部署脚本 | `deploy.sh` / `deploy.bat` |
| 服务器预构建镜像部署脚本 | `deploy_server.sh` |
| 前端 API 同源配置 | `docker-compose.yml` 的 `NEXT_PUBLIC_API_BASE=/api` |
| 管理端动态入口链接 | `web/src/app/admin/page.tsx` |
| 邮件入口域名 | `.env` / `.env.example` 的 `APP_WEB_URL` |

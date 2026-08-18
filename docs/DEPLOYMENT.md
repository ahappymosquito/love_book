# Love Book 部署

本仓库用 Docker Compose 运行后端、前端和 Caddy。公网入口由 Caddy 暴露 80/443，并为 `qrqto.club`、`www.qrqto.club` 自动申请和续期 HTTPS 证书。

- **域名**：`qrqto.club`（含 `www.qrqto.club`）
- **公网入口**：Caddy 自动 HTTPS，`/api/*` 去掉 `/api` 前缀后反代到 FastAPI，其它请求反代到 Next.js
- **数据库**：由 `.env` 的 `DATABASE_URL` 提供连接信息；生产使用 MySQL，本地开发默认 SQLite
- **媒体文件**：图片原图和缩略图保存在后端 `/app/media`，由 Docker named volume `love_book_media` 持久化
- **管理员复制入口链接**：前端运行时读取浏览器当前 `window.location.origin`
- **邮件通知链接**：后端使用 `.env` 的 `APP_WEB_URL`，生产应设为 `https://qrqto.club`

生产更新和备份已经安装在服务器部署目录，不随本仓库分发。真实密码和 SMTP 授权码只放服务器 `.env`。

## 镜像构建与版本标签

本项目由根目录 `VERSION` 统一维护前后端语义化版本。GitHub Actions 只接受与该文件一致的完整稳定版标签 `vX.Y.Z`。

- 普通分支 push、pull request 和手动 dispatch 都不会构建或推送镜像。
- 本地创建标签不会触发远程构建；只有显式推送匹配标签时才会触发。
- 标签应指向已经通过测试、且 `VERSION`、前端清单和 Changelog 均一致的提交。
- 前后端版本镜像都成功后才会把同一稳定版本提升为 `latest`；普通 `master` push 不会移动 `latest`。

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
├── docker-compose.yml            # 后端 / 前端 / Caddy
├── deploy/
│   └── caddy/
│       └── Caddyfile             # 自动 HTTPS 和反向代理
├── web/
│   └── Dockerfile                # 前端镜像
├── .env                          # 实际运行配置，不提交
└── .env.example                  # 占位模板
```

## 2. 前置条件

服务器建议使用 Ubuntu 24.04 LTS，并满足：

| 组件 | 要求 |
| --- | --- |
| Docker Engine | 24.x 或更新，带 `docker compose` v2 |
| 公网 DNS | `qrqto.club`、`www.qrqto.club` 的 A / AAAA 记录指向本机 |
| 防火墙 | 公网可访问 80 和 443，供 Caddy 完成 ACME 校验和 HTTPS 访问 |
| 数据库 | 生产建议 MySQL 5.7+ / 8.x；本地可用 SQLite |

如果 80/443 已被其它服务占用，Caddy 无法启动或无法签发证书。

## 3. 配置 `.env`

```bash
cp .env.example .env
```

至少检查这些变量：

| 变量 | 推荐值 | 说明 |
| --- | --- | --- |
| `ADMIN_KEY` | 32 位以上随机字符串 | 管理后台密钥 |
| `DATABASE_URL` | `mysql+pymysql://user:pass@host:3306/love_book?charset=utf8mb4` | 数据库连接，密码特殊字符需 URL 编码 |
| `APP_WEB_URL` | `https://qrqto.club` | 邮件通知中的前端入口链接 |
| `MEDIA_ROOT` | `/app/media` | 图片媒体根目录 |
| `MEDIA_STORAGE` | `local` | 当前图片存储后端 |
| `SMTP_*` | 你自己的邮件服务 | 用于事件 / 评论通知 |
| `AMAP_MAPS_API_KEY` | 高德 Web 服务 Key | `/todo` 搜索与附近抽奖；管理端可覆盖 |
| `LLM_*` | 你自己的模型服务 | 管理端获取模型列表和测试连接 |

真实密钥只放 `.env` 或服务器环境变量。管理端 AI / 模型配置会写入数据库，迁移服务器时需要和业务数据一起备份。

## 4. 部署命令

从源码构建并启动：

```bash
docker compose up -d --build --remove-orphans
```

使用已发布的 GHCR 镜像时，把 `docker-compose.yml` 中的 `build` 换成对应版本标签，或用 override 指定：

```yaml
services:
  backend:
    image: ghcr.io/ahappymosquito/love_book-backend:0.9.0
  frontend:
    image: ghcr.io/ahappymosquito/love_book-frontend:0.9.0
```

常用命令：

```bash
docker compose ps
docker compose logs -f
docker compose logs -f caddy
docker compose restart
docker compose down
```

`docker compose down` 会停止容器并保留 named volume。禁止对生产执行 `docker compose down -v`。

首次启动时 Caddy 会自动向 Let's Encrypt 申请证书，并把证书数据持久化到 `caddy_data` / `caddy_config`；后端图片媒体文件会持久化到 `love_book_media`。

## 5. 验收地址

| 地址 | 期望 |
| --- | --- |
| `https://qrqto.club/` | Next.js 登录页 |
| `https://qrqto.club/admin` | 管理控制台 |
| `https://qrqto.club/docs` | FastAPI Swagger UI |
| `https://qrqto.club/api/auth/me`（带 token） | 返回当前用户 JSON |

管理后台“复制入口链接”按当前页面的协议和域名生成。Clipboard API 不可用时使用隐藏 textarea 降级复制。

## 6. Caddy 反向代理

当前 `deploy/caddy/Caddyfile` 的关键行为：

- `qrqto.club, www.qrqto.club` 自动启用 HTTPS。
- `/api` 和 `/api/*` 去掉 `/api` 前缀后转发到 `backend:8000`。
- `/docs`、`/openapi.json` 转发到后端。
- 其它所有路由转发到 `frontend:3000`。

修改 Caddyfile 后执行 `docker compose restart caddy`。

## 7. 数据库与媒体

应用启动时 `app.core.database.init_db()` 会自动建表，并对老库做轻量补列。新上传图片写入 `MEDIA_ROOT`，数据库只保存相对 storage key；旧 BLOB 记录仍可回退读取。

迁移服务器时必须同时备份数据库和 `love_book_media` volume。语音能力已经移除；已有部署中的 `voices` 表和文件会作为不可达备份保留。

后端镜像安装 Node.js 22 以运行高德 MCP，图片缩略图依赖 Pillow。

## 8. 故障排查

| 现象 | 排查 |
| --- | --- |
| Caddy 无法签发证书 | 确认 DNS 指向本机，公网 80/443 未被拦截 |
| HTTPS 打不开 | 查看 `docker compose logs caddy`，确认容器和端口映射 |
| 前端能打开但 `/api/*` 失败 | 检查 Caddyfile 的 `/api` 反代和 backend 状态 |
| 邮件链接还是 localhost | 修改 `.env` 的 `APP_WEB_URL` 后重启 backend |
| 数据库连接 timeout | 确认 MySQL 地址、端口、用户授权和安全组 |

## 9. 当前部署相关文件

| 功能 | 文件 |
| --- | --- |
| Docker 编排 | `docker-compose.yml` |
| 图片媒体 volume | `love_book_media:/app/media` |
| 备份与恢复说明 | [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) |
| Caddy HTTPS 与反代 | `deploy/caddy/Caddyfile` |
| 前端 API 同源配置 | `NEXT_PUBLIC_API_BASE=/api` |
| 邮件入口域名 | `.env` 的 `APP_WEB_URL` |

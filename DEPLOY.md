# 我们之间的小事 · 部署文档

本仓库支持 Docker Compose 一键部署：后端、前端和 Caddy 三个容器共同运行。公网入口由 Caddy 暴露 80/443，并为 `qrqto.club`、`www.qrqto.club` 自动申请和续期 HTTPS 证书。

- **域名**：`qrqto.club`（含 `www.qrqto.club`）
- **公网入口**：Caddy 自动 HTTPS，`/api/*` 去掉 `/api` 前缀后反代到 FastAPI，其它请求反代到 Next.js
- **MySQL**：由 `.env` 的 `DATABASE_URL` 提供连接信息，示例使用 `qrqto.club:3306`
- **管理员复制入口链接**：前端运行时读取浏览器当前 `window.location.origin`，访问 HTTP 就复制 HTTP，访问 HTTPS 就复制 HTTPS
- **邮件通知链接**：后端仍使用 `.env` 的 `APP_WEB_URL`，生产环境应设置为 `https://qrqto.club`

## 1. 目录结构

```text
.
├── Dockerfile                    # 后端镜像
├── docker-compose.yml            # 后端 / 前端 / Caddy 三件套
├── deploy.sh                     # Linux 部署脚本
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
| `SMTP_*` | 邮件服务配置 | 用于事件 / 评论通知 |
前端生产请求通过 `NEXT_PUBLIC_API_BASE=/api` 走同源 Caddy 反代。管理端复制入口链接不再依赖 `NEXT_PUBLIC_APP_URL`，因此换域名或 HTTP/HTTPS 协议时不需要为了复制链接重建前端。

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

`./deploy.sh up` 会执行 `docker compose up -d --build --remove-orphans`。首次启动时 Caddy 会自动向 Let's Encrypt 申请证书，并把证书数据持久化到 Docker volume `caddy_data` / `caddy_config`。

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

应用启动时 `app.core.database.init_db()` 会自动建表，并对老库做轻量补列。图片直接存入数据库 `images.data`，语音直接存入数据库 `voices.data`（MySQL / MariaDB 为 `LONGBLOB`，SQLite 为 `BLOB`）；生产部署不再需要 `uploads/` 目录、`UPLOAD_DIR` 或上传目录 volume。旧语音记录如果没有 `voices.data`，下载接口会返回 `404`。

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
| Caddy HTTPS 与反代 | `deploy/caddy/Caddyfile` |
| 部署脚本 | `deploy.sh` / `deploy.bat` |
| 前端 API 同源配置 | `docker-compose.yml` 的 `NEXT_PUBLIC_API_BASE=/api` |
| 管理端动态入口链接 | `web/src/app/admin/page.tsx` |
| 邮件入口域名 | `.env` / `.env.example` 的 `APP_WEB_URL` |

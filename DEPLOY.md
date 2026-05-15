# 我们之间的小事 · 部署文档

本仓库支持 docker-compose 一键部署：后端 / 前端 / nginx 三个容器全部以 `ubuntu:24.04` 为底层镜像，对外通过 nginx 暴露 80/443。

- **域名**：`db.example.com`（含 `www.db.example.com`）
- **MySQL**：使用宿主 `db.example.com:3306` 上已经在跑的实例，由 `.env` 提供凭据
- **图片存储**：图片二进制直接进 `images.data`（BLOB / LONGBLOB），不再依赖磁盘
- **上传持久化**：仅语音 (`voices/*`) 落 `./uploads`，挂宿主机持久化
- **管理员复制操作**：「复制入口链接」/ 邮件通知链接均使用 `https://db.example.com`，用户拷贝后直接可用

---

## 1. 目录结构（与部署相关的部分）

```
.
├── Dockerfile                    # 后端镜像（ubuntu:24.04 + python3）
├── docker-compose.yml            # 后端 / 前端 / nginx 三件套
├── .dockerignore
├── deploy.sh                     # Linux 部署脚本（check / build / up / down / logs ...）
├── deploy.bat                    # Windows 包装，自动转发到 git-bash / wsl
├── deploy/
│   └── nginx/
│       ├── nginx.conf            # 主配置（gzip、超时、上游池）
│       ├── conf.d/
│       │   ├── db.example.com.conf  # 站点 server 块
│       │   └── _app.locations    # 反向代理 location 片段（include 进 server）
│       └── certs/                # TLS 证书放这里
├── web/
│   ├── Dockerfile                # 前端镜像（ubuntu:24.04 + Node 20）
│   ├── .dockerignore
│   └── ...
├── uploads/                      # 语音持久化目录（compose 挂载点）
├── .env                          # 真正生效的运行期配置
└── .env.example                  # 配置模板
```

---

## 2. 先决条件

服务器（建议 Ubuntu 24.04 LTS）需要：

| 组件 | 版本 | 备注 |
| --- | --- | --- |
| Docker Engine | ≥ 24.x | 自带 `docker compose` v2 |
| MySQL 实例 | 5.7+ / 8.x | 监听 0.0.0.0:3306，库名 `love_book` |
| 公网域名 DNS | A / AAAA | `db.example.com`、`www.db.example.com` 指向本机 |
| 防火墙 | 80 / 443 / 3306 | 80/443 对外，3306 至少允许本机出口 |

> 若 MySQL 与 Web 同机部署，建议把 `bind-address = 0.0.0.0`，并给 `db_user` 用户授权 `db.example.com / %` 主机访问。

---

## 3. 配置 `.env`

```bash
cp .env.example .env
vim .env
```

至少检查 / 修改：

| 变量 | 必填 | 推荐值 | 说明 |
| --- | :-: | --- | --- |
| `ADMIN_KEY` | ✅ | 32 位随机串 | 管理后台密钥，避免默认 / 弱口令 |
| `DATABASE_URL` | ✅ | `mysql+pymysql://user:pass@db.example.com:3306/love_book?charset=utf8mb4` | 密码中的特殊字符须 URL 编码（`!` → `%21`） |
| `APP_WEB_URL` | ✅ | `https://db.example.com` | 邮件链接 & 前端 `NEXT_PUBLIC_APP_URL` 共同来源 |
| `SMTP_*` | 建议 | QQ / 阿里云邮件等 | 用于事件 / 评论通知 |
| `MYSQL_HOST` | 工具脚本用 | `db.example.com` | 仅迁移脚本 / DB 工具会读 |
| `UPLOAD_DIR` | 留空即可 | `uploads` | compose 内部会强制覆盖为 `/app/uploads` |
| `MAX_VOICE_BYTES` | 否 | `10485760` | 单条语音字节上限 |
| `MAX_IMAGE_BYTES` | 否 | `10485760` | 单张图片字节上限（BLOB） |

`docker-compose.yml` 会在 build 时读取 `.env` 里的 `APP_WEB_URL`，把它作为 `NEXT_PUBLIC_APP_URL` 注入前端 bundle；同时把 `NEXT_PUBLIC_API_BASE` 固定为 `/api`，前端用同源相对路径访问后端。

---

## 4. 一键部署

### 4.1 打包前自检

```bash
./deploy.sh check
```

脚本会校验：

- `docker`、`docker compose` 可用
- `.env` 存在且 `ADMIN_KEY` / `DATABASE_URL` / `APP_WEB_URL` 非空
- `APP_WEB_URL` 不是 `localhost / 127.0.0.1`
- `DATABASE_URL` 使用 `mysql+pymysql`
- 关键文件（`Dockerfile` / `web/Dockerfile` / nginx 配置）齐全
- 宿主 80/443 端口空闲

### 4.2 构建 + 启动

```bash
./deploy.sh up
```

等价于 `docker compose up -d --build --remove-orphans`。首次启动会构建两个 ubuntu:24.04 镜像（后端 ≈ 250MB，前端 ≈ 500MB，依网络而定）。

### 4.3 其他常用命令

```bash
./deploy.sh status     # 查看容器状态
./deploy.sh logs       # 跟随全部日志
./deploy.sh logs backend
./deploy.sh restart    # 重启
./deploy.sh down       # 停止并移除容器（不删数据卷）
./deploy.sh build      # 仅重新构建
```

### 4.4 验收清单

启动后访问以下地址确认：

| 路径 | 期望 |
| --- | --- |
| `http://db.example.com/` | Next.js 登录页（3D 小狗） |
| `http://db.example.com/admin` | 管理控制台（输入 `ADMIN_KEY`） |
| `http://db.example.com/docs` | FastAPI Swagger UI |
| `http://db.example.com/api/auth/me` (带 token) | 返回用户 JSON |

> 管理后台「复制入口链接」按钮拷贝出的形如 `https://db.example.com/?token=...`，用户在任意浏览器粘贴即可登录。

---

## 5. 启用 HTTPS

部署初期可仅监听 80；上线后强烈建议启用 HTTPS。

### 5.1 用 certbot 申请证书

```bash
mkdir -p deploy/nginx/webroot deploy/nginx/certs

docker run --rm -it \
  -v "$PWD/deploy/nginx/certs:/etc/letsencrypt" \
  -v "$PWD/deploy/nginx/webroot:/var/www/certbot" \
  -p 80:80 \
  certbot/certbot certonly --standalone \
  -d db.example.com -d www.db.example.com \
  --agree-tos -m admin@db.example.com --no-eff-email
```

申请成功后把证书拷到 `deploy/nginx/certs/`，重命名为：

```
deploy/nginx/certs/db.example.com.crt   # fullchain
deploy/nginx/certs/db.example.com.key   # privkey
```

### 5.2 打开 nginx 的 443 段

编辑 `deploy/nginx/conf.d/db.example.com.conf`：

1. 取消 `return 301 https://$host$request_uri;` 的注释（强制 80 跳转）
2. 取消整段 `server { listen 443 ssl http2; ... }` 注释

### 5.3 重启

```bash
./deploy.sh restart
```

---

## 6. 数据库 & 上传

### 6.1 表结构

应用启动时 `app.core.database.init_db()` 会：

1. `Base.metadata.create_all(...)`：自动建表
2. `_ensure_columns(...)`：对老库做增量列迁移（含 `images.data` LONGBLOB）

如果数据库已经有内容，无需手动迁移；脚本会自动 ALTER TABLE 加列。

### 6.2 图片：直接走数据库 BLOB

> 当前业务里**图片只走数据库**，不再落磁盘。`images` 表新增列 `data`：
>
> - MySQL / MariaDB → `LONGBLOB NULL`
> - SQLite → `BLOB NULL`

```sql
-- 用 SQL 客户端手工插入一张图片，举例：
-- 1. 准备：找到要绑定的 event_id / author_id
-- 2. 用 LOAD_FILE 读本机磁盘上的图片（需要 secure_file_priv 配置允许）
INSERT INTO images (event_id, author_id, file_path, data, mime_type, size_bytes, width, height, created_at)
VALUES (
  42,                       -- event_id
  3,                        -- author_id（必须属于该 event 所在 pair）
  '',                       -- file_path 保留占位，可空字符串
  LOAD_FILE('/var/lib/mysql-files/cat.jpg'),
  'image/jpeg',
  COALESCE(OCTET_LENGTH(LOAD_FILE('/var/lib/mysql-files/cat.jpg')), 0),
  1280,                     -- width，可空
  720,                      -- height，可空
  UTC_TIMESTAMP()
);
```

如果不方便用 `LOAD_FILE`，也可以：

- 用 DBeaver / Navicat / DataGrip 的「编辑列」直接把本地图片粘贴到 `data` 列
- 或者 base64 编码后 `INSERT INTO images (..., data) VALUES (..., UNHEX('...'))`
- 或者直接走 API：`POST /events/{event_id}/images`（multipart 上传），后端会自动写到 `data`

字段说明：

| 列 | 必须 | 说明 |
| --- | :-: | --- |
| `event_id` | ✅ | 关联事件 |
| `author_id` | ✅ | 上传者用户 id，必须属于该 event 所在 pair |
| `file_path` | ✅（占位） | 老字段，新数据写 `''` 即可 |
| `data` | ✅（新数据） | 真正的图片字节 |
| `mime_type` | 建议 | 默认 `application/octet-stream`，前端 `<img>` 会按响应头识别 |
| `size_bytes` | 建议 | 不填默认 0，仅用于前端展示 |
| `width / height` | 否 | 仅用于前端布局 |
| `created_at` | ✅ | UTC 时间 |

读取链路：

```
GET /api/images/{id}/file
    └─ ensure_image_file_visible() 检查 pair 可见性
    └─ image.data 存在  →  Response(content=image.data, media_type=image.mime_type)
    └─ image.data 为空  →  回退到 image.file_path 的磁盘文件（旧数据）
```

### 6.3 语音：仍然走磁盘

语音文件仍写入容器内 `/app/uploads/voices/...`，通过 `./uploads:/app/uploads` 挂载到宿主机。如果今后希望语音也入库，可以参考图片的 BLOB 改造。

### 6.4 备份建议

| 数据 | 路径 | 备份频率 |
| --- | --- | --- |
| MySQL（含图片 BLOB） | 远端 / 本机 MySQL 数据目录 | 至少每天 mysqldump 一次 |
| 语音文件 | `./uploads/voices/...` | 与 DB 同节奏 rsync |

> 提醒：图片入 BLOB 后单表会迅速膨胀，请把 `innodb_file_per_table=1` 打开，并定期 `OPTIMIZE TABLE images` 或归档老数据。

---

## 7. 升级 / 回滚

```bash
# 拉新代码
git pull
# 重新打包前端 + 重启
./deploy.sh up

# 回滚到上一版
git checkout <old-sha>
./deploy.sh up
```

注意：

- 前端的 `NEXT_PUBLIC_*` 是 build 阶段烘焙的，**改 `.env` 中 `APP_WEB_URL` 后必须重新 build 前端镜像**（直接 `./deploy.sh up` 会触发 rebuild，不要只 restart）。
- 如果改了 `DATABASE_URL` 指向新库，建议先 `./deploy.sh down`，再 `up`，避免老连接残留。

---

## 8. 故障排查速查表

| 现象 | 排查方向 |
| --- | --- |
| 前端能打开，调用 `/api/*` 404 | nginx 的 `conf.d/_app.locations` 是否被 include 进了 server 块 |
| `docs` 打不开 | 后端容器是否健康（`./deploy.sh status`），`docker logs love-book-backend` |
| 邮件链接还是 `http://localhost:3000` | `.env` 里 `APP_WEB_URL` 未改成 `https://db.example.com`，或后端容器没重启 |
| 管理后台拷贝出来的是 `http://localhost...` | 前端镜像没用新 `APP_WEB_URL` rebuild，跑 `./deploy.sh up` 触发重 build |
| 图片上传 200 但显示「无法加载」 | 1) 检查 `images.data` 是否存进字节；2) 浏览器 Network 看 `/api/images/{id}/file` 状态 |
| 数据库连接 timeout | 容器外 `mysql -h db.example.com -u ... -p` 能否登录；MySQL `bind-address` 是否 0.0.0.0；用户白名单 |
| nginx 起不来 / 50x | `docker logs love-book-nginx`，检查 `deploy/nginx/conf.d/db.example.com.conf` 语法 |
| 客户端真实 IP 全是 `172.x.x.x` | 后端已开 `--proxy-headers --forwarded-allow-ips=*`，nginx 已下发 `X-Forwarded-*`，应当 OK；若仍异常请检查 `client_ip()` 解析顺序 |

---

## 9. 用 GitHub Actions 自动构建镜像

仓库内置 `.github/workflows/docker-build.yml`，触发条件：

- `push` 到 `master` / `main` / 任意 `v*` 标签 → 自动构建并推送
- `pull_request` → 仅构建不推送（验证 Dockerfile 不挂掉）
- `workflow_dispatch` → 手动触发，可临时覆盖 `NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_APP_URL`

镜像默认推送到 GHCR：

```
ghcr.io/<owner>/<repo>-backend:latest
ghcr.io/<owner>/<repo>-backend:sha-<short>
ghcr.io/<owner>/<repo>-frontend:latest
ghcr.io/<owner>/<repo>-frontend:sha-<short>
```

可选的仓库变量（Settings → Secrets and variables → Actions → Variables）：

| 变量名 | 作用 |
| --- | --- |
| `NEXT_PUBLIC_API_BASE` | 前端 build args，覆盖默认的 `/api` |
| `NEXT_PUBLIC_APP_URL` | 前端 build args，覆盖默认的 `https://db.example.com` |

> GHCR 默认对仓库 Collaborator 开放，外部拉取需要先在 Package settings 里把可见性改为 Public，或在拉取机器上执行 `docker login ghcr.io`。

### 直接使用 CI 镜像部署

服务器端可以跳过本地 build，直接 pull 用：

```bash
docker login ghcr.io        # 私有包才需要
docker compose pull         # 配合下面的 image 覆写
docker compose up -d
```

在服务器上创建 `docker-compose.override.yml`（不进仓库）：

```yaml
services:
  backend:
    image: ghcr.io/<owner>/<repo>-backend:latest
    build: !reset null
  frontend:
    image: ghcr.io/<owner>/<repo>-frontend:latest
    build: !reset null
```

这样 `docker compose up -d` 就会直接拉 GHCR 镜像，跳过本地构建步骤。

---

## 10. 关键改动备忘（v0.3 部署版）

| 改动 | 文件 |
| --- | --- |
| 后端镜像 ubuntu:24.04 + python3 + uvicorn | `Dockerfile` |
| 前端镜像 ubuntu:24.04 + Node 20 + 多阶段 build | `web/Dockerfile` |
| 三服务编排 | `docker-compose.yml` |
| nginx 反代 `/api/*` + Next.js | `deploy/nginx/*` |
| 前端 `API_BASE` 改为相对路径 `/api` | `web/src/lib/api.ts` |
| 入口链接优先用 `NEXT_PUBLIC_APP_URL` | `web/src/app/admin/page.tsx` |
| 图片改入数据库 BLOB | `app/models.py` / `app/api/routes/contents.py` / `app/services.py` |
| 自动列迁移 `images.data` | `app/core/database.py` |
| `.env` 邮件域名指向 `https://db.example.com` | `.env` / `.env.example` |

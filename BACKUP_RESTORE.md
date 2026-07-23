# Love Book 备份与恢复

本文档说明生产服务器 `ts3_qrqto` 上 `love_book` MySQL 数据库、`/app/media` Docker volume 和生产 `.env` 的低成本备份方案。Caddy 的 `caddy_data` / `caddy_config` 不在备份范围内，灾备时由 Caddy 重新签发证书。

## 恢复目标与已接受风险

- 每周一 04:00 在线备份，最多可能丢失约 7 天数据。
- 先导出数据库、再归档媒体；备份期间不停止 backend，因此数据库和媒体之间是 best-effort 一致性。
- 服务器与 Windows 各保留最近 4 份，Windows 由用户每周手工拉取。
- SQL、私人媒体和生产 `.env` 均为明文。服务器目录必须为 `0700`，Windows 目录必须只允许当前用户访问。
- 没有主动失败告警；Windows 拉取脚本会拒绝超过 8 天的备份。

## 服务器一次性配置

### 1. 授予受信运维用户 Docker 权限

`docker` 组可通过挂载宿主路径或启动特权容器取得等同 root 的控制能力，只能授予受信运维账号：

```bash
sudo usermod -aG docker ts3
```

执行后退出 SSH 并重新登录，再确认：

```bash
docker info
docker inspect love-book-backend
```

### 2. 创建 MySQL 只读备份账号

使用 MySQL 管理账号执行，其中密码应使用随机强密码：

```sql
CREATE USER 'love_book_backup'@'localhost' IDENTIFIED BY 'REPLACE_WITH_RANDOM_PASSWORD';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON love_book.* TO 'love_book_backup'@'localhost';
```

MySQL 8.0.20 及以上可另外授予存储过程元数据读取权限；不支持该权限的 MySQL/MariaDB 跳过这一句：

```sql
GRANT SHOW_ROUTINE ON *.* TO 'love_book_backup'@'localhost';
```

为 `ts3` 创建 `/home/ts3/.my.cnf`：

```ini
# Love Book mysqldump-only client credentials.
[client]
host=127.0.0.1
port=3306
user=love_book_backup
password=REPLACE_WITH_RANDOM_PASSWORD
```

然后执行：

```bash
chmod 600 /home/ts3/.my.cnf
```

### 3. 安装脚本和 cron

把以下文件上传到服务器同一临时目录：

- `scripts/love_book_backup.sh`
- `scripts/setup_love_book_backup.sh`

以 `ts3` 执行：

```bash
chmod 700 setup_love_book_backup.sh love_book_backup.sh
./setup_love_book_backup.sh
```

安装器会：

- 把备份程序安装为 `/home/ts3/bin/love-book-backup`；
- 创建权限为 `0700` 的 `/home/ts3/backups/love_book`；
- 准备固定版本 `alpine:3.22` 归档镜像；
- 安装 `0 4 * * 1` 的用户 crontab，并把输出追加到 `backup.log`。

首次安装后立即生成并检查一份周备份：

```bash
/home/ts3/bin/love-book-backup weekly
find /home/ts3/backups/love_book -mindepth 2 -maxdepth 2 -name SUCCESS -print
tail -n 100 /home/ts3/backups/love_book/backup.log
```

发布前或事故现场备份分别使用：

```bash
/home/ts3/bin/love-book-backup pre-release
/home/ts3/bin/love-book-backup emergency
```

脚本通过 `love-book-backend` 的 `/app/media` 挂载动态获取真实 volume 名，也从 Compose label 获取生产 `.env`，不会假设 volume 的项目名前缀。

每个成功恢复点包含：

```text
YYYYMMDDTHHMMSSZ_weekly/
├── love_book.sql.gz
├── love_book_media.tar.gz
├── production.env
├── metadata.txt
├── manifest.sha256
└── SUCCESS
```

只有 SQL 完成标记、gzip、tar 和 SHA-256 均验证成功后才会原子发布恢复点。成功周备份保留最近 4 个，并清理已经被本次周备份覆盖的发布前恢复点。

## Windows 手工拉取

从仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pull_love_book_backup.ps1
```

默认通过 `ts3_qrqto` 拉取到 `C:\Backups\love_book`。脚本会：

- 查找服务器最新的 `SUCCESS` 恢复点；
- 拒绝超过 8 天的恢复点；
- 先下载到 `.partial`，校验全部 SHA-256 后再改名；
- 收紧目标目录 NTFS ACL；
- 保留最近 4 个已验证恢复点。

参数可显式覆盖：

```powershell
.\scripts\pull_love_book_backup.ps1 `
  -SshAlias ts3_qrqto `
  -LocalRoot C:\Backups\love_book `
  -Keep 4 `
  -MaximumAgeDays 8
```

## 每季度恢复演练

演练必须使用临时数据库和临时 volume，不得覆盖生产。

1. 选择恢复点并验证：

   ```bash
   cd /home/ts3/backups/love_book/RESTORE_POINT
   sha256sum -c manifest.sha256
   gzip -t love_book.sql.gz
   tar -tzf love_book_media.tar.gz >/dev/null
   ```

2. 使用 MySQL 管理账号创建临时数据库并导入：

   ```bash
   mysql -u root -p -e \
     "DROP DATABASE IF EXISTS love_book_restore_test; CREATE DATABASE love_book_restore_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   gzip -cd love_book.sql.gz | mysql -u root -p love_book_restore_test
   ```

3. 创建临时 volume 并恢复媒体：

   ```bash
   docker volume rm love_book_media_restore_test 2>/dev/null || true
   docker volume create love_book_media_restore_test
   docker run --rm \
     -v love_book_media_restore_test:/target \
     -v "$PWD:/backup:ro" \
     alpine:3.22 tar -xzf /backup/love_book_media.tar.gz -C /target
   ```

4. 从 `metadata.txt` 读取 `backend_image`。为临时数据库准备权限为 `0600` 的临时 env 文件，再运行只读验证：

   ```bash
   docker run --rm --network host \
     --env-file /path/to/restore-verify.env \
     -e MEDIA_ROOT=/app/media \
     -v love_book_media_restore_test:/app/media:ro \
     BACKEND_IMAGE_FROM_METADATA \
     python scripts/verify_backup_restore.py
   ```

   `restore-verify.env` 的 `DATABASE_URL` 必须指向 `love_book_restore_test`。验证器会输出关键表行数，并检查：

   - `users.avatar_storage_key`
   - `images.storage_key` / `thumb_storage_key`
   - `todo_images.storage_key` / `thumb_storage_key`
   - `love_receipt_images.storage_key` / `thumb_storage_key`

5. 验证健康接口和至少一条 Timeline 图片、头像、Todo 图片及爱心回执图片。演练完成后，确认目标名称无误再清理临时数据库、临时 volume 和临时 env。

## 正式恢复运行手册

正式恢复会覆盖生产数据，必须在执行前再次获得明确授权。

1. 确认目标恢复点的 SHA-256、时间、应用镜像版本和恢复范围。
2. 停止 backend，保留 frontend 与 Caddy：

   ```bash
   cd COMPOSE_WORKING_DIR
   docker compose stop backend
   ```

3. backend 停止后执行 `/home/ts3/bin/love-book-backup emergency`，并确认应急恢复点存在。
4. 按“每季度恢复演练”完整恢复到临时数据库和临时 volume；只有验证成功才能继续。
5. 记录脚本动态解析出的生产媒体 volume 名。重建 `love_book`、导入目标 SQL，并在严格核验 volume 名后清空其内容、解包目标媒体归档。
6. 将目标恢复点的 `production.env` 恢复为 Compose 工作目录 `.env`，权限设为 `0600`。
7. 启动 backend，检查 `/api/health`、登录、Timeline、头像、Todo 和爱心回执媒体。
8. 验收失败时保持 backend 停止，使用第 3 步的应急恢复点回滚数据库、媒体和 `.env`。

任何备份或恢复流程都禁止执行 `docker compose down -v`。清空生产数据库或 volume 的具体命令不封装为一键脚本，以确保每次都先核验目标并取得破坏性操作授权。

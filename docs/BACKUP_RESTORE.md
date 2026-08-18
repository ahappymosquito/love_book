# Love Book 备份与恢复

生产备份和更新工具已经安装在服务器部署目录，不随本仓库分发。本文记录当前实例的备份约定和恢复步骤。Caddy 的 `caddy_data` / `caddy_config` 不在备份范围内，灾备时由 Caddy 重新签发证书。

## 恢复目标与已接受风险

- 每周一 04:00 在线备份，最多可能丢失约 7 天数据。
- 先导出数据库、再归档媒体；备份期间不停止 backend，因此数据库和媒体之间是 best-effort 一致性。
- 服务器保留最近 4 份成功恢复点。
- SQL、私人媒体和生产 `.env` 均为明文，备份目录权限必须为 `0700`。
- 没有主动失败告警。

## 当前生产形态

生产 Compose 工作目录独立于 Git 仓库。日常更新走服务器上已安装的更新器；周备份由用户 crontab 调用已安装的备份程序。每个成功恢复点包含：

```text
YYYYMMDDTHHMMSSZ_weekly/
├── love_book.sql.gz
├── love_book_media.tar.gz
├── production.env
├── metadata.txt
├── manifest.sha256
└── SUCCESS
```

只有 SQL 完成标记、gzip、tar 和 SHA-256 均验证成功后才会原子发布恢复点。发布前或事故现场备份分别使用 `pre-release` 和 `emergency` 类型。

## 每季度恢复演练

演练必须使用临时数据库和临时 volume，不得覆盖生产。

1. 选择恢复点并验证：

   ```bash
   cd RESTORE_POINT
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

4. 从 `metadata.txt` 读取 `backend_image`。为临时数据库准备权限为 `0600` 的临时 env 文件，用该镜像启动只读 backend，核对：

   - `/api/health` 返回预期版本
   - `users.avatar_storage_key`
   - `images.storage_key` / `thumb_storage_key`
   - `todo_images.storage_key` / `thumb_storage_key`
   - 收礼事件图片 storage key

5. 验证至少一条 Timeline 图片、头像和 Todo 图片。演练完成后清理临时数据库、临时 volume 和临时 env。

## 正式恢复运行手册

正式恢复会覆盖生产数据，必须在执行前再次获得明确授权。

1. 确认目标恢复点的 SHA-256、时间、应用镜像版本和恢复范围。
2. 停止 backend，保留 frontend 与 Caddy：

   ```bash
   cd COMPOSE_WORKING_DIR
   docker compose stop backend
   ```

3. backend 停止后先做一次 `emergency` 备份，并确认应急恢复点存在。
4. 按“每季度恢复演练”完整恢复到临时数据库和临时 volume；只有验证成功才能继续。
5. 记录生产媒体 volume 名。重建业务库、导入目标 SQL，并在严格核验 volume 名后清空其内容、解包目标媒体归档。
6. 将目标恢复点的 `production.env` 恢复为 Compose 工作目录 `.env`，权限设为 `0600`。
7. 启动 backend，检查 `/api/health`、登录、Timeline、头像、Todo 和收礼媒体。
8. 验收失败时保持 backend 停止，使用第 3 步的应急恢复点回滚数据库、媒体和 `.env`。

任何备份或恢复流程都禁止执行 `docker compose down -v`。清空生产数据库或 volume 的具体命令不封装为一键脚本。

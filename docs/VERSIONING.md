# Love Book 版本与发布

`VERSION` 是 Love Book 前端、后端和容器镜像的唯一应用版本来源。`package-lock.json` 与 `poetry.lock` 中其余版本均为依赖版本。

## SemVer 规则

- patch（`0.3.0 -> 0.3.1`）：兼容的缺陷修复。
- minor（`0.3.1 -> 0.4.0`）：兼容的新功能。
- major（`1.4.0 -> 2.0.0`）：需要调用方或部署方配合的破坏性升级。
- 普通开发提交不修改 `VERSION`；没有对应 Git 标签的提交均为未发布代码。

## 日常开发

1. 从最新 `master` 创建功能分支。
2. 在 `CHANGELOG.md` 的 `Unreleased` 下记录用户可见改动、修复和数据库变化。
3. 运行 `python scripts/version.py check`、后端测试和前端构建。
4. 合并代码，但不为每个提交递增应用版本。

普通 push 和 pull request 由 `ci.yml` 验证版本、Poetry 锁文件、后端测试和前端生产构建，不会发布镜像。

## 准备发布

以下示例把本次版本准备为 `0.5.0`：

```powershell
# 1. 只编辑根 VERSION，并整理 CHANGELOG.md 的 Unreleased
python scripts/version.py sync
python scripts/version.py check --tag v0.5.0

# 2. 使用锁文件验证
poetry sync --no-root
poetry run python -m pytest -q --basetemp=.pytest-tmp-release-local
cmd /c "cd web && npm ci --no-audit --no-fund && npm run build"

# 3. 在干净容器上下文中构建候选镜像并做 HTTP 冒烟
docker build --build-arg APP_GIT_SHA=release-candidate -t love-book-backend:0.5.0-rc .
docker build --build-arg NEXT_PUBLIC_API_BASE=/api -t love-book-frontend:0.5.0-rc web

# 4. 只有候选镜像通过后，才创建发布提交与 annotated tag
git add VERSION CHANGELOG.md web/package.json web/package-lock.json
git commit -m "chore: release 0.5.0"
git tag -a v0.5.0 -m "Love Book 0.5.0"
```

候选镜像必须实际启动：后端 `/health` 需要返回候选版本和构建标识，前端首页需要返回 HTTP 200。只有明确推送 `vX.Y.Z` 标签才会发布 GHCR 镜像。发布工作流会拒绝与 `VERSION` 不一致的标签，并为前后端同时生成 `0.5.0` 与 `sha-xxxxxxx` 两类不可变标签；两套镜像都成功后才会把同一版本提升为稳定版 `latest` 并创建 GitHub Release。普通 `master` push 不会移动 `latest`。

## 生产部署与验证

生产 Compose 工作目录独立于 Git 仓库，更新器和备份程序已经安装在服务器上，不随本仓库分发。日常更新拉取前后端稳定版 `latest`，确认两套镜像的 OCI 版本标签完全一致，仅在发现新版本时创建 `pre-release` 恢复点，然后启动并验证 `/api/health` 和首页。`/api/health` 返回应用版本和完整 Git SHA。

```bash
curl -fsS https://qrqto.club/api/health
```

需要更强的供应链固定时，前后端应同时指定同一次发布生成的镜像 digest。

## 发布前备份

每次包含数据库变化的发布都要先备份数据库和 `love_book_media`。生产使用 [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) 中的已校验恢复点格式，备份文件放在服务器受保护目录，不提交仓库。确认恢复点包含 `SUCCESS` 后再部署。当前启动迁移只允许向前兼容地增加或扩展结构，不在启动时删除业务表、旧媒体或旧字段。

## 显式兼容版本

日常更新不自动回滚。仅在明确需要兼容旧环境时，前后端才一起指定同一版本镜像。切换后必须验证 `/api/health`。只有旧应用确实无法读取新数据库时，才按 [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) 在临时数据库和临时 volume 演练成功后恢复生产。

## 依赖更新

- 后端只通过 `pyproject.toml` 声明直接依赖，提交 `poetry.lock`；Docker 与 CI 使用 `poetry sync`。
- 前端提交 `package.json` 与 `package-lock.json`；Docker 与 CI 使用 `npm ci`。
- 依赖升级单独提交，并运行完整测试与构建；不要在普通功能提交中顺手刷新整个锁文件。

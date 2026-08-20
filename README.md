# Love Book

Love Book 是给两个人共同使用的私密生活手账：记录日常、见面和收到的礼物，一起完成 Todo，并维护习惯与周期日历。

![Version](https://img.shields.io/badge/version-0.7.0-cc6677)
![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB)
![Next.js](https://img.shields.io/badge/Next.js-15-black)

## 能做什么

- **时间线**：记录公开或双方提交后解锁的小事，支持评论、图片、表情回应和见面日期范围。
- **共同 Todo**：按吃喝、玩乐、住宿、许愿整理计划，可结合高德地点信息与可选 AI 分类。
- **习惯与周期**：双方可见的每日习惯进度、补打卡，以及只作记录参考的共享周期日历。
- **收礼事件**：收礼人直接记录礼物名称，可选补充正常反馈、最多 3 个真实感受标签、五分制评分和最多 6 张照片；照片会在时间线中成为这类事件的视觉重点。
- **个人与共享内容**：私有头像、个人资料、常用位置和情侣共享语录。
- **花田拾光**：未登录首页的全屏代码绘制小游戏，边跑边拾花瓣，和全站 Top 3 比一比；已登录会直接进入手账。
- **可自行部署**：FastAPI + Next.js + MySQL/SQLite，生产环境使用 Docker Compose、Caddy HTTPS 和媒体持久化。

## 快速开始

环境要求：Python 3.11+、Poetry 2.2+、Node.js 22+。

```powershell
Copy-Item .env.example .env
.\start_dev.bat --install
```

启动后访问：

- 前端：<http://localhost:3000>
- 后端健康检查：<http://127.0.0.1:8000/health>
- Swagger API 文档：<http://127.0.0.1:8000/docs>

依赖已安装时直接运行 `.\start_dev.bat`，不会重复安装。配置、高德和 LLM 说明见 [本地开发文档](docs/DEVELOPMENT.md)。

## 项目结构

```text
love_book/
├─ app/                 FastAPI 后端、数据库模型与业务服务
├─ web/                 Next.js 前端
├─ tests/               后端与版本回归测试
├─ scripts/             版本校验
├─ deploy/              Caddy 等部署配置
├─ docs/
│  ├─ ai/               产品与设计约束，供开发者和 AI 协作使用
│  └─ audits/           带日期的历史审计记录
├─ AGENTS.md            AI 协作规范与当前业务约定
├─ CHANGELOG.md         完整版本记录
└─ VERSION              应用版本唯一真相
```

## 文档导航

| 目的 | 文档 |
| --- | --- |
| 本地启动与开发 | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| API 与鉴权 | [docs/API_REFERENCE.md](docs/API_REFERENCE.md) |
| 生产部署 | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| 备份与恢复 | [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) |
| 版本与发布 | [docs/VERSIONING.md](docs/VERSIONING.md) |
| 产品与视觉上下文 | [docs/ai/PRODUCT.md](docs/ai/PRODUCT.md)、[docs/ai/DESIGN.md](docs/ai/DESIGN.md) |
| AI 开发约定 | [AGENTS.md](AGENTS.md) |

## 版本变化

### 0.7.0 · 2026-07-28

- 简化收礼时间线卡片，突出照片与核心信息，浏览更轻松。

### 0.6.0 · 2026-07-28

- 新增收礼人直接记录礼物、反馈、感受、评分和照片的收礼事件，并将旧爱的回执迁移到共享时间线。

### 0.5.0 · 2026-07-27

- 新增生产数据库、媒体和环境配置的一体化备份、Windows 拉取、完整性校验与季度恢复演练流程。
- 修复备份脚本在生产 Compose 项目名称变化时无法找到后端容器的问题。
- 重构项目文档目录；README 改为面向使用者的产品、启动、文档和版本入口。
- 清理可再生的测试缓存、构建缓存、日志和历史 QA 输出。

### 0.4.1 · 2026-07-20

- 修复 CI 在全新检出环境下因测试临时目录不存在而失败的问题。

### 0.4.0 · 2026-07-20

- 新增“爱的回执”完整流程与私有媒体支持。
- 统一前后端版本来源、依赖锁定和不可变发布镜像。
- 生产部署改为固定同版本前后端镜像，不再使用 `latest`。

### 0.2.3 · 2026-07-18

- 修复“爱的回执”在 MySQL/MariaDB 下的建表与排序兼容性。

更完整的分类记录、数据库影响和版本比较链接见 [CHANGELOG.md](CHANGELOG.md)。

## 验证与发布

```powershell
python scripts/version.py check
poetry run python -m pytest -q --basetemp=.pytest-tmp/local
cmd /c npm run build
```

根目录 `VERSION` 是唯一应用版本。只有与它完全一致的 `vX.Y.Z` 标签会触发 GitHub Actions 构建前后端镜像；两套镜像成功后会同时提升为稳定版 `latest` 并创建 GitHub Release。生产更新和备份工具安装在服务器部署目录，不随仓库分发，详见 [版本与发布](docs/VERSIONING.md)。

## 数据安全

- `.env`、本地数据库、媒体文件、测试输出和发布产物不会提交到 Git。
- 图片保存到 `MEDIA_ROOT`，数据库只保存 storage key；生产迁移时必须同时备份数据库和 `love_book_media`。
- 周期预测仅用于个人记录参考，不提供医疗诊断或避孕建议。

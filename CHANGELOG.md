# Changelog

Love Book follows Semantic Versioning. Git tags are the source of truth for released versions; changes without a matching tag remain unreleased.

## [Unreleased]

## [0.12.0] - 2026-11-14

### Added

- 发布工作流在推送镜像前先做容器冒烟（`scripts/ci_smoke_image.sh`）：后端用隔离 SQLite 启动并核对 `/health` 的版本与提交，前端首页需返回 200，两者都核对 OCI 版本标签。
- 主机 Nginx 新增安全头片段（HSTS、`nosniff`、Referrer-Policy、`X-Frame-Options: SAMEORIGIN`、Permissions-Policy）。
- 安全密码登录增加失败限流：同一登录名或 IP 在 15 分钟内失败 5 次后返回 429，登录成功即清零。
- 周期 dashboard 统计新增 `has_prediction`；还没有有效经期记录时，周期页展示首次记录邀请。
- `/timeline`、`/cycle`、`/todo`、`/habits` 顶部栏提供带二次确认的退出按钮。
- 花田拾光画面升级：连续抖动天色、日月弧线、星星与流星、三层视差、萤火和花瓣，小狗摇尾眨眼，拾取闪光、`+N` / 连击提示、心盾与受击反馈；减弱动效时关闭震屏、闪白、流星和花瓣。页面隐藏或失焦会暂停并弹出继续菜单。
- 新增「送一份礼物」：送礼人选包装纸（玫瑰、暖桃、鼠尾草、奶油、星夜）、写一句小提示和藏在里面的话、放最多 6 张照片，可设拆开时间（`POST /events/gifts/wrap`，事件类型 `gift`）。拆开前对方只看到礼盒、小提示和「来自 X」，看不到名称、正文、照片和评论；送礼人拆开前可重新包装。
- 收礼人可拆礼物（`POST /events/{id}/gift/open`，未到时间返回 409）并写回应：最多 3 个感受、1–5 枚印章评分和一段反馈（`PUT /events/{id}/gift/response`）。包礼物和拆礼物各发一封不含内容的提醒邮件。
- 时间线礼物卡片：待拆礼盒轻晃、倒计时 / 「可以拆啦」、约 1.6 秒全屏拆礼物动画后进入回应步骤；拆开后显示打开的礼盒、拍立得和回应贴纸。
- 新增 `/journal` 手账导出：可选全部、日期范围（近 30 天 / 半年 / 今年）或某次见面，可带上照片，支持在线翻看、HTML、PDF（A5）和长图；触屏设备能分享文件时走系统分享。后端新增 `GET /journal`，未解锁的互相提交内容和未拆礼物对双方都只显示占位。
- `events` 新增可空列 `gift_receiver_id`、`gift_wrap_style`、`gift_teaser`、`gift_open_at`、`gift_opened_at`、`gift_feedback`、`gift_responded_at`；MySQL 启动修复会给事件类型 ENUM 补上 `gift`。前端新增依赖 `modern-screenshot` 与 `jspdf`，只在导出时按需加载。

### Changed

- `/timeline` 与事件详情改为剪贴手账风格：按月的纸页和装订孔（点阵 / 方格 / 横线）、手写月份书签、翻页展开、轻微倾斜的卡片、和纸胶带、贴纸、拍立得，见面分组做成票根并可「导出这次见面」；顶部栏新增「手账」入口。纸张是实体内容层，减弱动效时只保留淡入淡出。
- 创建入口的第三项由「记一份收礼」改为「送一份礼物」；旧 `gift_received` 收礼事件继续展示，但不再提供新建入口。
- 生产镜像固定为与 `VERSION` 一致的裸 `X.Y.Z` 标签；`deploy_host.py update --yes` 会把 `LOVE_BOOK_IMAGE_TAG` 传给服务器更新器，更新器只拉取该标签并在结束后核对 `/api/health` 的版本。`latest` 只在冒烟和发布成功后作为便捷指针移动。
- `deploy_host.py run` 在 `User=root` 的发布主机上必须加 `--yes`，并支持 `--dry-run`。
- 工作流顶层权限收紧为 `contents: read`，只有发布 job 拿 `packages: write`；所有 job 都设置超时。
- 后端镜像改为多阶段构建，只信任私有网段来源的转发头（`FORWARDED_ALLOW_IPS`）；前端镜像只装生产依赖，并以非 root 用户 `nextjs` 运行。
- Docker Compose 默认 `APP_ENV=production`，前端增加健康检查并等待后端健康后再启动。
- 生产环境 `ADMIN_KEY` 为空或仍是占位值时，管理接口返回 503。
- 公网不再开放 `/docs`、`/redoc` 和 `/openapi.json`，需要时经 SSH 隧道访问。
- 周期预测只把 2-10 天的经期段作为开始锚点；没有锚点时预测日期字段为空，不再编造默认预测。
- AI 分类关闭时，Todo 重新分类接口返回 409；LLM 失败返回 502 并自动关闭 AI 分类。
- 错误提示改为简短中文，不再暴露内部异常信息。
- `/todo` 在宽屏使用左侧列表导航，窄屏改为板块 chip 与“抽一家”按钮；抽奖在弹层中打开并按需加载 3D 场景，任务按最早要完成日期排序，新增失败可重试，页面隐藏时暂停轮询。
- 周期页移动端快速记录胶囊浮在底边栏上方；Timeline 移除“未整理的见面”分组，对方也能从已归类事件打开见面编辑。
- 顶部栏、主内容和底边栏共用同一宽度表；日期统一按北京时间计算。

### Fixed

- 旧图片缺失缩略图时改为生成到媒体目录并保存 storage key，不再写回数据库；上传在数据库提交失败时会清理已写入的文件。
- 习惯提醒扫描移到工作线程执行，每封邮件发送后立即提交去重记录，避免重试时重复发送。
- 旧爱的回执写接口统一固定返回 410。

### Removed

- 移除周期演示数据和清空全部记录接口（`POST /cycles/example-data`、`DELETE /cycles/logs`）。
- 移除单方记录收礼的 `POST /events/gifts`（现返回 405）和前端「记一份收礼」表单；`POST /events` 不再接受 `event_kind=gift`（422）。
- 移除 `deploy/caddy/Caddyfile` 与 `scripts/cutover_caddy_to_nginx.sh`。

## [0.11.1] - 2026-11-10

### Added

- 公开首页底部居中展示备案号「浙ICP备2025205478号-2」，链接到 https://beian.miit.gov.cn/ 。

### Fixed

- 未配置 SSH Host 时，`cn` 仍是 root 发布入口，`cn-ts3` 仍是检查入口，打包命令不再把检查主机当成更新目标。
- 生产后端改连本机 MySQL（`host.docker.internal`）。`qrqto.group` DNS 已指向阿里云，查库接口会超时，页面虽能打开但登录后交互全部失败。

### Changed

- 公网域名与发布主机改为 `tingle272.xyz` / `cn-ts3,cn`，Nginx 反代补上 `Host` 与 `X-Forwarded-*`。
- 清理本地 Playwright 快照、跑酷 QA 截图和像素草稿，并把 `tmp/`、`.playwright-mcp/` 纳入忽略规则。

## [0.11.0] - 2026-08-26

### Added

- `/me` 可合上当前 pair：任意一方二次确认并可留一句话后，双方都无法再进手账。时间线、媒体和 pair 内容会保留；对方用安全密码或入口链接登录时只看到那句话。

### Fixed

- Local `start_dev.bat` now skips Windows Hyper-V reserved port 8000 (`WinError 10013`) and starts the backend on a bindable loopback port, passing it to the frontend.

## [0.10.0] - 2026-08-24

### Changed

- Redrew 花田拾光 as a Chrome T-Rex-style 1-bit pixel runner: integer-scaled silhouettes, paper outline, a scrolling horizon, and a three-color chapter palette instead of anti-aliased ellipse scenery.
- Restyled the login runner overlays (start menu, login, leaderboard, score name, ended, and help) to the same paper-and-ink pixel chrome as the HUD.
- Tightened 花田拾光 to Chrome T-Rex proportions: a small character on a low horizon, a 0.56s jump, 12fps leg frames, and faster world scroll.

## [0.9.1] - 2026-08-22

### Added

- Added `LOVE_BOOK_SSH_HOSTS` and `scripts/deploy_host.py` so agents can package locally, then check or publish through named `~/.ssh/config` hosts such as `ts3_qrqto` and `root_qrqto`.
- Added host Nginx vhosts, certbot webroot renewal, and a Caddy-to-Nginx cutover that keeps `cdn.qrqto.club` on the existing static root.

### Changed

- Replaced the atlas-based login runner with a fully code-drawn 花田拾光: geometric Xiaohua, hashed meadow scenery, and shape obstacles, plus a start menu. Visitors with a stored or URL token skip the game and enter the app; play starts only from the menu.
- Rebuilt the login runner into 花田拾光: chaptered day-to-night meadow, collectible petals and letters, combo scoring, two hearts with invincibility, hold-to-jump-higher on desktop, a double jump after noon, and Space/Up jumping without activating focused runner buttons.
- Removed unused production deploy, backup, and one-off migration scripts from the repository. Local development keeps `start_dev.bat` plus version helpers.
- Replaced production-specific host, account, and mailbox defaults in example env and docs with placeholders.
- Production public HTTP(S) now uses host Nginx instead of the Love Book Caddy container, so other host sites can share 80/443.

## [0.9.0] - 2026-08-05

### Added

- Added a public pixel-grassland Xiaohua runner with a global Top 3 leaderboard and record-name flow on the login page.
- Added unique normalized login names, Argon2id security passwords, 90-day password sessions, and in-session password reset controls.

### Fixed

- Fixed password-session rotation so resetting a credential revokes only password-issued sessions while entry and email-link tokens remain valid.
- Fixed the runner start control being blocked by the default-open login overlay and made every foreground panel pause gameplay reliably.
- Fixed mobile controls to use left-side held crouch and right-side tap jump while retaining desktop mouse and keyboard controls.
- Fixed padded obstacle atlases making visible sprites appear smaller than their collision areas.

### Changed

- Replaced the login-only 3D scene with a responsive Canvas 2D runner and removed animated puppies from Timeline quotes and empty states.
- Expanded the runner to the full viewport, added neutral collapsed login controls, and improved obstacle silhouettes with alpha-bound cropping, pixel outlines, and contact shadows.
- Redesigned the Timeline quote as a quieter single-column content surface with more readable type and spacing.

### Database

- Added nullable user credential fields, device-token source tracking, and the global `game_scores` leaderboard table through startup-compatible schema migration.

## [0.8.0] - 2026-07-31

### Added

- Added a lightweight animated 2D puppy companion to the Timeline, with idle, greeting, curious, and celebration actions.

### Fixed

- Fixed meeting-session regression tests to use the application's `Asia/Shanghai` date instead of the CI runner's local date at UTC day boundaries.
- Fixed production updates silently retaining an older version-pinned Compose image after newer stable images were published.
- Fixed `sudo` updates resolving the deployment and backup paths under `/root` instead of the installed `/home/ts3` paths.

### Changed

- Replaced the Timeline's login-scene dependency with a dedicated transparent puppy atlas, including reduced-motion and background-tab pause behavior for smooth low-overhead animation.
- Stable releases now promote matching frontend and backend images to `latest`, with a reusable production updater that checks versions, creates a validated backup, pulls, starts, and verifies the site.

### Database

- No schema changes.

## [0.7.0] - 2026-07-28

### Changed

- Simplified received-gift timeline cards to make their photo-led presentation more focused and easier to scan.

### Database

- No schema changes.

## [0.6.0] - 2026-07-28

### Added

- Added direct received-gift events with optional feedback, ratings, and up to six private photos in place of the retired delivery workflow.
- Added up to three honest positive or complex feeling tags to received-gift events, independent from written feedback.
- Added photo-led received-gift cards, private timeline previews, responsive detail galleries, and an auditable legacy media migration command.

### Changed

- Moved every legacy love receipt into the shared timeline while preserving its receiver, date, feedback, sender message, meeting relationship, and rating.
- Retired legacy receipt mutations and redirected old receipt pages to their corresponding timeline events.

### Fixed

- Preserved legacy love-receipt image order and made interrupted media copies safe to retry with deterministic paths.

### Database

- Added `gift_received` events, nullable `events.gift_rating` and `events.gift_feelings`, ordered `images.sort_order`, and idempotent legacy image mappings through forward-compatible startup migration.

## [0.5.0] - 2026-07-27

### Added

- Added a validated production backup and recovery workflow covering MySQL, media, environment configuration, Windows retrieval, integrity checks, and quarterly restore drills.

### Changed

- Reorganized development, deployment, API, product, design, and audit documentation under `docs/`.
- Rewrote the root README as a human-oriented product, setup, documentation, and release-history entry point.
- Removed obsolete empty notes and regenerated local test, build, log, and QA artifacts from the working directory.

### Fixed

- Made the production backup script discover the backend container through Docker Compose labels instead of relying on a fixed project-generated container name.

### Database

- No schema changes.

## [0.4.1] - 2026-07-20

### Fixed

- Made clean-checkout CI test temporary directories self-contained so release gates do not depend on a pre-existing ignored parent directory.

### Database

- No schema changes.

## [0.4.0] - 2026-07-20

### Added

- Added the private Love Receipt flow, including delivery progress, photos, honest positive or negative moods, and optional one-to-five-star ratings.
- Added a single root application version, automated manifest checks, locked backend dependencies, and immutable release images.

### Changed

- Replaced the Timeline receipt envelope with a gift icon and kept logout only in Settings.
- Production deployment now pins matching frontend and backend image versions instead of `latest`.

### Fixed

- Isolated locked backend dependencies in a container virtual environment and included the runtime HTTP client required by admin routes.

### Database

- Added Love Receipt tables, private media metadata, expanded receipt moods, and the nullable `receipt_rating` column through forward-compatible startup migrations.

## [0.2.3] - 2026-07-18

### Fixed

- Kept Love Receipt table creation and list ordering compatible with MySQL and MariaDB.

[Unreleased]: https://github.com/ahappymosquito/love_book/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/ahappymosquito/love_book/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ahappymosquito/love_book/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ahappymosquito/love_book/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ahappymosquito/love_book/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/ahappymosquito/love_book/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ahappymosquito/love_book/compare/v0.2.3...v0.4.0
[0.2.3]: https://github.com/ahappymosquito/love_book/releases/tag/v0.2.3

# AGENTS

## 开发沟通规范

- 提到库时，默认按最新稳定版本编写代码，除非项目现有约束明确限制版本。
- 每次改动都同步更新项目文档，保证文档描述与当前代码状态一致。
- 每次用户提示词优先级最高；如果和项目文档冲突，以当前用户提示词为准。
- 每次任务完成后，如果测试通过且当前目录是 Git 仓库，需要创建 Git 提交。
- 需要让技术实现可追踪；修改代码文件时，需要同步更新文件开头的功能介绍注释。

## 当前约定

- 本地开发一键启动脚本为 [start_dev.bat](C:\RPA\code\love_book\start_dev.bat)。
- `start_dev.bat --install` 会先安装后端 `requirements.txt` 和前端 `web/package.json` 依赖，再启动本地开发服务。
- 直接执行 `start_dev.bat` 只启动服务，不重复安装依赖。
- 事件、评论、语音、图片等写接口必须在响应返回前完成数据库提交，避免前端立即刷新时读到未提交数据。
- 语音文件必须转为 MP3 后写入 `MEDIA_ROOT` 本地媒体目录，数据库只保存 `voices.storage_key`，不得再为新语音写入 `voices.data`；旧语音记录没有 storage key 且没有数据库数据时按不可播放处理。
- 移动端图片上传入口不得强制 `capture` 调用相机，优先使用系统图片选择器以兼容 iPhone 相册选择。
- 图片上传需要把原图和缩略图写入 `MEDIA_ROOT` 本地媒体目录，数据库只保存 `images.storage_key` / `images.thumb_storage_key`，不得再为新图片写入 `images.data` / `images.thumb_data`。
- 旧图片记录没有 storage key 时必须回退读取 `images.data` / `images.thumb_data`，详情页缩略图展示不得直接拉取原图。
- 邮件通知必须遵守事件解锁状态：`mutual_submit` 未解锁时，只通知有新事件或新评论，不展示事件标题、描述或评论正文。
- 管理端复制 token / 入口链接需要保留 Clipboard API 失败后的降级复制，兼容服务器 HTTP、权限策略或浏览器剪贴板限制。
- 管理端复制入口链接由浏览器当前 `window.location.origin` 动态生成：HTTP 环境复制 HTTP，HTTPS 环境复制 HTTPS。
- 生产 Docker 公网入口使用 Caddy 自动申请和续期 `qrqto.club` / `www.qrqto.club` HTTPS 证书；邮件链接仍由后端 `APP_WEB_URL` 生成，生产应设为 `https://qrqto.club`。
- 生产 Docker 媒体文件持久化在 named volume `love_book_media`，迁移服务器时需要和数据库一起备份。
- 服务器使用预构建镜像部署时，优先执行 [deploy_server.sh](C:\RPA\code\love_book\deploy_server.sh) 生成 `.env`、`Caddyfile`、`docker-compose.yml` 并启动服务；真实密码和 SMTP 授权码只放服务器 env 文件或环境变量，不提交到仓库。

## 首页提醒约定

- 首页纪念日提醒由后端 `/auth/anniversary` 聚合：情侣日期天数、520/1314/整月纪念、固定恋爱节日、本地语录库和 timor.tech 中国节假日信息。
- 一言模块已弃用；普通日情话从当前 pair 的数据库语录库和 `default_quotes` 全站共享兜底语录表合并后的随机池中选取。
- 节假日接口失败时必须静默降级，不能影响 `/timeline` 首页加载。
- `/quotes` 是登录后的情侣共享语录库接口；同一 pair 双方可添加、查看、删除共享语录，写接口必须在响应返回前完成数据库提交；前端刷新和编辑入口收在首页纪念日卡片右侧图标按钮内。

## 周期日历约定

- `/cycle` 是登录后的周期日历 Dashboard，从 `/timeline` 入口进入，复用当前 Bearer token 鉴权。
- 周期记录按 pair 双方共享：同一 pair 的两个用户看到同一份周期数据，编辑时记录最后更新用户。
- 周期记录、示例数据、清空数据等写接口必须在响应返回前完成数据库提交，保证前端保存后立即刷新可读。
- 周期阶段和下次经期预测只用于记录参考，页面和接口文案不得写医疗诊断、避孕建议或恐吓式提醒。

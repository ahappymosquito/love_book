# AGENTS

## 开发沟通规范

- 提到库时，默认按最新稳定版本编写代码，除非项目现有约束明确限制版本。
- 每次改动都同步更新项目文档，保证文档描述与当前代码状态一致。
- 每次用户提示词优先级最高；如果和项目文档冲突，以当前用户提示词为准。
- 每次任务完成后，如果测试通过且当前目录是 Git 仓库，需要创建 Git 提交。
- 需要让技术实现可追踪；修改代码文件时，需要同步更新文件开头的功能介绍注释。

## 当前约定

- 本地开发一键启动脚本为 [start_dev.bat](C:\RPA\code\love_book\start_dev.bat)。
- 前端默认按 [PRODUCT.md](C:\RPA\code\love_book\PRODUCT.md) 和 [DESIGN.md](C:\RPA\code\love_book\DESIGN.md) 的 product register 设计上下文执行；整体气质为“温暖、可爱、舒服、可信”。
- 前端视觉基线是柔和恋爱手账型产品 UI：低饱和玫瑰为主色，暖桃承载重点，鼠尾草薄荷用于完成和正向状态；避免晃眼高饱和色、清冷灰后台、装饰玻璃拟态、渐变文字和低对比彩色文本。
- `start_dev.bat --install` 会先安装后端 `requirements.txt` 和前端 `web/package.json` 依赖，再启动本地开发服务。
- 直接执行 `start_dev.bat` 只启动服务，不重复安装依赖。
- 事件、评论、语音、图片等写接口必须在响应返回前完成数据库提交，避免前端立即刷新时读到未提交数据。
- Timeline 留言 reaction 只支持当前 allowlist 内的表情，初期为点赞和倒赞；同一用户对同一留言最多保留一个 reaction，点另一个会替换，点已选会取消。
- Timeline 留言 reaction 只显示在可见留言下方的表情和数量；reaction 不计入 `mutual_submit` 的提交状态，不触发邮件通知，也不能让未解锁的隐藏留言提前可见或可操作。
- Timeline 桌面端留言 reaction 操作条必须保留从气泡移动到按钮的 hover 桥接区域，避免鼠标移过去时菜单立即消失。
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
- 首页时间线事件按 `occurred_at` 所在月份收纳；没有发生时间时回退 `created_at`，默认只展开当前月份。
- 首页标题区右侧不再显示 `/todo` 和 `/cycle` 快捷图标；这两个入口统一通过底边栏进入。
- 登录后的用户页面统一显示底边栏：`/timeline`、`/timeline/[id]`、`/create`、`/cycle`、`/todo`、`/me`；底栏使用克制的 iOS 液态玻璃材质，普通导航项之间以共享玻璃选中块丝滑滑动，低动效模式下直接切换。中间使用项目玫瑰红扁圆粗体加号作为“记一笔”入口；点击底栏或 Timeline 空状态的创建入口时，共享玻璃选中块先汇聚到中间，再从底部滑出近全屏创建窗口，关闭后立即清空草稿；直接访问 `/create` 时仍使用独立创建页。桌面端底栏需要和主内容宽度平齐，`/me` 底栏入口显示设置图标，是当前用户资料和共享语录管理入口。
- 一言模块已弃用；普通日情话从当前 pair 的数据库语录库和 `default_quotes` 全站共享兜底语录表合并后的随机池中选取。
- 节假日接口失败时必须静默降级，不能影响 `/timeline` 首页加载。
- `/quotes` 是登录后的情侣共享语录库接口；同一 pair 双方可添加、查看、删除共享语录，写接口必须在响应返回前完成数据库提交；`/quotes/defaults` 只读返回默认语录，不混入当前 pair 的自定义语录；前端语录管理入口集中在 `/me`，Timeline 只保留当前话语展示和刷新。
- 共享语录的主要前端管理入口在 `/me`，Timeline 首页只展示纪念日和当前话语，不再作为语录管理主界面。
- `/me` 的“我的小档案”保留头像图片/emoji、用户名和邮箱编辑；头像点击进入头像编辑，用户名/邮箱点击后在卡片内原地编辑，并通过保存按钮统一提交；下方折叠展示共享语录，用户语录、默认语录、加载和空状态都使用等宽清晰边界行，默认语录以只读行直接排在用户语录下面，不单独做说明板块。
- 首页周期记录提醒只在预计月经开始前本机配置的 N 天到预计当天展示，默认 3 天；今日已记录或当天选择“暂时不写”后不再弹出。

## Todo 看板约定

- `/todo` 是登录后的共享 todo 看板，从 `/timeline` 入口进入，复用当前 Bearer token 鉴权。
- `/todo` 前端采用 Microsoft To Do 式信息架构：桌面端左侧列表导航、中间任务列表、右侧任务详情；移动端折叠导航并使用底部详情面板。视觉气质仍遵守 Love Book 的温暖玫瑰、暖桃、鼠尾草体系，不照搬冷蓝 Windows 外壳。
- `/todo` 默认展示所有未完成 todo，不按当天或所选日期过滤；任务按最早“要完成时间”升序排列，未设置时间的任务排在已设置时间任务后面；已完成/打卡 todo 在主列表下方以默认折叠板块展示。
- `/todo` 日期安排只在任务详情内用单个日期选择框设置或取消；选中日期后必须立刻保存，不再要求点击保存按钮。主列表顶部不显示全局日期选择，任务行右侧不显示安排日期的 `+` 或删除入口，删除/收起操作放在详情面板内。
- Todo 完成状态按双方评论判定：同一 todo 下 pair 双方都至少评论过一次才自动完成；图片不参与完成判定。详情评论需要显示评论作者，照片区折叠展示且不按上传人分组。
- Todo 任务标签前端显示为“吃喝 / 玩乐 / 住宿 / 许愿”；`/todo` 主界面分为“今天想吃点 / 出去玩一玩 / 住一晚也好 / 悄悄许个愿”四个默认折叠板块，新增输入放在板块顶部。新增输入会先创建本地“正在解析”待确认卡片，再由后端同步用 LLM 分类并对非许愿项调用高德 MCP 搜索；待确认卡片默认展示 LLM 判断分类、高德候选信息和分类切换控件，用户可改到任意板块后再确认加入或丢弃。确认失败必须保留卡片并显示可重试错误，不能抛出未处理运行时错误；后端确认异常应回滚并返回明确 502，不删除候选。`/todo` 工具栏保留刷新按钮，可批量调用 LLM 更新当前 pair 全部未完成 todo，已完成 todo 不显示刷新入口也不参与刷新。
- Todo 数据独立于时间线事件，不自动创建或更新 `/timeline` 事件。
- Todo 项目按 pair 双方共享，分为 `food` 吃喝、`play` 玩乐、`stay` 住宿和 `wish` 许愿；默认玩乐项目为“唱歌、台球、看电影、拼乐高”。
- Todo 分类扩展到 `stay` / `wish` 后，MySQL / MariaDB 运行环境会在后端启动 `init_db()` 阶段自动把 `todo_items.category` 和 `todo_candidates.category` 的旧 ENUM 修复为 `food/play/stay/wish`，避免确认加入住宿或许愿时发生 `Data truncated`。
- Todo 所有操作都不发送邮件通知；日期安排写接口必须在响应返回前完成数据库提交。每个 todo 同一时间只保留一个安排日期，新日期会替换旧日期；前端任务行右侧需要用日期 badge 展示保存后的日期，并按已过期、今天、近三天、未来、已完成使用不同状态色。
- `/todo` 移动端底部新增输入、详情弹窗 footer、写评论打卡、上传照片和删除按钮必须避让全局底边栏；详情移动端是底部弹窗，PC 端是右侧栏，打开关闭需要保持丝滑且低动效模式可用。
- 餐厅搜索和详情解析通过后端运行 `npx -y @amap/amap-maps-mcp-server` 调用高德 MCP，后端会在 Windows 本地经 `cmd.exe` 调用 `npx` 以兼容 Node.js 批处理入口，按该包当前 SDK 的 newline JSON stdio 协议通信，并为 MCP 冷启动保留 45 秒默认超时；高德 key 优先使用管理端保存值，未保存时回退 `.env` / 环境变量 `AMAP_MAPS_API_KEY`。Todo 餐厅添加后必须自动拉取高德详情并刷新打开详情面板，用户只填餐厅名/城市；详情展示店名、城市、地址、商圈、类型、评分、人均、营业时间、坐标、POI ID、点餐字段、门店照片和高德导航链接，字段缺失时显示未返回。
- 餐厅 todo 同样遵守双方评论完成规则，不因单方评论或图片上传直接完成。
- Todo 图片写入 `MEDIA_ROOT/todo/images/...`，数据库只保存 `todo_images.storage_key` / `todo_images.thumb_storage_key`，不得写入数据库 BLOB。
- 随机抽奖支持人均、城市/区域、附近 1/3/5/10km 筛选；附近筛选由浏览器定位提供经纬度，定位失败不得阻断其它抽奖方式。
- 3D 抽奖动画使用 Three.js / react-three-fiber，并需要尊重 `prefers-reduced-motion`。

## Admin AI 配置约定

- Admin AI 配置为全站唯一；管理端可保存协议、对应服务地址、token、选中模型和高德 key，`.env` / 服务器环境变量作为初始默认和兜底。
- 管理端先选择 OpenAI 或 Anthropic，再编辑当前协议对应地址和 token；获取模型列表后需要按协议保存最近一次模型列表，刷新页面后继续展示上次列表和选中模型；没有选中模型时获取列表会自动保存第一个模型。Admin 测试默认样例为“江西小炒(西溪北苑东区店)”`food`、“浩波台球俱乐部(汇银中心店)”`play`、“海友酒店(杭州阿里巴巴全球总部店)”`stay`，也允许输入自定义 POI 名称和城市。测试必须先通过高德 MCP 获取真实 POI 证据，并以高德 POI 类型作为主判断依据；高德取证展示名称、地址、城市、区域、类型、typecode、电话、商圈、评分、人均、标签/特色和照片摘要。LLM 只作为补全诊断展示，空回复、协议错配或模型不支持 chat/messages 不能让高德取证测试失败。界面需要展示“高德取证 -> 高德类型判断 -> LLM 补全诊断”过程。分类补全默认给 64 tokens 输出预算，遇到长度耗尽且正文为空时用 256 tokens 重试一次。
- `.env` / 服务器环境变量维护 `LLM_OPENAI_BASE_URL`、`LLM_ANTHROPIC_BASE_URL`、`LLM_API_KEY`、`LLM_PROTOCOL`、`LLM_MODEL`、`AMAP_MAPS_API_KEY` 的默认值。
- OpenAI 协议获取模型列表走 `{LLM_OPENAI_BASE_URL}/models`；Anthropic 协议走 `{LLM_ANTHROPIC_BASE_URL}/v1/models`。
- `.env.example` 只能放占位值，不得提交真实高德 key、LLM token、数据库密码或 SMTP 授权码。

## 周期日历约定

- `/cycle` 是登录后的周期日历 Dashboard，从 `/timeline` 入口进入，复用当前 Bearer token 鉴权。
- 周期记录按 pair 双方共享：同一 pair 的两个用户看到同一份周期数据，编辑时记录最后更新用户。
- 周期记录、示例数据、清空数据等写接口必须在响应返回前完成数据库提交，保证前端保存后立即刷新可读。
- 周期日历已作为正式功能使用，正式界面不展示示例数据、清空数据或导入历史数据等测试入口。
- 周期提醒提前天数保存在当前浏览器 localStorage，key 为 `love-book:cycle-reminder-days:{pairId}`；当天暂时不写状态 key 为 `love-book:cycle-reminder-dismissed:{pairId}:{yyyy-MM-dd}`。
- 周期阶段和下次经期预测只用于记录参考，页面和接口文案不得写医疗诊断、避孕建议或恐吓式提醒。

## 头像约定

- 用户头像支持图片上传和 emoji 备用头像；展示时优先显示上传图片，图片缺失或加载失败时回退 `users.avatar` emoji，再回退昵称首字。
- 头像图片按私有媒体处理：写入 `MEDIA_ROOT/avatars/{user_id}/...`，数据库只保存 `users.avatar_storage_key` / `users.avatar_mime_type` / `users.avatar_size_bytes` / `users.avatar_updated_at`，不得写入数据库 BLOB。
- `POST /auth/me/avatar` 和 `DELETE /auth/me/avatar` 必须在响应返回前完成数据库提交，保证前端上传或清除后立即刷新可读。
- 当前登录用户可在 `/me` 的“我的小档案”点击编辑自己的用户名、邮箱、emoji 头像和头像图片；邮箱空字符串按 `NULL` 保存。
- `GET /users/{user_id}/avatar` 只允许同一 pair 的双方或管理员读取；头像下载使用私有缓存头，不提供公开静态 URL。
- 管理端创建配对阶段继续只设置 emoji 默认头像；登录用户可在顶部头像弹窗里上传或清除自己的头像图片。

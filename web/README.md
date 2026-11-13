# love · book — 前端

基于 Next.js 15 (App Router) + TypeScript + Tailwind CSS 的双人事件记录应用，对应 FastAPI 后端 `app.main:app`。

## Liquid Glass 视觉系统

前端明确分成两层：

- 控制层：`GlassSurface`、`SegmentedControl`、`AppHeader`、`BottomNav`、浮动操作和临时 Sheet 使用自适应 Liquid Glass。
- 内容层：`Card`、`content-surface`、`form-section` 和 `settings-group` 为时间线、日历、Todo、表单和设置提供不模糊的实体背景。

主题值集中在 `src/app/globals.css` 的 `--lb-*` OKLCH 通道，同时提供亮色和暖夜深色。样式包含不支持 `backdrop-filter`、高对比度、强制色彩与低动效回退；旧 RGB 变量暂时保留给现有 Tailwind 颜色类。

共享组件入口：

- `src/components/ui/glass-surface.tsx`：玻璃变体、形状和交互接口。
- `src/components/ui/segmented-control.tsx`：可访问的共享选择镜片。
- `src/components/ui/card.tsx` 与 `src/components/ui/sheet.tsx`：实体内容层和临时浮层。

已登录页面的 `AppHeader`、主内容容器和桌面 `BottomNav` 共用 `src/lib/page-width.ts` 的宽度表，左右边缘对齐；顶部栏与底边栏避让统一使用 `globals.css` 的 `--lb-header-clearance` / `--lb-nav-clearance`。`AppHeader` 在 `/timeline`、`/cycle`、`/todo`、`/habits` 右侧显示退出按钮并二次确认，`/me` 页内同样保留退出。日期分组与“今天”判断统一由 `src/lib/dates.ts` 按 `Asia/Shanghai` 计算。

提交 UI 改动前运行 `npm run build`，并验证 407×885、430×932、768×1024、1440×900。移动端必须满足 `scrollWidth === clientWidth`，确需横向浏览的内容只能放在 `local-x-scroll` 内。

## 准备

```powershell
cd web
npm config set registry https://registry.npmmirror.com
npm install
```

可选：复制环境变量示例。

```powershell
Copy-Item .env.local.example .env.local
```

`NEXT_PUBLIC_API_BASE` 未设置时指向 `http://127.0.0.1:8000`。仓库根目录 `start_dev.bat` 会按本机实际可绑定端口写入该变量；Windows 上 8000 被 Hyper-V 保留时常见回退是 8100。

## 开发

```powershell
npm run dev
```

打开 http://localhost:3000 。后端需要同步运行：

```powershell
# 仓库根目录；端口以 start_dev.bat 或 scripts/dev_backend_port.py 为准
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## 生产构建

```powershell
npm run build
npm run start
```

## 路由

| 路由 | 说明 |
| --- | --- |
| `/` | 1-bit 像素「花田拾光」登录页：无 token 时全视口地平线加开始弹窗，有 token 直接进入手账；晨昏光景、拾光与小心心、鼠标与触控适配、全站 Top 3、安全密码与 token 登录 |
| `/admin` | 管理控制台：先用 admin key 验证，再创建配对、选择 token 有效期、复制 token / 入口链接；Clipboard API 失败时自动降级复制；AI 配置会保存上次模型列表、选中模型、高德 key 和“启用 AI 分类”开关，开关默认关闭，开启时必须通过 LLM 模型列表和分类调用校验，失败后界面回到关闭；测试时可选择江西小炒、浩波台球、海友酒店或自定义 POI，先用高德 MCP 获取名称、地址、类型、typecode、评分、人均、特色等证据，再展示高德类型判断和 LLM 诊断 |
| `/timeline` | 当前用户的剪贴手账首页，含关系话语板块、全部 / 见面分段、按月纸页（装订孔、点阵 / 方格 / 横线、手写月份书签、翻页展开）、胶带卡片与拍立得、票根式见面分组（可「导出这次见面」）、礼物卡片和静态空状态创建入口；顶部栏有「手账」入口 |
| `/timeline/[id]` | 事件详情，同样是纸页手账风格；创建者可从顶部铅笔原地编辑完整事件信息；日历爱心可创建见面，已归类事件双方都能从这里打开所属见面范围编辑；礼物详情含拆礼物和回应；合并的评论 / 图片内容流和底部输入栏覆盖全局底边栏 |
| `/create` | 新建事件，可选择普通小事、线下见面或「送一份礼物」；线下见面保存时自动建立同名见面，不额外填写归属 |
| `/journal` | 双人手账导出：范围选全部 / 日期范围（近 30 天、半年、今年快捷选择）/ 某次见面，可开关「带上照片」，格式为在线翻看、HTML、PDF、长图；桌面端侧边设置 + 预览 + 全屏阅读，移动端全幅预览 + 安全区上方的玻璃底栏 + 设置 Sheet；导出有进度、取消和重试 |
| `/todo` | 双人共享 To Do 式工作区，首屏是“要一起做的事情”，按“今天想吃点 / 出去玩一玩 / 住一晚也好 / 悄悄许个愿”四个板块展示，许愿默认展开；`xl` 及以上左侧列表导航含四个板块、“等你确认”和“抽一家”，更窄时改为横向板块 chip 加“抽一家”按钮；抽奖在弹层中打开，Three.js 场景懒加载；任务按最早要完成日期升序、未安排排后；页面隐藏时暂停后台轮询；快速新增失败的本地卡片保留并可重试；新增输入放在板块顶部，用户先选择手动分类，提交后立刻进入待确认队列并显示解析中；AI 开启时卡片展示 AI 分类和高德候选信息，AI 关闭时不调用 LLM 并使用手动分类，用户仍可改分类后确认加入或丢弃；确认失败会留在详情里展示错误；正式详情内使用选中即保存的单一日期安排、评论作者、照片折叠和高德取证信息；移动端详情覆盖底边栏，日期保存后在任务行右侧用状态色 badge 展示 |
| `/cycle` | 双人共享周期日历 Dashboard，含月 / 周 / 列表视图、筛选、提醒设置和移动端详情面板；还没有有效经期记录时展示首次记录邀请 |

## 设计基线

- 产品默认按 [`docs/ai/PRODUCT.md`](../docs/ai/PRODUCT.md) 和 [`docs/ai/DESIGN.md`](../docs/ai/DESIGN.md) 执行，气质为“温暖、可爱、舒服、可信”。
- 低饱和玫瑰主操作、暖桃重点、鼠尾草薄荷正向状态、奶油色可读面板，避免晃眼高饱和色、清冷灰后台和低对比彩色文本。
- Inter + Noto Sans SC via `next/font/google`；`font-display` 指向友好的 sans-serif 栈。
- `glass-card` 是柔和手账面板：温暖边界、低对比彩色阴影、浅色/深色模式同步。
- 触控目标 ≥44px，焦点状态可见，遵守 `prefers-reduced-motion`。

## 主要实现点

- **登录主路径**：`/` 在无 token 时使用全视口 Canvas 2D「花田拾光」，小狗、障碍和地平线全部是代码里的 1-bit 像素剪影，关闭抗锯齿、不加载图集；有本地 token 或 `?token=` / `#token=` 时不挂游戏，直接进入 `/timeline`。未登录先弹出开始菜单，点「开始游戏」才开跑。角色、速度、跳跃和障碍使用设备无关逻辑单位。跑酷按晨光 / 午后 / 黄昏 / 星夜换纸面与墨水色，分数由路程、花瓣信封和连击组成，开局两颗小心心，撞到障碍先失去一颗再短暂无敌。电脑端鼠标左键或 `↑/Space` 跳跃且按住跳得更高、右键或 `↓/S` 按住趴下，午后可二段跳；手机左半区按住趴下、右半区点按完整跳跃，角落 `?` 展示玩法。障碍间距按速度、宽度与随机系数生成，并抑制连续重复。登录、排行榜、玩法和留名弹窗打开时会暂停并锁住游戏输入；页面隐藏或窗口失焦也会暂停并弹出继续菜单。管理员入口保持原样。
- **花田拾光画面**：天色由 `src/lib/xiaohua-runner-sky.ts` 按晨光到星夜连续插值，并用 4×4 Bayer 有序抖动成像素天空；`src/lib/xiaohua-runner-draw.ts` 绘制日月弧线、星星与流星、三层整数视差远山 / 花田 / 草丛、萤火与飘落花瓣，以及小狗摇尾、耳朵弹跳和跑动眨眼。`src/lib/xiaohua-runner-fx.ts` 用固定容量、种子随机可复现的粒子池在固定步进内发射尘土、拾取闪光与 `+N` / 连击提示、心盾、受击闪白和轻震。`prefers-reduced-motion` 下关闭震屏、闪白、流星和花瓣，粒子数量也会降低。
- **Timeline 首页**：`/timeline` 顶部为单一关系话语板块，只合并关系状态、在一起天数和当前话语，不放创建、周期、习惯等底边栏已有入口；下方使用“全部 / 见面”分段。见面以北京时间日期范围自动归类双方事件，范围外事件被标记时建立同名单日见面。点击见面标题后通过桌面居中窗口或移动端底部 Sheet 同时编辑标题、开始日期和结束日期；重叠合并前提示保留标题，也可确认取消整个见面，不显示加号或记录选择器。手机端事件项保持更轻的行式卡片，空状态只用静态图标和现有创建弹层联动。
- **送礼物**：`src/components/gift-wrap-form.tsx` 是包礼物表单，实时预览礼盒，5 种 CSS/SVG 包装纸（玫瑰、暖桃、鼠尾草、奶油、星夜）、小提示、藏在里面的话、最多 6 张照片和可选拆开时间，提交到 `POST /events/gifts/wrap`。时间线由 `gift-box`、`gift-timeline-card`、`gift-countdown` 绘制待拆礼盒（轻晃、小提示、「来自 X」、倒计时或「可以拆啦」）；收礼人点开后 `gift-unwrap-overlay` 播放约 1.6 秒全屏拆礼物（丝带松开、盒盖弹起、最多 40 片花瓣、卡片升起），再由 `gift-response-form` 填最多 3 个感受、1–5 枚印章和反馈。送礼人拆开前看到「等 TA 拆开」并可重新包装；拆开后显示打开的礼盒 / 拍立得和收礼人的回应贴纸。旧收礼事件按已拆开的礼物继续展示，不再提供新建入口。状态推导在 `src/lib/gift-state.ts`，手账装饰在 `src/lib/gift-scrapbook.ts` 与 `src/components/scrapbook-decor.tsx`。
- **剪贴手账风格**：卡片按确定性规则倾斜不超过 1.2°，纸张是实体内容层，不使用 `backdrop-filter`；纸张与胶带 token 为 `globals.css` 中的 `--lb-paper-*` / `--lb-washi-*`，手写字体为 `--lb-hand-font`。低动效下不放彩纸、不轻晃，只保留淡入淡出。
- **手账导出**：`/journal` 读取 `GET /journal`（`src/lib/journal-api.ts` / `journal-query.ts`），在线翻看和所有导出共用 `src/lib/journal-render.ts` 一个渲染器：所有文字转义、带 CSP、图片只用 `data:`，在线翻看放在 sandbox `srcdoc` iframe 内。图片由 `journal-assets.ts` 拉取压缩：HTML 最长边 1600px JPEG，长图 1200，PDF 1000。`journal-export.ts` 生成长图时遵守 16.7M 像素面积 / 16384 边长上限，自适应像素倍率或拆成多张 PNG；PDF 为 A5 逐页截图后组装。`modern-screenshot` 与 `jspdf` 只在导出时按需加载；能分享文件的触屏设备走 Web Share API，否则下载。画面包含封面（头像、在一起天数、统计）、月份页、胶带卡片、拍立得、带邮戳的票根见面、礼盒 / 已拆礼物卡和感受印章、未解锁占位与结尾页，动效有纸张落下、胶带贴上、照片显影、封面打开和桌面翻页，并有低动效回退。
- **详情输入**：底部输入栏支持文字和系统图片选择，移动端使用 44px 触控目标并覆盖全局底边栏。
- **图片**：通过系统图片选择器进入相册 / 拍照来源，不强制调用相机；选择后前端先压缩大图并乐观渲染，详情页优先加载 `/images/{id}/thumb` 缩略图，点开才加载原图。
- **凭据**：用户 token 存 `localStorage` (`pair-events-token`)；admin key 仅留在 zustand 内存 + sessionStorage 标记；过期 token 会在登录时提示失效。
- **复制兼容**：管理员复制 token / 入口链接时优先使用 `navigator.clipboard.writeText`，生产浏览器拒绝剪贴板权限或非安全上下文时降级为隐藏 `textarea` + `execCommand("copy")`。

## 首页纪念日与节日提醒

- `/admin` 创建 pair 时可设置情侣日期，pair 列表里可继续编辑。
- `/timeline` 顶端关系话语板块只展示双方昵称、在一起第 N 天和最终文案；520/1314/整月纪念、固定恋爱节日、中国大陆节假日/调休只参与后端文案聚合，不作为顶部 pill 展示。
- 一言模块已弃用；普通日文案由后端从当前 pair 的数据库语录库和 `default_quotes` 全站共享兜底语录表合并后的随机池中选取。
- `/timeline` 点击话语文案即可刷新当前话语，不展示独立刷新图标按钮或“本地语录兜底”等实现来源说明；共享语录添加、查看和删除集中在 `/me`，提醒接口失败时仍会用 `me.love_started_on` 做基础天数兜底。
## 周期日历 Dashboard

- `/cycle` 是登录后的周期日历页面，从底边栏进入，使用现有 token 鉴权。
- 页面使用 React + TypeScript + Tailwind CSS，配合 shadcn/ui 风格本地组件、lucide-react、framer-motion 和 date-fns。
- 数据来自后端 `/cycles/dashboard`，单日保存和删除通过 `/cycles/logs/{day}` 完成，不依赖前端 mock 作为真实数据源。后端没有有效经期锚点时预测字段为 `null`，页面展示首次记录邀请而不是默认预测。
- 主要组件在 `src/components/cycle-calendar-dashboard.tsx`：顶部概览、月/周/列表视图、筛选、日期详情、快速记录、阶段图例、统计卡片、周期进度条和空状态。
- 移动端保留全宽日历、浮在底边栏上方的快速记录胶囊和日期详情 bottom sheet；桌面端使用右侧详情面板。
- 所有预测文案仅作个人记录参考，不提供医疗诊断或避孕建议。

## Habits page

- `/habits` is the authenticated daily habit page and now occupies the final bottom-nav slot.
- `/me` remains the profile/settings surface, but users reach it from the top avatar instead of the bottom nav.
- The page renders a liquid-glass calendar board with Monday-start week view by default and an optional month view. Each date is split between both partners; each partner's half is divided by their active habits and filled as habits are checked off.
- The current user's habit panel is expanded by default and supports add, rename, one-button color selection during create/edit, stop, and date-specific toggle. The create row puts the color button to the left of the input and opens a liquid palette with default rose, bright presets, and custom color. The counterpart panel is read-only and collapsed by default. Completed rows become sage green with a short completion animation instead of using a leading checkbox control.

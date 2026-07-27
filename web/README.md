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

`NEXT_PUBLIC_API_BASE` 默认指向 `http://127.0.0.1:8000`，与后端 `uvicorn` 默认端口一致。

## 开发

```powershell
npm run dev
```

打开 http://localhost:3000 。后端需要同步运行：

```powershell
# 仓库根目录
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
| `/` | 全屏狗狗背景登录页：前景登录框避开正中心，只保留欢迎语、token、进入和管理员入口，支持 `?token=` 或 `#token=` 自动登录 |
| `/admin` | 管理控制台：先用 admin key 验证，再创建配对、选择 token 有效期、复制 token / 入口链接；Clipboard API 失败时自动降级复制；AI 配置会保存上次模型列表、选中模型、高德 key 和“启用 AI 分类”开关，开关默认关闭，开启时必须通过 LLM 模型列表和分类调用校验，失败后界面回到关闭；测试时可选择江西小炒、浩波台球、海友酒店或自定义 POI，先用高德 MCP 获取名称、地址、类型、typecode、评分、人均、特色等证据，再展示高德类型判断和 LLM 诊断 |
| `/timeline` | 当前用户的事件流首页，含关系话语板块、全部 / 见面分段、月份分组、可点击编辑标题与日期范围的线下见面时间河流和狗狗空状态创建入口 |
| `/timeline/[id]` | 事件详情，创建者可从顶部铅笔原地编辑完整事件信息；日历爱心可创建见面或打开所属见面范围编辑；合并的评论 / 图片内容流和底部输入栏覆盖全局底边栏 |
| `/create` | 新建事件，可选择普通小事或线下见面；线下见面保存时自动建立同名见面，不额外填写归属 |
| `/todo` | 双人共享 To Do 式工作区，首屏是“要一起做的事情”，按“今天想吃点 / 出去玩一玩 / 住一晚也好 / 悄悄许个愿”四个默认折叠板块展示；新增输入放在板块顶部，用户先选择手动分类，提交后立刻进入待确认队列并显示解析中；AI 开启时卡片展示 AI 分类和高德候选信息，AI 关闭时不调用 LLM 并使用手动分类，用户仍可改分类后确认加入或丢弃；确认失败会留在详情里展示错误；正式详情内使用选中即保存的单一日期安排、评论作者、照片折叠和高德取证信息；移动端详情覆盖底边栏，日期保存后在任务行右侧用状态色 badge 展示 |
| `/cycle` | 双人共享周期日历 Dashboard，含月 / 周 / 列表视图、筛选、提醒设置和移动端详情面板 |

## 设计基线

- 产品默认按 [`docs/ai/PRODUCT.md`](../docs/ai/PRODUCT.md) 和 [`docs/ai/DESIGN.md`](../docs/ai/DESIGN.md) 执行，气质为“温暖、可爱、舒服、可信”。
- 低饱和玫瑰主操作、暖桃重点、鼠尾草薄荷正向状态、奶油色可读面板，避免晃眼高饱和色、清冷灰后台和低对比彩色文本。
- Inter + Noto Sans SC via `next/font/google`；`font-display` 指向友好的 sans-serif 栈。
- `glass-card` 是柔和手账面板：温暖边界、低对比彩色阴影、浅色/深色模式同步。
- 触控目标 ≥44px，焦点状态可见，遵守 `prefers-reduced-motion`。

## 主要实现点

- **3D 小狗**（`src/components/puppy-scene.tsx`）：基础几何体堆叠 + `useFrame` 跟随鼠标 / 触屏；统一支持 `hero` / `inline` 变体、移动端与桌面端独立镜头构图、点击触发跳跃 + 摇尾巴，以及 `prefers-reduced-motion` 下的弱动效或静态回退。
- **登录主路径**：`/` 使用全屏狗狗背景 + 前景偏置登录框，移动端把表单压在下侧拇指区、桌面端避开狗狗主体，页面只保留必要登录信息；管理员入口和 token 自动登录逻辑保持原样。
- **Timeline 首页**：`/timeline` 顶部为单一关系话语板块，只合并关系状态、在一起天数和当前话语，不放创建、周期、习惯等底边栏已有入口；下方使用“全部 / 见面”分段。见面以北京时间日期范围自动归类双方事件，范围外事件被标记时建立同名单日见面。点击见面标题后通过桌面居中窗口或移动端底部 Sheet 同时编辑标题、开始日期和结束日期；重叠合并前提示保留标题，也可确认取消整个见面，不显示加号或记录选择器。手机端事件项保持更轻的行式卡片，空状态使用 inline 小狗和现有创建弹层联动。
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

- `/cycle` 是登录后的周期日历页面，从 `/timeline` 入口进入，使用现有 token 鉴权。
- 页面使用 React + TypeScript + Tailwind CSS，配合 shadcn/ui 风格本地组件、lucide-react、framer-motion 和 date-fns。
- 数据来自后端 `/cycles/dashboard`，保存、删除、清空、示例数据通过 `/cycles/logs` 与 `/cycles/example-data` 完成，不依赖前端 mock 作为真实数据源。
- 主要组件在 `src/components/cycle-calendar-dashboard.tsx`：顶部概览、月/周/列表视图、筛选、日期详情、快速记录、阶段图例、统计卡片、周期进度条和空状态。
- 移动端保留全宽日历、底部固定快速记录按钮和日期详情 bottom sheet；桌面端使用右侧详情面板。
- 所有预测文案仅作个人记录参考，不提供医疗诊断或避孕建议。

## Habits page

- `/habits` is the authenticated daily habit page and now occupies the final bottom-nav slot.
- `/me` remains the profile/settings surface, but users reach it from the top avatar instead of the bottom nav.
- The page renders a liquid-glass calendar board with Monday-start week view by default and an optional month view. Each date is split between both partners; each partner's half is divided by their active habits and filled as habits are checked off.
- The current user's habit panel is expanded by default and supports add, rename, one-button color selection during create/edit, stop, and date-specific toggle. The create row puts the color button to the left of the input and opens a liquid palette with default rose, bright presets, and custom color. The counterpart panel is read-only and collapsed by default. Completed rows become sage green with a short completion animation instead of using a leading checkbox control.

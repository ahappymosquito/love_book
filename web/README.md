# love · book — 前端

基于 Next.js 15 (App Router) + TypeScript + Tailwind CSS 的双人事件记录应用，对应 FastAPI 后端 `app.main:app`。

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
| `/` | 三维小狗背景 + 明亮手账感登录表单，支持 `?token=` 或 `#token=` 自动登录 |
| `/admin` | 管理控制台：先用 admin key 验证，再创建配对、选择 token 有效期、复制 token / 入口链接；Clipboard API 失败时自动降级复制 |
| `/timeline` | 当前用户的事件流，含纪念日、语录、todo / 周期入口和月份分组 |
| `/timeline/[id]` | 事件详情，合并的内容流（评论 / 语音气泡 / 图片缩略），底部输入栏支持文字 / 按住说话 / 图片 |
| `/create` | 新建事件 |
| `/todo` | 双人共享吃饭 / 玩乐 todo 看板，含日期安排、餐厅搜索、随机抽奖和打卡详情 |
| `/cycle` | 双人共享周期日历 Dashboard，含月 / 周 / 列表视图、筛选、提醒设置和移动端详情面板 |

## 设计基线

- 产品默认按根目录 [`PRODUCT.md`](../PRODUCT.md) 和 [`DESIGN.md`](../DESIGN.md) 执行，气质为“温暖、可爱、舒服、可信”。
- 低饱和玫瑰主操作、暖桃重点、鼠尾草薄荷正向状态、奶油色可读面板，避免晃眼高饱和色、清冷灰后台和低对比彩色文本。
- Inter + Noto Sans SC via `next/font/google`；`font-display` 指向友好的 sans-serif 栈。
- `glass-card` 是柔和手账面板：温暖边界、低对比彩色阴影、浅色/深色模式同步。
- 触控目标 ≥44px，焦点状态可见，遵守 `prefers-reduced-motion`。

## 主要实现点

- **3D 小狗**（`src/components/puppy-scene.tsx`）：基础几何体堆叠 + `useFrame` 跟随鼠标 / 触屏；点击触发跳跃 + 摇尾巴；登录页用浅色覆盖层让动画退到任务背景。
- **录音**：按住麦克风开始录音，松开发送，上滑取消；录音控件禁用浏览器长按菜单和文本选择，停止后直接 `POST /events/{id}/voices`，后端转 MP3 后写入 `voices.data`。
- **图片**：通过系统图片选择器进入相册 / 拍照来源，不强制调用相机；选择后前端先压缩大图并乐观渲染，详情页优先加载 `/images/{id}/thumb` 缩略图，点开才加载原图。
- **凭据**：用户 token 存 `localStorage` (`pair-events-token`)；admin key 仅留在 zustand 内存 + sessionStorage 标记；过期 token 会在登录时提示失效。
- **复制兼容**：管理员复制 token / 入口链接时优先使用 `navigator.clipboard.writeText`，生产浏览器拒绝剪贴板权限或非安全上下文时降级为隐藏 `textarea` + `execCommand("copy")`。

## 首页纪念日与节日提醒

- `/admin` 创建 pair 时可设置情侣日期，pair 列表里可继续编辑。
- `/timeline` 顶端提醒块展示“双方昵称在一起第 N 天”、520/1314/整月纪念、固定恋爱节日、中国大陆节假日/调休标签和最终文案。
- 一言模块已弃用；普通日文案由后端从当前 pair 的数据库语录库和 `default_quotes` 全站共享兜底语录表合并后的随机池中选取。
- `/timeline` 在纪念日卡片右侧提供语录刷新和编辑图标；刷新会重新请求提醒文案，编辑可添加、查看和删除当前 pair 的共享语录，保存后编辑区自动收起，提醒接口失败时仍会用 `me.love_started_on` 做基础天数兜底。
## 周期日历 Dashboard

- `/cycle` 是登录后的周期日历页面，从 `/timeline` 入口进入，使用现有 token 鉴权。
- 页面使用 React + TypeScript + Tailwind CSS，配合 shadcn/ui 风格本地组件、lucide-react、framer-motion 和 date-fns。
- 数据来自后端 `/cycles/dashboard`，保存、删除、清空、示例数据通过 `/cycles/logs` 与 `/cycles/example-data` 完成，不依赖前端 mock 作为真实数据源。
- 主要组件在 `src/components/cycle-calendar-dashboard.tsx`：顶部概览、月/周/列表视图、筛选、日期详情、快速记录、阶段图例、统计卡片、周期进度条和空状态。
- 移动端保留全宽日历、底部固定快速记录按钮和日期详情 bottom sheet；桌面端使用右侧详情面板。
- 所有预测文案仅作个人记录参考，不提供医疗诊断或避孕建议。

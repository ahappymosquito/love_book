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
| `/` | 三维小狗 + 玻璃登录卡，支持 `?token=` 或 `#token=` 自动登录 |
| `/admin` | 管理控制台：先用 admin key 验证，再创建配对、选择 token 有效期、复制 token / 入口链接；Clipboard API 失败时自动降级复制 |
| `/timeline` | 当前用户的事件流，玻璃卡片瀑布 |
| `/timeline/[id]` | 事件详情，合并的内容流（评论 / 语音气泡 / 图片缩略），底部输入栏支持文字 / 录音 / 图片 |
| `/create` | 新建事件 |

## 设计基线

- 玫瑰金 / 桃粉 / 米白 / 深棕的暖色调，自动跟随系统暗色
- Fraunces (display) + Inter + Noto Sans SC (body) via `next/font/google`
- 玻璃卡片 (`backdrop-blur-xl`) + 圆角 24px + 双层阴影
- 触控目标 ≥44px，遵守 `prefers-reduced-motion`

## 主要实现点

- **3D 小狗**（`src/components/puppy-scene.tsx`）：基础几何体堆叠 + `useFrame` 跟随鼠标 / 触屏；点击触发跳跃 + 摇尾巴；周围漂浮粉色心形粒子 + 星空。
- **录音**：`MediaRecorder` 采用 `audio/webm;codecs=opus` 优先，停止后直接 `POST /events/{id}/voices`。
- **图片**：选择后 `URL.createObjectURL` 立即乐观渲染，上传完成后用真实 ID 替换。
- **凭据**：用户 token 存 `localStorage` (`pair-events-token`)；admin key 仅留在 zustand 内存 + sessionStorage 标记；过期 token 会在登录时提示失效。
- **复制兼容**：管理员复制 token / 入口链接时优先使用 `navigator.clipboard.writeText`，生产浏览器拒绝剪贴板权限或非安全上下文时降级为隐藏 `textarea` + `execCommand("copy")`。

## 首页纪念日与节日提醒

- `/admin` 创建 pair 时可设置情侣日期，pair 列表里可继续编辑。
- `/timeline` 顶端提醒块展示“一起第 N 天”、520/1314/整月纪念、固定恋爱节日、中国大陆节假日/调休标签和最终文案。
- 普通日文案由后端优先取一言 API，失败后使用本地随机情话；前端在提醒接口失败时会用 `me.love_started_on` 做基础天数兜底。
- 前端会在 `localStorage` 缓存最近 3 条普通日情话，进入时间线时先展示缓存/本地结果，再用 `/auth/anniversary` 的新结果刷新。

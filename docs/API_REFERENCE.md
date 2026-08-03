# Love Book API 参考

这是一个基于 FastAPI 的后端接口项目，围绕“两位固定伴侣用户共同参与事件”的场景设计。每个事件只属于一对用户，双方都可以创建事件、发表评论和上传图片。事件创建者可以选择公开可见，或者选择“双方都提交过评论或图片后再互相可见”。

> ⚙️ **生产部署**：docker-compose + Caddy 自动 HTTPS 一键部署到 `qrqto.club` 的完整说明见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。
> 🚀 **服务器一键部署**：使用预构建 GHCR 镜像时，可用 [`deploy_server.sh`](../deploy_server.sh) 在服务器生成 `.env` / `Caddyfile` / `docker-compose.yml` 并启动服务，后续通过 `scripts/update_production.sh` 检查稳定版 `latest`、备份并更新；真实密码只通过服务器 env 文件传入。
>
> 🗄️ **媒体存储**：图片原图和缩略图写入 `MEDIA_ROOT`，数据库只保存相对 `storage_key`；旧 `images.data` / `images.thumb_data` 记录仍可回退读取。升级前已有的 `voices` 表和媒体文件会原样保留为不可达备份，不再通过产品接口读取。
> 🏷️ **版本与镜像**：根目录 `VERSION` 是前后端唯一应用版本；普通提交只验证，只有与它一致的 `vX.Y.Z` 标签才发布同版本 GHCR 镜像。完整流程见 [`VERSIONING.md`](VERSIONING.md)。

## 功能概览

- 管理端一次创建一对用户，并返回两个入口 token，支持默认永久有效或指定过期时间。
- 用户可在已登录状态设置唯一登录名和安全密码，密码登录会签发 90 天有效的随机 Bearer 会话；邮件和入口链接继续使用原入口 token。
- 普通接口使用 `Authorization: Bearer <token>` 鉴权，每个 token 直接代表一个用户身份和确定的 pair 关系。
- 未登录首页提供像素小花草原跑酷与匿名全站 Top 3 排行榜；达到入榜门槛后可留下 1–12 字符的 Unicode 名字。
- 两位用户都可以创建事件、提交评论、上传图片，并对可见留言添加点赞 / 倒赞 reaction。
- 线下见面使用内部 `meeting_sessions` 作为真实见面次数统计单位，并以 `started_on / ended_on` 保存包含首尾整天的北京时间范围；范围内双方事件自动归类，标记范围外事件时自动建立同名单日见面。双方点击见面标题可同时编辑标题与日期范围，重叠范围自动合并并保留较早标题，也可取消整个见面；不再提供加号或手动归入流程，事件内容权限保持不变。
- 事件、内容和留言 reaction 写接口会在响应返回前完成数据库提交，前端创建、评论或点 reaction 后可以立即刷新详情。
- 只有 pair 内的两位用户能访问该 pair 的事件和内容。
- 支持两种事件可见模式：
  - `public`: 事件下评论 / 图片提交后立即对双方可见。
  - `mutual_submit`: 双方各自至少提交过一条评论或图片后，双方才能看到全部内容。

## 项目结构

```text
app/
  main.py                 FastAPI 应用入口
  models.py               SQLAlchemy 数据模型
  schemas.py              Pydantic 请求/响应模型
  services.py             可见性、权限和内容过滤逻辑
  storage.py              本地图片媒体存储 key、路径校验和读写
  core/
    config.py             环境配置
    database.py           数据库连接和建表
  api/
    dependencies.py       管理密钥和 Bearer token 鉴权
    routes/
      admin_auth.py       管理密钥校验接口
      admin.py            管理接口入口（创建、列出 pair）
      auth.py             当前用户、密码登录与安全凭据接口
      game.py             匿名跑酷排行榜接口
  security_credentials.py 登录名规范化、Argon2id 哈希与登录冷却
      quotes.py           情侣共享本地语录库接口
      events.py           事件接口
      meeting_sessions.py 共享见面标题/日期范围编辑、合并和取消接口
      contents.py         评论、留言 reaction、图片和内容接口
tests/
  test_api.py             核心接口测试
scripts/
  version.py                  同步并校验统一应用版本
  migrate_images_to_media.py  手动把历史图片 BLOB 迁出到媒体目录
VERSION                       前后端唯一应用版本
CHANGELOG.md                  未发布与正式发布变更记录
pyproject.toml / poetry.lock  后端直接依赖与完整锁文件
deploy_server.sh          服务器预构建镜像一键部署脚本
```

## 安装依赖

```powershell
poetry sync --no-root
```

项目使用 Poetry 2.2+ 锁定后端依赖；前端在 `web/` 下执行 `npm ci`。

## 配置项

应用启动时会读取项目根目录下的 `.env` 文件。真实系统环境变量仍然可以覆盖 `.env` 中的同名配置，适合线上部署时使用。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./pair_events.db` | 数据库连接地址。默认使用当前目录下的 SQLite 文件。 |
| `ADMIN_KEY` | `change-me` | 管理接口密钥，请求管理接口时放在 `X-Admin-Key` 请求头中。 |
| `MAX_IMAGE_BYTES` | `10485760` | 单张图片文件最大字节数，默认 10MB。 |
| `MEDIA_ROOT` | `/app/media` | 图片原图和缩略图的本地媒体根目录；Docker 中由 `love_book_media` volume 持久化。 |
| `MEDIA_STORAGE` | `local` | 当前图片存储后端，现阶段固定使用本地文件。 |

图片缩略图由 Pillow 生成。

开发环境可以先复制示例文件：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`：

```env
ADMIN_KEY=your-admin-key
DATABASE_URL=sqlite:///./pair_events.db
MAX_IMAGE_BYTES=10485760
MEDIA_ROOT=/app/media
MEDIA_STORAGE=local
```

## 启动服务

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

启动后可以访问：

- Swagger 文档：`http://127.0.0.1:8000/docs`
- OpenAPI JSON：`http://127.0.0.1:8000/openapi.json`

应用启动时会自动创建数据库表。v1 暂未接入 Alembic 迁移。

## 前端启动（`web/`）

仓库内 `web/` 目录是一个独立的 Next.js (App Router) + TypeScript + Tailwind 工程，作为这个 API 的官方前端。详见 [`web/README.md`](../web/README.md)。

```powershell
cd web
npm install
npm run dev
```

默认访问 http://localhost:3000 。前端通过 `NEXT_PUBLIC_API_BASE`（默认 `http://127.0.0.1:8000`）调用本后端，**需要同时启动后端的 `uvicorn`**。

页面：

- `/` 登录页（居中响应式像素小花草原跑酷、左右分区触控、匿名 Top 3 排行榜和按方向收放的登录卡，支持安全密码、手动 token，以及 `?token=` / `#token=` 自动登录）
- `/admin` 管理控制台（先用 `ADMIN_KEY` 验证身份，然后创建配对 / 复制 token / 复制入口链接；入口链接按当前浏览器 origin 动态生成，复制失败会自动降级到隐藏文本框复制）
- `/timeline` 事件列表首页（单列精选语录、全部 / 见面分段、见面标题与日期范围弹窗编辑、月份分组、静态空状态和底边栏导航）
- `/timeline/[id]` 事件详情（创建者可原地编辑标题、描述、发生时间和可见方式；日历爱心可创建见面或打开所属见面编辑窗口；评论 / 图片混排，底部输入栏支持文字和相册）
- `/me` 我的页面（当前用户头像、用户名、邮箱、常用位置、共享语录和安全密码管理）
- `/create` 新建事件
- `/todo` 共享 todo 工作区（四板块待确认队列 / 中央任务 / 右侧详情布局，默认展示全部未完成事项，按要完成时间排序，含详情内日期安排、描述编辑、双方打卡评论完成、照片折叠大图预览、餐厅搜索、随机抽奖和打卡详情）
- `/cycle` 周期日历 Dashboard（月 / 周 / 列表视图、筛选、提醒设置和移动端详情面板）

## 前端设计上下文

- 产品默认按 [`PRODUCT.md`](ai/PRODUCT.md) 和 [`DESIGN.md`](ai/DESIGN.md) 的 product register 执行，目标气质为“温暖、可爱、舒服、可信”。
- 当前视觉基线是柔和恋爱手账型产品 UI：低饱和玫瑰主操作、暖桃重点、鼠尾草薄荷正向状态、奶油色可读面板。
- 前端避免晃眼高饱和色、清冷灰后台、装饰玻璃拟态、渐变文字和低对比彩色文本。登录页用 Canvas 2D 像素跑酷承担陪伴感，Timeline 首页不展示动态小狗，以实体语录内容层和静态空状态保持阅读安静；Three.js 仅继续服务 Todo 抽奖。

token 分发链接形如 `http://localhost:3000/?token=xxx` 或 `https://qrqto.club/?token=xxx`；管理端会按当前访问域名和协议动态生成，链接本身携带身份凭据，请只通过可信渠道发送。

## 鉴权说明

### 管理接口鉴权

管理接口需要请求头：

```http
X-Admin-Key: your-admin-key
```

如果缺失或错误，会返回 `403`。

### 普通接口鉴权

普通业务接口需要请求头：

```http
Authorization: Bearer <token>
```

入口 token 由管理接口生成，默认永久有效；创建 pair 时也可以指定统一的过期时间。用户还可用安全密码换取 90 天有效的随机 Bearer 会话。重置安全密码会撤销该用户此前全部密码会话并签发新会话，不影响入口 token、邮件链接或历史免登录链接。过期或已撤销 token 返回 `401`。

## 核心可见性规则

### `public`

事件下任意评论或图片一旦提交，pair 内双方都能看到。

可见留言支持点赞 / 倒赞 reaction。每个用户对同一留言最多保留一个 reaction，切换到另一个表情会替换原表情，再次点击已选表情会取消；reaction 只在留言下方显示表情和数量，不会触发邮件通知，也不会改变提交状态。桌面端鼠标移入留言显示 reaction 操作条，并保留从留言气泡移动到按钮的 hover 桥接区域；移动端长按留言打开底部表情选择。

### `mutual_submit`

只要某个用户提交过评论或图片，就算该用户“已提交”。旧语音记录不参与该状态。

示例：

| 用户 A | 用户 B | 是否解锁 |
| --- | --- | --- |
| 未提交 | 未提交 | 否 |
| 提交评论 | 未提交 | 否 |
| 上传图片 | 未提交 | 否 |
| 上传图片 | 提交评论 | 是 |
| 提交评论 | 提交评论 | 是 |

未解锁时：

- 当前用户只能看到自己提交的评论和图片。
- 当前用户能看到 `counterpart_submitted` 状态，但看不到对方具体内容。
- 对方图片文件下载接口会返回 `403`。
- 邮件通知只提示有新事件或新评论，并提供详情入口；不会展示事件标题、描述或评论正文。

解锁后：

- 双方都能看到事件下全部评论和图片。
- 双方都能下载可见的图片文件。
- 邮件通知可以展示已解锁事件标题、摘要和评论正文。

## 接口文档

下面示例默认服务地址为 `http://127.0.0.1:8000`。

### 接口总览

| 分组 | 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| admin | POST | `/admin/auth` | 无 | 校验管理密钥，前端登录管理页用 |
| admin | POST | `/admin/pairs` | `X-Admin-Key` | 创建一对用户并签发两个 token，可选过期时间 |
| admin | GET | `/admin/pairs` | `X-Admin-Key` | 列出全部配对及其 token |
| auth | POST | `/auth/login/password` | 无 | 使用登录名和安全密码换取 90 天 Bearer 会话 |
| auth | GET | `/auth/me` | `Bearer` | 获取当前用户、对方、pair_id |
| auth | GET | `/auth/me/security-password` | `Bearer` | 获取当前用户安全密码配置状态 |
| auth | PUT | `/auth/me/security-password` | `Bearer` | 设置或重置登录名和安全密码，返回新会话 |
| auth | PATCH | `/auth/me` | `Bearer` | 修改自己的昵称、邮箱或 emoji 头像 |
| auth | PATCH | `/auth/me/location` | `Bearer` | 保存当前用户常用位置，支持坐标逆地理编码或地址地理编码 |
| auth | DELETE | `/auth/me/location` | `Bearer` | 清除当前用户常用位置 |
| auth | POST | `/auth/me/avatar` | `Bearer` | 上传自己的图片头像（multipart） |
| auth | DELETE | `/auth/me/avatar` | `Bearer` | 清除自己的图片头像，回退 emoji/首字 |
| users | GET | `/users/{user_id}/avatar` | `Bearer` 或 `X-Admin-Key` | 下载私有图片头像，同 pair 或管理员可读 |
| quotes | GET | `/quotes` | `Bearer` | 当前 pair 的共享语录列表 |
| quotes | POST | `/quotes` | `Bearer` | 添加一条共享语录 |
| quotes | DELETE | `/quotes/{quote_id}` | `Bearer` | 删除当前 pair 的共享语录 |
| game | GET | `/game/leaderboard` | 无 | 匿名读取全站跑酷 Top 3 和入榜门槛 |
| game | POST | `/game/leaderboard` | 无 | 匿名提交名字和成绩，返回是否入榜及最新榜单 |
| events | POST | `/events` | `Bearer` | 创建事件 |
| events | GET | `/events` | `Bearer` | 当前 pair 的事件列表 |
| events | GET | `/events/{event_id}` | `Bearer` | 事件详情（含已可见内容） |
| events | PATCH | `/events/{event_id}` | `Bearer` | 修改事件，仅创建者 |
| events | DELETE | `/events/{event_id}` | `Bearer` | 删除事件，仅创建者 |
| contents | POST | `/events/{event_id}/comments` | `Bearer` | 提交评论 |
| contents | PUT | `/comments/{comment_id}/reaction` | `Bearer` | 设置或替换当前用户对留言的点赞 / 倒赞 |
| contents | DELETE | `/comments/{comment_id}/reaction` | `Bearer` | 取消当前用户对留言的 reaction |
| contents | POST | `/events/{event_id}/images` | `Bearer` | 上传图片（multipart） |
| contents | GET | `/events/{event_id}/contents` | `Bearer` | 按可见规则过滤后的内容列表 |
| contents | GET | `/images/{image_id}/file` | `Bearer` | 下载图片文件 |
| contents | GET | `/images/{image_id}/thumb` | `Bearer` | 下载图片缩略图 |

### 1. 校验管理密钥

`POST /admin/auth`

用于前端管理页校验输入的密钥。无需任何请求头。

请求体：

```json
{
  "admin_key": "your-admin-key"
}
```

成功响应：

```json
{ "ok": true }
```

密钥错误返回 `401`。

### 2. 创建 pair 并生成两个 token

`POST /admin/pairs`

请求头：

```http
X-Admin-Key: your-admin-key
```

请求体：

```json
{
  "user_a_display_name": "Alice",
  "user_b_display_name": "Bob",
  "user_a_avatar": "🐶",
  "user_b_avatar": "🐱",
  "token_expires_at": "2026-05-06T12:00:00Z"
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `user_a_display_name` | 是 | 用户 A 昵称，1 到 100 字符。 |
| `user_b_display_name` | 是 | 用户 B 昵称，1 到 100 字符。 |
| `user_a_avatar` | 否 | 用户 A 头像（emoji 或短字符串），最长 64。 |
| `user_b_avatar` | 否 | 用户 B 头像（emoji 或短字符串），最长 64。 |
| `token_expires_at` | 否 | 两个 token 的统一过期时间，ISO 8601 格式。省略或传 `null` 表示永久有效；传过去时间会返回 `422`。 |

成功响应：

```json
{
  "pair_id": 1,
  "user_a": {
    "id": 1,
    "display_name": "Alice",
    "avatar": "🐶",
    "avatar_has_image": false,
    "avatar_updated_at": null,
    "created_at": "2026-04-29T12:00:00Z"
  },
  "user_b": {
    "id": 2,
    "display_name": "Bob",
    "avatar": "🐱",
    "avatar_has_image": false,
    "avatar_updated_at": null,
    "created_at": "2026-04-29T12:00:00Z"
  },
  "user_a_token": "token-for-alice",
  "user_b_token": "token-for-bob",
  "user_a_token_expires_at": "2026-05-06T12:00:00Z",
  "user_b_token_expires_at": "2026-05-06T12:00:00Z"
}
```

curl 示例：

```bash
curl -X POST "http://127.0.0.1:8000/admin/pairs" \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"user_a_display_name":"Alice","user_b_display_name":"Bob"}'
```

### 3. 列出所有 pair

`GET /admin/pairs`

请求头：

```http
X-Admin-Key: your-admin-key
```

成功响应是数组，每一项格式与上一节的 `PairCreated` 相同，并额外包含 `created_at`：

```json
[
  {
    "pair_id": 1,
    "user_a": { "id": 1, "display_name": "Alice", "avatar": "🐶", "avatar_has_image": false, "avatar_updated_at": null, "created_at": "2026-04-29T12:00:00Z" },
    "user_b": { "id": 2, "display_name": "Bob", "avatar": "🐱", "avatar_has_image": false, "avatar_updated_at": null, "created_at": "2026-04-29T12:00:00Z" },
    "user_a_token": "token-for-alice",
    "user_b_token": "token-for-bob",
    "user_a_token_expires_at": null,
    "user_b_token_expires_at": null,
    "created_at": "2026-04-29T12:00:00Z"
  }
]
```

按创建时间倒序返回。

### 4. 获取当前用户和对方信息

`GET /auth/me`

请求头：

```http
Authorization: Bearer token-for-alice
```

成功响应：

```json
{
  "user": {
    "id": 1,
    "display_name": "Alice",
    "avatar": "🐶",
    "avatar_has_image": true,
    "avatar_updated_at": "2026-04-29T12:10:00Z",
    "created_at": "2026-04-29T12:00:00Z"
  },
  "counterpart": {
    "id": 2,
    "display_name": "Bob",
    "avatar": "🐱",
    "avatar_has_image": false,
    "avatar_updated_at": null,
    "created_at": "2026-04-29T12:00:00Z"
  },
  "pair_id": 1
}
```

### 5. 修改当前用户资料

`PATCH /auth/me`

请求头：

```http
Authorization: Bearer token-for-alice
```

请求体（所有字段都可选，不传即不修改）：

```json
{
  "display_name": "Alice 新",
  "avatar": "🦊"
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `display_name` | 否 | 新昵称，1 到 100 字符。 |
| `avatar` | 否 | 新头像（emoji 或短字符串），最长 64。 |

成功响应是更新后的用户对象，与 `GET /auth/me` 中 `user` 字段结构相同。当前用户可更新 `display_name`、`avatar` 和 `email`；`email` 空字符串会按 `null` 保存。

### 5.1 常用位置

`PATCH /auth/me/location`

请求头：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

浏览器定位保存：

```json
{ "coords": "120.027121,30.288808" }
```

手动地址保存：

```json
{ "address": "西溪北苑东区", "city": "杭州" }
```

位置按当前用户保存，不共享给另一半。后端会先调用高德 `maps_regeocode` 或 `maps_geo` 解析成功，再写入 `location_label`、`location_address`、`location_city`、`location_coords` 和 `location_updated_at`。高德解析失败返回 502，不写入半成品位置。`DELETE /auth/me/location` 会清空这些字段。

### 5.2 上传、清除和读取图片头像

图片头像和 emoji 头像并存：展示时优先显示上传图片；没有图片或图片读取失败时，回退 `avatar` emoji，再回退昵称首字。图片头像按私有媒体保存到 `MEDIA_ROOT`，数据库只保存相对 storage key 和元数据。

`POST /auth/me/avatar`

请求头：

```http
Authorization: Bearer token-for-alice
Content-Type: multipart/form-data
```

表单字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `file` | 是 | 支持 `image/jpeg`、`image/png`、`image/webp`、`image/gif`，大小受 `MAX_IMAGE_BYTES` 限制。 |

成功响应是更新后的 `UserOut`，其中 `avatar_has_image` 为 `true`，`avatar_updated_at` 为本次更新时间。非法类型返回 `415`，超限返回 `413`。

`DELETE /auth/me/avatar`

清除当前用户上传的图片头像，成功响应是更新后的 `UserOut`，其中 `avatar_has_image` 为 `false`，原有 `avatar` emoji 保留。

`GET /users/{user_id}/avatar`

请求头可使用当前用户 `Bearer` token 或管理员 `X-Admin-Key`。只有同一 pair 的双方和管理员可读取；未上传、已清除、文件缺失或无权限时返回 `404`。成功时返回头像 JPEG 文件，并带 `Cache-Control: private, max-age=604800`。

### 5.3 安全密码与密码会话

`POST /auth/login/password` 接收 `{ "login_name": "xiaohua", "password": "..." }`，成功后返回 `access_token`、`token_type: "bearer"` 和 90 天后的 `expires_at`。错误账号与错误密码统一返回“登录名或安全密码不正确”；账号与 IP 连续失败达到 5 次后进入渐进冷却。

`GET /auth/me/security-password` 返回当前用户的规范化登录名、是否已配置及更新时间。`PUT /auth/me/security-password` 只需当前 Bearer 鉴权，接收登录名和新密码，设置或重置后撤销该用户全部旧 `password` 来源会话，并在响应中返回新会话和最新 `security` 状态；`entry` 来源入口 token 不受影响。

登录名会执行 NFKC、去除首尾空白和 casefold，允许 3–32 个 Unicode 字母/数字及 `._-`，并通过唯一索引避免大小写或全半角重复。密码允许 Unicode、空格和粘贴，长度为 15–128；凭据使用 Argon2id 单向哈希，接口与日志均不返回明文或哈希。

### 5.4 共享语录库

`GET /quotes`、`POST /quotes`、`DELETE /quotes/{quote_id}`

语录库按 pair 共享，双方都可以查看、添加和删除。首页 `/auth/anniversary` 在普通日会从当前 pair 的数据库语录和 `default_quotes` 全站共享兜底语录表合并后的随机池中取一句。应用启动和普通日读取时都会自动补齐默认语录。新增和删除接口都会在响应返回前提交数据库，前端保存后可以立即刷新读到最新内容。前端语录管理集中在 `/me`，Timeline 首页只展示当前纪念日话语和刷新入口。

新增请求体：

```json
{
  "text": "如果碰不到你的双唇，你的笑容就是我的吻痕"
}
```

成功响应：

```json
{
  "id": 1,
  "pair_id": 1,
  "author_id": 1,
  "text": "如果碰不到你的双唇，你的笑容就是我的吻痕",
  "created_at": "2026-04-29T12:00:00Z"
}
```

### 6. 创建事件

`POST /events`

请求体：

```json
{
  "title": "第一次旅行",
  "description": "周末去海边",
  "occurred_at": "2026-04-29T10:00:00Z",
  "visibility_mode": "mutual_submit"
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 事件标题，1 到 200 字符。 |
| `description` | 否 | 事件描述。 |
| `occurred_at` | 否 | 事件发生时间。 |
| `visibility_mode` | 否 | `public` 或 `mutual_submit`，默认 `public`。 |

成功响应会返回事件详情和当前可见内容。

### 7. 获取事件列表

`GET /events`

成功响应：

```json
[
  {
    "id": 1,
    "pair_id": 1,
    "creator_id": 1,
    "title": "第一次旅行",
    "description": "周末去海边",
    "occurred_at": "2026-04-29T10:00:00Z",
    "visibility_mode": "mutual_submit",
    "created_at": "2026-04-29T12:00:00Z",
    "submission_state": {
      "current_user_submitted": true,
      "counterpart_submitted": false,
      "unlocked": false
    }
  }
]
```

### 8. 获取事件详情

`GET /events/{event_id}`

成功响应包含：

- 事件基础信息。
- `submission_state`。
- 按可见规则过滤后的 `contents.comments` 和 `contents.images`。

### 9. 修改事件

`PATCH /events/{event_id}`

只有事件创建者可以修改。

请求体可传部分字段：

```json
{
  "title": "更新后的标题",
  "description": "更新后的描述",
  "visibility_mode": "public"
}
```

非创建者请求会返回 `403`。

### 10. 删除事件

`DELETE /events/{event_id}`

只有事件创建者可以删除。成功返回 `204`。

### 11. 提交评论

`POST /events/{event_id}/comments`

请求体：

```json
{
  "text": "我先写下我的感受"
}
```

成功响应：

```json
{
  "type": "comment",
  "id": 1,
  "event_id": 1,
  "author_id": 1,
  "text": "我先写下我的感受",
  "created_at": "2026-04-29T12:00:00Z"
}
```

### 12. 上传图片

`POST /events/{event_id}/images`

请求类型：`multipart/form-data`

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `file` | 是 | 图片文件。 |
| `width` | 否 | 图片宽度，单位像素。 |
| `height` | 否 | 图片高度，单位像素。 |

支持的图片 MIME 类型：

- `image/jpeg`
- `image/png`
- `image/webp`
- `image/gif`

单张图片最大字节数由环境变量 `MAX_IMAGE_BYTES` 控制，默认 10MB。超出返回 `413`，不支持的 MIME 类型返回 `415`。上传成功后原图写入 `MEDIA_ROOT/images/originals/{pair_id}/{event_id}/...`，约 360px JPEG 缩略图写入 `MEDIA_ROOT/images/thumbs/{pair_id}/{event_id}/...`，数据库只保存相对 key、MIME、尺寸和大小等元数据。详情页优先加载缩略图，点开大图时再加载原图。

curl 示例：

```bash
curl -X POST "http://127.0.0.1:8000/events/1/images" \
  -H "Authorization: Bearer token-for-alice" \
  -F "file=@photo.jpg;type=image/jpeg" \
  -F "width=1024" \
  -F "height=768"
```

成功响应：

```json
{
  "type": "image",
  "id": 1,
  "event_id": 1,
  "author_id": 1,
  "mime_type": "image/jpeg",
  "size_bytes": 234567,
  "width": 1024,
  "height": 768,
  "created_at": "2026-04-29T12:00:00Z"
}
```

### 13. 获取事件内容

`GET /events/{event_id}/contents`

成功响应：

```json
{
  "submission_state": {
    "current_user_submitted": true,
    "counterpart_submitted": true,
    "unlocked": true
  },
  "comments": [
    {
      "type": "comment",
      "id": 1,
      "event_id": 1,
      "author_id": 1,
      "text": "我先写下我的感受",
      "created_at": "2026-04-29T12:00:00Z"
    }
  ],
  "images": [
    {
      "type": "image",
      "id": 1,
      "event_id": 1,
      "author_id": 1,
      "mime_type": "image/jpeg",
      "size_bytes": 234567,
      "width": 1024,
      "height": 768,
      "created_at": "2026-04-29T12:00:00Z"
    }
  ]
}
```

按 `mutual_submit` 规则未解锁时，两个数组只包含当前用户自己提交的内容。

### 14. 下载图片文件

`GET /images/{image_id}/file`

返回原始图片文件流。接口优先读取 `images.storage_key` 指向的本地媒体文件；旧记录没有 key 时回退读取 `images.data`。如果当前用户无权访问该图片，或 `mutual_submit` 事件还未解锁，会返回 `403`；图片不存在返回 `404`。响应会带 `Cache-Control: private` 缓存头。

### 15. 下载图片缩略图

`GET /images/{image_id}/thumb`

返回 JPEG 缩略图。接口优先读取 `images.thumb_storage_key` 指向的本地媒体文件；旧记录没有 key 时回退读取 `images.thumb_data`，如果旧图片还没有缩略图，首次请求会从 `images.data` 懒生成并写回数据库。响应会带 `Cache-Control: private` 缓存头。

## 历史图片迁移

已有数据库如果仍包含 `images.data` / `images.thumb_data`，先备份数据库和媒体目录，然后执行：

```powershell
python scripts/migrate_images_to_media.py
```

脚本会把历史原图和缩略图导出到 `MEDIA_ROOT`，并回填 `storage_key` / `thumb_storage_key`，默认不清空旧 BLOB。确认接口读取正常、备份可用后，才执行可选清理：

```powershell
python scripts/migrate_images_to_media.py --clear-blobs --compact
```

Docker 生产环境迁移服务器时需要同时备份数据库和 `love_book_media` volume。

## 已停用语音数据

语音上传、下载和网页播放能力已经移除。已有部署中的 `voices` 表、BLOB 和 `MEDIA_ROOT/voices` 文件不会在启动或部署时自动删除，只作为不可达备份保留；新安装环境不再创建 `voices` 表。删除一个旧事件时，后端只清理该事件对应的旧 `voices` 行以兼容外键约束，不清理其他历史语音或媒体文件。

## 典型流程

### 公开事件

1. 管理员调用 `POST /admin/pairs` 创建 Alice 和 Bob，拿到两个 token。
2. Alice 调用 `POST /events` 创建事件，`visibility_mode` 使用 `public`。
3. Alice 提交评论或图片。
4. Bob 调用 `GET /events/{event_id}/contents`，立即能看到 Alice 的内容。

### 互锁事件

1. Alice 创建事件，`visibility_mode` 使用 `mutual_submit`。
2. Alice 提交评论。
3. Bob 此时查看内容，只能看到状态：`counterpart_submitted=true`，但看不到 Alice 的评论文本。
4. Bob 提交评论或图片中任意一种内容。
5. 双方都已提交评论或图片，事件解锁。
6. Alice 和 Bob 都能看到全部评论和图片，并能下载对应的图片文件。

## 测试

测试覆盖：

- 管理密钥校验。
- token 鉴权。
- token 过期时间创建、过期拒绝和旧 token 永久有效兼容。
- 当前用户和 counterpart 查询。
- pair 隔离权限。
- 公开事件立即可见。
- 互锁事件任意内容提交后解锁。
- 语音路由已移除，旧语音不参与互锁提交状态。
- 删除含旧语音行的事件时兼容遗留 `voices` 表外键，并保留其他历史语音数据。
- 图片上传后原图和缩略图落盘到 `MEDIA_ROOT`，数据库不再写新图片 BLOB，详情页缩略图接口不拉取原图。
- 旧 `images.data` / `images.thumb_data` 图片仍可读取，避免升级后历史图片失效。
- 只有事件创建者可以修改和删除事件。
- 情侣共享语录库的添加、列表、删除和 pair 隔离权限。

## 像素跑酷排行榜

`GET /game/leaderboard` 和 `POST /game/leaderboard` 均为匿名接口。读取接口返回全站前 3 名 `items` 与当前 `threshold`；不足 3 人时门槛为 0。提交体为 `{ "player_name": "小花", "score": 128 }`，名字去除首尾空白后须为 1–12 个 Unicode 字符，分数须为非负 32 位整数。

榜单按分数降序、创建时间升序、ID 升序排列，同分时较早纪录优先。提交接口返回 `entered`、可空的 `rank`、最新 `items` 和 `threshold`；未入榜的成绩不会保留，成功写入后会在返回前提交并清理第 11 名以后记录。

运行测试：

```powershell
python -m pytest tests -q
```

## 注意事项

- 入口 token 默认永久有效，也可以在创建 pair 时指定过期时间；密码会话固定 90 天有效，重置凭据时只撤销旧密码会话。
- v1 自动建表，并带少量轻量级补列和索引逻辑（包括用户安全凭据字段、`device_tokens.source` 与唯一登录名索引）。已有生产 token 会迁移为 `entry` 来源，`expires_at` 为 `NULL` 时继续永久有效。
- SQLite 适合本地开发；正式部署建议改成 PostgreSQL，并增加迁移、备份和文件存储策略。
- 图片文件默认保存到 `MEDIA_ROOT` 本地目录；Docker 生产部署已用 `love_book_media` named volume 持久化，服务器迁移时要和数据库一起备份。旧语音文件仍可能存在于该 volume 中，除非运维在备份后手动清理。
- `.env` 不应提交到版本库；项目已在 `.gitignore` 中排除 `.env`。
- `ADMIN_KEY` 默认值是 `change-me`，正式环境必须改掉。
- 前端代码在 `web/`，不参与后端 Python 测试。`web/node_modules/`、`web/.next/`、`web/.env.local` 已在 `.gitignore` 中排除。

## 首页纪念日与节日提醒

- 创建 pair 时可设置 `love_started_on` 情侣日期；旧数据未设置时回退到 pair 创建日期。
- 登录后的 `/timeline` 会调用 `GET /auth/anniversary`，展示“双方昵称在一起第 N 天”、520/1314/整月纪念、固定恋爱节日、中国大陆节假日/调休信息和普通日本地语录。
- `/timeline` 事件列表按发生时间 `occurred_at` 所在月份收纳，没有发生时间时回退创建时间 `created_at`；默认只展开当前月份，其他月份可手动展开。
- 登录后的用户页面显示固定底边栏：`/timeline`、`/cycle`、`/create`、`/todo`、`/me`，中间加号进入 `/create` 记一笔，详情页归属 Timeline。
- 首页标题区右侧月亮图标进入 `/cycle` 月经周期记录页面，桌面端和手机端都显示。
- 首页不再常驻展示周期入口；仅在预计月经开始前本机配置的 N 天到预计当天、且今日尚未记录时弹出周期记录提醒，可进入 `/cycle?quickLog=today` 填写或选择当天暂时不写。
- 一言模块已弃用；非特殊日后端从当前 pair 的 `quotes` 数据库语录库和 `default_quotes` 全站共享兜底语录表合并后的随机池中取一句。
- Timeline 首页进入时预读 5 句语录，点击语录文案立即换句，剩余 2 句时后台补充；页面不展示刷新图标或动态小狗，语录管理继续集中在 `/me`。
- 节假日信息使用 `https://timor.tech/api/holiday/info/{YYYY-MM-DD}`；接口失败时静默跳过节假日标签，不影响首页加载。
## 周期日历 Dashboard

- 前端新增 `/cycle` 页面，登录后可通过首页周期提醒进入，或直接访问该路由。
- 后端新增 `/cycles` API，所有接口复用现有 Bearer token 鉴权，并按当前 pair 共享周期记录。
- 新增 `cycle_daily_logs` 表，使用 `pair_id + date` 唯一约束保存单日记录；用户事实记录以是否经期、流量、症状、心情、BBT、宫颈黏液、备注、创建/更新用户与时间为准，非经期阶段由系统按已有周期数据推算。
- `GET /cycles/dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD` 返回区间内已记录日期、今天及之后的预测日期、已有经期锚点时今天之前未记录日期的非经期阶段展示、统计信息和空状态。
- `PUT /cycles/logs/{date}`、`PUT /cycles/logs/{date}/dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD`、`DELETE /cycles/logs/{date}`、`DELETE /cycles/logs`、`POST /cycles/example-data` 用于保存、保存并返回重算 dashboard、删除、清空和生成演示数据；写接口在返回前完成提交。正式前端界面只展示记录、查看、编辑和提醒设置，不再展示演示/清空/导入入口。
- 预测逻辑只基于当前已保存记录做参考展示：经期开始日由连续经期日分段识别，周期长度过滤 21-45 天异常间隔，经期长度过滤 2-10 天异常段，最近 6 个有效周期参与计算且最近 3 个权重更高；数据不足时使用 28 天周期、5 天经期默认值。今天及之后的未记录日期会生成完整预测；今天之前的未记录日期在已有经期锚点时只展示非经期阶段，不回填经期。已记录非经期日的阶段同样由系统推算，但 `is_period=false` 的事实优先，不会被阶段推算改成经期。前端保存周期记录后会使用重算后的 dashboard 实时刷新下个周期预测和日历填充。
- 周期页面“下次经期”展示必须使用 `next_period_start` 到 `next_period_end`，并与日历预测经期色块保持一致；`prediction_start` 到 `prediction_end` 只表示开始日可能浮动范围，不能当作整段经期展示。
- 周期术语不再使用独立知识卡；基础体温 BBT、宫颈黏液、易孕期、排卵日、卵泡期、黄体期等关键词在不干扰按钮和日期格点击的位置提供百科外链，默认使用大陆网络更稳定的百度百科搜索；可信度属于系统算法说明，只在页面内用短文案解释。
- 周期提醒提前天数保存在当前浏览器 localStorage：`love-book:cycle-reminder-days:{pairId}`，默认 3 天、页面限制 1-7 天；当天“暂时不写”状态保存为 `love-book:cycle-reminder-dismissed:{pairId}:{yyyy-MM-dd}`。
- 页面文案保持“记录和预测仅供参考”，不提供医疗诊断或避孕建议。

## Todo 看板、餐厅和模型配置

- 登录后可从底边栏进入 `/todo` todo 看板和 `/cycle` 周期入口；`/todo` 复用当前 Bearer token 鉴权，数据按 pair 双方共享。
- `/todo` 前端采用四板块工作区：桌面端主内容配右侧详情栏，移动端详情以覆盖底边栏的底部弹窗展示。默认展示所有未完成 todo，不按当天过滤；已设置要完成时间的 todo 按日期升序排在前面，未设置时间的 todo 排在后面，已完成/打卡 todo 在下方折叠板块展示。`?date=YYYY-MM-DD` 会预选详情内日期输入，但不会隐藏其它 todo；日期只能在详情内设置或取消，选中日期后立即保存，每个 todo 同时只保留一个日期，任务行右侧用日期 badge 展示并按时间状态着色。Todo 操作不发送邮件通知，Timeline 事件和留言邮件继续保留。
- Todo 项目独立于 `/timeline` 事件，不会自动写入时间线。默认玩乐项目为“唱歌、台球、看电影、拼乐高”，用户也可以自定义新增。
- Todo 任务标签语义为“吃喝 / 玩乐 / 住宿 / 许愿”，`/todo` 主界面使用“今天想吃点 / 出去玩一玩 / 住一晚也好 / 悄悄许个愿”四个板块，其中许愿板块默认展开；四个板块用更明确但低饱和的背景 tint、边框、header 色带、图标底色、标题色和计数 badge 做区分。任务行不重复展示所属分类 badge，餐厅/地点正常解析完成时也不展示“已解析”，只在解析中或解析失败时显示状态提示。新增输入位于板块顶部，输入框右侧提供手动分类选择、“新增”和“许愿”操作；手动分类选择只显示吃喝 / 玩乐 / 住宿，不再显示许愿。“新增”会进入待确认队列并显示“正在解析”；AI 开启时后端优先用 LLM 分类到 `food/play/stay/wish` 并调用高德 MCP 搜索，LLM 失败会持久化关闭 AI 并回退到请求里的手动分类；AI 关闭时后端不调用 LLM，直接使用用户当前选择的 `food/play/stay` 手动分类。“许愿”会直接创建 todo、展开许愿板块并打开详情描述编辑，不进入待确认队列。待确认卡片在 AI 开启时展示 AI 分类，AI 关闭时展示手动分类和高德候选信息，用户可在卡片里改到任意板块后确认加入或丢弃，确认失败时保留卡片和错误提示；后端确认异常返回 502 并保留候选可重试。页面不再展示手动刷新分类按钮。
- MySQL / MariaDB 部署在后端启动时会自动修复 `todo_items.category` 和 `todo_candidates.category` 的旧 ENUM，确保 `food/play/stay/wish` 都能写入；因此住宿“确定加入”不应再因为 `Data truncated for column 'category'` 失败。
- Todo 完成状态要求 pair 双方都至少写过一次打卡评论；评论详情展示作者名，图片上传和详情描述只作为记录内容，不参与完成判定。描述保存到 `todo_items.note`，可在详情页添加、编辑或清空。照片在详情内折叠展示，不按上传人分组。
- 吃饭、玩乐和住宿候选通过后端 `npx -y @amap/amap-maps-mcp-server` 调用高德 MCP 搜索和详情解析；Windows 本地会经 `cmd.exe` 调用 `npx` 以兼容 Node.js 批处理入口，并按该包当前 SDK 的 newline JSON stdio 协议通信，MCP 冷启动默认保留 45 秒超时。当前用户保存常用位置后，餐馆和住宿搜索会先用 5km 周边搜按距离优先返回候选，不足 6 条再用关键字/城市文本搜索补齐并去重；候选卡显示距离、地址、商圈、评分和人均。用户只需要在底部填写想一起做的事，确认高德候选后前端自动刷新并打开详情面板，展示店名、城市、地址、商圈、类型、评分、人均、营业时间、坐标、POI ID、点餐字段、门店照片和高德导航链接。有地点城市和安排日期时，详情页会通过高德天气接口展示轻量天气提醒；天气失败静默降级。高德 key 可在管理端单独配置，`.env` / 服务器环境变量 `AMAP_MAPS_API_KEY` 作为初始默认和兜底。
- Todo 图片写入 `MEDIA_ROOT/todo/images/...`，数据库只保存 `todo_images.storage_key` / `todo_images.thumb_storage_key`，下载接口为 `/todo-images/{image_id}/file` 和 `/todo-images/{image_id}/thumb`；详情页缩略图可打开私有大图，同 pair 双方可通过 `DELETE /todo-images/{image_id}` 删除图片，后端会删除数据库记录并尽力清理原图和缩略图文件。
- `/todo` 随机抽奖支持人均、城市/区域和附近 1/3/5/10km 点选筛选；附近筛选由浏览器定位提供经纬度，失败时静默保留其它筛选。
- 管理端 `/admin` 的 AI / 模型配置区先选择 OpenAI 或 Anthropic 协议，再编辑对应地址和 token，并提供“启用 AI 分类”开关；开关默认关闭，开启时会先保存配置并校验 LLM 模型列表和一次分类调用，任一步失败都会持久化关闭并把界面同步回关闭。获取模型列表后按协议保存最近一次模型列表，刷新页面后继续展示上次列表和选中模型；没有选中模型时获取列表会自动保存第一个模型。测试样例内置“江西小炒(西溪北苑东区店)”`food`、“浩波台球俱乐部(汇银中心店)”`play`、“海友酒店(杭州阿里巴巴全球总部店)”`stay`，也允许输入自定义 POI 名称和城市。测试先通过高德 MCP 获取真实 POI 证据，并以高德 POI 类型作为主判断依据；取证展示名称、地址、城市、区域、类型、typecode、电话、商圈、评分、人均、标签/特色和照片摘要；LLM 只作为补全诊断展示，空回复、协议错配或模型不支持 chat/messages 不会让高德取证测试失败。界面展示“高德取证 -> 高德类型判断 -> LLM 补全诊断”过程；分类补全默认给 64 tokens 输出预算，遇到长度耗尽且正文为空时用 256 tokens 重试一次；高德 `AMAP_MAPS_API_KEY` 单独罗列并可自定义保存。
- 相关环境变量：`AMAP_MAPS_API_KEY`、`LLM_OPENAI_BASE_URL`、`LLM_ANTHROPIC_BASE_URL`、`LLM_API_KEY`、`LLM_PROTOCOL`、`LLM_MODEL`。真实密钥只放 `.env`、服务器 env 文件或管理端数据库配置，不提交仓库。

## 习惯页与每日提醒

- 登录后新增 `/habits` 页面，底边栏最后一项进入习惯页；原 `/me` 设置页继续存在，通过顶部用户头像进入。
- 习惯按用户各自管理，双方互相可见：当前用户可新增、编辑颜色/标题、停用自己的习惯，对方习惯只读展示。
- `/habits` 顶部日期看板采用更高层次的液态玻璃日历容器，支持周视图和月视图，默认周视图并从周一开始；每个格子双方各占一半，每半边按该用户启用习惯数量等分，完成项填充对应颜色；双方当天全部完成时显示低调融合完成态和低干扰庆祝动画。
- 下方清单是上下排列的全宽液态玻璃折叠板块，桌面和移动端都不做左右两栏；默认展开自己、折叠对方；点击自己的习惯会对当前选中日期完成/取消，支持点击昨天或更早日期补记。新增习惯输入框左侧只有一个颜色按钮，直接新增使用默认玫瑰色，点开后展示调色板、明亮预设色和自定义颜色；习惯颜色只在新增或编辑时选择一次，不在每条任务行重复铺开；完成后的任务行整体切换为鼠尾草绿色并播放完成反馈动画。
- 后端新增 `/habits/dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD`、`POST /habits/tasks`、`PATCH /habits/tasks/{id}`、`DELETE /habits/tasks/{id}`、`POST /habits/tasks/{id}/toggle`，全部复用 Bearer token 并按当前 pair 隔离。
- 数据表包括 `habit_tasks`、`habit_checkins` 和 `habit_reminder_runs`；写接口返回前完成数据库提交。
- FastAPI lifespan 内置轻量习惯提醒任务，每天服务器本地时间 00:01 检查昨天。用户昨天有启用习惯且未全部完成时发送邮件；全部完成、无邮箱、无启用习惯或习惯已停用时不发送。提醒邮件链接到 `/habits?date=YYYY-MM-DD`，可携带 token 免登录补记；只有邮件实际投递成功后才写入 `habit_reminder_runs` 去重记录，临时投递失败不会被误记为已发送，单次扫描异常也不会终止后续每日任务。

## 收礼事件与旧回执兼容

- `POST /events/gifts` 使用 multipart 创建收礼事件。`title` 必填；`feedback`、重复提交且最多 3 个的 `feelings`、`occurred_at`、1–5 的 `rating` 和最多 6 个 `files` 均可选。过渡期继续接受旧 `feeling` 文本字段。
- `feelings` 仅接受 `happy / surprised / touched / reassured / cherished / hug / disappointed / wronged / pressured / not_my_style / upset / complicated`，不得重复。
- 收礼事件返回标准 `EventDetail`，`event_kind` 为 `gift_received`，反馈复用 `description`，标签位于 `gift_feelings`，评分位于 `gift_rating`。事件摘要额外返回 `preview_image` 和 `image_count`，照片仍通过 `/images/{id}/file|thumb` 私有接口读取。
- 创建事件及全部照片在同一事务中完成；数据库或媒体写入失败时回滚事件并清理已写文件。
- 收礼日期落在见面范围内时仍保持 `gift_received`，同时写入 `meeting_session_id`，因此会出现在对应见面分组。
- 启动迁移会把所有旧 `love_receipts` 幂等转换为收礼事件并复制媒体；旧心情迁入 `gift_feelings`，旧图片 ID 使用确定性目标路径和唯一映射避免重复。可先运行 `python scripts/migrate_love_receipts_to_gifts.py` 审计，再加 `--apply` 显式执行。旧 `GET /love-receipts` 与详情仅供历史跳转；旧创建、状态推进和提交回执接口返回 `410 Gone`。
- 普通登录页面的公共标题栏不显示退出；唯一的用户退出入口位于 `/me` 设置页。管理端继续保留独立的管理员退出操作。

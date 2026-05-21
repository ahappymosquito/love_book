# 事件双人互动后端接口

这是一个基于 FastAPI 的后端接口项目，围绕“两位固定伴侣用户共同参与事件”的场景设计。每个事件只属于一对用户，双方都可以创建事件、发表评论、上传语音。事件创建者可以选择公开可见，或者选择“双方都提交过任意内容后再互相可见”。

> ⚙️ **生产部署**：docker-compose + nginx + ubuntu:24.04 一键部署到 `db.example.com` 的完整说明见 [`DEPLOY.md`](DEPLOY.md)。
>
> 🖼️ **图片存储**：从 v0.3 起图片直接存入 `images.data`（MySQL `LONGBLOB` / SQLite `BLOB`），不再依赖磁盘文件。手工通过 SQL `INSERT` 入库的写法见 `DEPLOY.md §6.2`。

## 功能概览

- 管理端一次创建一对用户，并返回两个 token，支持默认永久有效或指定过期时间。
- 普通接口使用 `Authorization: Bearer <token>` 鉴权。
- 每个 token 直接代表一个用户身份，用户身份和 pair 关系在 token 生成时确定。
- 两位用户都可以创建事件、提交评论、上传语音、上传图片。
- 只有 pair 内的两位用户能访问该 pair 的事件和内容。
- 支持两种事件可见模式：
  - `public`: 事件下评论 / 语音 / 图片提交后立即对双方可见。
  - `mutual_submit`: 评论、语音、图片地位相同；双方各自至少提交过一条任意内容后，双方才能看到全部内容。

## 项目结构

```text
app/
  main.py                 FastAPI 应用入口
  models.py               SQLAlchemy 数据模型
  schemas.py              Pydantic 请求/响应模型
  services.py             可见性、权限和内容过滤逻辑
  core/
    config.py             环境配置
    database.py           数据库连接和建表
  api/
    dependencies.py       管理密钥和 Bearer token 鉴权
    routes/
      admin_auth.py       管理密钥校验接口
      admin.py            管理接口入口（创建、列出 pair）
      auth.py             当前用户接口
      events.py           事件接口
      contents.py         评论、语音、图片和内容接口
tests/
  test_api.py             核心接口测试
```

## 安装依赖

```powershell
pip install -r requirements.txt
```

如果本机没有 `python` 或 `pip` 在 PATH 中，需要使用你自己的 Python 解释器路径执行同等命令。

## 配置项

应用启动时会读取项目根目录下的 `.env` 文件。真实系统环境变量仍然可以覆盖 `.env` 中的同名配置，适合线上部署时使用。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./pair_events.db` | 数据库连接地址。默认使用当前目录下的 SQLite 文件。 |
| `ADMIN_KEY` | `change-me` | 管理接口密钥，请求管理接口时放在 `X-Admin-Key` 请求头中。 |
| `UPLOAD_DIR` | `uploads` | 语音文件保存目录。 |
| `MAX_VOICE_BYTES` | `10485760` | 单个语音文件最大字节数，默认 10MB。 |
| `MAX_IMAGE_BYTES` | `10485760` | 单张图片文件最大字节数，默认 10MB。 |

开发环境可以先复制示例文件：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`：

```env
ADMIN_KEY=your-admin-key
DATABASE_URL=sqlite:///./pair_events.db
UPLOAD_DIR=uploads
MAX_VOICE_BYTES=10485760
MAX_IMAGE_BYTES=10485760
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

仓库内 `web/` 目录是一个独立的 Next.js (App Router) + TypeScript + Tailwind 工程，作为这个 API 的官方前端。详见 [`web/README.md`](web/README.md)。

```powershell
cd web
npm install
npm run dev
```

默认访问 http://localhost:3000 。前端通过 `NEXT_PUBLIC_API_BASE`（默认 `http://127.0.0.1:8000`）调用本后端，**需要同时启动后端的 `uvicorn`**。

页面：

- `/` 登录页（3D 小狗 + 玻璃登录卡，支持 `?token=` 或 `#token=` 自动登录）
- `/admin` 管理控制台（先用 `ADMIN_KEY` 验证身份，然后创建配对 / 复制 token / 复制入口链接）
- `/timeline` 事件列表
- `/timeline/[id]` 事件详情（评论 / 语音 / 图片混排，底部输入栏支持文字、录音、相册）
- `/create` 新建事件

token 分发链接形如 `http://localhost:3000/?token=xxx`，本身携带身份凭据，请只通过可信渠道发送。

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

token 由管理接口生成，默认永久有效；创建 pair 时也可以指定统一的过期时间。过期 token 会返回 `401`。v1 不提供刷新、撤销、普通注册或登录接口。

## 核心可见性规则

### `public`

事件下任意评论、语音或图片一旦提交，pair 内双方都能看到。

### `mutual_submit`

评论、语音、图片是同等内容类型。只要某个用户提交过其中任意一种内容，就算该用户“已提交”。

示例：

| 用户 A | 用户 B | 是否解锁 |
| --- | --- | --- |
| 未提交 | 未提交 | 否 |
| 提交评论 | 未提交 | 否 |
| 上传语音 | 未提交 | 否 |
| 上传图片 | 未提交 | 否 |
| 提交评论 | 上传语音 | 是 |
| 上传语音 | 提交评论 | 是 |
| 上传图片 | 提交评论 | 是 |
| 上传图片 | 上传语音 | 是 |
| 提交评论 | 提交评论 | 是 |

未解锁时：

- 当前用户只能看到自己提交的评论、语音和图片。
- 当前用户能看到 `counterpart_submitted` 状态，但看不到对方具体内容。
- 对方语音 / 图片文件下载接口会返回 `403`。

解锁后：

- 双方都能看到事件下全部评论、语音和图片。
- 双方都能下载可见的语音和图片文件。

## 接口文档

下面示例默认服务地址为 `http://127.0.0.1:8000`。

### 接口总览

| 分组 | 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| admin | POST | `/admin/auth` | 无 | 校验管理密钥，前端登录管理页用 |
| admin | POST | `/admin/pairs` | `X-Admin-Key` | 创建一对用户并签发两个 token，可选过期时间 |
| admin | GET | `/admin/pairs` | `X-Admin-Key` | 列出全部配对及其 token |
| auth | GET | `/auth/me` | `Bearer` | 获取当前用户、对方、pair_id |
| auth | PATCH | `/auth/me` | `Bearer` | 修改自己的昵称或头像 |
| events | POST | `/events` | `Bearer` | 创建事件 |
| events | GET | `/events` | `Bearer` | 当前 pair 的事件列表 |
| events | GET | `/events/{event_id}` | `Bearer` | 事件详情（含已可见内容） |
| events | PATCH | `/events/{event_id}` | `Bearer` | 修改事件，仅创建者 |
| events | DELETE | `/events/{event_id}` | `Bearer` | 删除事件，仅创建者 |
| contents | POST | `/events/{event_id}/comments` | `Bearer` | 提交评论 |
| contents | POST | `/events/{event_id}/voices` | `Bearer` | 上传语音（multipart） |
| contents | POST | `/events/{event_id}/images` | `Bearer` | 上传图片（multipart） |
| contents | GET | `/events/{event_id}/contents` | `Bearer` | 按可见规则过滤后的内容列表 |
| contents | GET | `/voices/{voice_id}/file` | `Bearer` | 下载语音文件 |
| contents | GET | `/images/{image_id}/file` | `Bearer` | 下载图片文件 |

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
    "created_at": "2026-04-29T12:00:00Z"
  },
  "user_b": {
    "id": 2,
    "display_name": "Bob",
    "avatar": "🐱",
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
    "user_a": { "id": 1, "display_name": "Alice", "avatar": "🐶", "created_at": "2026-04-29T12:00:00Z" },
    "user_b": { "id": 2, "display_name": "Bob", "avatar": "🐱", "created_at": "2026-04-29T12:00:00Z" },
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
    "created_at": "2026-04-29T12:00:00Z"
  },
  "counterpart": {
    "id": 2,
    "display_name": "Bob",
    "avatar": "🐱",
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

成功响应是更新后的用户对象，与 `GET /auth/me` 中 `user` 字段结构相同。

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
- 按可见规则过滤后的 `contents.comments`、`contents.voices` 和 `contents.images`。

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

### 12. 上传语音

`POST /events/{event_id}/voices`

请求类型：`multipart/form-data`

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `file` | 是 | 音频文件。 |
| `duration_ms` | 否 | 语音时长，单位毫秒。 |

支持的音频 MIME 类型：

- `audio/mpeg`
- `audio/mp3`
- `audio/mp4`
- `audio/wav`
- `audio/x-wav`
- `audio/webm`
- `audio/ogg`
- `audio/aac`

curl 示例：

```bash
curl -X POST "http://127.0.0.1:8000/events/1/voices" \
  -H "Authorization: Bearer token-for-alice" \
  -F "file=@voice.webm;type=audio/webm" \
  -F "duration_ms=3200"
```

成功响应：

```json
{
  "type": "voice",
  "id": 1,
  "event_id": 1,
  "author_id": 1,
  "duration_ms": 3200,
  "mime_type": "audio/webm",
  "size_bytes": 12345,
  "created_at": "2026-04-29T12:00:00Z"
}
```

超出大小返回 `413`，不支持的 MIME 类型返回 `415`。

### 13. 上传图片

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

单张图片最大字节数由环境变量 `MAX_IMAGE_BYTES` 控制，默认 10MB。超出返回 `413`，不支持的 MIME 类型返回 `415`。

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

### 14. 获取事件内容

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
  "voices": [
    {
      "type": "voice",
      "id": 1,
      "event_id": 1,
      "author_id": 2,
      "duration_ms": 3200,
      "mime_type": "audio/webm",
      "size_bytes": 12345,
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

按 `mutual_submit` 规则未解锁时，三个数组只包含当前用户自己提交的内容。

### 15. 下载语音文件

`GET /voices/{voice_id}/file`

返回原始音频文件流。如果当前用户无权访问该语音，或 `mutual_submit` 事件还未解锁，会返回 `403`；语音不存在返回 `404`。

### 16. 下载图片文件

`GET /images/{image_id}/file`

返回原始图片文件流。如果当前用户无权访问该图片，或 `mutual_submit` 事件还未解锁，会返回 `403`；图片不存在返回 `404`。

## 典型流程

### 公开事件

1. 管理员调用 `POST /admin/pairs` 创建 Alice 和 Bob，拿到两个 token。
2. Alice 调用 `POST /events` 创建事件，`visibility_mode` 使用 `public`。
3. Alice 提交评论、语音或图片。
4. Bob 调用 `GET /events/{event_id}/contents`，立即能看到 Alice 的内容。

### 互锁事件

1. Alice 创建事件，`visibility_mode` 使用 `mutual_submit`。
2. Alice 提交评论。
3. Bob 此时查看内容，只能看到状态：`counterpart_submitted=true`，但看不到 Alice 的评论文本。
4. Bob 上传语音或图片中任意一种内容。
5. 双方都已提交任意内容，事件解锁。
6. Alice 和 Bob 都能看到全部评论、语音和图片，并能下载对应的语音 / 图片文件。

## 测试

测试覆盖：

- 管理密钥校验。
- token 鉴权。
- token 过期时间创建、过期拒绝和旧 token 永久有效兼容。
- 当前用户和 counterpart 查询。
- pair 隔离权限。
- 公开事件立即可见。
- 互锁事件任意内容提交后解锁。
- 未解锁时阻止下载对方语音。
- 只有事件创建者可以修改和删除事件。
- 非音频文件上传被拒绝。

运行测试：

```powershell
python -m pytest tests -q
```

## 注意事项

- v1 token 默认永久有效，也可以在创建 pair 时指定过期时间；尚未提供刷新和撤销机制。
- v1 自动建表，并带少量轻量级补列逻辑（如 `users.avatar`、`device_tokens.expires_at`）。已有生产数据库中的旧 token 因 `expires_at` 为 `NULL` 会继续永久有效。
- SQLite 适合本地开发；正式部署建议改成 PostgreSQL，并增加迁移、备份和文件存储策略。
- 上传文件默认保存到本地目录，正式部署时需要考虑对象存储或持久化挂载。
- `.env` 不应提交到版本库；项目已在 `.gitignore` 中排除 `.env`。
- `ADMIN_KEY` 默认值是 `change-me`，正式环境必须改掉。
- 前端代码在 `web/`，不参与后端 Python 测试。`web/node_modules/`、`web/.next/`、`web/.env.local` 已在 `.gitignore` 中排除。

## 首页纪念日与节日提醒

- 创建 pair 时可设置 `love_started_on` 情侣日期；旧数据未设置时回退到 pair 创建日期。
- 登录后的 `/timeline` 会调用 `GET /auth/anniversary`，展示“一起第 N 天”、520/1314/整月纪念、固定恋爱节日和中国大陆节假日/调休信息。
- 非特殊日后端调用一言 `https://v1.hitokoto.cn/?c=e&c=f&max_length=30&encode=json` 获取小情话；失败时随机使用本地情话。
- 节假日信息使用 `https://timor.tech/api/holiday/info/{YYYY-MM-DD}`；接口失败时静默跳过节假日标签，不影响首页加载。

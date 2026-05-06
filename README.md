# 事件双人互动后端接口

这是一个基于 FastAPI 的后端接口项目，围绕“两位固定伴侣用户共同参与事件”的场景设计。每个事件只属于一对用户，双方都可以创建事件、发表评论、上传语音。事件创建者可以选择公开可见，或者选择“双方都提交过任意内容后再互相可见”。

## 功能概览

- 管理端一次创建一对用户，并返回两个永久 token。
- 普通接口使用 `Authorization: Bearer <token>` 鉴权。
- 每个 token 直接代表一个用户身份，用户身份和 pair 关系在 token 生成时确定。
- 两位用户都可以创建事件、提交评论、上传语音。
- 只有 pair 内的两位用户能访问该 pair 的事件和内容。
- 支持两种事件可见模式：
  - `public`: 事件下评论和语音提交后立即对双方可见。
  - `mutual_submit`: 评论和语音地位相同；双方各自至少提交过一条任意内容后，双方才能看到全部评论和语音。

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
      admin.py            管理接口
      auth.py             当前用户接口
      events.py           事件接口
      contents.py         评论、语音和内容接口
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

token 由管理接口生成，永久有效。v1 不提供刷新、撤销、普通注册或登录接口。

## 核心可见性规则

### `public`

事件下任意评论或语音一旦提交，pair 内双方都能看到。

### `mutual_submit`

评论和语音是同等内容类型。只要某个用户提交过任意一种内容，就算该用户“已提交”。

示例：

| 用户 A | 用户 B | 是否解锁 |
| --- | --- | --- |
| 未提交 | 未提交 | 否 |
| 提交评论 | 未提交 | 否 |
| 上传语音 | 未提交 | 否 |
| 提交评论 | 上传语音 | 是 |
| 上传语音 | 提交评论 | 是 |
| 提交评论 | 提交评论 | 是 |
| 上传语音 | 上传语音 | 是 |

未解锁时：

- 当前用户只能看到自己提交的评论和语音。
- 当前用户能看到 `counterpart_submitted` 状态，但看不到对方具体内容。
- 对方语音文件下载接口会返回 `403`。

解锁后：

- 双方都能看到事件下全部评论和语音。
- 双方都能下载可见语音文件。

## 接口文档

下面示例默认服务地址为 `http://127.0.0.1:8000`。

### 1. 创建 pair 并生成两个 token

`POST /admin/pairs`

请求头：

```http
X-Admin-Key: your-admin-key
```

请求体：

```json
{
  "user_a_display_name": "Alice",
  "user_b_display_name": "Bob"
}
```

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
  "user_b_token": "token-for-bob"
}
```

curl 示例：

```bash
curl -X POST "http://127.0.0.1:8000/admin/pairs" \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"user_a_display_name":"Alice","user_b_display_name":"Bob"}'
```

### 2. 获取当前用户和对方信息

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
    "created_at": "2026-04-29T12:00:00Z"
  },
  "counterpart": {
    "id": 2,
    "display_name": "Bob",
    "created_at": "2026-04-29T12:00:00Z"
  },
  "pair_id": 1
}
```

### 3. 创建事件

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

### 4. 获取事件列表

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

### 5. 获取事件详情

`GET /events/{event_id}`

成功响应包含：

- 事件基础信息。
- `submission_state`。
- 按可见规则过滤后的 `contents.comments` 和 `contents.voices`。

### 6. 修改事件

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

### 7. 删除事件

`DELETE /events/{event_id}`

只有事件创建者可以删除。成功返回 `204`。

### 8. 提交评论

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

### 9. 上传语音

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

### 10. 获取事件内容

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
  ]
}
```

### 11. 下载语音文件

`GET /voices/{voice_id}/file`

如果当前用户无权访问该语音，或 `mutual_submit` 事件还未解锁，会返回 `403`。

## 典型流程

### 公开事件

1. 管理员调用 `POST /admin/pairs` 创建 Alice 和 Bob，拿到两个 token。
2. Alice 调用 `POST /events` 创建事件，`visibility_mode` 使用 `public`。
3. Alice 提交评论或语音。
4. Bob 调用 `GET /events/{event_id}/contents`，立即能看到 Alice 的内容。

### 互锁事件

1. Alice 创建事件，`visibility_mode` 使用 `mutual_submit`。
2. Alice 提交评论。
3. Bob 此时查看内容，只能看到状态：`counterpart_submitted=true`，但看不到 Alice 的评论文本。
4. Bob 上传语音。
5. 双方都已提交任意内容，事件解锁。
6. Alice 和 Bob 都能看到全部评论和语音，并能下载语音文件。

## 测试

测试覆盖：

- 管理密钥校验。
- token 鉴权。
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

- v1 使用永久 token，没有刷新和撤销机制。
- v1 自动建表，尚未引入数据库迁移工具。
- SQLite 适合本地开发；正式部署建议改成 PostgreSQL，并增加迁移、备份和文件存储策略。
- 上传文件默认保存到本地目录，正式部署时需要考虑对象存储或持久化挂载。
- `.env` 不应提交到版本库；项目已在 `.gitignore` 中排除 `.env`。
- `ADMIN_KEY` 默认值是 `change-me`，正式环境必须改掉。
- 前端代码在 `web/`，不参与后端 Python 测试。`web/node_modules/`、`web/.next/`、`web/.env.local` 已在 `.gitignore` 中排除。

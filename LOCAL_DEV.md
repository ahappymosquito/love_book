# 本地开发启动

## 入口脚本

- 脚本路径：`C:\RPA\code\love_book\start_dev.bat`
- 默认行为：直接启动后端 FastAPI 和前端 Next.js 开发服务
- 安装模式：`start_dev.bat --install`

## 启动说明

### 1. 仅启动服务

```powershell
.\start_dev.bat
```

该模式不会安装依赖，适合本地环境已经准备好的情况。

### 2. 安装依赖并启动

```powershell
.\start_dev.bat --install
```

该模式会依次执行：

1. `python -m pip install -r requirements.txt`
2. `npm install`（位于 `web/` 目录）
3. 启动后端开发服务：`http://127.0.0.1:8000`
4. 启动前端开发服务：`http://localhost:3000`

## 环境要求

- `python` 或 `py` 已加入 PATH
- `npm` / `npx` 已加入 PATH；餐厅搜索会通过 `npx -y @amap/amap-maps-mcp-server` 调用高德 MCP
- 前后端依赖源可正常访问

## Todo / 高德 / LLM 配置

- `/todo` 需要后端和前端同时启动，前端入口在 `/timeline` 首页标题区右侧。
- `.env` 需要配置 `AMAP_MAPS_API_KEY`，用于餐厅搜索、详情解析和附近抽奖。
- 管理端 AI 配置使用 `.env` 中的 `LLM_OPENAI_BASE_URL`、`LLM_ANTHROPIC_BASE_URL`、`LLM_API_KEY`、`LLM_PROTOCOL`、`LLM_MODEL`。页面只保存协议和模型 ID，不保存密钥。
- 本地测试可用 `python -m pytest`；如果 Windows 默认临时目录无权限，可先设置 `TMP` / `TEMP` 到项目内 `.pytest_tmp`。

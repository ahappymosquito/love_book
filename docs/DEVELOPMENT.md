# Love Book 本地开发

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

1. `poetry sync --no-root --no-interaction`
2. `npm ci --no-audit --no-fund`（位于 `web/` 目录）
3. 启动后端开发服务：`http://127.0.0.1:8000`
4. 启动前端开发服务：`http://localhost:3000`

## 环境要求

- Poetry 2.2+ 已加入 PATH，Python 版本满足 `pyproject.toml`
- `npm` / `npx` 已加入 PATH；餐厅搜索会通过 `npx -y @amap/amap-maps-mcp-server` 调用高德 MCP，Windows 本地会经 `cmd.exe` 调用 `npx`，按 newline JSON stdio 协议通信，MCP 冷启动默认等待 45 秒
- 前后端依赖源可正常访问

## Todo / 高德 / LLM 配置

- `/todo` 需要后端和前端同时启动，前端入口在 `/timeline` 首页标题区右侧。
- `.env` 可配置 `AMAP_MAPS_API_KEY`，用于餐厅搜索、详情解析和附近抽奖；管理端也可以单独覆盖并保存高德 key。
- 管理端 AI 配置使用 `.env` 中的 `LLM_OPENAI_BASE_URL`、`LLM_ANTHROPIC_BASE_URL`、`LLM_API_KEY`、`LLM_PROTOCOL`、`LLM_MODEL` 作为初始默认。页面可保存协议、对应地址、token 和选中模型；获取模型列表后会在下拉框展示模型数量，选择模型会自动测试连接。
- 本地测试使用 `poetry run python -m pytest`；如果 Windows 默认临时目录无权限，可传入 `--basetemp=.pytest-tmp/local`。

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
- `npm` 已加入 PATH
- 前后端依赖源可正常访问

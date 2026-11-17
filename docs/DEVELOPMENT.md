# Love Book 本地开发

## 入口脚本

- 脚本路径：仓库根目录 `start_dev.bat`
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
3. 启动后端开发服务：优先 `http://127.0.0.1:8000`；若该端口被 Windows Hyper-V 保留（`WinError 10013`），则改用 `8100` 等可用端口，并给前端设置 `NEXT_PUBLIC_API_BASE`
4. 启动前端开发服务：`http://localhost:3000`

本地后端默认 `APP_ENV=development`，`.env` 里的占位 `ADMIN_KEY`（`change-me-please`）只会在启动时打印警告，管理端仍可使用。若本地把 `APP_ENV` 设为 `production`（或用 `docker compose` 启动，Compose 默认 `production`），占位密钥会让 `/admin/*` 返回 503，需要换成真实随机密钥。

## 前端约定速查

- 已登录页面的顶部栏、主内容和桌面底边栏共用 `web/src/lib/page-width.ts` 的宽度表，三者左右边缘对齐；新页面主内容直接用 `PAGE_MAIN_WIDTH_CLASS[...]`，并在 `pageWidthForPath` 登记同一档宽度，不要另写 `max-w-*`。宽内容页（Timeline、约会计划、习惯、周期、手账导出）用 7xl，设置和事件详情用 6xl；大屏优先改成多栏或双页布局，而不是把单列拉宽。
- 顶部栏和底边栏的避让高度用 `globals.css` 中的 `--lb-header-clearance` / `--lb-nav-clearance`（已含 safe-area），浮层和吸底控件按这两个变量留空。底栏向下滚动时会自动收起，此时 `<html data-nav-hidden="true">` 把 `--lb-nav-clearance` 缩成只剩安全区；首页手账书页高度用的是不随底栏收起变化的 `--lb-book-chrome`，避免翻页时书页跳动。
- “今天”、月份分组和日期判断统一走 `web/src/lib/dates.ts`，固定按 `Asia/Shanghai` 计算，不要用浏览器本地时区直接切日期。

## 环境要求

- Poetry 2.2+ 已加入 PATH，Python 版本满足 `pyproject.toml`
- `npm` 已加入 PATH（只用于前端；后端不再依赖 Node.js）
- 前后端依赖源可正常访问

## 本地配置提示

- `/todo` 约会计划和 `/cycle` 邮件提醒都只依赖后端与数据库，不需要任何第三方地图或模型 key。周期邮件提醒在后端进程里每天 9:00 扫描，本地没配 SMTP 时只记日志、不发信。
- 本地 `DATABASE_URL` 指向服务器数据库时，图片文件仍在服务器的媒体卷里，本地会显示“没加载出来”。在 `.env` 里设 `MEDIA_REMOTE_API_BASE=https://tingle272.xyz/api`，本地缺图时就会带着当前登录 token 回源线上读取（仅非生产环境生效）。注意本地上传的新图片只写本地 `MEDIA_ROOT`，线上看不到；用线上数据库调试时尽量不要在本地上传。
- 本地测试使用 `poetry run python -m pytest`；如果 Windows 默认临时目录无权限，可传入 `--basetemp=.pytest-tmp-local`。pytest 会自己创建这个目录，不需要预先建 `.pytest-tmp/`。
- Windows 上 `WinError 10013` 表示 8000 被 Hyper-V / WinNAT 保留，不是代码权限错误。不要手工去绑 8000；重新运行 `start_dev.bat`，看窗口里打印的后端地址。手动启动可用 `poetry run python scripts/dev_backend_port.py` 查看当前可用端口。
- 生产发布不走本机 `start_dev.bat`。智能体只读 `LOVE_BOOK_SSH_HOSTS`，步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 本地临时文件

浏览器验证截图、像素草稿、开发日志和一次性脚本放到仓库根目录 `tmp/`，不要写进 `app/`、`web/src/` 或 `docs/`。下列目录都已加入 `.gitignore`，用完可直接删，不要提交：

- `tmp/`：手工 QA 截图、草稿脚本、`next-dev` 日志
- `.playwright-mcp/`、`.playwright-cli/`：Playwright 页面快照和 console 日志
- `.pytest-tmp/`、`.pytest-tmp-local/`、`.pytest-tmp-*/`、`.pytest_cache/`：pytest 运行缓存
- `web/.next/`、`web/out/`、`web/*.tsbuildinfo`：前端构建缓存

`pair_events.db`、`.env`、`media/` 是本地数据和密钥，也不要提交；清理临时文件时不要删它们。

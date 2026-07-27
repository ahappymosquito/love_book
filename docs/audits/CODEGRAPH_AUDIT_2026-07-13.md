# CodeGraph 全项目审计报告（2026-07-13）

审计日期：2026-07-13

审计范围：FastAPI、数据库事务、私有媒体、鉴权与 pair 隔离、Todo/周期/习惯业务、Next.js 状态流与移动端布局。

处置原则：只修复证据充分且可复现的高优先级问题；不改变公共 API、数据库结构或部署接口，不调用真实高德或 LLM 服务。

## 结论

本次审计确认并修复 3 个 P1 问题：习惯提醒循环会被单次异常永久终止、邮件投递失败会被误记为已发送，以及 Todo 餐厅照片允许保存并暴露危险 scheme 链接。每项修复均有最小回归测试，最终后端 120 项测试全部通过，前端生产构建和 ESLint 检查通过。

未发现可复现的跨 pair 越权、私有媒体路径穿越、Todo 候选确认失败后丢失候选、主要页面生产构建失败或目标移动端视口全局横向溢出。其余发现均记录为 P2/P3，未在本次提交中扩展重构。

## CodeGraph 索引与分析方法

- 本地执行 `codegraph init .`，索引目录为 `.codegraph/`，已加入 `.gitignore`，不进入版本库。
- 最终 `codegraph status`：104 files、1,890 nodes、5,031 edges，索引状态为 `up to date`。
- 定位优先使用 `codegraph explore`、`node`、`callers`、`callees`、`impact` 和 `affected`；仅对非代码内容、运行时行为和 UI 实测使用常规搜索与 Playwright 补充验证。
- 修改后使用 `codegraph sync .` 更新索引，并使用 `impact` / `affected` 核对相关调用者与测试影响面。

### 关键调用链

1. FastAPI 生命周期：`app.main.lifespan` → `init_db()` / `habit_reminder_loop()` → `scan_habit_reminders()` → 邮件投递与 `habit_reminder_runs` 去重。
2. 请求鉴权与隔离：Bearer token → `get_current_user()` → `get_pair_for_user()` → 各业务路由按 `pair_id` 查询或写入。
3. Todo 候选：候选创建与 LLM/手动分类 → 高德 MCP 搜索或详情补全 → `_create_item_from_candidate()` → 提交成功后删除候选；异常路径回滚并保留候选。
4. 私有媒体：上传路由 → MIME/尺寸处理 → `MEDIA_ROOT` 下受控 storage key → 同 pair 或管理员鉴权读取；旧图片和语音按兼容规则回退。
5. 周期：pair 共享事实记录 → 提交 → 基于当前记录实时重算 dashboard 与预测，不落库存储预测结果。
6. 前端：认证状态与 API client → `AppHeader` / 全局底栏 → Timeline、Todo、Cycle、Habits、Me；创建弹层与 Todo 详情使用更高层级覆盖底栏。

## 已修复的高优先级问题

### P1：单次扫描异常会永久终止习惯提醒后台任务

- 证据：原 `habit_reminder_loop()` 的无限循环没有扫描级异常边界，数据库或邮件扫描中的普通异常会退出 lifespan 创建的后台 task，之后每日提醒不再执行。
- 修复：在每次扫描外增加异常边界并记录堆栈，保留任务循环；`asyncio.CancelledError` 仍按任务取消语义向上传播。
- 回归测试：`test_habit_reminder_loop_continues_after_scan_failure` 先制造一次临时失败，再确认循环进入第二次扫描。
- CodeGraph 影响：`habit_reminder_loop` 直接影响 FastAPI lifespan 后台任务及新增循环恢复测试。

### P1：邮件失败仍写去重记录，提醒无法重试

- 证据：原 `notify_habit_reminder()` 忽略 `send_email()` 的布尔结果；扫描逻辑无条件写入 `HabitReminderRun`。SMTP 临时失败后，该用户当天会永久被视为已发送。
- 修复：提醒函数返回真实投递结果，仅在成功时写入去重记录并增加发送计数。
- 回归测试：`test_habit_reminder_scan_retries_after_failed_delivery` 验证失败不落去重记录，后续成功投递可以重试并只记录一次。
- 兼容性：没有修改路由、请求/响应模型或数据库结构。

### P1：Todo 餐厅照片可暴露危险外链 scheme

- 证据：认证用户可提交 `first_photo_url`，原实现直接持久化，并通过 `display_facts.href` 返回给前端。类似 `javascript:` 的链接可进入可点击数据流。
- 修复：新增 `safe_external_url()`，只接受具有 host 的绝对 HTTP/HTTPS URL；新写入时清洗，读取历史数据时再次过滤。
- 回归测试：`test_todo_restaurant_drops_unsafe_external_photo_link` 验证危险链接既不保存也不作为展示链接返回。
- CodeGraph 影响：安全过滤覆盖 Todo 餐厅直接创建、候选确认写入和详情事实输出路径。

## 正向验证

- Bearer/Admin 权限与 pair 数据隔离由统一依赖和业务查询共同约束，现有跨 pair 回归测试通过。
- 私有图片、语音、头像和 Todo 图片读取均经过鉴权；storage key 的目标路径受 `MEDIA_ROOT` 约束，未发现可复现的路径穿越。
- Todo 候选确认只在事务成功后删除候选，异常会回滚并返回明确错误，候选可重试。
- Timeline、Cycle、Todo、Habits 的主要写路径在响应前提交；测试覆盖保存后立即读取。
- 节假日、天气、高德和 LLM 的可选失败路径具备降级或明确错误处理，本次没有发起真实外部付费调用。
- 前端生产构建成功，目标移动端视口无全局横向滚动；创建弹层和 Todo 详情层级高于全局底栏。

## UI/UX 审计

| 维度 | 得分 | 结论 |
| --- | ---: | --- |
| Accessibility | 3/4 | 主流程可用；部分详情图标按钮触控尺寸和弹层标题层级仍可改进 |
| Performance | 3/4 | 生产构建正常；3D 登录场景存在一条运行时颜色告警 |
| Responsive | 4/4 | 两个目标视口及关键弹层均未出现全局横向溢出或底栏遮挡 |
| Theming | 3/4 | 主页面遵循项目 token 与温暖实体内容层约定；登录 3D 背景需修复透明色写法 |
| Anti-patterns | 4/4 | 未发现影响主要流程的高风险 UI 反模式 |
| **总分** | **17/20** | **Good** |

### 移动端实测

Playwright 使用临时 SQLite 数据库、临时 pair/token 和本地服务检查 `/timeline`、`/todo`、`/cycle`、`/habits`、`/me`：

| CSS viewport | 页面结果 | 弹层结果 |
| --- | --- | --- |
| 430×932（iPhone 15 Pro Max 条件） | 所有页面 `document.scrollWidth` 与 `body.scrollWidth` 均等于 viewport 宽度 | 无全局横向滚动，安全区未被底栏遮挡 |
| 407×885（小米 17 Pro 条件） | 所有页面 `document.scrollWidth` 与 `body.scrollWidth` 均等于 viewport 宽度 | 创建弹层 z-index 50、Todo 详情 z-index 80，均高于 z-index 40 的底栏且宽度贴合视口 |

## 保留的中低优先级事项

### P2

- 媒体上传在文件写入成功、数据库事务失败时可能留下孤儿文件；删除 Timeline 事件时也不会清理其关联媒体文件。建议后续增加事务补偿清理和定期孤儿扫描。
- Timeline 详情部分纯图标按钮为 40×40，小于项目 44×44 的移动触控目标约定。
- 创建弹层外层先出现 level 2 heading，内部页面又出现 level 1 heading，语义标题层级不连续。
- 登录页控制台出现 `THREE.Color: Unknown color transparent`，来源为 `puppy-scene.tsx` 中将 `transparent` 作为 Three.js 场景背景颜色；当前不阻断登录，但应改为正确的透明渲染配置。

### P3

- `/favicon.ico` 返回 404，不影响应用主流程。
- FastAPI/Starlette 的 `HTTP_413_REQUEST_ENTITY_TOO_LARGE` 常量产生弃用 warning，建议迁移到新常量名后单独验证上传限制。
- `next lint` 将在 Next.js 16 移除，后续应把 lint 脚本迁移为直接调用 ESLint CLI。

建议后续按 `$impeccable harden` 处理无障碍与边界状态，使用 `$impeccable adapt` 复核更多响应式条件，最后以 `$impeccable polish` 收敛视觉细节；这些事项不属于本次 P1 修复提交。

## 验证记录

- `python -m pytest -q --basetemp=.pytest-tmp/codegraph-audit-final`：`120 passed, 1 warning`。
- `npm run build`：成功，TypeScript、Next.js 编译与静态页面生成通过。
- `npm run lint`：成功，无 ESLint warning/error；仅输出 Next.js 16 的 `next lint` 弃用提示。
- CodeGraph `impact` / `affected`：确认 URL 过滤影响 Todo 创建、候选确认与详情输出；习惯提醒变更影响后台循环、扫描服务和对应回归测试。
- Playwright：上述 5 个登录后主页面在 430×932 和 407×885 下通过横向溢出检查，两个关键移动弹层通过宽度与层级检查。
- `git diff --check`：提交前执行。

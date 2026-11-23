# 阶段 0 技术验证记录

> 对应开发规格：`word-camp-development-v1.1.md` §2.2、§15
> 上游基准：Vanilla Class SRS `4fcbf6d4eb6aaacbfc23144a948f1c4dd9e6f065`
> 执行日期：2026-11-23（Asia/Shanghai）
> 结论：**有条件 Go**——可以基于上游分支继续，但上游不能按“开箱即用”对待；下列阻断项必须先修复或绕开，再进入阶段 1。

## 1. 环境

| 项目 | 实测值 | 说明 |
| --- | --- | --- |
| Node.js | v22.23.3 | 满足上游 README 的 Node 20+ |
| npm | 11.10.1 | 使用仓库内 `package-lock.json` 执行 `npm ci`，安装 329 个包 |
| Docker | 29.4.3 | 守护进程可启动；`postgres:16` 镜像可拉取 |
| PostgreSQL | 16（一次性本地容器，仅验证） | 9 个既有迁移全部成功应用 |
| 运行平台 | Windows 11 / PowerShell | 仓库路径含中文，Docker Compose 需显式 `-p wordcamp` |

## 2. §2.2 验证项结果

| 验证项 | 结果 | 证据与说明 |
| --- | --- | --- |
| 启动与部署 | **通过（0.1.1 修复）** | 在干净卷上启动 Compose：db 健康 → `migrate` 应用 9 个迁移 → server 健康 → client 返回 200；`GET /api/health` 为 `ok`；`seed` 创建管理员后 `POST /api/auth/login` 返回 200 且 `mustChangePassword: true`。server / migrator / seeder / client 四个镜像分别构建成功。注意：本机 Docker Desktop 29.4.3 的 `docker compose up --build` 触发 bake gRPC 报错，改用逐镜像 `docker build` + `up --no-build` 验证；CI / Linux 仍需复测。 |
| 权限隔离 | **部分通过** | 路由均有 JWT + 角色 + 对象级校验，静态审计未发现直接越权绕过：`server/src/middleware/auth.ts:19-32,38-51`、`routes/students.ts:13,61-68,181-187,240-246`、`services/review.service.ts:163,426,551`。对一次性 PostgreSQL 库运行 `subjectLead.integration.test.ts`：12/12 通过。但该套件默认跳过（`SL_TEST_DATABASE_URL`），且仓库无 API 级权限矩阵、无 CI。另有权限模型冲突：上游学科组长（SL）可只读查看同事班级学生数据（`classAccess.service.ts:16-18`、`routes/teachers.ts:320`），与规格 §12“教师仅查看授课班级”不一致，需明确取舍。 |
| FSRS 正确性 | **已校正（基准向量通过）** | 阶段 1 按 `ts-fsrs@4.7.0`（FSRS-5.0，MIT）重写 `shared/fsrs/fsrs.ts`：默认 19 权重对齐参考实现；遗忘曲线改为 `(1 + 19/81·t/S)^-0.5`；复习稳定度补 `1 +` 项；难度加入 linear damping 与均值回归；遗忘稳定度取 `min(S, S_f)`；新卡 Again/Hard/Good 按 1/5/10 分钟留在 LEARNING，Only Easy 直接毕业。到期时间改为精确时间戳，不再归一到服务器本地零点。`fsrs.reference.test.ts` 的 9 条固定向量与参考实现逐项一致。仍缺：真实学习数据上的参数校准。 |
| 中文与导入 | **部分修复（卡片导入已通过）** | 阶段 1 已补卡片 CSV 的 UTF-8/BOM/UTF-16/GBK 探测、`meaning_zh` 表头别名与 `Card.variants`，并有单元测试与 Docker 端到端（GBK 中文正确入库）。仍未处理：学生名单 CSV 的 GBK 探测；教师/管理员页面仍有英文；音标/音频字段未实现。 |
| 手机可用性 | **未验证（外部阻塞）** | 无目标真机、无微信内置浏览器环境；已有 700px 以下抽屉导航与响应式基线，但未做真机验收。 |
| 登录改造可行性 | **已实施（待权限回归）** | 已新增 `username`、可选 `email`、无邮箱学生创建、用户名登录与 `sessionVersion` 会话撤销；Docker 端到端验证用户名登录与重置后旧 token 401。API 级权限矩阵仍未建立。 |
| 代码质量 | **部分通过** | `npm run test -w server`：208 通过、12 跳过；三包构建通过；学生端产物 gzip 111.00 kB，低于 §7.9 的 200 kB 预算。使用官方 registry 的生产依赖审计报告 **15 个漏洞：2 critical、7 high、6 moderate**（`proxy-addr` IP 伪造、`tar` 解压 DoS、`nodemailer` 多项、`body-parser`、`qs`、`zod` 等），见 `docs/THIRD_PARTY_LICENSES.md` §4。当前宿主 npm 镜像不支持 audit 端点，本地审计命令需改走官方 registry。无 CI、无客户端测试、无 API 级权限测试。 |

## 3. 结构性差异与改造点（静态审计）

| 规格要求 | 上游现状 | 处理建议 |
| --- | --- | --- |
| 用户名登录、学生无邮箱、公共电脑 | 邮箱唯一必填；无 `user_sessions`；refresh token 30 天无状态，logout 只清 cookie（`auth.service.ts:9-11,52-58`、`routes/auth.ts:87-91`） | 新增 `username`、可选 `email`、会话表 / 撤销；登录限流改为账号维度严格（现为 IP+email，换 IP 可绕过单账号锁定，`routes/auth.ts:26-38`） |
| 服务端判分与一次性调度 | 客户端直接提交 1–4 评分（`routes/students.ts:470-492`）；每次 grade 都调度一次（`review.service.ts:442-470`）；无 `submissionId` / `sessionVersion` | 在外层新增“服务端判分 → FSRS 评分映射 → 每词每会话一次调度”；不改上游 grade 语义，避免破坏现有复习 |
| 断点续学 | `review/start` 先关闭未结束会话再新建（`review.service.ts:173-178`）；7 天 Expired 无实现 | 新增 Word Camp 学习会话或扩展 `ReviewSession`；开始学习返回进行中会话（幂等） |
| 每日任务 / 关卡 / 星级 | 只有卡组复习与自评 | 已新增纯规则层 `shared/word-camp.ts`（见下节）；数据库与会话模型待阶段 1 |
| 奖励 / 等级 / 每日上限 | 无模型 | 新增 `reward_ledger`（唯一 `user_id+event_key+reward_type`）、`daily_stats`、`user_settings` |
| 词条版本 | `Card` 直接修改，历史复习引用同一 Card | 新增快照或“发布后不可改 + 复制新版本”；MVP 前禁止静默改已学词条 |
| 音频 / 图片 | 无字段、无素材 | 发布流程增加音频、图片字段与来源授权记录；无素材时仍可完成学习 |
| 报告问题 | 无 | 新增 `feedback_reports` 与 `POST /feedback` |
| CSP / CSRF / 统一错误码 / requestId | 全仓无 helmet、CSP、CSRF、`X-Client-Version`、`requestId`；错误仅 `{error}`（`server/src/index.ts:46-50`） | 阶段 3–4 补齐，先加 `requestId` 与统一错误格式 |
| CSV 导出安全 | **已修复** | 学生 deck 导出改用 `server/src/lib/csv.ts`：公式注入前缀转义 + UTF-8 BOM + CRLF；单测覆盖 `= + - @` 等触发字符。 |

## 4. 阶段 0 结论

**有条件 Go。** 上游技术栈与规格一致，权限模型整体可靠，构建与基础测试可用；但其 FSRS 实现、部署链路、导入编码、会话幂等均达不到规格要求，不能当作“已完成能力”直接复用。本项目应基于固定提交改造，并自带回归测试与迁移。

进入阶段 1 前必须完成：

1. 锁定上游提交（已打标签 `baseline-4fcbf6d`），建立本项目分支与发布记录（见 `docs/WORD_CAMP_VERSIONING.md`）。
2. 修复 Dockerfile workspace 清单与 Compose 启动链路（迁移 + 管理员种子）——**已在 0.1.1 完成**：`migrate` / `seed` 一次性服务、自动迁移、健康检查与随机临时密码。
3. 用 fsrs-rs / ts-fsrs 的固定向量替换或校正 `shared/fsrs`，补时区边界用例——**已校正**：`fsrs.reference.test.ts` 9 条 ts-fsrs 4.7.0 向量通过，到期时间为精确时间戳，不依赖服务器时区。
4. 词表导入补 UTF-8 / BOM / GBK 探测与错误预览，补 `variants` 字段——**卡片 CSV 已完成**（`card.service.ts`）；学生名单 CSV 的 GBK 探测待补。
5. “用户名登录 + 可选邮箱 + 会话撤销”作为独立可回滚特性——**已实现并端到端验证**；API 级权限回归测试仍待补。
6. 依赖审计改走官方 registry 或等价离线工具，记录高危漏洞与升级计划。

外部阻塞（需用户 / 学校提供，代码无法单方面完成）：

- 目标真机与微信内置浏览器、校园网络环境；
- 域名、备案、HTTPS 与学校数据合规告知流程；
- 首批教材词表与音频 / 图片授权来源；
- 试点班级设备调查结果。

## 5. 已落地的规则层

阶段 0 同时加入 `shared/word-camp.ts` 与 `server/src/__tests__/wordCampRules.test.ts`（80 个用例），实现规格 §4.1 / §5 中可脱离数据库验证的纯规则：拼写规范化与变体 / 一字符接近提示、FSRS 评分映射（首次独立答对 Good、提示或重试 Hard、答错或揭示答案 Again）、上海学习日期、掌握状态、关卡星级、10 级阈值、奖励事件键与每日上限结算。该模块不接 API，不声称完成学习闭环；它通过 `@vanilla-srs/shared/word-camp` 子路径只暴露给服务端，避免把判分逻辑打进学生端。

## 6. 复现命令

```powershell
# 基线安装、测试与构建
npm ci
npm run test -w server
npm run build -w shared
npm run build -w server
npm run build -w client

# 权限集成用例（需要一次性 PostgreSQL 库，库名必须为 sl_fresh）
$env:DATABASE_URL = 'postgresql://<user>:<DB_PASSWORD>@127.0.0.1:<port>/sl_fresh'
npx prisma migrate deploy --schema=prisma/schema.prisma
$env:SL_TEST_DATABASE_URL = $env:DATABASE_URL
npx vitest run src/__tests__/subjectLead.integration.test.ts --root server
```

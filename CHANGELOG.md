# 变更记录

本项目变更记录从上游基准 `4fcbf6d` 之后开始。格式参考 Keep a Changelog，日期使用 Asia/Shanghai。

## [Unreleased]

### 新增
- 每日任务与关卡服务端闭环：`DailyStudyTask`/`DailyTaskWord`/`LevelSession`/`LevelQuestion`/`LevelAnswer` 五表与迁移 `20261123050000_daily_study_tasks`；按上海学习日取建任务并冻结词快照；L1/L2/L3/L5/Boss/复习关卡服务端固定出题、答案不下发；每题 3 次尝试与揭晓、拼写两级提示、选择题排除提示；`(sessionId, submissionId)` 幂等答题；70%/80% 通关与首答 90%/100% 星级；通关时每词一次性 FSRS 调度；`word_learned`/`review_ok`/`boss_clear`/`daily_done` 奖励幂等结算。
- 用户名登录：`User.username`（唯一、可空），`User.email` 改为可空；登录接受用户名或邮箱。
- 无邮箱学生：教师/管理员可只填用户名创建账号，CSV 模板为 `name,username,email`。
- 学生名单/账号卡展示登录名；一次性临时密码打印条包含登录名。
- 迁移 `20261123000000_user_username_optional_email` 回填既有账号用户名。
- 奖励账本 `RewardEvent`（唯一事件键 + 每日上限）与等级计算；复习结束自动结算 XP，新增 `GET /students/rewards` 和学生“我的成长”页。
- 词表导入支持 GBK/BOM、`meaning_zh` 等表头别名与 `variants` 变体拼写；新增 `Card.variants` 迁移。
- 会话撤销：`User.sessionVersion` + JWT `sv`，改密/重置后旧 access/refresh token 立即失效。
- 学生复习界面中文化；完成页显示本次 XP/金币。
- 断点续学：`ReviewSession.queue` 持久化题目顺序，刷新/切后台后 `review/start` 返回同一会话的剩余题目。
- FSRS-5 校正：默认权重、遗忘曲线、`1 +` 稳定度项、linear damping 难度、short-term 状态与精确到期时间对齐 `ts-fsrs@4.7.0`；新增 9 条基准向量测试。
- 教师/管理员班级“今日”页：按 Asia/Shanghai 自然日列出今日已学习、未学习名单（`pending-today` API）。
- CSV 导出公式注入防护与 UTF-8 BOM/CRLF。
- 学生名单 CSV 支持 GBK/BOM/UTF-16；与卡片导入共用解码器。
- 依赖安全：`bcrypt` 6、`multer` 2.5、根 `overrides`（body-parser/proxy-addr/path-to-regexp/ip-address）、router patch；生产漏洞 15 → 6（0 critical）。
- 权限集成回归：干净 `sl_fresh` 库应用 14 个迁移，学科组长权限套件 12/12 通过。
- 学生“今日进度”：`GET /students/today` 与复习页空闲状态进度卡（新词/复习/到期/今日 XP）。
- 服务端拼写题：`POST /students/review/answer` 负责变体/大小写/空格判分与 FSRS 调度，新增 `/student/spelling` 练习页。
- 服务端认词四选一：`GET /students/review/choice` 生成唯一选项，`POST /students/review/choice-answer` 判分；新增 `/student/choice` 页面。

### 验证
- 服务端单元测试 341 通过 / 12 跳过、三包构建通过；干净数据库完整应用 14 个迁移。
- 会话撤销已端到端验证：重置密码后旧 access/refresh token 均返回 401。
- 断点续学已端到端验证：连续两次开始学习返回同一会话与相同题目顺序。
- Docker 端到端：只传用户名创建学生 → 该学生用用户名登录成功，`email=null`，首次登录强制改密。
- 奖励服务测试覆盖首次奖励、重复事件、每日上限与唯一键竞态。

### 计划中
- 会话撤销与公共电脑选项。
- 词表导入编码探测（UTF-8 / BOM / GBK）与 `variants` 字段。
- 每日任务、关卡、奖励流水、反馈入口与移动端学生界面。
- 全站中文界面与资源级权限测试。

## [0.1.1] - 2026-11-23

### 修复
- Docker Compose 启动链路：`migrate` 一次性服务在数据库健康后自动执行 `prisma migrate deploy`，API 等待迁移成功再启动；新增数据库与 API 健康检查。
- Compose 内的 `DATABASE_URL` 由 `POSTGRES_USER` / `POSTGRES_PASSWORD` 自动组装并指向 `db` 服务，不再依赖 `.env` 中指向 `localhost` 的地址。
- 管理员种子改为 `seed` 服务，可在运行镜像中执行；未提供 `ADMIN_PASSWORD` 时生成随机临时密码，不再使用“日期 + 姓氏”的可猜密码，首次登录强制改密。
- 客户端 Nginx 增加 gzip、`index.html` 禁止强缓存、带 hash 静态资源长缓存。
- `.env.example` 补充 `COMPOSE_PROJECT_NAME` 与 `POSTGRES_*` 变量，避免中文路径下 Compose 项目名为空。

### 验证
- 在干净卷上启动完整栈：db 健康 → 9 个迁移应用 → server 健康 → client 返回 200。
- `GET /api/health` 返回 `{status:"ok"}`；种子创建管理员后 `POST /api/auth/login` 返回 200，`mustChangePassword: true`。
- server / migrator / seeder / client 四个镜像分别构建成功。

### 已知限制
- 本机 `docker compose up --build` 在 Docker Desktop 29.4.3 上触发 bake gRPC 报错（`x-docker-expose-session-sharedkey` 非可打印字符），改用逐镜像 `docker build` 后 `docker compose up --no-build` 通过；该问题属本机 Docker 环境，CI / Linux 服务器仍需复测。
- 生产依赖审计 15 个漏洞尚未升级（见 0.1.0 记录与许可证文档）。

## [0.1.0-stage0] - 2026-11-23

### 新增
- 引入 `word-camp-development-v1.1.md` 开发规格。
- 阶段 0 技术验证记录：`docs/WORD_CAMP_STAGE0_VERIFICATION.md`。
- 版本管理与发布规范：`docs/WORD_CAMP_VERSIONING.md`。
- 第三方许可证清单：`docs/THIRD_PARTY_LICENSES.md`。
- 纯规则层 `shared/word-camp.ts` 与 `server/src/__tests__/wordCampRules.test.ts`：拼写判分 / 变体 / 接近提示、FSRS 评分映射、上海学习日期、掌握状态、关卡星级、等级阈值、奖励事件键与每日上限结算；80 个单元测试。

### 验证
- `npm ci` 安装 329 个包。
- `npm run test -w server`：208 通过、12 跳过。
- `npm run build -w shared|server|client`：通过；学生端产物 gzip 111.00 kB。
- 9 个 Prisma 迁移在 PostgreSQL 16 上全部应用。
- `subjectLead.integration.test.ts` 在一次性 PostgreSQL 库上 12/12 通过。

### 已知限制
- 上游 FSRS 实现未达规格：复习稳定度公式缺项、遗忘曲线为近似、到期日依赖服务器本地时区；本版本不宣称间隔复习正确。
- 上游部署链路未跑通：Compose 数据库地址与镜像内迁移 / 种子缺失；Dockerfile workspace 清单需修复。
- 词表导入不支持 GBK，`variants` 字段尚不存在。
- 用户名登录、每日任务、奖励流水、反馈、移动端界面均未实现。
- 无真机 / 微信内置浏览器验证，无域名、备案与合规确认。
- 依赖审计未完成（当前 npm 镜像不支持 audit 端点）。生产依赖审计（官方 registry）发现 15 个漏洞：2 critical、7 high、6 moderate，升级计划见 `docs/THIRD_PARTY_LICENSES.md` §4。

## 上游基线

- `baseline-4fcbf6d` - 2026-11-23 - 固定 Vanilla Class SRS `4fcbf6d4eb6aaacbfc23144a948f1c4dd9e6f065`。

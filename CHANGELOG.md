# 变更记录

本项目变更记录从上游基准 `4fcbf6d` 之后开始。格式参考 Keep a Changelog，日期使用 Asia/Shanghai。

## [Unreleased]

### 新增（Stage 5 世界观与游戏化体验包装层）
- **词灵与词灵图鉴**：`shared/world.ts` 提供 `spiritFormFromStage`（蛋/幼灵/亚成/成灵/耀灵，按历史最高 `bestStage` 单调不回退）与 `spiritAppearanceSeed`（按规范化单词确定性着色）；`WordSpirit.tsx` 确定性 SVG 词灵（6 种身体、4 色 `--spirit-0..3`、按 retention 的迷雾透明度 0.12–0.65、耀灵光晕、按 seed 奇偶配饰）。`/student/deck` 词灵图鉴。
- **营地家园与糖晶**：迁移 `20261127010000_world_home` 新增 `StudentHomeBuilding`、`StudentGameProfile.sugarCrystalsSpent`、`GameEvent.sugarCrystalRatio`（EVENT_SNAPSHOT 比例快照）。糖晶只由学习类事件（`REVIEW_GRADE`/`LEVEL_CLEAR`/`WEAK_RESTUDY`/`WEAK_BOSS_WIN`/`RINGS_CLOSED`/`COMEBACK_EASY`/`WEAK_CLEAR_DAY`）按 `floor(Σ xp × ratio)` 换算，不清零、不购买、不交易；多班共享单钱包。`home.service.ts` 行锁 + `Idempotency-Key` UUID 防重复建造；`GET /api/students/game/home`（家园聚合：到期数、词灵、营地地图、糖晶、预估分钟、灯塔预报）与 `POST /api/students/game/home/build`。
- **四岛世界观内容热发布**：迁移 `20261126010000_world_content_release` 新增 `WORLD_CONTENT` 负载类型。`shared/worldContent.ts` 提供内置包 `DEFAULT_WORLD_CONTENT`（4 岛 D1–23，雾兽日 D6/D12/D18/D23，23 条艾斯小剧）与 `validateWorldContent`/`parseWorldContentJson` 严格校验（拒绝奖励/FSRS/日界改动与 HTML/CSS/脚本/外链）。管理员可发布 ALL/CLASSES 范围，教师仅本班；回滚与公共 `/releases/latest` 隔离。学生端 `GET /api/students/world-content?enrollmentId=`。
- **匿名首体验与登录页**：`FirstWakeExperience.tsx` 前 3 秒/3 分钟“唤醒”流程（3 只固定 D1 词灵蛋→认词→孵化→点燃篝火→登录入口），不写任何成绩/奖励；匿名首体验事件不直传服务端。`LoginPage.tsx` 未登录默认进唤醒流程，登录页配 `IslandScene` 与“先认识词灵”回退。
- **复习与关卡包装**：`ReviewPage.tsx` 词灵随卡显示、评分改“雾未散/散一半/散尽/闪光”四级、`grade=1` 揭示释义、显式“继续”按钮步进（修掉原先评分即结算的 bug）、结算页“你唤醒了 N 只词灵 + 今天到此为止”并移除默认“加练一组新词”诱导；`LevelSessionPage.tsx` 关卡名改“邂逅/辨义/辨词/念咒语/雾兽战”、结算“据点灯亮起 ★”与“回营地，今天到这里”。
- **学生端壳层与导航**：`/student/task` 改为 `WorldHome`（迷雾预报 + IslandScene + 糖晶 + 四岛地图/建造/明日预报对话），新增 `/student/adventure` 承接 `TaskPage`；`StudentLayout` 桌面导航“营地家园/驱雾复习/岛屿探险/词灵图鉴”，移动端底栏“家园/驱雾/探险/图鉴”。
- **保持率曲线与深色/动效**：`EbbinghausStrip.tsx` 改为“艾斯的灯”弹窗（可交互保持率折线 + 数据表回退，`dataviz` 校验的顺序蓝 `#2a78d6`/`#3987e5` 单槽位 PASS）；`world.css` 世界令牌、`prefers-reduced-motion` 与 `forced-colors` 适配、深色主题覆盖。
- **隐私埋点**：新增 9 个世界事件（`world_home_open`/`world_story_view`/`world_story_skip`/`world_build`/`world_wake_start`/`world_spirit_wake`/`world_secret_open` 等），不收集设备指纹/IP/UA；匿名首体验事件按设计不上报。

### 修复（Stage 5 包装层缺陷）
- `client/src/world.css`：补 `:root` 下缺失的 `--world-grass`/`--world-soil`，修复浅色主题营地场景 SVG 渲染为黑色块的问题。
- `client/src/pages/student/ReviewPage.tsx`：评分后不再直接 `finishRound` 结束整轮，改为等待显式“继续”；雾兽模式评分只扣 HP、推进与弱词回排由“继续”统一处理，并去掉重复的 `resetRoundStats()`。
- `client/src/index.css`：窄屏（≤400px）顶栏品牌名截断为省略号并收紧内边距，避免与 XP 胶囊/主题按钮重叠。

### 已知回归 / 未验收项（Stage 5）
- 客户端主包 gzip ≈ 208 KB（高于 ~128 KB 目标），`world`/`worldContent`/词灵 SVG 引入所致，未做分包。
- 服务器全量测试存在 28 个环境性失败（mock 损坏 + 缺 `DATABASE_URL`）与 exit 139 段错误，与世界观功能无关；Stage 5 定向套件 7 文件 57 测试通过。
- 匿名首体验漏斗指标按设计不上报服务端。
- `TaskPage.tsx` 仍有 `storyDay`/`selectedDay` 未用变量等遗留松散点；据点微剧只在 `WorldHome` 自动弹出。

### 新增（Stage 4 留存验证与规模化 R1–R11）
- 数据模型与迁移 `20261126000000_stage4_retention_scale`：扩展 `AppRelease.scope`、`ClassGameSetting`（`mnemonicCoCreateOpen` / `squadEnabled` / `activePackId`）、`StudentGameProfile`（`fontScale` / `reduceMotion` / `lowSpecMode` / `unlockedSkins`）；新增 `AnalyticsEvent`、`AnalyticsDailyRollup`、`PushSubscription`、`ReminderPref`、`ReminderLog`、`MnemonicEntry`、`Squad`、`SquadMember`、`SquadWeek`、`SquadCheer`、`ClassSeason`、`WeeklyReport`、`VocabPack`、`VocabPackItem`。
- 并发安全与对账运维（R1）：`gamification.service.ts` 引入按学生行锁 `SELECT ... FOR UPDATE` 与幂等建档防竞态；新增 `reconcile.service.ts` 与 `reconcile-ledger.ts` 对账脚本；补充设备矩阵与灰度回滚 SOP。
- 隐私埋点、效果看板与灰度配置（R2）：新增 [ANALYTICS_METRICS_SPEC.md](docs/ANALYTICS_METRICS_SPEC.md)、`analytics.service.ts`（180 天归档与去指纹校验）、`/teacher/game` 与 `/admin/game` 留存效果看板，以及 `/admin/releases` `GAME_CONFIG` 分班灰度范围与回滚。
- 温和召回提醒（R3）：新增零依赖 ES256 VAPID + RFC 8291 `webpush.ts`、`reminder.service.ts` 与 `send-reminders.ts`、`sw.js` 推送点击激活、6 套非愧疚预设模板（日≤1/周≤4、07:00–21:30 静默、连续 3 次未开暂停 7 天）及微信端降级站内横幅。
- 邪修口诀扩充与工程化（R4）：Day 4–14 手工扩充后 688 词内置覆盖率达 431/688（62.6%）；新增 `/teacher/mnemonics` 与 `/admin/mnemonics` 双端对等工作台（覆盖率面板、实时预览编校、CSV/JSON 逐行校验导入、学生 stage≥4 共创“同学版”及每日 1 次奖励、`MNEMONIC_PATCH` 打包发布与撤回）。
- 合作小队、冲刺赛季、智能规划与周报扩展（R5–R11）：新增 2–3 人合作小队与每日 ≤3 次预设击掌（隐私脱敏）；考前 100 天自动冲刺赛季、阶段皮肤与 `<canvas>` 赛季/家长周报分享卡（不改 FSRS）；积压清账模式与可选 `+5` 加餐及 R2 耗时预估；每周自动周报归档与调参建议；自定义多词包（R10）与三档字号/减弱动效/低配省电模式（R11）。

### 新增（Stage 3 游戏化激励）
- 共享纯规则层 `shared/gamification.ts`：复习评分 XP（1/3/5/6）与同词同日限前 2 次及未到期 0 XP 防刷、每日 400 XP 封顶、Lv1→Lv2=100（每级 +50）升级与称号区间、艾斯阶段→糖纸/银箔/金箔/闪钻稀有度映射、双环与积压保护（常规 50 / 断学 ≥ 3 天回归 20）、连续天数与冻结券（每 7 天 +1 券，上限 2 张）、23 天营地星级（80% 达第 4 阶）、`GameConfig` 参数护栏校验及 19 枚配置化徽章。
- 数据模型与迁移 `20261125010000_stage3_gamification`：新增 `GameEvent`、`StudentGameProfile`、`DailyGameState`、`StudentBadge`、`ClassGameSetting`、`ClassChallenge`、`TeacherCheer`、`TeacherCheerRead`；扩展 `CardInstance.bestStage`（按当前 FSRS 阶段回填历史最高稀有度）、`ReviewEvent.submissionId` 幂等键、`DailyStudyTask.campDay`、`AppRelease.configPayload` 与 `ReleasePayloadType.GAME_CONFIG`。
- 服务端游戏化闭环：`gamification.service.ts`、`gameConfig.service.ts`、`teacherGame.service.ts`，事务内集成至 `gradeCard`、`finishSession` 与 `completeLevel`；新增学生端 `/api/students/game/*`（summary/profile/map/cards/badges/leaderboard/weak-boss/cheers）、教师与管理端对等看板 `/api/teachers/game/*` & `/api/admin/game/*`（严格 403 跨班/越权隔离），并限制仅管理员可发布/撤回 `GAME_CONFIG` 热更新。
- 学生与师长端 UI：顶栏常驻 XP 条与升级庆祝（≤1.5s 可跳过、支持 `prefers-reduced-motion`）、评分后 XP 飘字（断网不虚增）、特训页双环/本周 7 格营地与 23 天全图/班级周挑战/22:30 护眼边界、艾斯背词弱词 Boss 模式与每日结算（含明日到期数/升级卡牌/本地战报分享卡）、23 天词库 688 卡册收集视图、我的App 徽章墙/班内进步榜（默认关闭，仅昵称头像）/装扮换肤/音效开关，以及教师端 `/teacher/game` 与管理员端 `/admin/game` 激励看板与预设击掌鼓励。

### 新增（Stage 1 & 2）
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
- 每日任务/关卡学生端 UI：`/student/task` 今日任务主页（六个关卡入口、星级/状态徽章、完成横幅）；`/student/levels/:id` 关卡页（L1 词表预览、L2/L3 选择、L5 拼写、提示/重试/揭晓、结算页含星级/弱词/奖励）；导航新增“今日任务”，选班后默认落到任务页；已完成任务的已通关关卡支持只读回顾。

### 验证
- 服务端单元测试 377 通过 / 12 跳过、三包构建通过；干净数据库完整应用 15 个迁移。
- 会话撤销已端到端验证：重置密码后旧 access/refresh token 均返回 401。
- 断点续学已端到端验证：连续两次开始学习返回同一会话与相同题目顺序。
- Docker 端到端：只传用户名创建学生 → 该学生用用户名登录成功，`email=null`，首次登录强制改密。
- 奖励服务测试覆盖首次奖励、重复事件、每日上限与唯一键竞态。
- 关卡闭环端到端：任务取建幂等、进行中会话复用、提示排除/拼写两级提示、提交幂等（`replayed:true`）、REVIEW 通关每词一次性调度（首对 Good/提示后 Hard）、重复结算奖励为 0；浏览器真实流程（登录 → 任务页 → 关卡答题 → 结算 → 成长页奖励）。

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

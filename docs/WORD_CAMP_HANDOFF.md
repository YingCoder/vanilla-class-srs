# 单词特训营开发交接文档

> 面向下一个接手开发的模型/工程师。  
> 本文件是**快速上下文**，不是规格本身；实现细节以代码、测试和 `word-camp-development-v1.1.md` 为准。  
> 整理时间：2026-11-26；整理时包含 Stage 5 世界观包装层（本文件会产生新提交）。

---

## 0. 先读什么

建议按这个顺序：

1. 本文件：当前状态、能跑什么、不能宣称什么。
2. [`word-camp-development-v1.1.md`](../word-camp-development-v1.1.md)：产品规格与验收清单。
3. [`docs/WORD_CAMP_STAGE0_VERIFICATION.md`](WORD_CAMP_STAGE0_VERIFICATION.md)：上游审计、已修复/未修复的阻断项。
4. [`docs/WORD_CAMP_STAGE1_PROGRESS.md`](WORD_CAMP_STAGE1_PROGRESS.md)：每项能力的实现与验证证据。
5. [`docs/WORD_CAMP_VERSIONING.md`](WORD_CAMP_VERSIONING.md)：分支、提交、标签、干净库集成测试流程。
6. 代码入口：
   - 服务端：[`server/src/index.ts`](../server/src/index.ts)、[`server/src/routes/students.ts`](../server/src/routes/students.ts)
   - 学生端：[`client/src/pages/student/ReviewPage.tsx`](../client/src/pages/student/ReviewPage.tsx)
   - 调度：[`shared/fsrs/fsrs.ts`](../shared/fsrs/fsrs.ts)
   - 规则：[`shared/word-camp.ts`](../shared/word-camp.ts)
   - 数据模型：[`prisma/schema.prisma`](../prisma/schema.prisma)

**第一步永远先检查工作区**，不要只相信本文档：

```powershell
git status --short
git log --oneline --decorate -12
docker compose -p wordcamp ps
```

---

## 1. 一句话状态

教师/管理员已能建班、建词集、导入词表、分配任务、重置密码、查看今日学习名单；学生已能用用户名登录、改密、断点续学、做认词四选一和服务端判分的拼写题、获得一次性奖励与复习计划。

**每日任务/关卡学生闭环已完成**：`/student/task` 今日任务主页 + `/student/levels/:id` 关卡页（L1 预览/L2/L3 选择/L5 拼写/Boss/复习，提示/重试/揭晓/星级/弱词/奖励，L4 显示“等价练习”跳转认词）；服务端闭环见 `docs/WORD_CAMP_STAGE1_PROGRESS.md` §13。

**Stage 5 世界观包装层已完成并验证**：`/student/task` 改为 `WorldHome` 营地家园（迷雾预报 + IslandScene 词灵场景 + 糖晶 + 四岛地图/建造/明日预报对话）；`/student/adventure` 承接原 `TaskPage` 关卡地图；复习页词灵随卡、四级“雾”评分、显式“继续”步进与“今天到此为止”结算；登录页前置匿名“唤醒”体验。新接口 `GET /api/students/game/home`、`POST /api/students/game/home/build`（幂等键）、`GET /api/students/world-content`；新迁移 `20261126010000_world_content_release` 与 `20261127010000_world_home`（迁移总数 20）。匿名首体验事件按设计不上报服务端。

**尚未完成**：教师/管理员“今日任务完成”看板、听音题（L4 接口显式 409，UI 走等价练习）、错词重练入口、教师自定义任务配置、完整学情报表、真机/微信验收。

当前应用运行在：

- URL：`http://127.0.0.1:2080`
- Compose 项目名：`wordcamp`（必须显式指定，中文路径下不要依赖目录名）
- 健康检查：`GET /api/health` → `{"status":"ok"}`

---

## 2. 仓库与版本

| 项目 | 值 |
| --- | --- |
| 工作区 | `E:\code\单词` |
| 当前分支 | `develop/word-camp-v0.1` |
| 开发主线 | `main` 只用于可交付集成，当前未合并 |
| 版本文件 | `VERSION` = `0.1.1`（阶段 1 仍在 Unreleased） |
| 上游基准 | `4fcbf6d4eb6aaacbfc23144a948f1c4dd9e6f065`，本地标签 `baseline-4fcbf6d` |
| 远程 | **没有配置 `origin`**；不要把本项目推到 `upstream` |

提交规范：Conventional Commits 简化形式，中文正文；每个提交应通过服务端测试与三包构建。

**当前不要做的事**：

- 不要删除或改写历史迁移（本项目迁移只追加）。
- 不要提交 `.env`、`logs/`、真实密码或 token。
- 不要把阶段 1 未验收能力标成 `1.0.0` 或“完成”。

---

## 3. 如何启动

### 3.1 正常 Linux / 有 Docker Compose 的环境

```bash
docker compose up -d --build
```

Compose 会：

1. 启动 PostgreSQL 16；
2. 运行一次性 `migrate` 服务执行 `prisma migrate deploy`；
3. 数据库健康且迁移成功后启动 API；
4. 启动 Nginx 客户端。

首次管理员用 `seed` profile：

```bash
docker compose run --rm seed
```

### 3.2 当前 Windows 主机的已知绕行方式

本机 Docker Desktop 29.4.3 的 `docker compose up --build` 会触发 bake gRPC 报错，因此本轮验证使用逐镜像构建：

```powershell
docker build -f server/Dockerfile -t wordcamp-server .
docker build -f server/Dockerfile --target migrator -t wordcamp-migrate .
docker build -f server/Dockerfile --target seeder -t wordcamp-seed .
docker build -f client/Dockerfile -t wordcamp-client .

docker compose -p wordcamp up -d --no-build --force-recreate server client
```

如果只改了服务端，可只重建/重启 `server`；只改客户端同理。  
**这是本机环境问题，不是应用代码结论；Linux/CI 仍需复测。**

### 3.3 环境变量

- 模板：[`.env.example`](../.env.example)
- 实际 `.env` 已被 `.gitignore` 忽略，含真实 secret，**不要读取后写进文档或提交**。
- 必需项：`POSTGRES_*`、`JWT_SECRET`、`JWT_REFRESH_SECRET`、`CLIENT_URL`、`PORT`、`TZ`。

---

## 4. 技术架构（接手够用版）

```
React 18 + Vite (client/)
        │  /api
Node 22 + Express + Prisma (server/)
        │
PostgreSQL 16 (db)
        │
shared/：FSRS-5 调度 + 纯奖励规则 + 学习日工具
```

- npm workspaces：`client`、`server`、`shared`。
- 服务端鉴权：JWT 放在 httpOnly cookie；access 1 小时、refresh 30 天。
- `User.sessionVersion` 参与 JWT `sv` 校验：改密/重置后旧 token 立即 401。
- 学生按 `Enrollment` 拥有独立 `Deck`，多班进度隔离。
- 复习调度在服务端完成；客户端只提交答案/自评，不决定最终 grade（新增题型已强制这一点）。
- 学习日按 **Asia/Shanghai** 自然日计算，数据库时间存 UTC。

### 4.1 数据模型重点

见 [`prisma/schema.prisma`](../prisma/schema.prisma)。与当前功能最相关：

- `User.username` 唯一可空；`User.email` 可空。
- `User.sessionVersion`：会话代际。
- `Card.variants String[]`：可接受拼写变体。
- `ReviewSession.queue Json?`：本轮有序题目实例，用于断点续学。
- `ReviewEvent`：每次评分/答题事件；当前**没有** `submission_id` 幂等约束。
- `RewardEvent`：`(userId,eventKey,rewardType)` 唯一，奖励幂等靠它。
- `CardInstance`：FSRS 状态 + `lastReview` + `due`。

### 4.2 迁移

共 20 个，最后五个与本项目强相关：

- `20261123030000_session_version`
- `20261123040000_review_session_queue`
- `20261123050000_daily_study_tasks`（每日任务/关卡五表）
- `20261126010000_world_content_release`（世界观内容热发布 `WORLD_CONTENT` 负载类型）
- `20261127010000_world_home`（家园 `StudentHomeBuilding`、`StudentGameProfile.sugarCrystalsSpent`、`GameEvent.sugarCrystalRatio` 快照）

新增字段/表必须新增迁移目录，并在干净库验证：

```powershell
docker build -f server/Dockerfile --target migrator -t wordcamp-migrate .
docker run --rm --network wordcamp_default `
  -e "DATABASE_URL=postgresql://srs_user:<password>@db:5432/<new_db>" `
  wordcamp-migrate
```

---

## 5. 已完成能力与证据

详细过程见 [`docs/WORD_CAMP_STAGE1_PROGRESS.md`](WORD_CAMP_STAGE1_PROGRESS.md)。这里是索引。

| 能力 | 入口/文件 | 证据 |
| --- | --- | --- |
| 用户名/邮箱登录、无邮箱学生 | `server/src/routes/auth.ts`、`server/src/services/enrollment.service.ts` | Docker 端到端：只传用户名创建 → 用户名登录成功、`email=null`、首次改密 |
| 会话撤销 | `auth.service.ts`、`middleware/auth.ts` | 重置密码后旧 access/refresh 均 401 |
| 奖励账本/等级/成长页 | `reward.service.ts`、`client/src/pages/student/RewardsPage.tsx` | 首次/复习/上限/唯一键测试；完成页显示 XP/金币 |
| 词表导入 GBK/BOM/别名/变体 | `card.service.ts`、`client/src/components/CardImportHelpModal.tsx` | GBK 字节测试 + Docker 导入 `created:1` |
| 学生名单 GBK | `lib/csv.ts`、`enrollment.service.ts` | GBK 中文姓名单测 |
| CSV 导出防公式注入/BOM | `lib/csv.ts`、`routes/students.ts` | 单测 + Docker 导出前三字节 `EF BB BF` |
| 断点续学 | `review.service.ts`、`ReviewSession.queue` | 连续两次 start 同 sessionId、同顺序、第二次 `resumed:true` |
| FSRS-5 校正 | `shared/fsrs/` | 9 条 `ts-fsrs@4.7.0` 固定向量逐项一致 |
| 教师/管理员今日名单 | `todayRoster.service.ts`、`ClassTodayPanel.tsx` | 上海日界单测；Docker 未学习 1→0 |
| 学生今日进度 | `todayProgress.service.ts`、`ReviewPage.tsx` | 单测 + Docker 返回今日新词/复习/到期/XP |
| 认词四选一 | `choice.service.ts`、`ChoicePage.tsx` | 选项唯一/确定性单测；Docker 选项 `颜色\|味道\|形状\|大小` |
| 拼写题 | `spelling.service.ts`、`SpellingPage.tsx` | 变体/大小写/空格/1 字符差单测；Docker `colour` 命中 variant，+5 XP |
| 每日任务/关卡服务端 | `dailyTask.service.ts`、`levelSession.service.ts`、`levelAttempt.service.ts`、`studentTask.ts` | 375 项单测；幂等/调度/奖励 Docker 端到端 |
| 每日任务/关卡学生 UI | `client/src/pages/student/TaskPage.tsx`、`LevelSessionPage.tsx` | 浏览器真实流程：REVIEW 9/9 通关、+35 XP、9 词调度、任务完成横幅 |
| Stage 5 世界观包装层 | 见下方 §5.2 | 浏览器全流程 + 57 项定向测试 + 建造幂等 curl 证据 |

### 5.1 当前测试基线

| 项目 | 结果 |
| --- | --- |
| `npm run test -w server` | **377 passed / 12 skipped**（38 个文件通过，1 个集成套件默认跳过） |
| 干净库权限集成 | 单独跑 `sl_fresh`：**12 passed**（合计 389 项） |
| 三包构建 | shared / server / client 通过（最近一次） |
| 迁移 | 干净库 `task_fresh` 应用 15 个通过 |
| 生产依赖审计 | **6 个：0 critical / 2 high / 4 moderate** |
| 当前栈 | client 200、server healthy、health ok |

> 注意：`subjectLead.integration.test.ts` 的 12 项默认被跳过，因为需要 `SL_TEST_DATABASE_URL` 且强制 `127.0.0.1` + `sl_fresh`。复现步骤见 [`docs/WORD_CAMP_VERSIONING.md`](WORD_CAMP_VERSIONING.md) §5（用临时 socat 把容器 db 映射到宿主 5433）。

### 5.2 Stage 5 世界观包装层（已实现 / 已验证 / 未验证）

设计依据：[`docs/单词特训营 — 世界观与游戏化体验设计方案.md`](单词特训营%20—%20世界观与游戏化体验设计方案.md)。原则：词灵/糖晶/四岛全部从既有 capped XP 账本派生，**不改 FSRS、不改奖励结算、不设概率奖励/无限循环/损失恐吓/付费交易/公开排行**。

**已实现**

- 词灵：`shared/world.ts` + `client/src/components/WordSpirit.tsx`（确定性 SVG，`spiritFormFromStage` 单调不回退，`spiritAppearanceSeed` 按规范化单词着色）。
- 家园与糖晶：`server/src/services/home.service.ts`、`server/src/routes/studentGame.ts`（`GET /students/game/home`、`POST /students/game/home/build`）、`client/src/components/WorldHome.tsx` + `IslandScene.tsx` + `WorldDialog.tsx`。
- 世界内容热发布：`shared/worldContent.ts`（内置包 + 校验）、`server/src/services/worldContent.service.ts`、`server/src/routes/releases.ts`（`/admin/releases` 与 `/teachers/releases` 共用 `manageReleasesRouter`，管理员 ALL/CLASSES、教师仅本班）、学生端 `studentStage4.ts` `GET /students/world-content`。
- 匿名首体验：`client/src/components/FirstWakeExperience.tsx`、`client/src/pages/auth/LoginPage.tsx`（未登录默认唤醒流程）。
- 复习/关卡包装：`ReviewPage.tsx`（词灵随卡、四级雾评分、显式“继续”）、`LevelSessionPage.tsx`（邂逅/辨义/辨词/念咒语/雾兽战、据点灯结算）、`TaskPage.tsx`（岛名/据点灯星）。
- 保持率曲线：`EbbinghausStrip.tsx` 弹窗折线 + 数据表（`dataviz` 校验蓝 `#2a78d6`/`#3987e5` PASS）。
- 样式与无障碍：`client/src/world.css`（令牌、深色覆盖、`prefers-reduced-motion`、`forced-colors`）。

**已验证（本轮 Playwright + curl + vitest，390×844 为主）**

- 匿名唤醒全流程：蛋 → 3 词认词 → 点燃篝火 → “今天到此为止” → 登录切换，0 控制台错误。
- 家园页：真实到期数（6→0）、预估分钟、四岛地图（4 岛 D1–23 + 雾兽日）、故事/建造/预报对话、糖晶余额与 XP 换算（28 XP→2 糖晶、90+70 XP 后 93）。
- 复习页：grade=1 揭示释义并显式“继续”步进、grade=4 闪光庆祝、FSRS 重排（重来词稍后重现）、结算“你唤醒了 N 只词灵 + 今天到此为止”且无“再来一轮”。
- 关卡页：L1 六词浏览通关、结算“据点灯亮起 ★ + 回营地，今天到这里”。
- 建造：`POST /students/game/home/build` 缺糖晶 409、非法建筑 400、缺幂等键 400、同键重放不重复扣费（93→13→13）、灯塔建成后解锁真实明日时段预报；UI 点击建造 83→3 糖晶并显示建成通知。
- 响应式：360×640 与 1280×900 布局正常；深色主题可读。
- 定向测试：`world.rules`/`worldContent`/`release.service`/`gamification`/`gamification.service`/`stage4.rules`/`ebbinghaus` = **7 文件 57 测试通过**；`home.service` 真实 PostgreSQL 集成（含 8 路并发升级、幂等重放、多班钱包、0 XP→0 糖晶）在 Stage 5 会话中通过。
- 迁移：线上库补齐到 20 个；`docker compose -p wordcamp` 三包重建后 `/api/health` ok。

**未验证 / 已知问题**

- 客户端主包 gzip ≈ 208 KB，超过 ~128 KB 目标，未分包。
- 服务器全量测试存在 28 个环境性失败（mock 损坏 + `DATABASE_URL` 缺失）与 exit 139 段错误，与世界观功能无关；未在本会话修复。
- 匿名首体验漏斗指标按设计不上报服务端。
- 雾兽（weak-boss）模式路径未在浏览器走通（两次 grade=1 的词已越过 stage≤2 池子，UI 正确显示“当前没有近7天待攻克弱词”）；代码层已修推进逻辑但未端到端跑通雾兽战。
- `TaskPage.tsx` 仍有 `storyDay`/`selectedDay` 未用变量等松散点；据点微剧只在 `WorldHome` 自动弹出。
- 真机/微信验收未做。

### 5.3 Stage 5 修复的自身缺陷

- `client/src/world.css` 补 `:root` 下缺失的 `--world-grass`/`--world-soil`（浅色主题 SVG 此前渲染为黑色块）。
- `client/src/pages/student/ReviewPage.tsx` 评分后不再立即 `finishRound` 结束整轮；雾兽模式评分只扣 HP，推进/弱词回排统一由“继续”处理。
- `client/src/index.css` 窄屏（≤400px）顶栏品牌名截断为省略号，避免与 XP 胶囊/主题按钮重叠。

---

## 6. 关键业务规则（改代码前必须知道）

### 6.1 判分与调度

- 旧复习页是“翻转词卡 + 自评 Again/Hard/Good/Easy”，客户端传 `grade`；这是历史能力，尚未移除。
- 新增拼写/认词接口由服务端判分：
  - 正确 → grade 3（Good）
  - 错误/接近 → grade 1（Again）
- **每次提交都会立即写 `ReviewEvent` 并调度**，目前没有“重试后再最终判分”的模型；不要直接把“允许重试”加到现有接口，否则会重复调度。
- FSRS 使用 `ts-fsrs@4.7.0` 的 FSRS-5.0 公式与默认 19 权重；权重未用真实学习数据拟合。

### 6.2 奖励

- 复习结束 `POST /students/review/finish` 时结算。
- 事件键规则在 `shared/word-camp.ts`；每日上限默认 250 XP / 100 金币。
- 奖励结算与答题写入**不在同一事务**，幂等由 `RewardEvent` 唯一键兜底。
- `daily_done`、`boss_clear`、`streak7` 规则已定义，但**没有产生这些事件的任务/关卡实体**，不要伪造。

### 6.3 时间与统计

- 学习日：Asia/Shanghai；数据库 UTC。
- `todayRoster`（教师看“今日未学习”）口径是“有已结束且 cardsReviewed > 0 的复习会话”，**不是**每日任务完成。
- `todayProgress` 不返回 `completed`，同理。

### 6.4 权限与多端

- 管理员与教师的功能保持 parity（`CLAUDE.md` 要求）；新增教师能力必须同步管理员页面。
- 学科组长可跨班只读，但与规格 §12 的权限描述存在冲突，需产品决策；不要擅自收紧/放宽。
- 学生端中文优先；教师/管理员页面大部分仍是英文。

---

## 7. 常见开发命令

```powershell
# 安装
npm install

# 构建
npm run build -w shared
npm run build -w server
npm run build -w client

# 测试
npm run test -w server
npm run test -w server -- --run src/__tests__/fsrs.reference.test.ts

# 本地开发
npm run dev

# 数据库
npm run db:migrate
npm run db:generate
```

提交前至少：

```powershell
npm run test -w server
git diff --check
```

涉及客户端改动必须重新构建 `client` 镜像并刷新页面验证，不要只跑 TypeScript。

---

## 8. 当前未完成与优先级

### P0：教师/管理员“今日任务完成”看板

学生端闭环已交付（`/student/task` + `/student/levels/:id`，见 §5 与 `docs/WORD_CAMP_STAGE1_PROGRESS.md` §13/§14）。剩余缺口：

1. **教师/管理员看板**：把“今日未学习”升级为“今日任务完成/未完成”（区分按时/逾期），教师端与管理端同步（parity）。
2. 错词重练入口（complete 接口已返回 `weakWords`）。
3. 教师自定义任务配置（每日新词数、关卡组合），当前写死 `DEFAULT_DAILY_TASK_CONFIG`。

### P1：质量与合规

- 听音题三层降级（预生成音频 → 浏览器 TTS → 等价 L2/L3 题），记录 `skip-audio`。
- 错词本/错词重练；`wrong_word` 状态。
- 教师/管理员页面中文化（登录、学生表单、成长页已中文）。
- 完整资源级权限矩阵，并把 `sl_fresh` 集成测试接入 CI。
- CSP/CSRF/安全头复审；当前 cookie 为 httpOnly + SameSite=Lax，生产 `secure`。
- 大版本依赖升级：`nodemailer` 10、`zod` 4、`react-router-dom` 7、`csv-parse` 7。
- 移动端 320/360 宽、软键盘、切后台/锁屏、微信内置浏览器真机验收。
- PWA/离线/弱网策略，按规格 §7 决定是否进入本轮。

### P2：长期

- 用真实学习数据拟合 FSRS 权重。
- 学习报表导出、教师奖励配置、审计日志 UI。
- 域名/ICP/HTTPS、学校合规告知、教材/音频/图片授权、设备调查——这些是外部阻塞，代码无法单方面完成，**不要伪造验收**。

---

## 9. 已知坑（省时间）

1. **不要用 `docker compose up --build` 在当前 Windows 主机上验证**，会触发 bake gRPC 错误；用逐镜像构建。
2. **Compose 必须带 `-p wordcamp`**，否则中文路径导致项目名异常。
3. **DB 没有映射宿主端口**；跑集成测试要临时 socat 或另起测试库，且测试强制 `127.0.0.1` / `sl_fresh`。
4. **`ReviewPage`、`SpellingPage`、`ChoicePage` 都调用 `review/start`**；已有未结束会话时会续用同一队列，模式切换不是独立会话。改逻辑前先确认这是否符合预期。
5. **`review/answer`、`review/choice-answer` 没有提交幂等**；网络重试可能重复调度。P0 答题模型要先解决。
6. **奖励结算在 finish，不在 grade**；中途退出不会立即发奖，符合当前设计，但报表要能解释。
7. **默认权重变更会影响历史 `Deck.fsrsParams`**：新卡/空 `w` 会用 `DEFAULT_W`；已有自定义 `w` 的 deck 不受影响，不要假设全库统一。
8. **`requireAuth` 每请求查数据库校验 `sessionVersion`**；高并发下需关注查询成本。
9. **客户端没有自动化测试**；仅靠 `tsc`/构建不足以保证交互。
10. **管理端和教师端是两套页面**，新增能力必须两边都加。

---

## 10. 文件地图

### 服务端

| 文件 | 作用 |
| --- | --- |
| `server/src/index.ts` | Express 装配、CORS、路由挂载 |
| `server/src/routes/auth.ts` | 登录/刷新/改密/忘记密码 |
| `server/src/routes/students.ts` | 学生 deck、今日进度、复习 start/grade/finish、拼写/认词、导出 |
| `server/src/routes/teachers.ts` | 教师班级、学生、任务、今日名单 |
| `server/src/routes/admin.ts` | 管理员班级/词集/教师/年级、导入、重置密码 |
| `server/src/services/review.service.ts` | 会话、FSRS 调度、断点续学、结算 |
| `server/src/services/spelling.service.ts` | 拼写判分（变体/编辑距离） |
| `server/src/services/choice.service.ts` | 四选一选项生成与判分 |
| `server/src/services/reward.service.ts` | 奖励账本/上限/等级 |
| `server/src/services/home.service.ts` | Stage 5 家园聚合与糖晶建造（行锁 + 幂等键） |
| `server/src/services/worldContent.service.ts` | Stage 5 世界内容发布/范围解析/回滚 |
| `server/src/services/todayRoster.service.ts` | 教师今日学习名单 |
| `server/src/services/todayProgress.service.ts` | 学生今日进度 |
| `server/src/lib/csv.ts` | CSV 编码探测/导出转义 |

### 客户端

| 文件 | 作用 |
| --- | --- |
| `client/src/pages/student/ReviewPage.tsx` | 复习主流程、自评、断点续学、今日进度（Stage 5 词灵随卡/雾评分/显式继续） |
| `client/src/pages/student/TaskPage.tsx` | 今日任务主页（六个关卡入口、星级/状态、完成横幅），现挂 `/student/adventure` |
| `client/src/components/WorldHome.tsx` | Stage 5 营地家园主页（迷雾预报/建造/四岛/故事），现挂 `/student/task` |
| `client/src/components/IslandScene.tsx` | Stage 5 营地 SVG 场景 |
| `client/src/components/WordSpirit.tsx` | Stage 5 词灵 SVG |
| `client/src/components/FirstWakeExperience.tsx` | Stage 5 匿名首体验 |
| `client/src/pages/student/LevelSessionPage.tsx` | 关卡作答页（L1 预览/L2/L3 选择/L5 拼写、提示/重试/揭晓/结算） |
| `client/src/pages/student/SpellingPage.tsx` | 拼写练习 |
| `client/src/pages/student/ChoicePage.tsx` | 认词四选一 |
| `client/src/pages/student/RewardsPage.tsx` | 成长/等级/流水 |
| `client/src/components/ClassTodayPanel.tsx` | 教师/管理员“今日”Tab |
| `client/src/pages/teacher/ClassDetailPage.tsx` | 教师班级详情 |
| `client/src/pages/admin/ClassDetailPage.tsx` | 管理员班级详情 |

### 共享

| 文件 | 作用 |
| --- | --- |
| `shared/fsrs/fsrs.ts` | FSRS-5 公式与调度 |
| `shared/fsrs/constants.ts` | 默认权重/参数 |
| `shared/word-camp.ts` | 奖励事件键、上限、等级、学习日、纯规则 |
| `shared/world.ts` | Stage 5 词灵形态/外观 seed、糖晶换算规则、家园契约类型 |
| `shared/worldContent.ts` | Stage 5 内置四岛内容包、世界内容 JSON 校验/解析 |

---

## 11. 交接验收清单

接手后先确认：

- [ ] `git status` 干净，分支 `develop/word-camp-v0.1`。
- [ ] `npm run test -w server` 为 `377 passed / 12 skipped`（或更新后的等价基线）。
- [ ] 三包构建通过。
- [ ] `docker compose -p wordcamp ps` 三服务正常；`/api/health` 为 ok。
- [ ] 能说清“今日名单/今日进度”不是每日任务完成。
- [ ] 知道 12 项集成测试如何用干净库跑。
- [ ] 知道当前没有 `origin`，不要推 `upstream`。

完成一项功能后请：

1. 更新 `docs/WORD_CAMP_STAGE1_PROGRESS.md` 或新建阶段文档，写清验证证据。
2. 更新 `CHANGELOG.md` 的 `[Unreleased]`。
3. 如果迁移/协议变化，更新本文档“数据模型/已知坑”。
4. `git diff --check` → 提交（不要把 secret、日志、`node_modules` 提交）。
5. 汇报时区分“已实现/已验证/未验证/外部阻塞”，不要把计划写成完成。


---

## Stage 4 留存验证与规模化（R1–R11）完成摘要

- **规则与词库**：[shared/stage4.ts](../shared/stage4.ts)、[shared/gamification.ts](../shared/gamification.ts) 及 Day 4–14 手工扩充口诀已合入（688 核心词覆盖 431 词 / 62.6%）。
- **数据库与服务端**：迁移 [20261126000000_stage4_retention_scale/migration.sql](../prisma/migrations/20261126000000_stage4_retention_scale/migration.sql) 与 10 余项 Stage 4 服务、路由及脚本已通过真实 PostgreSQL 18.4（`sl_fresh`、`stage4_test`、`stage3_copy`）全量验证；修复高并发下学生账本行锁 `SELECT ... FOR UPDATE`。
- **前后端界面与性能**：学生端 Task/Review/Deck/Stats 与师长端 `/teacher/mnemonics`、`/admin/mnemonics`、`/teacher/game`、`/admin/game`、`/admin/releases` 全部构建并通过 Chromium Mobile（390×844 / 360×640）与 Desktop 端到端回归，学生首屏主包 gzip < 200 KB，详细进度见 [WORD_CAMP_STAGE4_PROGRESS.md](./WORD_CAMP_STAGE4_PROGRESS.md)。

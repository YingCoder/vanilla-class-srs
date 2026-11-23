# 阶段 1 进展记录

> 新接手请先读 [`docs/WORD_CAMP_HANDOFF.md`](WORD_CAMP_HANDOFF.md)：当前状态、运行命令、已知坑与下一里程碑。

本文件只记录**已实现并验证**的能力与证据；未完成项列在末尾，不提前写成已完成。

## 1. 用户名登录（2026-11-23）

### 数据模型

- `User.username String? @unique`：学生的主登录名；教师/管理员可继续用邮箱登录。
- `User.email String? @unique`：改为可空，学生可以没有邮箱。
- 迁移 `prisma/migrations/20261123000000_user_username_optional_email/`：
  1. 新增 `username`，把 `email` 改为可空；
  2. 用邮箱前缀 + 用户 id 前 4 位回填既有账号，保证唯一；
  3. 规范化非法字符；
  4. 建立唯一索引 `User_username_key`。
- 已在干净数据库（`sl_fresh2`）从初始迁移开始完整应用 10 个迁移，无报错；也在现有开发库上完成增量应用。

### 服务端

- `POST /api/auth/login` 接受 `identifier`（用户名或邮箱），继续兼容旧的 `email` / `username` 字段；响应返回 `username` 与可空 `email`。
- 登录查询同时匹配 `username`（小写规范化）与 `email`，失败信息统一为 “Invalid username or password”，仍执行 bcrypt 常量时间比较。
- `authRateLimitKey` 按 IP + 标识符限流，兼容旧客户端只传 `email` 的请求。
- 忘记密码：无邮箱账号不会尝试发信，统一返回 200，避免枚举账号；学生密码由教师重置。
- 学生创建（单条 + CSV）：
  - 支持 `username` 与/或 `email`，至少一项；
  - 用户名规则 `^[a-z0-9_]{3,32}$`，服务端统一小写；
  - 无用户名时从邮箱/姓名派生候选，冲突时追加随机后缀；
  - 无邮箱学生创建成功，返回一次性临时密码与用户名。
- 教师/管理员重置学生密码的响应新增 `username` / `email`，账号卡可直接印出登录名。
- 管理员种子脚本新增 `ADMIN_USERNAME`（默认取邮箱前缀），创建时写入用户名。

### 客户端

- 登录页改为“用户名或邮箱”单输入框，中文提示；调用 `{ identifier, password }`。
- 教师/管理员班级页的新增学生表单支持“用户名（可无邮箱）”，编辑表单可改用户名/邮箱。
- 学生名单新增 `Login` 列；CSV 导入结果展示用户名。
- CSV 模板改为 `name,username,email`，允许邮箱留空。
- 账号卡/打印条新增登录名，中文提示首次登录改密。

### 验证证据

- `npm run test -w server`：`295 passed | 12 skipped`（用户名规则、纯用户名导入、迁移后登录路径均有覆盖）。
- `npm run build -w shared && npm run build -w server && npm run build -w client`：通过。
- Docker 端到端（干净数据卷）：
  1. 邮箱登录管理员 → 返回 `username=admin_4dfd`；
  2. 用 `identifier=admin_4dfd` 登录 → 200；
  3. 管理员创建部门/年级/班级；
  4. `POST /api/admin/classes/:id/students` 只传 `{name, username}`，返回 `status=created`、`username=e2e_student_4561`、一次性临时密码；
  5. 该学生用 `identifier=e2e_student_4561` + 临时密码登录 → 200，`email=null`，`mustChangePassword=true`。
- 迁移与种子镜像在运行镜像之外单独构建；`seed` 目标已修复 bcrypt 原生绑定问题（builder 阶段 `--ignore-scripts`）。

## 2. 奖励账本与等级（2026-11-23）

### 数据模型

- 新增 `RewardEvent`：
  - `eventKey` 业务事件键、`rewardType`（XP / COIN）、`amount`、`reason`、`studyDate`（北京时间 `YYYY-MM-DD`）；
  - 唯一约束 `(userId, eventKey, rewardType)`，作为重复提交/重试的幂等保护；
  - 索引 `(userId, studyDate)` 支持每日上限结算。
- 迁移 `20261123010000_reward_ledger` 已在干净库与开发库应用。

### 规则与结算

- 复用 `shared/word-camp.ts` 的纯规则：事件键、默认奖励额、每日上限（250 XP / 100 金币）、等级阈值。
- 复习会话结束（`POST /students/review/finish`）后按会话结算：
  - 某词第一次成功回忆（grade ≥ 3 且无更早成功记录）→ `word_learned`，10 XP；
  - 后续成功复习 → `review_ok`，5 XP，按上海学习日去重；
  - grade 1/2（提示后答对或答错）不奖励；
  - 同一会话同一词只按第一次成功计一次。
- 每日上限按 `studyDate` 聚合，超额时截断（clamp）；重复事件由数据库唯一键吞掉。
- `GET /students/rewards` 返回累计 XP、金币、今日获得、等级/下一级进度与最近 50 条流水。
- 学生端新增“我的成长”页；复习完成页显示本次 `+XP / +金币`。

### 验证证据

- `reward.service.test.ts`：首次奖励、重复事件不重复写入、每日上限截断、P2002 竞态容错。
- `npm run test -w server`：`308 passed | 12 skipped`（卡片导入与奖励测试加入后）。
- 干净数据库完整应用 11 个迁移。
- 前端构建通过；新增页面已接入 `/student/rewards`。

### 已知限制

- 奖励在 `finish` 时结算，尚未与答题写入放在同一数据库事务；幂等由账本唯一键保证，极端失败下可能延迟到下一次完成会话补发。
- Boss 首通、每日任务完成、连续 7 天奖励的事件来源（关卡/每日任务表）尚未实现，规则与事件键已在共享层就绪。
- 教师端奖励配置与流水查看尚未开始。

## 3. 词表导入：GBK / BOM、表头兼容与变体（2026-11-23）

### 解析

- 服务端统一用 `parseCardCsvBuffer`：
  - UTF-8（含 BOM）优先；UTF-16 LE/BE BOM 支持；
  - 非法 UTF-8 自动回退 GBK（Excel 中文版默认导出），不再要求教师手动转码；
  - 表头别名：`meaning_zh` / `meaning` → `definition_l1`，`definition_en` → `definition_l2`，`example_en` → `example_sentence`，`variants` 支持 `variant` / `alt_spellings`。
- `Card.variants String[]` 新增：
  - CSV `variants` 列按 `|` 拆分、去空格、去重、排除词条本身；
  - 单卡新增/编辑 API 同步支持 `variants`。
- 教师端与管理员端共用同一解析与校验服务；导入仍保持“全部校验通过才写入”。

### 验证证据

- `card.service.test.ts`：UTF-8 BOM + 别名、GBK 字节解码、畸形 CSV、变体清洗、必填校验。
- Docker 端到端：管理员上传 GBK 编码 CSV（`word,meaning_zh,example_en,variants`）→ `created:1`；读取词集得到 `definitionL1:"颜色"`、`variants:["colour"]`。
- 前端导入帮助与模板改为规格表头，并提示 GBK 支持。

## 4. 会话撤销与中文学生复习界面（2026-11-23）

### 会话撤销

- `User.sessionVersion`（迁移 `20261123030000_session_version`）作为会话代际。
- JWT 增加 `sv`；`requireAuth` 每次请求校验 token 的 `sv` 与数据库一致，重置/改密后旧 access token 立即 401，不再等 1 小时过期。
- `refresh` 校验 refresh token 的 `sv`，不匹配返回 401。
- 改密：`sessionVersion + 1`，随后给当前设备重新签发 cookie（当前设备不掉线，其他设备失效）。
- 忘记密码、教师/管理员重置密码：`sessionVersion + 1`，旧会话全部失效。

### 中文学生复习界面

- 复习页按钮/评分/完成页/作业说明改为中文；评分文案为“不记得 / 差点忘了 / 记得 / 很简单”。
- 学生导航：学习、我的词库、班级词集、统计、我的成长。
- 完成后展示本次 `+XP` 与金币。

### 验证证据

- 全量测试 `341 passed | 12 skipped`；13 个迁移（含会话版本）在干净库应用通过。
- Docker 端到端：学生登录后由管理员重置密码，旧 access token 与旧 refresh token 请求均返回 401。
- 前端构建通过；中文复习页与成长页已随镜像部署。

## 5. 断点续学（2026-11-23）

- `ReviewSession.queue` 保存本轮题目实例的**有序**列表（迁移 `20261123040000_review_session_queue`）。
- `review/start` 发现该 deck 有未结束会话且队列未完成时：
  - 读取已产生 `ReviewEvent` 的实例，过滤出剩余题目；
  - 返回**同一个** `sessionId`，`resumed: true`，不新建会话；
  - 队列全部完成或没有队列时，才关闭旧会话并新建。
- 客户端刷新、切后台再回来调用 start 即可继续同一轮；已答题目不再出现。

### 验证

- `startSession` 新增“resume”用例：同一会话、只返回未答卡、不调用 create。
- 14 个迁移在干净库应用通过。
- Docker 端到端：同一学生连续两次 `POST /students/review/start`，返回同一 `sessionId`，第二次 `resumed: true`，10 张卡顺序完全一致。

## 6. FSRS-5 校正与基准向量（2026-11-23）

- 参考实现：`ts-fsrs@4.7.0`（自报 `using FSRS-5.0`，MIT），固定 `request_retention=0.9`、`maximum_interval=36500`、无 fuzz、启用 short-term。
- `shared/fsrs/fsrs.ts` 已对齐：
  - 19 个默认权重与参考实现完全一致；
  - 遗忘曲线 `R=(1+19/81·t/S)^-0.5`；
  - 复习稳定度 `S' = S·(1 + exp(w8)·(11-D)·S^-w9·(exp(w10·(1-R))-1)·hard·easy)`；
  - 难度 linear damping + 均值回归 `D0(Easy)`；
  - 遗忘稳定度 `min(S, S_f)`；
  - 新卡 1/2/3 评分分别 1/5/10 分钟后仍在 LEARNING，Easy 直接 REVIEW；
  - 复习 Again 进入 RELEARNING（5 分钟），reps 每次递增。
- 到期时间改为 `now + interval` 的精确时间戳，不再 `setHours(0,0,0,0)`，消除了对服务器本地时区的依赖。
- `server/src/__tests__/fsrs.reference.test.ts`：9 条固定向量（NEW 四档、LEARNING 毕业后、REVIEW 四档）与参考实现 stability / difficulty / state / due 逐项一致。
- 仍缺：用真实学习日志重新拟合权重；本轮只证明“公式与参考实现一致”，不证明默认权重适合本校学生。

## 7. 今日已学习 / 未学习名单（2026-11-23）

- 新增 `GET /api/teachers/classes/:id/pending-today` 与管理员镜像 `/api/admin/classes/:id/pending-today`。
- 口径：Asia/Shanghai 自然日（UTC 边界 `16:00Z`）内，该班学生有至少一轮**已结束**且 `cardsReviewed > 0` 的复习会话，即“今日已学习”；否则“今日未学习”。
- 返回班级人数、已学习/未学习人数、未学习名单（姓名/登录名）、已学习名单（今日复习卡数/最近完成时间）。
- 教师端与管理员端班级详情新增“今日”Tab；同时显示“统计口径不是关卡任务完成”，避免把“学习过”冒充“完成每日任务”。
- 服务端单测覆盖上海日界（`15:59:59Z` 仍属前一日、`16:00Z` 进入新一日）与名单分组；Docker 端到端：完成一轮复习后，未学习 1 → 0、已学习 0 → 1。

## 8. CSV 导出安全（2026-11-23）

- 新增 `server/src/lib/csv.ts`：`escapeCsvCell` 对以 `= + - @ \t \r` 开头的单元格前置单引号，阻止 Excel/Sheets 公式注入；含逗号/引号/换行的单元格按 RFC 4180 引号转义。
- 学生 deck 导出改用 `toCsv`：UTF-8 BOM + CRLF，中文在 Windows Excel 直接可读。
- 单测覆盖公式触发字符、引号+公式组合、BOM/CRLF。

## 9. 学生名单 GBK 与依赖安全（2026-11-23）

### 学生名单 GBK

- `decodeCsvBuffer` 抽到 `server/src/lib/csv.ts`，卡片导入与学生名单导入共用。
- `parseEnrollCsv` 先解码再 `csv-parse`，UTF-8/BOM、UTF-16、GBK 均可；GBK 中文姓名单测通过。
- 中文 Windows Excel 导出的名单不再需要手动转码。

### 生产依赖审计

- `bcrypt` 5.1.1 → 6.0.0，移除 `@mapbox/node-pre-gyp` / `tar` / `glob` / `rimraf` 旧链，消除 1 critical + 相关 high。
- 根 `package.json` 新增 `overrides`：`body-parser` 1.20.9、`proxy-addr` 2.0.8、`path-to-regexp` 0.1.13、`ip-address` 10.7.6。
- `react-router-dom` 6.30.3 → 6.30.6。
- `multer` 1.4.5-lts → 2.5.0（1.x 官方已弃用），Docker 内 GBK 词表上传回归 `{"created":1}`。
- 生产审计：**15 → 6 个（0 critical、2 high、4 moderate）**；`nodemailer` / `zod` / `react-router` / `csv-parse` 的修复需破坏性大版本，列入后续计划。
- 升级后 328 个服务端测试、三包构建与 Docker 登录路径均需回归。

### 权限集成回归（2026-11-23）

- 在一次性干净库 `sl_fresh` 上完整应用 14 个迁移，运行 `subjectLead.integration.test.ts`：**12 passed / 12**。
- 覆盖学科组长跨班读取、授权/拒绝、班级创建与成员关系等工作流；默认套件仍因缺少 `SL_TEST_DATABASE_URL` 跳过，需按 `docs/WORD_CAMP_VERSIONING.md` 使用 127.0.0.1 的独立库执行。
- 该结果消除了“权限测试从未跑过”的状态，但不等于全部资源级权限矩阵；管理员/教师/学生越权矩阵仍待补。

## 10. 学生“今日进度”（2026-11-23）

- 新增 `GET /api/students/today?enrollmentId=`，返回：上海学习日、当前到期总数、待学新词、待复习数、今日新学词数、今日复习事件数/去重卡数、默认目标（新词 10 / 复习 10）、今日 XP/金币。
- 新学词判定：`CardInstance.reps === 1` 且 `lastReview` 落在上海自然日内；复习事件按 `ReviewEvent.reviewedAt` 统计。
- 学生复习页空闲状态显示今日进度与当前待复习数；结束一轮后自动刷新。
- 该接口只报告“可测学习活动”，不返回 `completed`，避免在 L1–L5/Boss 未实现时把复习活动冒充每日任务完成。
- 单测覆盖上海日界、目标回退、非本人 enrollment；Docker 实测返回 `todayNewCards:1, todayReviews:1, reviewsDue:1, xpToday:10`。

## 11. 服务端拼写题（2026-11-23）

- 新增 `POST /api/students/review/answer`：客户端只提交学生输入的字符串，服务端负责比对答案与 FSRS 评分，不再让客户端直接决定 grade。
- 判分：去首尾空格、忽略大小写、合并连续空格；接受 `Card.word` 与教师配置的 `variants`（如 color / colour）。
- 与任一正确词形相差 1 个字符时返回 `verdict: "close"`（“很接近了”），但仍按答错调度；完全匹配为 `correct`，其余 `wrong`。
- 调度映射：正确 → grade 3（Good），错误/接近 → grade 1（Again）；回答进入 `ReviewEvent`，因此奖励与统计沿用既有链路。
- 新增学生页面 `/student/spelling`：显示中文释义，隐藏英文，逐词输入；复习页空闲状态提供“拼写练习”入口。输入框关闭自动大写/纠错/拼写检查，符合移动端规范。
- 单测覆盖规范化、变体、Levenshtein 1 字符与空答案；Docker 端到端用 `colour` 命中 variant：`correct:true`、`expected:"color"`、grade 结果 `state:REVIEW`，结束结算 +5 XP。
- 限制：尚无选择题、听音题、提示分级、重试 2 次、Boss 与星星；拼写只作为首个独立客观题型。

## 12. 服务端认词四选一（2026-11-23）

- 新增 `GET /api/students/review/choice?sessionId=&instanceId=`：返回英文提示词、词性与 4 个中文释义选项；正确项不单独标记。
- 新增 `POST /api/students/review/choice-answer`：服务端比对所选释义，正确 → grade 3，错误 → grade 1；客户端仍不能自选 grade。
- 选项来源：优先同 deck 其他词义；deck 不足 3 个时用通用中文释义补齐并去重，保证小题量也能显示 4 个唯一选项。
- 选项排序用 FNV-1a 哈希 + `instanceId` 种子，刷新同一题顺序稳定，避免每题跳动。
- 新增学生页面 `/student/choice`：大号四行选项、提交后标出正确项、逐题进入下一张；复习页提供“认词练习”入口。
- 单测覆盖：包含正确项、去重、确定性、极小 deck 补齐；Docker 实测选项 `颜色 | 味道 | 形状 | 大小`，选择“颜色”返回 `correct:true` 并正常调度。
- 至此 MVP 要求的“认词 + 拼写”两种独立客观题型均有服务端判分；尚未做选择题提示排除、键盘 1–4 快捷选择与重复提交幂等。

## 13. 未完成（阶段 1 剩余）

- 全站中文界面：目前登录页、新增学生表单、学生“我的成长”已中文，教师/管理员其余页面仍为英文。
- 权限收紧：学科组长跨班只读与规格 §12 的冲突仍待产品决策；尚未实现完整资源级权限测试矩阵。
- 单词表导入的剩余字段：音标与音频生成/降级尚未实现。
- 每日任务定义、关卡（L1–L5/Boss）、星级与错词重练尚未实现；奖励账本与等级、今日学习名单已完成。
- 学生移动端首页/单手操作规范尚未系统化验收；断点续学已有后端与复习页，但未做真机切后台验收。
- 依赖大版本升级：`nodemailer` 10、`zod` 4、`react-router-dom` 7、`csv-parse` 7；当前生产审计仍有 6 个（0 critical）。
- `subjectLead.integration.test.ts` 默认因缺少 `SL_TEST_DATABASE_URL` 跳过 12 项；已在干净 `sl_fresh` 跑通 12/12，但还没有 CI 自动执行。

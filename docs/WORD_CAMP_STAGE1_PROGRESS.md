# 阶段 1 进展记录

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

- 全量测试 `328 passed | 12 skipped`；13 个迁移（含会话版本）在干净库应用通过。
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

## 10. 未完成（阶段 1 剩余）

- 全站中文界面：目前登录页、新增学生表单、学生“我的成长”已中文，教师/管理员其余页面仍为英文。
- 权限收紧：学科组长跨班只读与规格 §12 的冲突仍待产品决策；尚未实现资源级权限测试矩阵。
- 单词表导入的剩余字段：音标、词性/例句已能导入，音标与音频生成/降级尚未实现。
- 每日任务定义、关卡（L1–L5/Boss）、星级与错词重练尚未实现；奖励账本与等级已完成。
- 学生移动端首页/单手操作规范、断点续学 UI 尚未系统化验收。
- FSRS 金标向量与时区边界仍未补测。
- 依赖安全升级（生产 15 个漏洞）未处理。

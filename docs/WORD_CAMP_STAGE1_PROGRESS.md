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
- `npm run test -w server`：`302 passed | 12 skipped`（奖励测试加入后）。
- 干净数据库完整应用 11 个迁移。
- 前端构建通过；新增页面已接入 `/student/rewards`。

### 已知限制

- 奖励在 `finish` 时结算，尚未与答题写入放在同一数据库事务；幂等由账本唯一键保证，极端失败下可能延迟到下一次完成会话补发。
- Boss 首通、每日任务完成、连续 7 天奖励的事件来源（关卡/每日任务表）尚未实现，规则与事件键已在共享层就绪。
- 教师端奖励配置与流水查看尚未开始。

## 3. 未完成（阶段 1 剩余）

- 全站中文界面：目前登录页与新增学生表单已中文，教师/管理员其余页面仍为英文。
- 权限收紧：学科组长跨班只读与规格 §12 的冲突仍待产品决策；尚未实现资源级权限测试矩阵。
- 单词表导入：GBK/BOM 检测、`variants`/词性/例句字段、音标与音频占位尚未实现。
- 每日任务、奖励账本、等级/星级、学生移动端首页尚未开始。
- FSRS 金标向量与时区边界仍未补测。
- 依赖安全升级（生产 15 个漏洞）未处理。

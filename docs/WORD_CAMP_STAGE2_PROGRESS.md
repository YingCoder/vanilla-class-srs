# 单词特训营 — Stage 2 开发进度与测试验收文档

> **文档用途**：供产品经理（PM）功能验收、测试工程师（QA）用例设计与提测联调参考。  
> **更新日期**：2026-11-25  
> **当前分支**：`develop/word-camp-v0.1`  
> **基线客户端版本**：`v2.4.0`（词包编号 `Pack-23D-688`）  
> **视觉定稿方向**：方向二 · 糖果卡牌特训营（`香草单词营`，已记录于 `design-demos/direction-approved.md`）

---

## 一、本阶段核心交付概览

本阶段围绕「初中/中职学生手机端高频背词」场景完成五大改造，并在管理员端与教师端保持热更新管理能力完全对等：

| 需求项 | 落地形态与核心设计 | 当前状态 | 关键入口文件 |
| --- | --- | --- | --- |
| 1. 手机端单屏短小适配 | `100dvh` 固定视口、底部 4 标签栏（`特训` / `艾斯背词` / `23天词库` / `我的App`）、卡片左右滑动切词，消除长滚动与频繁翻页 | 已完成（UI & 构建已验） | `client/src/pages/student/StudentLayout.tsx`、`client/src/pages/student/ReviewPage.tsx` |
| 2. 深浅颜色开关与内容适配 | 亮色「草莓奶昔营 `#FFF0EC`」× 暗色「深夜可可营 `#141117`」；便利贴、按钮、状态标签与 `<meta name="theme-color">` 均做语义重映射并持久化至 `localStorage` | 已完成（全端可用） | `client/src/components/ThemeProvider.tsx`、`client/src/components/ThemeToggleButton.tsx`、`client/src/index.css` |
| 3. 邪修记忆 × 23 天 688 词库 | 解析源文档《23天背完中考英语高频词》，688 词全量入库与客户端速查，其中 **136 词**配手工邪修口诀（Day 1–3 全 90 词 + Day 4–23 难点 46 词），其余诚实标注「待配邪修」 | 已完成 | `shared/vocab/zhongkao23.ts`、`client/src/components/MnemonicCardBlock.tsx`、`client/src/pages/student/DeckPage.tsx` |
| 4. 艾宾浩斯（艾斯）记忆法 | 在服务端 FSRS-5 上叠加 8 阶段模型（`初记 → 5分 → 30分 → 12时 → 1天 → 2天 → 4天 → 7天 → 15天`）、实时保持率曲线条及四档反馈键（`重来 / 模糊 / 记住 / 秒杀`） | 已完成 | `shared/ebbinghaus.ts`、`client/src/components/EbbinghausStrip.tsx`、`server/src/services/review.service.ts` |
| 5. iOS 免签名网页 App（PWA） | 配置 `manifest.webmanifest`、Safari Web Clip meta 标签、安全区适配与「添加到主屏幕」3 步指引弹窗；单班级学生打开直入学习页 | 已完成（待 iOS 真机实测） | `client/index.html`、`client/public/manifest.webmanifest`、`client/public/sw.js`、`client/src/utils/pwa.ts` |
| 6. 热更新管理与推送 | 新增 `AppRelease` 表与推送服务；管理员与教师均可发布词包/口诀补丁/界面更新或一键撤回，学生端切回前台或轮询时弹出 `1秒热更新` 浮条 | 已完成（待连库联调） | `server/src/services/release.service.ts`、`server/src/routes/releases.ts`、`client/src/components/HotUpdateBanner.tsx`、`client/src/components/ReleasePushManager.tsx` |

---

## 二、产品验收要点与业务规则说明

### 2.1 词库与「邪修记忆」覆盖口径
- **全量词数**：共 23 天 **688 词**（Day 1–22 每天 30 词，Day 23 共 28 词；已修正原文档末尾 `"TRUE"` 为小写 `"true"`）。
- **邪修覆盖说明**：当前提供 **136 条手工精编邪修口诀**（含流派标签如 `谐音暴击`、`拆字脑洞`、一句话记忆故事、音节/字母块中文拆解、考场防坑提示与例句）。未手工编写的 552 词会在卡片上显示音标、释义、例句与艾宾浩斯节奏，并诚实提示「待配邪修」，后续可通过教师/管理员后台发布 `MNEMONIC_PATCH` 热更新补丁包扩充，不生成千篇一律的模板套话。
- **闯关错题急救**：学生在 `LevelSessionPage`（L2/L3/L5/Boss）、`ChoicePage`（四选一）或 `SpellingPage`（拼写）答错并揭示答案后，界面自动弹出对应单词的「邪修急救便利贴」，不泄露未作答前的标准答案。

### 2.2 艾宾浩斯记忆法与 FSRS-5 映射规则
- **数据权威性**：所有评分与下次复习时间计算仍严格由服务端 `shared/fsrs` 执行（客户端不做擅自改期）。
- **前端展示映射（`shared/ebbinghaus.ts`）**：
  - 按稳定度 `stability` 与状态映射至 0–8 阶（`初记` → `第1阶 5分后` → `第2阶 30分后` → `第3阶 12时后` → `第4阶 1天后` → `第5阶 2天后` → `第6阶 4天后` → `第7阶 7天后` → `满级稳固 15天后`）。
  - 实时计算遗忘曲线保持率 `R(t, S) = (1 + (19/81) * t / S)^(-0.5)`，在卡片顶部曲线条展示「保持 XX% · 临界状态 · 预计下次复习时间」。
  - `重来`（grade=1）会在本轮结束后计入弱词名单，支持结算页一键「邪修急救弱词重练」。

### 2.3 iOS 无签名 App 与 Service Worker 缓存边界
- **免签名逻辑**：采用标准 iOS Safari Web Clip（`apple-mobile-web-app-capable="yes"`），学生点击 Safari「分享 → 添加到主屏幕」后生成独立图标与无地址栏窗口，无需企业证书或 App Store 签名，不面临 7 天过期问题。
- **避免离线缓存陷阱**：`client/public/sw.js` 对 `/api/*` 严格执行 **Network-Only**，对 HTML 导航执行 **Network-First**，仅缓存带 hash 的 `/assets/*`、`/fonts/*` 与图标，并在热更新触发时通过 `SKIP_WAITING` 接管。

### 2.4 热更新推送与回滚策略
- **支持三种推送方式（`ReleasePushMode`）**：
  - `BANNER`（默认）：学生端弹出悬浮横幅「老师推送热更 vX.Y.Z」，点击 **「1秒热更新」** 即同步版本标记（涉及前端代码更新 `APP_UI` 或 SW 等待态时触发页面重载）。
  - `FORCE_RELOAD`：紧急补丁模式，提示约 1.4 秒后自动应用并刷新。
  - `SILENT`：静默同步版本标签，不弹窗打扰做题。
- **教师/管理员对等**：管理员端（`/admin/releases`）与教师端（`/teacher/releases`）使用同一套 `ReleasePushManager` 与后端服务，均支持发布新推送与一键「撤回」（停用当前版本并自动回退至上一有效版本）。

---

## 三、测试工程师（QA）验收清单

### 3.1 环境准备（连库上线必做）
1. 启动 PostgreSQL 数据库并确认 `.env` 中 `DATABASE_URL` 可连接。
2. 在仓库根目录依次执行：
   ```bash
   npx prisma migrate deploy
   npm run build -w shared
   npm run seed
   npm run build -w server
   npm run build -w client
   ```
3. 确认迁移 `20261125000000_mnemonic_ipa_hot_releases` 已成功写入 `"Card"."ipa"`、`"Card"."mnemonic"`、`"DailyTaskWord"."ipa"`、`"DailyTaskWord"."mnemonic"` 与 `"app_releases"` 表，且种子生成 `23天中考英语高频词（688词·含邪修口诀）` 词集与基线发布 `v2.4.0`。

### 3.2 功能与兼容性测试用例

| 编号 | 模块 | 测试步骤 | 预期结果 | 测试状态 |
| --- | --- | --- | --- | --- |
| QA-01 | 手机单屏适配 | 使用手机或 `390×844` / `360×640` 视口打开 `/student/review` 与 `/student/task` | 顶部教练栏、艾斯曲线、焦点词卡、邪修便利贴、4 档记忆键与底部 4 标签栏完整呈现；无横向滚动条，无需上下翻长页 | 已在构建+Playwright中验 `390×844`；需真机复核 `360×640` 与微信内置浏览器 |
| QA-02 | 手势切词与便利贴开关 | 在 `/student/review` 卡片区左右滑动，点击右上角「收起便利贴 / 展开邪修贴」及「遮住释义自测」 | 左右滑动顺畅切换队列词卡；便利贴可即时折叠展开；遮住释义后再点卡片即可揭晓 | 待连库真机手势验证 |
| QA-03 | 深浅色切换与持久化 | 在学生顶栏、登录页或教师/管理侧栏点击「夜间护眼 / 草莓日间」，刷新页面 | 页面立即切换亮/暗主题；邪修便利贴在暗模式下转为深金护眼配色；标签与按钮无白字白底或低对比度问题；刷新后保持当前主题 | 已通过 Playwright 日间/夜间切换验证；需核查教师/管理其它子页面暗色观感 |
| QA-04 | 艾斯复习与重练 | 依次点击 `重来 (5分)`、`模糊 (30分)`、`记住`、`秒杀` 完成一轮复习 | 请求正常提交 `POST /students/review/grade`，`重来` 触发便利贴展开并在结算页出现「弱词重练」按钮；点击重练可重开弱词队列 | 需连真实后端+DB验证 FSRS 落库结果 |
| QA-05 | 每日闯关与邪修急救 | 进入 `/student/task` 启动 L1 / L2 / L3 / L5；在选择题或拼写题故意答错触发揭示答案 | L1 可浏览新词邪修卡片；答错揭示后立即展示该词邪修急救卡片；键盘弹出时 L5 输入框和「核对」按钮不被遮挡 | 需真实任务+真机软键盘验证 |
| QA-06 | 23 天 688 词库速查 | 进入 `/student/deck`，切换 `D1`–`D23`、搜索 `museum` / `TRUE` / 中文、勾选「仅邪修」 | 可精确检索全书 688 词；点击「看邪修卡」弹窗展示完整口诀、音节拆解与读音按钮 | 已验证 `688` 词数据结构及 `D23` 列表渲染 |
| QA-07 | iOS 免签名网页 App | iPhone Safari 访问后点「装到桌面」或我的页面「iPhone 免签名安装」，按引导添加到主屏幕并从桌面启动 | 弹窗 3 步引导清晰；从主屏幕打开呈无地址栏独立 App，单班学生自动跳过选班直入 `/student/task` | 仅验证 meta/manifest 与弹窗渲染；**必须 iOS 真机 Safari 实测** |
| QA-08 | 热更新发布、推送与撤回 | 教师或管理员登录 `/teacher/releases` 或 `/admin/releases`，发布 `v2.4.1`（`BANNER` 模式）；切回学生端检查/等待聚焦触发 | 列表与「当前线上生效版本」更新为 `v2.4.1`；学生端弹出「老师推送热更 v2.4.1」，点击「1秒热更新」后顶栏版本变为 `v2.4.1`；后台点击「撤回」后 `/api/releases/latest` 回滚为 `v2.4.0` | 单测+Mock联调已验；需双账号实时端到端联调 |
| QA-09 | 权限与安全边界 | 学生账号请求 `/api/admin/releases` 或 `/api/teachers/releases` | 返回 `403 Forbidden` | 路由级已挂载 `requireAdmin` / `requireTeacher` 校验，待接口回归测试 |

---

## 四、当前已执行的自动化验证记录

| 检查项 | 执行命令 | 结果与覆盖范围 | 备注 |
| --- | --- | --- | --- |
| 共享包构建 | `npm run build -w shared` | 通过（退出码 0） | 产出 `ebbinghaus`、`vocab`（688词）、`fsrs`、`word-camp` |
| 服务端编译 | `npm run build -w server` | 通过（退出码 0） | `tsc` 无类型报错 |
| 服务端单元测试 | `npm run test -w server` | **39 个测试文件、381 项用例通过**；1 个数据库集成测试文件（12 项用例）跳过 | 新增 `release.service.test.ts`（2 项）与 `ebbinghaus.test.ts`（2 项）全部通过；因本机 5432 端口无 PostgreSQL 服务，12 项 DB 集成用例按预期跳过 |
| 前端构建 | `npm run build -w client` | 通过（`tsc && vite build` 零报错） | 学生首屏入口 JS `dist/assets/index-*.js` 约 **117.81 kB (gzip)**（低于 200 KB 预算）；管理/教师端按路由懒加载分包 |
| 前端预览与 UI 回归 | `vite preview` + Playwright 自动化脚本 | 全部通过，0 个 `console.error` / `pageerror` | 使用 `/api/**` Mock 拦截实测 `390×844`（日间/夜间主题、`scrollHeight = 844`、4 底部 tab、热更浮条、iOS 引导弹窗）与 `1440×900` 管理员热更控制台 |

---

## 五、已知局限与上线前待办

1. **真实数据库联调未在本机执行**：当前开发机未启动 PostgreSQL（Docker 未运行），`prisma migrate deploy` 与 `npm run seed` 需要在有数据库的环境执行并复核 `scripts/seed/verify.ts` 与 `subjectLead.integration.test.ts`。
2. **真机与微信浏览器验证**：`scrollHeight = 844` 在桌面 Chromium 手机模拟下已达标，但仍需在 iPhone Safari（含刘海屏/灵动岛主屏幕模式）、华为/小米等 Android 浏览器及微信内置浏览器中验证软键盘弹起、语音朗读 `speechSynthesis` 降级与返回手势。
3. **其余 552 词邪修内容**：首版精编完成 136 词，后续可由教研老师整理 JSON/CSV 并通过热更新推送机制持续增量更新。
4. **遗留原型目录说明**：`design-demos/` 目录存放 `huashu-design` 三方向比稿原型及评测截图，上线打包不影响 `client/`、`server/`、`shared/` 构建产物；如需精简仓库体积可在归档后清理。

---

## 六、本阶段主要新增与修改文件清单

### 共享层与数据库（`shared/`、`prisma/`、`scripts/seed/`）
- `prisma/schema.prisma`：为 `Card`、`DailyTaskWord` 增加 `ipa`、`mnemonic`，新增 `AppRelease` 模型及推送枚举
- `prisma/migrations/20261125000000_mnemonic_ipa_hot_releases/migration.sql`：增量 DDL 迁移脚本
- `shared/ebbinghaus.ts`：艾宾浩斯 8 阶段映射与遗忘保持率计算纯函数
- `shared/vocab/zhongkao23.ts`、`shared/vocab/index.ts`：23 天 688 词 + 136 条邪修记忆结构化词库与检索函数
- `shared/package.json`、`shared/tsconfig.json`：导出 `./ebbinghaus` 与 `./vocab`
- `scripts/seed/index.ts`、`scripts/seed/wipe.ts`：写入 23 天高频词集与基线发布记录 `v2.4.0`

### 服务端（`server/`）
- `server/src/services/release.service.ts`、`server/src/routes/releases.ts`、`server/src/index.ts`：热更新检查、词包信息、Admin/Teacher 发布与撤回接口
- `server/src/services/review.service.ts`、`dailyTask.service.ts`、`levelSession.service.ts`：为复习卡片、每日任务快照与 L1 词卡补全 `ipa` 与 `mnemonic`
- `server/vitest.config.ts`、`server/src/__tests__/release.service.test.ts`、`server/src/__tests__/ebbinghaus.test.ts`

### 客户端（`client/`）
- PWA 与主题底座：`client/index.html`、`client/public/manifest.webmanifest`、`client/public/sw.js`、`client/src/utils/pwa.ts`、`client/src/utils/audio.ts`、`client/src/utils/api.ts`、`client/src/components/ThemeProvider.tsx`、`client/src/components/ThemeToggleButton.tsx`、`client/src/components/HotUpdateBanner.tsx`、`client/src/index.css`、`client/vite.config.ts`
- 学生端页面：`client/src/components/EbbinghausStrip.tsx`、`client/src/components/MnemonicCardBlock.tsx`、`client/src/pages/student/StudentLayout.tsx`、`TaskPage.tsx`、`ReviewPage.tsx`、`LevelSessionPage.tsx`、`ChoicePage.tsx`、`SpellingPage.tsx`、`DeckPage.tsx`、`StatsPage.tsx`
- 认证与双端热更台：`client/src/components/AuthProvider.tsx`、`client/src/utils/auth.ts`、`client/src/pages/auth/LoginPage.tsx`、`client/src/components/AppShell.tsx`、`client/src/components/ReleasePushManager.tsx`、`client/src/pages/admin/ReleasesPage.tsx`、`AdminLayout.tsx`、`client/src/pages/teacher/ReleasesPage.tsx`、`TeacherLayout.tsx`、`client/src/App.tsx`

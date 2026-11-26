# 单词特训营 — Stage 3 游戏化激励开发与验收文档

> **更新日期**：2026-11-25  
> **需求依据**：`docs/单词特训营 — Stage 3 游戏化激励开发需求.md`

---

## 一、核心交付与功能覆盖

| 需求项 | 优先级 | 落地内容 | 关键文件 |
| --- | --- | --- | --- |
| G0 奖励账本与防刷 | P0 | `GameEvent` 只增不改账本、`submissionId` 幂等、同词每日限前 2 次 XP、未到期 0 XP、每日 400 XP 封顶、上海日界 | `server/src/services/gamification.service.ts`、`review.service.ts` |
| F1 经验值与营员等级 | P0 | 1/3/5/6 分档评分 XP、关卡首通 XP、弱词重练 XP、Lv1→2=100/+50 阶梯升级、5 档称号、顶栏 XP 条与明细弹窗 | `shared/gamification.ts`、`client/src/pages/student/StudentLayout.tsx` |
| F2 每日双环与连续学习 | P0 | 复习环（0 到期自动满环）+ 闯关环（L1–L3）、积压保护（50 / 回归首日 20）、双环合拢 +30 XP、7 天发冻结券（上限 2 张） | `shared/gamification.ts`、`client/src/pages/student/TaskPage.tsx` |
| F3 23 天营地地图 | P0 | D1–D23 节点状态与 1★/2★/3★（≥80% 词达第 4 阶：24/30，D23 为 23/28）、本周 7 格入口与 23 天全图弹层 | `server/src/services/gamification.service.ts`、`client/src/pages/student/TaskPage.tsx` |
| F4 单词卡牌收集 | P0 | `CardInstance.bestStage` 历史最高稀有度不降级、糖纸/银箔/金箔/闪钻边框、「23天词库」卡册切换（688 词，D23 28 张） | `client/src/pages/student/DeckPage.tsx`、`client/src/index.css` |
| F5 即时反馈与每日结算 | P0 | XP 飘字、≤1.5s 可跳过升级庆祝、`prefers-reduced-motion` 支持、默认关闭音效开关、明日到期词数与温和文案 | `client/src/components/GameContext.tsx`、`ReviewPage.tsx`、`LevelSessionPage.tsx` |
| F6 徽章与成就 | P0 | `BadgeDef` 配置化 18+1 枚徽章（坚持/记忆/闯关/逆袭/结业+周挑战）、幂等发放、未获得徽章显示灰色剪影与进度 | `shared/gamification.ts`、`client/src/pages/student/StatsPage.tsx` |
| F7 弱词 Boss | P1 | 近 7 天 `重来` 且当前 ≤2 阶最多 10 词、答对扣血/答错排到队尾、复用 FSRS 结算、关联逆袭徽章 | `server/src/routes/studentGame.ts`、`client/src/pages/student/ReviewPage.tsx` |
| F8 班级周挑战 | P1 | `ClassChallenge` 动态聚合全班进展与参与人数、只显示「已参与 X/Y 人」不泄露未参与名单 | `server/src/services/gamification.service.ts`、`TaskPage.tsx` |
| F9 班内进步榜 | P1 | 默认关闭；展示本周 XP 相对上周增量前 10 名；只返回昵称、头像与框，不暴露真实姓名 | `server/src/services/gamification.service.ts`、`StatsPage.tsx` |
| F10 教师激励看板与击掌 | P1 | `/teacher/game` 与 `/admin/game` 对等看板、连续天数分布、掉队名单（仅师长可见）、6 条预设击掌鼓励不打断做题 | `server/src/routes/teacherGame.ts`、`StaffGameDashboard.tsx` |
| F11/F12 装扮与战报卡 | P2 | 头像/头像框/词卡皮肤解锁与自定义、本地 `<canvas>` PNG 战报分享卡（无真名与排名） | `client/src/utils/shareCard.ts`、`ShareCardModal.tsx` |
| `GAME_CONFIG` 热更新 | P0/六 | `AppRelease` 支持 `GAME_CONFIG` 发布与撤回，仅管理员可发布且服务端强制参数护栏校验 | `server/src/routes/releases.ts`、`ReleasePushManager.tsx` |

---

## 二、已执行的自动化验证结果

1. **三包构建**：
   - `npm run build -w shared`：通过（退出码 0）。
   - `npm run build -w server`：通过（退出码 0）。
   - `npm run build -w client`：通过（退出码 0），学生首屏入口 JS `dist/assets/index-*.js` 为 **127.80 kB (gzip)**（低于 200 KB 预算，较 Stage 2 基线 `117.81 kB` 仅增加约 10 kB）。
2. **Prisma 校验与客户端生成**：
   - `npx prisma validate --schema=prisma/schema.prisma` 与 `npm run db:generate` 通过。
3. **服务端单元测试（Vitest）**：
   - 新增 `gamification.test.ts`（纯规则：XP/防刷/升级/稀有度/双环/积压保护/连胜与冻结券/上海时区与 22:30 边界/营地星级/参数护栏）、`gamification.service.test.ts`（QA-G01/G02/G04/G06/G10/G11/G13/G18）、`teacherGame.test.ts`（QA-G03/G15/G16 权限与篡改防护）。
4. **Playwright 浏览器自动化回归（`vite preview` + `/api/**` Mock）**：
   - 在 `390×844` 与 `360×640` 视口实测 `/student/task`、`/student/review`、`/student/deck`、`/student/stats`：`scrollWidth === clientWidth`、`scrollHeight === innerHeight`、`.student-stage-viewport` 内部零纵向溢出，0 个 `console.error` / `pageerror`。
   - 实测教师击掌横幅展示与点击、词库「卡册」视图与 `688` 词统计、徽章墙进度与剪影、班内进步榜昵称隐私保护、评分后结算页「明日到期」与升阶展示、日/夜主题切换、`/teacher/game` 与 `/admin/game` 对等看板及 `/admin/releases` `GAME_CONFIG` 表单。

---

## 三、待真实数据库与真机环境联调项

- 本机开发环境中 Docker 未运行且 `postgresql-x64-18` 服务处于停止状态，因此以下验收项尚未在真实 PostgreSQL 数据库与真机设备执行：
  1. 在真实 PostgreSQL 上执行 `npx prisma migrate deploy`（含 `20261125010000_stage3_gamification` 对 `CardInstance.bestStage` 的回填 SQL）与 `npm run seed`。
  2. 真实数据库并发竞态、跨自然日（23:59 → 00:01）端到端测试与 `subjectLead.integration.test.ts` 集成测试。
  3. iOS Safari / Android 浏览器 / 微信内置浏览器真机长按保存战报卡与 `100dvh` 软键盘验证。

# 香草单词营 — Stage 4 留存验证与规模化进展记录

对应需求文档：[单词特训营 — Stage 4 留存验证与规模化开发需求.md](./单词特训营%20—%20Stage%204%20留存验证与规模化开发需求.md)

## 1. 交付范围总结（P0 R1–R4 + P1 R5–R8 + P2 R9–R11）

### R1：上线稳定性、迁移演练、并发防护与对账 SOP
- **Schema & 迁移**：[prisma/schema.prisma](../prisma/schema.prisma) 与迁移 [20261126000000_stage4_retention_scale/migration.sql](../prisma/migrations/20261126000000_stage4_retention_scale/migration.sql) 已于真实 PostgreSQL 18.4 上全量部署（共 18 个迁移）。
- **Stage 2→3 迁移演练**：在包含 200 条合成 `CardInstance` 的 `stage3_copy` 库执行 [20261125010000_stage3_gamification/migration.sql](../prisma/migrations/20261125010000_stage3_gamification/migration.sql)，耗时约 189 ms，所有非 `NEW` 卡片 `bestStage` 无 NULL 异常并与 `mapFsrsToEbbinghausStage` 一致。
- **并发行锁修复**：在 [gamification.service.ts](../server/src/services/gamification.service.ts) `ensureProfileAndDailyState` 内引入按 `StudentGameProfile` 维度的 `SELECT ... FOR UPDATE` 行锁与 `createMany({ skipDuplicates: true })`，彻底消除高并发提交下 400 XP 封顶竞态或 `DailyGameState.xpEarned` 丢失更新。
- **对账脚本与告警**：[reconcile.service.ts](../server/src/services/reconcile.service.ts) 与 CLI [reconcile-ledger.ts](../server/src/scripts/reconcile-ledger.ts) 核验 `StudentGameProfile.totalXp === SUM(GameEvent.xp)`、`DailyGameState.xpEarned` 分日一致、无负值 XP、无重复 `submissionId`，异常写入 `logs/reconcile-alerts.log` 并返回非零退出码。

### R2：隐私安全埋点、效果看板与灰度/A-B 分班试验
- **指标口径文档**：[ANALYTICS_METRICS_SPEC.md](./ANALYTICS_METRICS_SPEC.md) 定义周活跃天数、到期完成率、双环合拢率、7 日留存率、口诀覆盖率、触顶率、关特效率、2h 提醒召回率、漏斗转化及 180 天 `AnalyticsDailyRollup` 归档规范。
- **服务端实现**：[analytics.service.ts](../server/src/services/analytics.service.ts)（剥离设备指纹/IP/UA，`clientEventId` 幂等去重）与 [gameConfig.service.ts](../server/src/services/gameConfig.service.ts)（支持 `AppRelease.scope` 为 `ALL` 或 `CLASSES` 指定实验班）。
- **师长端看板与推送范围**：[StaffStage4Panels.tsx](../client/src/components/StaffStage4Panels.tsx) 与 [ReleasePushManager.tsx](../client/src/components/ReleasePushManager.tsx) 分别接入 `/teacher/game`、`/admin/game` 效果看板 Tab 及 `/admin/releases` 灰度班级选择器。

### R3：温和召回体系（站内横幅 + Web Push + 微信优雅降级）
- **纯规则护栏**：[shared/stage4.ts](../shared/stage4.ts) 提供 6 套内置中性鼓励模板（经 `checkReminderTemplateSafety` 过滤愧疚/惩罚词）、每天 ≤1 / 每周 ≤4 次上限、07:00–21:30 静默窗及连续 3 次未打开自动静默 7 天规则。
- **零依赖 Web Push**：[webpush.ts](../server/src/lib/webpush.ts)（ES256 VAPID JWT + RFC 8291 `aes128gcm`）与 [reminder.service.ts](../server/src/services/reminder.service.ts) / [send-reminders.ts](../server/src/scripts/send-reminders.ts)；[sw.js](../client/public/sw.js) 支持通知点击打开并上报 `reminder_open`；[StatsPage.tsx](../client/src/pages/student/StatsPage.tsx) 微信浏览器自动隐藏系统推送开关并以 [StudentLayout.tsx](../client/src/pages/student/StudentLayout.tsx) 20:00 后站内轻提示及冻结券消耗通知护航。

### R4：邪修口诀工程化与 60%+ 内置覆盖扩充
- **内置覆盖扩充**：新增 [zhongkao23MnemonicsExtra.ts](../shared/vocab/zhongkao23MnemonicsExtra.ts) 与 [zhongkao23MnemonicsExtra2.ts](../shared/vocab/zhongkao23MnemonicsExtra2.ts) 合并至 [zhongkao23.ts](../shared/vocab/zhongkao23.ts)，`getZhongkaoCoverageStats()` 实测覆盖 **431 / 688（62.6%）**（超过 ≥413 / 60% 目标），未覆盖词诚实显示“待配邪修”。
- **工作台、批量导入、共创与热更**：[mnemonic.service.ts](../server/src/services/mnemonic.service.ts)、[mnemonics.ts](../server/src/routes/mnemonics.ts)、[StaffMnemonicsPage.tsx](../client/src/pages/staff/StaffMnemonicsPage.tsx)（`/teacher/mnemonics` 与 `/admin/mnemonics` 路由对等）与 [DeckPage.tsx](../client/src/pages/student/DeckPage.tsx)（班级开启且词条 stage ≥ 4 时可共创，审核通过“同学版”仅展示昵称、每人每日限领 1 次奖励）。

### R5–R11：学习搭子、冲刺赛季、智能规划、周报与多词包/适老化
- **R5 学习搭子小队**：[squad.service.ts](../server/src/services/squad.service.ts) 与 [TaskPage.tsx](../client/src/pages/student/TaskPage.tsx)（2–3 人合作小队、全员本周 ≥4 天复习环合拢达成目标、每日最多 3 次预设击掌、隐私隐藏个人未完成状态）。
- **R6 冲刺赛季**：[seasonPlan.service.ts](../server/src/services/seasonPlan.service.ts)（考前 100 天自动开跑、25/50/75/100% 里程碑徽章与赛季词卡皮肤、[shareCard.ts](../client/src/utils/shareCard.ts) `<canvas>` 赛季回顾卡），仅影响队列排序不改 FSRS `due`。
- **R7 今日智能规划**：[TaskPage.tsx](../client/src/pages/student/TaskPage.tsx) 与 [ReviewPage.tsx](../client/src/pages/student/ReviewPage.tsx) 展示预计耗时、重积压清账模式（`newWordTarget=0`）及连续 3 天 ≥90% 完成后的可选 `+5 加餐` 入口（`?bypass=1`），不修改 FSRS 参数。
- **R8 每周教学周报**：[weeklyReport.service.ts](../server/src/services/weeklyReport.service.ts) 与 [generate-weekly-reports.ts](../server/src/scripts/generate-weekly-reports.ts) 自动归档并生成规则化 `GAME_CONFIG` 调参建议与打印 PDF 视图。
- **R9 家长简报卡 / R10 多词包 / R11 字体与低配适配**：[ShareCardModal.tsx](../client/src/components/ShareCardModal.tsx)、[vocabPack.service.ts](../server/src/services/vocabPack.service.ts)、[GameContext.tsx](../client/src/components/GameContext.tsx) 与 [index.css](../client/src/index.css) 完成落库与交互联调。

---

## 2. 上线设备兼容检查矩阵（R1-7 Checklist）

| 检查项 | iOS Safari (主屏 PWA) | iOS 微信内置浏览器 | Android Chromium / PWA | 桌面 Chrome / Edge |
|---|---|---|---|---|
| Web Push 推送提醒 | Safari 16.4+ 添加到主屏幕后支持订阅 | 自动隐藏系统推送开关，降级为站内横幅与击掌（已实装 `isWeChatBrowser()` 分支） | 支持 Service Worker + PushManager | 支持（已通过 unit 测试验证 VAPID ES256 + `aes128gcm`） |
| Service Worker 热更 | `sw.js` `push` / `notificationclick` 注册及 BANNER 更新 | 支持站内更新横幅与无感刷新 | 正常 | 正常 |
| `<canvas>` 分享图保存 | 下载或长按 `<img>` PNG DataURL 保存 | 提示长按保存 `<img>` PNG | 正常 | 下载 `.png` 文件 |
| 移动端首屏高度与横向溢出 | 无横向溢出 | 无横向溢出 | 通过 `360x640` Chromium E2E 校验 | 通过 `390x844` & `1280x800` Chromium E2E 校验 |
| 字号缩放 / 减弱动效 / 低配模式 | `data-font-scale` / `data-reduce-motion` / `data-low-spec` CSS | 同左 | 同左 | Playwright 验证切换 `data-font-scale="large"` 生效 |

---

## 3. 灰度发布与秒级回滚 SOP（R1-8）

1. **发布灰度试验**：管理员在 `/admin/releases` 选择 `GAME_CONFIG` 类型，选择「指定灰度班级」并勾选实验班（或发布 `MNEMONIC_PATCH` 口诀补丁）。
2. **观察效果指标**：在 `/admin/game` 或 `/teacher/game` 的「留存效果看板 (R2)」对照实验班与对照班的到期完成率、双环合拢率、XP 触顶率与关闭特效比。
3. **每日账本与周报巡检**：
   - 执行 `npx tsx server/src/scripts/reconcile-ledger.ts` 确认账本 `ok: true`。
   - 周一 07:00（Asia/Shanghai）执行 `npx tsx server/src/scripts/generate-weekly-reports.ts` 归档班级周报。
4. **异常秒级回滚**：一旦指标异常，在 `/admin/releases` 点击该版本「撤回」（调用 `PATCH /api/admin/releases/:id/rollback`），[gameConfig.service.ts](../server/src/services/gameConfig.service.ts) 与 [mnemonicOverlay.service.ts](../server/src/services/mnemonicOverlay.service.ts) 将立即自动回退至上一有效版本或系统默认配置，无需重新部署。

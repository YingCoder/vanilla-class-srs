# 单词特训营 Stage 4 指标口径文档（Metrics SQL Spec）

> **目的**：确保 `/teacher/game`（教师端）、`/admin/game`（管理端）与 `/teacher/reports/weekly`（教师周报）使用完全一致的指标计算口径，避免跨端口径漂移。  
> **时区约定**：所有自然日 `dayKey` / `localDate` 与自然周 `weekStart`（周一为首日）均按 `Asia/Shanghai` 切分。  
> **数据权威**：学习与奖励事件以服务端落库表为准；前端埋点 `AnalyticsEvent` 通过 `(studentId, clientEventId)` 去重，不采集设备指纹。

---

## 1. 核心成功指标口径

| 指标 | 代码字段 | 分子 / 定义 | 分母 | 目标起始值 |
| --- | --- | --- | --- | --- |
| 周活跃天数 | `weeklyActiveDaysAvg` | 周内每个学生至少有 1 次评分提交（`ReviewEvent` / `GameEvent(REVIEW_GRADE)` / `AnalyticsEvent(grade_submit)`）的不重复 `localDate` 天数之和 | 班级当前有效在籍学生数 `COUNT(Enrollment WHERE archivedAt IS NULL)` | ≥ 4 天 |
| 到期词完成率 | `dueCompletionRate` | `SUM(LEAST(DailyGameState.reviewDone, DailyGameState.reviewDue))`（周期内每日快照） | `SUM(DailyGameState.reviewDue)`（若分母为 0 则记为 `0`，无到期压力时另标） | ≥ 70% |
| 双环合拢率 | `dualRingCloseRate` | 周期内有学习活动的各天中，每日 `DailyGameState.ringsClosed = true` 人次占该班在籍人数的日均占比 | 班级在籍人数 × 周期内有记录天数（单日看板即 `今日合拢人数 / 在籍人数`） | ≥ 40% |
| 7 日留存 | `retention7dRate` | 首次学习日 `d0` 距评估日已满 7 天（`d0 + 7d <= asOfDate`）的队列中，在 `d0 + 7d` 当日仍有任意学习记录（`ReviewEvent` / `GameEvent` / `AnalyticsEvent`）的学生数 | `d0 + 7d <= asOfDate` 的已成熟首学学生总数 | 基线 +10pct |
| 提醒召回率 | `reminderRecallRate` | `ReminderLog` 中满足 `openedAt <= sentAt + 24h` 或学生在 `sentAt` 后 24 小时内产生学习事件（`GameEvent` / `ReviewEvent`）的提醒条数 | 周期内已发送 `ReminderLog` 总条数 | ≥ 25% |
| 邪修覆盖率 | `mnemonicCoverageRate` | 688 词库中已有手工内置口诀或教师审核通过口诀的去重单词数 | `688` | ≥ 60%（≥ 413 词） |
| 护栏：XP 封顶触达率 | `xpCapHitRate` | 周期内达到生效 `dailyXpCap`（默认 400）的 `DailyGameState` 人天数 | 周期内有学习记录的 `DailyGameState` 总人天数 | ≤ 5% |
| 护栏：游戏化关闭率 | `gamificationOptOutRate` | 设置中开启 `reduceMotion` 或显式发出 `game_setting_toggle(enabled=false)` 关闭反馈/音效/榜单的学生数 | 班级在籍学生数 | ≤ 15% |

---

## 2. 参考 SQL（PostgreSQL）

### 2.1 周活跃天数（某班某自然周 `[weekStart, weekEnd]`）

```sql
WITH enrolled AS (
  SELECT e."studentId", d.id AS "deckId"
  FROM "Enrollment" e
  LEFT JOIN "Deck" d ON d."enrollmentId" = e.id
  WHERE e."classId" = :classId AND e."archivedAt" IS NULL
),
active_days AS (
  SELECT g."studentId", g."localDate" AS day_key
  FROM "GameEvent" g
  JOIN enrolled e ON e."studentId" = g."studentId"
  WHERE g.type = 'REVIEW_GRADE' AND g."localDate" BETWEEN :weekStart AND :weekEnd
  UNION
  SELECT a."studentId", a."dayKey" AS day_key
  FROM "AnalyticsEvent" a
  JOIN enrolled e ON e."studentId" = a."studentId"
  WHERE a.type = 'grade_submit' AND a."dayKey" BETWEEN :weekStart AND :weekEnd
  UNION
  SELECT e."studentId", to_char(re."reviewedAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day_key
  FROM "ReviewEvent" re
  JOIN "ReviewSession" rs ON rs.id = re."sessionId"
  JOIN enrolled e ON e."deckId" = rs."deckId"
  WHERE to_char(re."reviewedAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') BETWEEN :weekStart AND :weekEnd
)
SELECT
  COUNT(*)::float / NULLIF((SELECT COUNT(*) FROM enrolled), 0) AS weekly_active_days_avg
FROM active_days;
```

### 2.2 转化漏斗（`打开 → 开始复习 → 复习环合拢 → 闯关环合拢`）

以自然周/周期内**去重学生数**统计：
1. `appOpen`: `AnalyticsEvent.type = 'app_open'` 的去重 `studentId` 数（保底不小于有学习行为学生数）。
2. `reviewStart`: `AnalyticsEvent.type = 'review_start'` 或产生 `ReviewSession` 的去重 `studentId` 数。
3. `reviewRingClosed`: `DailyGameState.reviewDue = 0 OR reviewDone >= reviewDue`（至少 1 天合拢复习环）的去重 `studentId` 数。
4. `levelRingClosed`: `DailyGameState.levelsPassed` 同时包含 `L1, L2, L3` 的去重 `studentId` 数。
5. `dualRingClosed`: `DailyGameState.ringsClosed = true` 的去重 `studentId` 数。

---

## 3. 数据隐私与保留策略

- **最小化字段**：`AnalyticsEvent` 仅存储 `studentId`、`classId`、`clientEventId`、`type`、`props`、`clientVersion`、`occurredAt`、`dayKey`。
- **严禁采集**：入库服务主动剥离 `deviceFingerprint`、`fingerprint`、`imei`、`mac`、`idfa`、`ip` 等设备标识字段。
- **保留期限**：原始 `AnalyticsEvent` 保留 **180 天**，超期后由 `archiveOldAnalyticsEvents` 任务聚合写入 `AnalyticsDailyRollup` 并清理原始行。

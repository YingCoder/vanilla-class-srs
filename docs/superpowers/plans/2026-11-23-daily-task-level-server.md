# 每日任务与关卡（服务端闭环）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让学生每天获得冻结的新词 + 到期复习任务，并通过服务端判分的 L1/L2/L3/L5/Boss/复习关卡完成学习、调度与奖励结算。

**Architecture:** 任务与卡片内容在创建时快照到新表 `DailyStudyTask` / `DailyTaskWord`；每次闯关是 `LevelSession`，题目在会话创建时冻结到 `LevelQuestion`，每次提交追加 `LevelAnswer` 并以 `(sessionId, submissionId)` 幂等。关卡结算时每个词只调度一次 FSRS，奖励统一走现有 `settleRewardsForUser`。

**Tech Stack:** TypeScript、Express、Prisma 5 / PostgreSQL 16、Vitest、共享包 `@vanilla-srs/shared/word-camp`。

**Spec:** `docs/superpowers/specs/2026-11-23-daily-task-level-server-design.md`（实现时同时参考 `word-camp-development-v1.1.md` §4.1/§5/§9/§10.3）

## Global Constraints

- 分支 `develop/word-camp-v0.1`；仓库没有 `origin`，不要推送；不要提交 `.env`、`logs/`、`node_modules`。
- 迁移只追加：新增目录 `prisma/migrations/20261123050000_daily_study_tasks/`，不要修改历史迁移。
- 服务端权威：正确答案、判分、FSRS 评分、奖励金额都不得由客户端决定；答题接口在揭晓前不返回正确答案。
- 每个词在一个任务内只产生一次 FSRS 调度，用 `DailyTaskWord.scheduledAt` 条件更新兜底。
- 奖励事件键必须复用 `shared/word-camp.ts` 的 `rewardEventKey`；每日上限与幂等继续由 `RewardEvent` 唯一键保证。
- 学习日按 `shanghaiStudyDate`；数据库时间存 UTC。
- 本次不做学生 UI、教师看板、真实音频/L4、错词重练、教师自定义配置 UI。
- 提交前必须通过：`npm run test -w server`、`npm run build -w shared && npm run build -w server && npm run build -w client`、`git diff --check`。
- 测试基线：当前 `341 passed / 12 skipped`；新增测试后计数只增不减。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `prisma/schema.prisma` | 新增 5 个模型与 5 个枚举；`Enrollment` 增加 `dailyTasks` 反向关系 |
| `prisma/migrations/20261123050000_daily_study_tasks/migration.sql` | 建表、枚举、索引、外键 |
| `server/src/services/levelRules.ts` | 纯规则：关卡题型、重试状态机、提示、星级、每日完成判定 |
| `server/src/services/dailyTask.service.ts` | 取建今日任务、选择词、冻结快照、任务摘要 |
| `server/src/services/levelSession.service.ts` | 开始/恢复关卡、出题、读取会话、提示 |
| `server/src/services/levelAttempt.service.ts` | 幂等提交答案、关卡结算、FSRS 调度、奖励结算 |
| `server/src/routes/studentTask.ts` | 学生端任务/关卡 HTTP 接口 |
| `server/src/index.ts` | 挂载 `/api/students` 新路由 |
| `server/src/__tests__/levelRules.test.ts` | 纯规则测试 |
| `server/src/__tests__/dailyTask.service.test.ts` | 任务取建与冻结测试 |
| `server/src/__tests__/levelSession.start.test.ts` | 出题、恢复、答案不外泄测试 |
| `server/src/__tests__/levelAttempt.answer.test.ts` | 幂等、重试、揭晓、提示测试 |
| `server/src/__tests__/levelAttempt.complete.test.ts` | 星级、调度一次、每日结算测试 |

---

### Task 1: 数据库模型与迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261123050000_daily_study_tasks/migration.sql`

**Interfaces:**
- Produces: Prisma 模型 `DailyStudyTask`、`DailyTaskWord`、`LevelSession`、`LevelQuestion`、`LevelAnswer`，后续任务直接使用。

- [ ] **Step 1: 在 `prisma/schema.prisma` 末尾追加枚举与模型**

```prisma
// ─────────────────────────────────────────────
// Daily study tasks & levels (Word Camp §4.1)
// ─────────────────────────────────────────────

enum DailyTaskStatus {
  ACTIVE
  COMPLETED
  EXPIRED
}

enum DailyTaskWordKind {
  NEW
  REVIEW
}

enum StudyLevel {
  L1
  L2
  L3
  L5
  BOSS
  REVIEW
}

enum LevelSessionState {
  IN_PROGRESS
  COMPLETED
}

enum LevelQuestionType {
  L2
  L3
  L5
}

model DailyStudyTask {
  id            String          @id @default(uuid())
  enrollmentId  String
  enrollment    Enrollment      @relation(fields: [enrollmentId], references: [id], onDelete: Cascade)
  studyDate     String          // Asia/Shanghai YYYY-MM-DD
  status        DailyTaskStatus @default(ACTIVE)
  version       Int             @default(1)
  newWordTarget Int
  reviewTarget  Int
  config        Json
  createdAt     DateTime        @default(now())
  completedAt   DateTime?
  words         DailyTaskWord[]
  sessions      LevelSession[]

  @@unique([enrollmentId, studyDate])
  @@index([enrollmentId, status])
}

model DailyTaskWord {
  id                 String            @id @default(uuid())
  taskId             String
  task               DailyStudyTask     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  cardInstanceId     String
  cardId             String
  kind               DailyTaskWordKind
  sortOrder          Int
  word               String
  pos                String?
  definitionL2       String?
  definitionL1       String?
  variants           String[]          @default([])
  exampleSentence    String?
  scheduledAt        DateTime?
  scheduledRating    Int?
  scheduledSessionId String?
  questions          LevelQuestion[]

  @@unique([taskId, cardInstanceId])
  @@index([taskId, kind, sortOrder])
}

model LevelSession {
  id                String            @id @default(uuid())
  taskId            String
  task              DailyStudyTask     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  level             StudyLevel
  attemptNo         Int               @default(1)
  state             LevelSessionState @default(IN_PROGRESS)
  sessionVersion    Int               @default(0)
  questionCount     Int               @default(0)
  firstTryCorrect   Int               @default(0)
  eventuallyCorrect Int               @default(0)
  stars             Int               @default(0)
  cleared           Boolean?
  startedAt         DateTime          @default(now())
  endedAt           DateTime?
  questions         LevelQuestion[]

  @@unique([taskId, level, attemptNo])
  @@index([taskId, level])
}

model LevelQuestion {
  id               String            @id @default(uuid())
  sessionId        String
  session          LevelSession      @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  taskWordId       String
  taskWord         DailyTaskWord     @relation(fields: [taskWordId], references: [id], onDelete: Cascade)
  questionType     LevelQuestionType
  prompt           String
  pos              String?
  options          Json?
  correctAnswer    String            // server-only, never serialized before reveal
  acceptedAnswers  String[]          @default([])
  sortOrder        Int
  attemptsUsed     Int               @default(0)
  hintLevel        Int               @default(0)
  firstTryCorrect  Boolean           @default(false)
  eventuallyCorrect Boolean          @default(false)
  answerRevealed   Boolean           @default(false)
  answeredAt       DateTime?
  answers          LevelAnswer[]

  @@index([sessionId, sortOrder])
}

model LevelAnswer {
  id           String        @id @default(uuid())
  sessionId    String
  session      LevelSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  questionId   String
  question     LevelQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)
  submissionId String
  answer       String
  correct      Boolean
  attemptNo    Int
  hintLevel    Int
  responseMs   Int?
  submittedAt  DateTime      @default(now())

  @@unique([sessionId, submissionId])
  @@index([sessionId, questionId])
}
```

- [ ] **Step 2: 在 `Enrollment` 模型里加反向关系**

```prisma
  dailyTasks      DailyStudyTask[]
```

- [ ] **Step 3: 写迁移 SQL**

`prisma/migrations/20261123050000_daily_study_tasks/migration.sql`：

```sql
-- Daily study tasks, level sessions, frozen questions and idempotent answers.

CREATE TYPE "DailyTaskStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');
CREATE TYPE "DailyTaskWordKind" AS ENUM ('NEW', 'REVIEW');
CREATE TYPE "StudyLevel" AS ENUM ('L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW');
CREATE TYPE "LevelSessionState" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "LevelQuestionType" AS ENUM ('L2', 'L3', 'L5');

CREATE TABLE "DailyStudyTask" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "studyDate" TEXT NOT NULL,
    "status" "DailyTaskStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "newWordTarget" INTEGER NOT NULL,
    "reviewTarget" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DailyStudyTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyTaskWord" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "cardInstanceId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "kind" "DailyTaskWordKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "word" TEXT NOT NULL,
    "pos" TEXT,
    "definitionL2" TEXT,
    "definitionL1" TEXT,
    "variants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "exampleSentence" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "scheduledRating" INTEGER,
    "scheduledSessionId" TEXT,

    CONSTRAINT "DailyTaskWord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LevelSession" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "level" "StudyLevel" NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "state" "LevelSessionState" NOT NULL DEFAULT 'IN_PROGRESS',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "firstTryCorrect" INTEGER NOT NULL DEFAULT 0,
    "eventuallyCorrect" INTEGER NOT NULL DEFAULT 0,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "cleared" BOOLEAN,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LevelSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LevelQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskWordId" TEXT NOT NULL,
    "questionType" "LevelQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "pos" TEXT,
    "options" JSONB,
    "correctAnswer" TEXT NOT NULL,
    "acceptedAnswers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "hintLevel" INTEGER NOT NULL DEFAULT 0,
    "firstTryCorrect" BOOLEAN NOT NULL DEFAULT false,
    "eventuallyCorrect" BOOLEAN NOT NULL DEFAULT false,
    "answerRevealed" BOOLEAN NOT NULL DEFAULT false,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "LevelQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LevelAnswer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "hintLevel" INTEGER NOT NULL,
    "responseMs" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyStudyTask_enrollmentId_studyDate_key" ON "DailyStudyTask"("enrollmentId", "studyDate");
CREATE INDEX "DailyStudyTask_enrollmentId_status_idx" ON "DailyStudyTask"("enrollmentId", "status");
CREATE UNIQUE INDEX "DailyTaskWord_taskId_cardInstanceId_key" ON "DailyTaskWord"("taskId", "cardInstanceId");
CREATE INDEX "DailyTaskWord_taskId_kind_sortOrder_idx" ON "DailyTaskWord"("taskId", "kind", "sortOrder");
CREATE UNIQUE INDEX "LevelSession_taskId_level_attemptNo_key" ON "LevelSession"("taskId", "level", "attemptNo");
CREATE INDEX "LevelSession_taskId_level_idx" ON "LevelSession"("taskId", "level");
CREATE INDEX "LevelQuestion_sessionId_sortOrder_idx" ON "LevelQuestion"("sessionId", "sortOrder");
CREATE UNIQUE INDEX "LevelAnswer_sessionId_submissionId_key" ON "LevelAnswer"("sessionId", "submissionId");
CREATE INDEX "LevelAnswer_sessionId_questionId_idx" ON "LevelAnswer"("sessionId", "questionId");

ALTER TABLE "DailyStudyTask" ADD CONSTRAINT "DailyStudyTask_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyTaskWord" ADD CONSTRAINT "DailyTaskWord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DailyStudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelSession" ADD CONSTRAINT "LevelSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DailyStudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelQuestion" ADD CONSTRAINT "LevelQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelQuestion" ADD CONSTRAINT "LevelQuestion_taskWordId_fkey" FOREIGN KEY ("taskWordId") REFERENCES "DailyTaskWord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelAnswer" ADD CONSTRAINT "LevelAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelAnswer" ADD CONSTRAINT "LevelAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "LevelQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: 校验 schema 并生成客户端**

Run: `npx prisma validate --schema=prisma/schema.prisma && npm run db:generate`
Expected: `The schema at prisma/schema.prisma is valid`，Prisma Client generated。

- [ ] **Step 5: 回归现有测试**

Run: `npm run test -w server`
Expected: 原有 `341 passed / 12 skipped`（新模型不影响现有逻辑）。

- [ ] **Step 6: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/20261123050000_daily_study_tasks/migration.sql
git commit -m "feat(task): 增加每日任务与关卡数据模型"
```

---

### Task 2: 纯规则模块（TDD）

**Files:**
- Create: `server/src/services/levelRules.ts`
- Test: `server/src/__tests__/levelRules.test.ts`

**Interfaces:**
- Produces:
  - `type LevelKind = 'L1' | 'L2' | 'L3' | 'L5' | 'BOSS' | 'REVIEW'`
  - `type QuestionKind = 'L2' | 'L3' | 'L5'`
  - `DEFAULT_DAILY_TASK_CONFIG`
  - `questionKindForLevel(level, wordIndex): QuestionKind | null`
  - `shouldScheduleLevel(level, config): boolean`
  - `applyQuestionAttempt(progress, { correct }): QuestionAttemptOutcome`
  - `spellingHint(word, hintLevel): string`
  - `pickExcludedOption(correct, options, seed): string | null`
  - `summarizeQuestions(questions): LevelAttemptStats`
  - `levelOutcome(level, stats): LevelStars`
  - `evaluateDailyTask({ newWordCount, reviewWordCount, levels }): { newWordPartDone, reviewPartDone, completed, hasWords }`

- [ ] **Step 1: 写失败测试**

`server/src/__tests__/levelRules.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DAILY_TASK_CONFIG,
  applyQuestionAttempt,
  evaluateDailyTask,
  levelOutcome,
  pickExcludedOption,
  questionKindForLevel,
  shouldScheduleLevel,
  spellingHint,
  summarizeQuestions,
} from '../services/levelRules'

const freshQuestion = {
  attemptsUsed: 0,
  hintLevel: 0,
  firstTryCorrect: false,
  eventuallyCorrect: false,
  answerRevealed: false,
}

describe('questionKindForLevel', () => {
  it('fixes the question type for single-type levels', () => {
    expect(questionKindForLevel('L2', 0)).toBe('L2')
    expect(questionKindForLevel('L3', 5)).toBe('L3')
    expect(questionKindForLevel('L5', 9)).toBe('L5')
  })

  it('mixes types for Boss and keeps review scheduling-eligible', () => {
    expect(['L2', 'L3', 'L5']).toEqual(
      Array.from({ length: 3 }, (_, i) => questionKindForLevel('BOSS', i)),
    )
    expect(questionKindForLevel('REVIEW', 0)).toBe('L3')
    expect(questionKindForLevel('REVIEW', 1)).toBe('L5')
    expect(questionKindForLevel('REVIEW', 2)).toBe('L3')
  })

  it('returns null for the L1 preview', () => {
    expect(questionKindForLevel('L1', 0)).toBeNull()
  })
})

describe('shouldScheduleLevel', () => {
  it('schedules at L5 when present, otherwise L3', () => {
    expect(shouldScheduleLevel('L5', DEFAULT_DAILY_TASK_CONFIG)).toBe(true)
    expect(shouldScheduleLevel('L3', DEFAULT_DAILY_TASK_CONFIG)).toBe(false)
    const noL5 = { ...DEFAULT_DAILY_TASK_CONFIG, levels: ['L1', 'L2', 'L3', 'BOSS', 'REVIEW'] as any }
    expect(shouldScheduleLevel('L3', noL5)).toBe(true)
    expect(shouldScheduleLevel('REVIEW', noL5)).toBe(true)
    expect(shouldScheduleLevel('L2', noL5)).toBe(false)
  })
})

describe('applyQuestionAttempt', () => {
  it('counts a clean first attempt as first-try correct', () => {
    const outcome = applyQuestionAttempt(freshQuestion, { correct: true })
    expect(outcome).toMatchObject({
      attemptNo: 1,
      finished: true,
      retryAllowed: false,
      revealAnswer: false,
      next: { firstTryCorrect: true, eventuallyCorrect: true },
    })
  })

  it('does not count a hinted first attempt as first-try correct', () => {
    const outcome = applyQuestionAttempt({ ...freshQuestion, hintLevel: 1 }, { correct: true })
    expect(outcome.next.firstTryCorrect).toBe(false)
    expect(outcome.next.eventuallyCorrect).toBe(true)
  })

  it('allows two retries and reveals on the third failure', () => {
    const first = applyQuestionAttempt(freshQuestion, { correct: false })
    expect(first).toMatchObject({ attemptNo: 1, retryAllowed: true, revealAnswer: false })
    const second = applyQuestionAttempt(first.next, { correct: false })
    expect(second).toMatchObject({ attemptNo: 2, retryAllowed: true, revealAnswer: false })
    const third = applyQuestionAttempt(second.next, { correct: false })
    expect(third).toMatchObject({ attemptNo: 3, retryAllowed: false, revealAnswer: true })
    expect(third.next.answerRevealed).toBe(true)
    expect(third.next.eventuallyCorrect).toBe(false)
  })

  it('rejects a fourth attempt', () => {
    const third = applyQuestionAttempt(
      { ...freshQuestion, attemptsUsed: 2 },
      { correct: false },
    )
    expect(() => applyQuestionAttempt(third.next, { correct: false })).toThrow(RangeError)
  })
})

describe('summarizeQuestions and levelOutcome', () => {
  it('passes at 70% and awards stars from first-try accuracy', () => {
    const stats = summarizeQuestions([
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: false, eventuallyCorrect: true },
      { firstTryCorrect: false, eventuallyCorrect: false },
    ])
    expect(stats).toEqual({ questionCount: 4, firstTryCorrect: 2, eventuallyCorrect: 3 })
    expect(levelOutcome('L3', stats)).toMatchObject({ cleared: true, stars: 1 })
  })

  it('uses the 80% Boss gate', () => {
    const stats = summarizeQuestions([
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: false, eventuallyCorrect: true },
      { firstTryCorrect: false, eventuallyCorrect: false },
    ])
    expect(levelOutcome('BOSS', stats)).toMatchObject({ cleared: true, stars: 1 })
  })

  it('marks review as cleared without stars once answered', () => {
    const stats = summarizeQuestions([
      { firstTryCorrect: false, eventuallyCorrect: false },
      { firstTryCorrect: true, eventuallyCorrect: true },
    ])
    expect(levelOutcome('REVIEW', stats)).toMatchObject({ cleared: true, stars: 0 })
  })
})

describe('evaluateDailyTask', () => {
  const cleared = ['L1', 'L2', 'L3', 'L5', 'BOSS'].map((level) => ({
    level: level as any,
    state: 'CLEARED' as const,
  }))

  it('is complete only when both parts are done', () => {
    expect(evaluateDailyTask({ newWordCount: 10, reviewWordCount: 10, levels: cleared }).completed).toBe(false)
    expect(
      evaluateDailyTask({
        newWordCount: 10,
        reviewWordCount: 10,
        levels: [...cleared, { level: 'REVIEW', state: 'CLEARED' }],
      }).completed,
    ).toBe(true)
  })

  it('does not award an empty task', () => {
    expect(evaluateDailyTask({ newWordCount: 0, reviewWordCount: 0, levels: [] }).completed).toBe(false)
  })
})

describe('hints', () => {
  it('reveals the first letter then half of the word', () => {
    expect(spellingHint('colour', 1)).toBe('c_____')
    expect(spellingHint('colour', 2)).toBe('col___')
  })

  it('picks a deterministic wrong option', () => {
    const first = pickExcludedOption('颜色', ['颜色', '形状', '味道', '大小'], 'seed')
    const second = pickExcludedOption('颜色', ['颜色', '形状', '味道', '大小'], 'seed')
    expect(first).toBe(second)
    expect(first).not.toBe('颜色')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -w server -- --run src/__tests__/levelRules.test.ts`
Expected: FAIL — `Cannot find module '../services/levelRules'`.

- [ ] **Step 3: 实现 `levelRules.ts`**

```ts
/**
 * Pure rules for the daily task and level flow. No database, no HTTP, no clock.
 * FSRS grades, reward keys and star rules stay in shared/word-camp.ts.
 */

import {
  BOSS_LEVEL_CLEAR_RATE,
  DEFAULT_LEVEL_CLEAR_RATE,
  MAX_QUESTION_ATTEMPTS,
  computeLevelStars,
  isDailyTaskComplete,
  normalizeSpelling,
  type LevelAttemptStats,
  type LevelStars,
} from '@vanilla-srs/shared/word-camp'

export type LevelKind = 'L1' | 'L2' | 'L3' | 'L5' | 'BOSS' | 'REVIEW'
export type ObjectiveLevel = 'L2' | 'L3' | 'L5' | 'BOSS' | 'REVIEW'
export type QuestionKind = 'L2' | 'L3' | 'L5'
export type LevelViewKind = LevelKind | 'L4'
export type LevelViewState = 'NOT_STARTED' | 'IN_PROGRESS' | 'FAILED' | 'CLEARED' | 'SKIPPED'

export interface DailyTaskConfig {
  levels: LevelKind[]
  newWordsPerDay: number
  reviewsPerDay: number
  clearRate: number
  bossClearRate: number
  listening: 'equivalent'
}

export const DEFAULT_DAILY_TASK_CONFIG: DailyTaskConfig = {
  levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'],
  newWordsPerDay: 10,
  reviewsPerDay: 10,
  clearRate: DEFAULT_LEVEL_CLEAR_RATE,
  bossClearRate: BOSS_LEVEL_CLEAR_RATE,
  listening: 'equivalent',
}

const MIXED_QUESTION_KINDS: readonly QuestionKind[] = ['L2', 'L3', 'L5']
const REVIEW_QUESTION_KINDS: readonly QuestionKind[] = ['L3', 'L5']

export function questionKindForLevel(level: LevelKind, wordIndex: number): QuestionKind | null {
  switch (level) {
    case 'L2':
      return 'L2'
    case 'L3':
      return 'L3'
    case 'L5':
      return 'L5'
    case 'BOSS':
      return MIXED_QUESTION_KINDS[wordIndex % MIXED_QUESTION_KINDS.length]
    case 'REVIEW':
      return REVIEW_QUESTION_KINDS[wordIndex % REVIEW_QUESTION_KINDS.length]
    default:
      return null
  }
}

/** One scheduling point per task: L5 when present, else L3; reviews schedule at REVIEW. */
export function shouldScheduleLevel(level: LevelKind, config: DailyTaskConfig): boolean {
  if (level === 'REVIEW' || level === 'L5') return true
  if (level === 'L3') return !config.levels.includes('L5')
  return false
}

export interface QuestionAttemptProgress {
  attemptsUsed: number
  hintLevel: number
  firstTryCorrect: boolean
  eventuallyCorrect: boolean
  answerRevealed: boolean
}

export interface QuestionAttemptOutcome {
  attemptNo: number
  finished: boolean
  retryAllowed: boolean
  revealAnswer: boolean
  next: QuestionAttemptProgress
}

/**
 * Advance one question by one submission. A hinted first attempt still counts
 * as independent for FSRS (Hard), but not for the first-try star/reward stat.
 */
export function applyQuestionAttempt(
  progress: QuestionAttemptProgress,
  input: { correct: boolean },
): QuestionAttemptOutcome {
  if (progress.answerRevealed || progress.attemptsUsed >= MAX_QUESTION_ATTEMPTS) {
    throw new RangeError('question: already finished')
  }
  if (typeof input.correct !== 'boolean') throw new TypeError('question attempt.correct: expected a boolean')

  const attemptNo = progress.attemptsUsed + 1
  const firstTryCorrect =
    progress.firstTryCorrect || (attemptNo === 1 && progress.hintLevel === 0 && input.correct)
  const eventuallyCorrect = progress.eventuallyCorrect || input.correct
  const finished = input.correct || attemptNo >= MAX_QUESTION_ATTEMPTS
  const revealAnswer = !input.correct && attemptNo >= MAX_QUESTION_ATTEMPTS

  return {
    attemptNo,
    finished,
    retryAllowed: !finished,
    revealAnswer,
    next: {
      attemptsUsed: attemptNo,
      hintLevel: progress.hintLevel,
      firstTryCorrect,
      eventuallyCorrect,
      answerRevealed: progress.answerRevealed || revealAnswer,
    },
  }
}

export function summarizeQuestions(
  questions: readonly { firstTryCorrect: boolean; eventuallyCorrect: boolean }[],
): LevelAttemptStats {
  return {
    questionCount: questions.length,
    firstTryCorrect: questions.filter((question) => question.firstTryCorrect).length,
    eventuallyCorrect: questions.filter((question) => question.eventuallyCorrect).length,
  }
}

export function levelOutcome(level: ObjectiveLevel, stats: LevelAttemptStats): LevelStars {
  const firstTryAccuracy = stats.questionCount === 0 ? 0 : stats.firstTryCorrect / stats.questionCount
  const finalAccuracy = stats.questionCount === 0 ? 0 : stats.eventuallyCorrect / stats.questionCount
  if (level === 'REVIEW') {
    return { cleared: true, stars: 0, firstTryAccuracy, finalAccuracy }
  }
  return computeLevelStars({
    ...stats,
    clearRate: level === 'BOSS' ? BOSS_LEVEL_CLEAR_RATE : DEFAULT_LEVEL_CLEAR_RATE,
  })
}

export interface LevelProgressSnapshot {
  level: LevelKind
  state: LevelViewState
}

export function evaluateDailyTask(input: {
  newWordCount: number
  reviewWordCount: number
  levels: readonly LevelProgressSnapshot[]
}): { newWordPartDone: boolean; reviewPartDone: boolean; completed: boolean; hasWords: boolean } {
  const isCleared = (level: LevelKind) =>
    input.levels.some((snapshot) => snapshot.level === level && snapshot.state === 'CLEARED')
  const newWordLevels: LevelKind[] = ['L1', 'L2', 'L3', 'L5', 'BOSS']
  const newWordPartDone = input.newWordCount === 0 ? true : newWordLevels.every(isCleared)
  const reviewPartDone = input.reviewWordCount === 0 ? true : isCleared('REVIEW')
  const hasWords = input.newWordCount + input.reviewWordCount > 0
  return {
    newWordPartDone,
    reviewPartDone,
    hasWords,
    completed:
      hasWords &&
      isDailyTaskComplete({
        newWordPartDone,
        reviewPartDone,
        reviewWordsAssigned: input.reviewWordCount,
      }),
  }
}

/** "c_____" then "col___" for `colour`; used by the spelling hint endpoint. */
export function spellingHint(word: string, hintLevel: number): string {
  const characters = Array.from(word)
  if (characters.length === 0) return ''
  if (hintLevel <= 1) return `${characters[0]}${'_'.repeat(Math.max(0, characters.length - 1))}`
  const reveal = Math.max(1, Math.ceil(characters.length / 2))
  return characters.map((character, index) => (index < reveal ? character : '_')).join('')
}

function fnv1a(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

export function pickExcludedOption(
  correct: string,
  options: readonly string[],
  seed: string,
): string | null {
  const wrong = options.filter(
    (option) => normalizeSpelling(option) !== normalizeSpelling(correct),
  )
  if (wrong.length === 0) return null
  return wrong[fnv1a(seed) % wrong.length]
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -w server -- --run src/__tests__/levelRules.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/services/levelRules.ts server/src/__tests__/levelRules.test.ts
git commit -m "feat(task): 每日任务与关卡纯规则"
```

---

### Task 3: 今日任务取建与冻结

**Files:**
- Create: `server/src/services/dailyTask.service.ts`
- Test: `server/src/__tests__/dailyTask.service.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_DAILY_TASK_CONFIG`、`evaluateDailyTask`、`LevelViewKind`、`LevelViewState`。
- Produces:
  - `getOrCreateDailyTask(prisma, studentId, enrollmentId, now?): Promise<DailyTaskSummary | { error, status }>`
  - `getTaskSummary(prisma, studentId, taskId, now?): Promise<DailyTaskSummary | { error, status }>`
  - `DailyTaskSummary`（任务 id、studyDate、词数、各关卡状态、完成标记）。

- [ ] **Step 1: 写失败测试**

`server/src/__tests__/dailyTask.service.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { getOrCreateDailyTask } from '../services/dailyTask.service'

const NOW = new Date('2026-11-23T02:00:00Z') // Shanghai 10:00

function instance(id: string, word: string, state: string, due = NOW) {
  return {
    id,
    cardId: `card-${id}`,
    state,
    due,
    createdAt: NOW,
    definitionL1: null,
    exampleSentence: null,
    card: {
      id: `card-${id}`,
      word,
      pos: 'n.',
      definitionL2: `en-${word}`,
      definitionL1: `zh-${word}`,
      variants: [],
      exampleSentence: `example ${word}`,
      cardSet: { isPersonal: false, assignments: [{ priority: 1 }] },
    },
  }
}

function makePrisma(existing: any = null) {
  const createdTask = {
    id: 'task-1',
    enrollmentId: 'enrollment-1',
    studyDate: '2026-11-23',
    status: 'ACTIVE',
    version: 1,
    newWordTarget: 2,
    reviewTarget: 2,
    config: { levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'], newWordsPerDay: 2, reviewsPerDay: 2 },
    createdAt: NOW,
    completedAt: null,
    words: [
      { kind: 'NEW', word: 'apple' },
      { kind: 'NEW', word: 'banana' },
      { kind: 'REVIEW', word: 'cat' },
    ],
    sessions: [],
  }
  return {
    enrollment: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-1',
        classId: 'class-1',
        archivedAt: null,
        deck: { id: 'deck-1', fsrsParams: { newCardsPerDay: 10 } },
        student: { userId: 'user-1' },
      }),
    },
    dailyStudyTask: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue(createdTask),
    },
    cardInstance: {
      findMany: vi.fn().mockImplementation(async ({ where }) => {
        if (where.state === 'NEW') return [instance('n1', 'apple', 'NEW'), instance('n2', 'banana', 'NEW')]
        return [instance('r1', 'cat', 'REVIEW')]
      }),
    },
  }
}

describe('getOrCreateDailyTask', () => {
  it('creates one task with frozen word snapshots', async () => {
    const prisma = makePrisma()
    const task = await getOrCreateDailyTask(prisma as any, 'student-1', 'enrollment-1', NOW)
    if ('error' in task) throw new Error(task.error)

    expect(task).toMatchObject({
      taskId: 'task-1',
      studyDate: '2026-11-23',
      newWordCount: 2,
      reviewWordCount: 1,
      status: 'ACTIVE',
    })
    expect(prisma.dailyStudyTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          words: {
            create: expect.arrayContaining([
              expect.objectContaining({ kind: 'NEW', word: 'apple', definitionL1: 'zh-apple' }),
              expect.objectContaining({ kind: 'REVIEW', word: 'cat' }),
            ]),
          },
        }),
      }),
    )
  })

  it('returns the existing task without creating another', async () => {
    const existing = {
      id: 'task-existing',
      enrollmentId: 'enrollment-1',
      studyDate: '2026-11-23',
      status: 'ACTIVE',
      version: 1,
      newWordTarget: 2,
      reviewTarget: 2,
      config: { levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'] },
      createdAt: NOW,
      completedAt: null,
      words: [{ kind: 'NEW', word: 'apple' }],
      sessions: [],
    }
    const prisma = makePrisma(existing)
    const task = await getOrCreateDailyTask(prisma as any, 'student-1', 'enrollment-1', NOW)
    if ('error' in task) throw new Error(task.error)
    expect(task.taskId).toBe('task-existing')
    expect(prisma.dailyStudyTask.create).not.toHaveBeenCalled()
  })

  it('rejects an enrollment that does not belong to the student', async () => {
    const prisma = makePrisma()
    prisma.enrollment.findUnique.mockResolvedValue({
      ...(await prisma.enrollment.findUnique()),
      studentId: 'someone-else',
    })
    const task = await getOrCreateDailyTask(prisma as any, 'student-1', 'enrollment-1', NOW)
    expect(task).toEqual({ error: 'Enrollment not found', status: 404 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -w server -- --run src/__tests__/dailyTask.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现 `dailyTask.service.ts`**

核心结构（完整实现）：

```ts
import type { PrismaClient } from '@prisma/client'
import { shanghaiStudyDate } from '@vanilla-srs/shared/word-camp'
import {
  DEFAULT_DAILY_TASK_CONFIG,
  evaluateDailyTask,
  type DailyTaskConfig,
  type LevelKind,
  type LevelViewKind,
  type LevelViewState,
} from './levelRules'

export interface LevelStatusView {
  level: LevelViewKind
  state: LevelViewState
  stars: number
  cleared: boolean
  attemptNo: number | null
  questionCount: number
  answeredCount: number
}

export interface DailyTaskSummary {
  taskId: string
  enrollmentId: string
  studyDate: string
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED'
  version: number
  newWordTarget: number
  reviewTarget: number
  newWordCount: number
  reviewWordCount: number
  levels: LevelStatusView[]
  progress: {
    newWordPartDone: boolean
    reviewPartDone: boolean
    completed: boolean
    hasWords: boolean
  }
  completedAt: Date | null
}

type LoadedTask = any

const taskInclude = {
  words: { orderBy: { sortOrder: 'asc' as const } },
  sessions: {
    orderBy: [{ level: 'asc' as const }, { attemptNo: 'desc' as const }],
    include: { questions: { select: { answeredAt: true } } },
  },
}

function readConfig(value: unknown): DailyTaskConfig {
  if (typeof value !== 'object' || value === null) return DEFAULT_DAILY_TASK_CONFIG
  const config = value as Partial<DailyTaskConfig>
  return {
    levels: Array.isArray(config.levels) && config.levels.length > 0
      ? (config.levels as LevelKind[])
      : DEFAULT_DAILY_TASK_CONFIG.levels,
    newWordsPerDay: config.newWordsPerDay ?? DEFAULT_DAILY_TASK_CONFIG.newWordsPerDay,
    reviewsPerDay: config.reviewsPerDay ?? DEFAULT_DAILY_TASK_CONFIG.reviewsPerDay,
    clearRate: config.clearRate ?? DEFAULT_DAILY_TASK_CONFIG.clearRate,
    bossClearRate: config.bossClearRate ?? DEFAULT_DAILY_TASK_CONFIG.bossClearRate,
    listening: 'equivalent',
  }
}

/** Pick the newest attempt per level and derive its view state. */
export function buildTaskSummary(task: LoadedTask): DailyTaskSummary {
  const config = readConfig(task.config)
  const latestByLevel = new Map<string, any>()
  for (const session of task.sessions) {
    if (!latestByLevel.has(session.level)) latestByLevel.set(session.level, session)
  }

  const levels: LevelStatusView[] = config.levels.map((level: LevelKind) => {
    const session = latestByLevel.get(level)
    if (!session) {
      return { level, state: 'NOT_STARTED', stars: 0, cleared: false, attemptNo: null, questionCount: 0, answeredCount: 0 }
    }
    const answeredCount = session.questions.filter((question: any) => question.answeredAt !== null).length
    const state: LevelViewState =
      session.state === 'IN_PROGRESS'
        ? 'IN_PROGRESS'
        : session.cleared
          ? 'CLEARED'
          : 'FAILED'
    return {
      level,
      state,
      stars: session.stars,
      cleared: session.cleared === true,
      attemptNo: session.attemptNo,
      questionCount: session.questionCount,
      answeredCount,
    }
  })
  levels.push({ level: 'L4', state: 'SKIPPED', stars: 0, cleared: false, attemptNo: null, questionCount: 0, answeredCount: 0 })

  const newWordCount = task.words.filter((word: any) => word.kind === 'NEW').length
  const reviewWordCount = task.words.filter((word: any) => word.kind === 'REVIEW').length
  const progress = evaluateDailyTask({
    newWordCount,
    reviewWordCount,
    levels: levels.map((level) => ({ level: level.level as LevelKind, state: level.state })),
  })

  return {
    taskId: task.id,
    enrollmentId: task.enrollmentId,
    studyDate: task.studyDate,
    status: task.status,
    version: task.version,
    newWordTarget: task.newWordTarget,
    reviewTarget: task.reviewTarget,
    newWordCount,
    reviewWordCount,
    levels,
    progress,
    completedAt: task.completedAt,
  }
}

function snapshotWord(instance: any, kind: 'NEW' | 'REVIEW', sortOrder: number) {
  return {
    cardInstanceId: instance.id,
    cardId: instance.cardId,
    kind,
    sortOrder,
    word: instance.card.word,
    pos: instance.card.pos,
    definitionL2: instance.card.definitionL2,
    definitionL1: instance.definitionL1 ?? instance.card.definitionL1,
    variants: instance.card.variants ?? [],
    exampleSentence: instance.exampleSentence ?? instance.card.exampleSentence,
  }
}

async function loadTask(prisma: PrismaClient, enrollmentId: string, studyDate: string) {
  return prisma.dailyStudyTask.findUnique({
    where: { enrollmentId_studyDate: { enrollmentId, studyDate } },
    include: taskInclude,
  })
}

export async function getOrCreateDailyTask(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
): Promise<DailyTaskSummary | { error: string; status: number }> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { deck: true, student: true },
  })
  if (!enrollment || enrollment.studentId !== studentId || enrollment.archivedAt) {
    return { error: 'Enrollment not found', status: 404 }
  }
  if (!enrollment.deck) return { error: 'Deck not found', status: 404 }

  const studyDate = shanghaiStudyDate(now)
  const existing = await loadTask(prisma, enrollmentId, studyDate)
  if (existing) return buildTaskSummary(existing)

  const config = DEFAULT_DAILY_TASK_CONFIG
  const newInstances = await prisma.cardInstance.findMany({
    where: { deckId: enrollment.deck.id, state: 'NEW' },
    include: {
      card: {
        include: {
          cardSet: {
            include: {
              assignments: {
                where: { classId: enrollment.classId },
                select: { priority: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  newInstances.sort((a: any, b: any) => {
    const priority = (instance: any) =>
      instance.card.cardSet.isPersonal ? 3 : (instance.card.cardSet.assignments[0]?.priority ?? 9999)
    return priority(a) - priority(b) || a.createdAt.getTime() - b.createdAt.getTime()
  })
  const selectedNew = newInstances.slice(0, config.newWordsPerDay)

  const selectedReview = await prisma.cardInstance.findMany({
    where: {
      deckId: enrollment.deck.id,
      state: { in: ['LEARNING', 'REVIEW', 'RELEARNING'] },
      due: { lte: now },
    },
    include: { card: true },
    orderBy: { due: 'asc' },
    take: config.reviewsPerDay,
  })

  const words = [
    ...selectedNew.map((instance: any, index: number) => snapshotWord(instance, 'NEW', index)),
    ...selectedReview.map((instance: any, index: number) =>
      snapshotWord(instance, 'REVIEW', selectedNew.length + index),
    ),
  ]

  try {
    const created = await prisma.dailyStudyTask.create({
      data: {
        enrollmentId,
        studyDate,
        newWordTarget: config.newWordsPerDay,
        reviewTarget: config.reviewsPerDay,
        config: config as any,
        words: { create: words },
      },
      include: taskInclude,
    })
    return buildTaskSummary(created)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const raced = await loadTask(prisma, enrollmentId, studyDate)
      if (raced) return buildTaskSummary(raced)
    }
    throw error
  }
}

export async function getTaskSummary(
  prisma: PrismaClient,
  studentId: string,
  taskId: string,
): Promise<DailyTaskSummary | { error: string; status: number }> {
  const task = await prisma.dailyStudyTask.findUnique({
    where: { id: taskId },
    include: { ...taskInclude, enrollment: true },
  })
  if (!task || (task as any).enrollment.studentId !== studentId) {
    return { error: 'Task not found', status: 404 }
  }
  return buildTaskSummary(task)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -w server -- --run src/__tests__/dailyTask.service.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/services/dailyTask.service.ts server/src/__tests__/dailyTask.service.test.ts
git commit -m "feat(task): 今日任务取建与词快照冻结"
```

---

### Task 4: 关卡开始、出题与恢复

**Files:**
- Create: `server/src/services/levelSession.service.ts`
- Test: `server/src/__tests__/levelSession.start.test.ts`

**Interfaces:**
- Consumes: `questionKindForLevel`、`shouldScheduleLevel`、`DailyTaskConfig`、`buildChoiceOptions`（来自 `choice.service`）。
- Produces:
  - `startLevel(prisma, studentId, taskId, level, now?): Promise<LevelSessionView | { error, status }>`
  - `getLevelSession(prisma, studentId, sessionId): Promise<LevelSessionView | { error, status }>`
  - `LevelSessionView`：`{ sessionId, taskId, level, attemptNo, state, questionCount, answeredCount, alreadyCleared, words?, questions }`

- [ ] **Step 1: 写失败测试**

`server/src/__tests__/levelSession.start.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { startLevel, getLevelSession } from '../services/levelSession.service'

function taskWord(id: string, word: string, kind: 'NEW' | 'REVIEW') {
  return {
    id,
    taskId: 'task-1',
    cardInstanceId: `inst-${id}`,
    cardId: `card-${id}`,
    kind,
    sortOrder: Number(id.replace(/\D/g, '')) || 0,
    word,
    pos: 'n.',
    definitionL2: `en-${word}`,
    definitionL1: `zh-${word}`,
    variants: [],
    exampleSentence: null,
    scheduledAt: null,
  }
}

const words = [
  taskWord('w1', 'apple', 'NEW'),
  taskWord('w2', 'banana', 'NEW'),
  taskWord('w3', 'cat', 'NEW'),
  taskWord('w4', 'dog', 'NEW'),
  taskWord('r1', 'egg', 'REVIEW'),
]

function makePrisma() {
  const task = {
    id: 'task-1',
    enrollmentId: 'enrollment-1',
    studyDate: '2026-11-23',
    status: 'ACTIVE',
    version: 1,
    newWordTarget: 10,
    reviewTarget: 10,
    config: { levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'] },
    completedAt: null,
    words,
    sessions: [],
    enrollment: { studentId: 'student-1', student: { userId: 'user-1' }, deck: { id: 'deck-1', fsrsParams: {} } },
  }
  const prisma: any = {
    dailyStudyTask: { findUnique: vi.fn().mockResolvedValue(task) },
    levelSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: 'session-1',
        taskId: data.taskId,
        level: data.level,
        attemptNo: data.attemptNo,
        state: 'IN_PROGRESS',
        sessionVersion: 0,
        questionCount: data.questionCount,
        stars: 0,
        cleared: null,
        endedAt: null,
        questions: (data.questions?.create ?? []).map((question: any, index: number) => ({
          ...question,
          id: `q${index + 1}`,
          attemptsUsed: 0,
          hintLevel: 0,
          firstTryCorrect: false,
          eventuallyCorrect: false,
          answerRevealed: false,
          answeredAt: null,
        })),
        task,
      })),
    },
    levelQuestion: { findMany: vi.fn().mockResolvedValue([]) },
  }
  return prisma
}

describe('startLevel', () => {
  it('creates one L5 question per new word and hides the answer', async () => {
    const prisma = makePrisma()
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L5')
    if ('error' in view) throw new Error(view.error)

    expect(view.questions).toHaveLength(4)
    expect(view.questions[0]).toMatchObject({ questionType: 'L5', prompt: 'zh-apple' })
    expect(view.questions[0]).not.toHaveProperty('correctAnswer')
    expect(view.questions[0]).not.toHaveProperty('acceptedAnswers')
    expect(prisma.levelSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          level: 'L5',
          attemptNo: 1,
          questions: { create: expect.arrayContaining([expect.objectContaining({ sortOrder: 0 })]) },
        }),
      }),
    )
  })

  it('returns an in-progress session instead of creating another', async () => {
    const prisma = makePrisma()
    prisma.levelSession.findFirst.mockResolvedValue({
      id: 'open-session',
      taskId: 'task-1',
      level: 'L5',
      attemptNo: 1,
      state: 'IN_PROGRESS',
      sessionVersion: 3,
      questionCount: 4,
      stars: 0,
      cleared: null,
      endedAt: null,
      questions: [],
      task: { ...(await prisma.dailyStudyTask.findUnique()), words },
    })
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L5')
    if ('error' in view) throw new Error(view.error)
    expect(view.sessionId).toBe('open-session')
    expect(prisma.levelSession.create).not.toHaveBeenCalled()
  })

  it('returns the L1 preview without questions', async () => {
    const prisma = makePrisma()
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L1')
    if ('error' in view) throw new Error(view.error)
    expect(view.questions).toHaveLength(0)
    expect(view.words).toHaveLength(4)
  })

  it('does not start L4 (audio is a recorded fallback)', async () => {
    const prisma = makePrisma()
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L4' as any)
    expect(view).toMatchObject({ status: 409 })
  })

  it('rejects a task owned by another student', async () => {
    const prisma = makePrisma()
    const task = await prisma.dailyStudyTask.findUnique()
    prisma.dailyStudyTask.findUnique.mockResolvedValue({
      ...task,
      enrollment: { ...task.enrollment, studentId: 'someone-else' },
    })
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L5')
    expect(view).toEqual({ error: 'Task not found', status: 404 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -w server -- --run src/__tests__/levelSession.start.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现 `levelSession.service.ts`**

要点：
- `loadTaskForStudent` 校验 `task.enrollment.studentId`。
- `startLevel`：
  1. 加载任务（含 words、sessions、enrollment）。
  2. `L4` → `{ error: 'L4 uses the listening-equivalent fallback', status: 409 }`。
  3. 任务非 ACTIVE → `{ error: 'Task is not active', status: 409 }`。
  4. 取该 level 最新 attempt；若 `IN_PROGRESS` 直接返回；若 `COMPLETED && cleared` 返回已完成视图（`alreadyCleared: true`），不重复建会话。
  5. 新建 attemptNo（`max + 1`）。
  6. L1：创建无题会话，返回 `words`（NEW 词）。
  7. 客观关：`task.words.filter(kind)`，按 `questionKindForLevel` 逐词出题。
- `buildQuestionData`：
  - L2：prompt = word，correct = `definitionL1 ?? definitionL2`，candidates = 其他词的 `definitionL1 ?? definitionL2`，fallback 中文词义。
  - L3：prompt = `definitionL1 ?? definitionL2`，correct = word，candidates = 其他词的 word，fallback 英文词。
  - L5：prompt = `definitionL1 ?? definitionL2`，correct = word，accepted = `[word, ...variants]`。
  - 选择题用 `buildChoiceOptions(correct, candidates, \`${taskId}:${level}:${attemptNo}:${index}\`)`，写 `options`。
  - `acceptedAnswers` 对 L2/L3 写 `[correct]`；对 L5 写去重后的 `[word, ...variants]`。
- `sanitizeSession` 只返回 `id, questionType, prompt, pos, options, sortOrder, attemptsUsed, hintLevel, answerRevealed, eventuallyCorrect, answeredAt`，绝不返回 `correctAnswer`/`acceptedAnswers`。
- `getLevelSession` 同样按 ownership 校验。

实现代码骨架：

```ts
import type { PrismaClient } from '@prisma/client'
import { buildChoiceOptions } from './choice.service'
import {
  questionKindForLevel,
  type DailyTaskConfig,
  type LevelKind,
  type QuestionKind,
} from './levelRules'

const FALLBACK_ZH = ['形状', '味道', '大小', '重量', '方向', '声音', '时间', '地点']
const FALLBACK_EN = ['apple', 'water', 'book', 'time', 'people']

const sessionInclude = {
  task: { include: { enrollment: { include: { student: true, deck: true } }, words: { orderBy: { sortOrder: 'asc' as const } }, sessions: true } },
  questions: { orderBy: { sortOrder: 'asc' as const } },
}

export interface PublicQuestion {
  id: string
  questionType: 'L2' | 'L3' | 'L5'
  prompt: string
  pos: string | null
  options: string[] | null
  sortOrder: number
  attemptsUsed: number
  hintLevel: number
  answerRevealed: boolean
  eventuallyCorrect: boolean
  answeredAt: Date | null
}

export interface LevelSessionView {
  sessionId: string
  taskId: string
  level: LevelKind
  attemptNo: number
  state: 'IN_PROGRESS' | 'COMPLETED'
  sessionVersion: number
  questionCount: number
  answeredCount: number
  stars: number
  cleared: boolean | null
  alreadyCleared: boolean
  words: { taskWordId: string; word: string; pos: string | null; definitionL1: string | null; definitionL2: string | null; exampleSentence: string | null }[] | null
  questions: PublicQuestion[]
}

function publicQuestion(question: any): PublicQuestion {
  return {
    id: question.id,
    questionType: question.questionType,
    prompt: question.prompt,
    pos: question.pos,
    options: Array.isArray(question.options) ? question.options : null,
    sortOrder: question.sortOrder,
    attemptsUsed: question.attemptsUsed,
    hintLevel: question.hintLevel,
    answerRevealed: question.answerRevealed,
    eventuallyCorrect: question.eventuallyCorrect,
    answeredAt: question.answeredAt,
  }
}

function viewOf(session: any, alreadyCleared = false): LevelSessionView {
  const isL1 = session.level === 'L1'
  return {
    sessionId: session.id,
    taskId: session.taskId,
    level: session.level,
    attemptNo: session.attemptNo,
    state: session.state,
    sessionVersion: session.sessionVersion,
    questionCount: session.questionCount,
    answeredCount: session.questions.filter((question: any) => question.answeredAt).length,
    stars: session.stars,
    cleared: session.cleared,
    alreadyCleared,
    words: isL1
      ? session.task.words
          .filter((word: any) => word.kind === 'NEW')
          .map((word: any) => ({
            taskWordId: word.id,
            word: word.word,
            pos: word.pos,
            definitionL1: word.definitionL1,
            definitionL2: word.definitionL2,
            exampleSentence: word.exampleSentence,
          }))
      : null,
    questions: session.questions.map(publicQuestion),
  }
}

function buildQuestionData(
  task: any,
  level: LevelKind,
  attemptNo: number,
  word: any,
  wordIndex: number,
) {
  const kind = questionKindForLevel(level, wordIndex)
  if (!kind) return null
  const peers = task.words.map((peer: any) => ({
    word: peer.word,
    meaning: peer.definitionL1 ?? peer.definitionL2 ?? '',
  }))
  if (kind === 'L5') {
    return {
      taskWordId: word.id,
      questionType: 'L5',
      prompt: word.definitionL1 ?? word.definitionL2 ?? word.word,
      pos: word.pos,
      options: null,
      correctAnswer: word.word,
      acceptedAnswers: [word.word, ...(word.variants ?? [])],
      sortOrder: wordIndex,
    }
  }
  if (kind === 'L2') {
    const correct = word.definitionL1 ?? word.definitionL2 ?? ''
    const candidates = peers.filter((peer: any) => peer.word !== word.word).map((peer: any) => peer.meaning)
    return {
      taskWordId: word.id,
      questionType: 'L2',
      prompt: word.word,
      pos: word.pos,
      options: buildChoiceOptions(correct, [...candidates, ...FALLBACK_ZH], `${task.id}:${level}:${attemptNo}:${wordIndex}`),
      correctAnswer: correct,
      acceptedAnswers: [correct],
      sortOrder: wordIndex,
    }
  }
  const correct = word.word
  const candidates = peers.filter((peer: any) => peer.word !== word.word).map((peer: any) => peer.word)
  return {
    taskWordId: word.id,
    questionType: 'L3',
    prompt: word.definitionL1 ?? word.definitionL2 ?? word.word,
    pos: word.pos,
    options: buildChoiceOptions(correct, [...candidates, ...FALLBACK_EN], `${task.id}:${level}:${attemptNo}:${wordIndex}`),
    correctAnswer: correct,
    acceptedAnswers: [correct],
    sortOrder: wordIndex,
  }
}

export async function startLevel(
  prisma: PrismaClient,
  studentId: string,
  taskId: string,
  level: LevelKind,
  now: Date = new Date(),
): Promise<LevelSessionView | { error: string; status: number }> {
  if (level === ('L4' as LevelKind)) {
    return { error: 'L4 uses the listening-equivalent fallback', status: 409 }
  }
  const task = await prisma.dailyStudyTask.findUnique({
    where: { id: taskId },
    include: {
      enrollment: { include: { student: true, deck: true } },
      words: { orderBy: { sortOrder: 'asc' } },
      sessions: { orderBy: [{ level: 'asc' }, { attemptNo: 'desc' }] },
    },
  })
  if (!task || task.enrollment.studentId !== studentId) {
    return { error: 'Task not found', status: 404 }
  }
  if (task.status !== 'ACTIVE') return { error: 'Task is not active', status: 409 }

  const words = task.words.filter((word) => word.kind === (level === 'REVIEW' ? 'REVIEW' : 'NEW'))
  if (words.length === 0) return { error: 'No words for this level', status: 409 }

  const latest = task.sessions.find((session) => session.level === level) ?? null
  if (latest?.state === 'IN_PROGRESS') {
    const loaded = await prisma.levelSession.findUnique({
      where: { id: latest.id },
      include: sessionInclude,
    })
    return viewOf(loaded)
  }
  if (latest?.state === 'COMPLETED' && latest.cleared) {
    const loaded = await prisma.levelSession.findUnique({
      where: { id: latest.id },
      include: sessionInclude,
    })
    return viewOf(loaded, true)
  }

  const attemptNo = (latest?.attemptNo ?? 0) + 1
  const questionData = level === 'L1'
    ? []
    : words
        .map((word, index) => buildQuestionData(task, level, attemptNo, word, index))
        .filter((question): question is NonNullable<typeof question> => question !== null)

  const created = await prisma.levelSession.create({
    data: {
      taskId,
      level,
      attemptNo,
      questionCount: questionData.length,
      questions: questionData.length > 0 ? { create: questionData } : undefined,
    },
    include: sessionInclude,
  })
  return viewOf(created)
}

export async function getLevelSession(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
): Promise<LevelSessionView | { error: string; status: number }> {
  const session = await prisma.levelSession.findUnique({
    where: { id: sessionId },
    include: sessionInclude,
  })
  if (!session || session.task.enrollment.studentId !== studentId) {
    return { error: 'Session not found', status: 404 }
  }
  return viewOf(session)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -w server -- --run src/__tests__/levelSession.start.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/services/levelSession.service.ts server/src/__tests__/levelSession.start.test.ts
git commit -m "feat(task): 关卡开始与固定出题"
```

---

### Task 5: 幂等答题与提示

**Files:**
- Create: `server/src/services/levelAttempt.service.ts`（先实现判分/提交/提示部分）
- Test: `server/src/__tests__/levelAttempt.answer.test.ts`

**Interfaces:**
- Consumes: `applyQuestionAttempt`、`pickExcludedOption`、`spellingHint`、`judgeSpelling`、`normalizeSpelling`。
- Produces:
  - `judgeQuestionAnswer(question, answer): { correct, verdict }`
  - `submitLevelAnswer(prisma, studentId, sessionId, input, now?): Promise<AnswerResult | { error, status }>`
  - `requestLevelHint(prisma, studentId, sessionId, questionId, now?): Promise<HintResult | { error, status }>`

- [ ] **Step 1: 写失败测试**

`server/src/__tests__/levelAttempt.answer.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  judgeQuestionAnswer,
  requestLevelHint,
  submitLevelAnswer,
} from '../services/levelAttempt.service'

const NOW = new Date('2026-11-23T02:00:00Z')

function question(overrides: any = {}) {
  return {
    id: 'q1',
    sessionId: 'session-1',
    taskWordId: 'word-1',
    questionType: 'L5',
    prompt: 'zh-apple',
    pos: null,
    options: null,
    correctAnswer: 'apple',
    acceptedAnswers: ['apple', 'appel'],
    sortOrder: 0,
    attemptsUsed: 0,
    hintLevel: 0,
    firstTryCorrect: false,
    eventuallyCorrect: false,
    answerRevealed: false,
    answeredAt: null,
    session: {
      id: 'session-1',
      state: 'IN_PROGRESS',
      questionCount: 1,
      task: { enrollment: { studentId: 'student-1' } },
    },
    ...overrides,
  }
}

function makePrisma(q = question()) {
  const prisma: any = {
    levelAnswer: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'answer-1' }),
    },
    levelQuestion: {
      findUnique: vi.fn().mockResolvedValue(q),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(1),
    },
    levelSession: {
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  }
  return prisma
}

describe('judgeQuestionAnswer', () => {
  it('accepts spelling variants and reports near misses', () => {
    expect(judgeQuestionAnswer(question() as any, 'APPLE').correct).toBe(true)
    expect(judgeQuestionAnswer(question() as any, 'aple')).toMatchObject({ correct: false, verdict: 'close' })
    expect(judgeQuestionAnswer(question() as any, 'banana')).toMatchObject({ correct: false, verdict: 'wrong' })
  })

  it('compares choice answers by normalized text', () => {
    const choice = question({ questionType: 'L2', correctAnswer: '颜色', acceptedAnswers: ['颜色'] })
    expect(judgeQuestionAnswer(choice as any, ' 颜色 ').correct).toBe(true)
  })
})

describe('submitLevelAnswer', () => {
  it('records a first-try correct attempt and finishes the question', async () => {
    const prisma = makePrisma()
    const result = await submitLevelAnswer(
      prisma,
      'student-1',
      'session-1',
      { questionId: 'q1', answer: 'apple', submissionId: 'sub-1', responseMs: 3200 },
      NOW,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result).toMatchObject({
      correct: true,
      attemptNo: 1,
      retryAllowed: false,
      revealAnswer: null,
      questionFinished: true,
    })
    expect(prisma.levelQuestion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'q1', attemptsUsed: 0 }),
        data: expect.objectContaining({ attemptsUsed: 1, firstTryCorrect: true, eventuallyCorrect: true }),
      }),
    )
  })

  it('allows two retries and reveals the answer on the third failure', async () => {
    const prisma = makePrisma(question({ attemptsUsed: 2 }))
    const result = await submitLevelAnswer(
      prisma,
      'student-1',
      'session-1',
      { questionId: 'q1', answer: 'banana', submissionId: 'sub-3' },
      NOW,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result).toMatchObject({
      correct: false,
      attemptNo: 3,
      retryAllowed: false,
      revealAnswer: 'apple',
      questionFinished: true,
    })
    expect(prisma.levelQuestion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ answerRevealed: true }) }),
    )
  })

  it('returns the stored result for a repeated submission id', async () => {
    const prisma = makePrisma()
    prisma.levelAnswer.findUnique.mockResolvedValue({
      id: 'answer-old', correct: true, attemptNo: 1, hintLevel: 0,
    })
    const result = await submitLevelAnswer(
      prisma,
      'student-1',
      'session-1',
      { questionId: 'q1', answer: 'apple', submissionId: 'sub-1' },
      NOW,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result).toMatchObject({ correct: true, attemptNo: 1, replayed: true })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a question that already finished', async () => {
    const prisma = makePrisma(question({ attemptsUsed: 3, answerRevealed: true, eventuallyCorrect: true }))
    const result = await submitLevelAnswer(
      prisma,
      'student-1',
      'session-1',
      { questionId: 'q1', answer: 'apple', submissionId: 'sub-4' },
      NOW,
    )
    expect(result).toMatchObject({ status: 409 })
  })
})

describe('requestLevelHint', () => {
  it('reveals the first letter then half the word and records the hint level', async () => {
    const prisma = makePrisma()
    const first = await requestLevelHint(prisma, 'student-1', 'session-1', 'q1')
    if ('error' in first) throw new Error(first.error)
    expect(first).toMatchObject({ hintLevel: 1, hint: 'a____' })

    prisma.levelQuestion.findUnique.mockResolvedValue(question({ hintLevel: 1 }))
    const second = await requestLevelHint(prisma, 'student-1', 'session-1', 'q1')
    if ('error' in second) throw new Error(second.error)
    expect(second).toMatchObject({ hintLevel: 2, hint: 'app__' })
    expect(prisma.levelQuestion.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { hintLevel: 2 },
    })
  })

  it('excludes one wrong option for a choice question', async () => {
    const prisma = makePrisma(question({
      questionType: 'L2', correctAnswer: '颜色', acceptedAnswers: ['颜色'],
      options: ['颜色', '形状', '味道', '大小'],
    }))
    const hint = await requestLevelHint(prisma, 'student-1', 'session-1', 'q1')
    if ('error' in hint) throw new Error(hint.error)
    expect(hint.excludedOption).not.toBe('颜色')
    expect(hint.hintLevel).toBe(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -w server -- --run src/__tests__/levelAttempt.answer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现判分、提交与提示**

```ts
import type { PrismaClient } from '@prisma/client'
import { judgeSpelling } from './spelling.service'
import { normalizeSpelling } from './spelling.service'
import {
  applyQuestionAttempt,
  pickExcludedOption,
  spellingHint,
  type QuestionAttemptProgress,
} from './levelRules'

export interface AnswerInput {
  questionId: string
  answer: string
  submissionId: string
  responseMs?: number
}

export interface AnswerResult {
  submissionId: string
  questionId: string
  correct: boolean
  verdict: 'correct' | 'close' | 'wrong'
  attemptNo: number
  firstAttempt: boolean
  retryAllowed: boolean
  revealAnswer: string | null
  feedback: string
  questionFinished: boolean
  progress: { completed: number; total: number }
  replayed?: boolean
}

export function judgeQuestionAnswer(
  question: { questionType: 'L2' | 'L3' | 'L5'; correctAnswer: string; acceptedAnswers: string[] },
  answer: string,
): { correct: boolean; verdict: 'correct' | 'close' | 'wrong' } {
  if (question.questionType === 'L5') {
    const judgement = judgeSpelling(answer, {
      word: question.correctAnswer,
      variants: question.acceptedAnswers,
    })
    return {
      correct: judgement.correct,
      verdict: judgement.correct ? 'correct' : judgement.nearMiss ? 'close' : 'wrong',
    }
  }
  const correct = normalizeSpelling(answer) === normalizeSpelling(question.correctAnswer)
  return { correct, verdict: correct ? 'correct' : 'wrong' }
}

function feedbackFor(verdict: 'correct' | 'close' | 'wrong', finished: boolean, reveal: string | null) {
  if (verdict === 'correct') return '答对了！'
  if (verdict === 'close') return '很接近了，再试一次'
  if (reveal) return `正确答案是：${reveal}`
  return '再想想，还有机会'
}

async function loadSessionQuestion(prisma: PrismaClient, studentId: string, sessionId: string, questionId: string) {
  const question = await prisma.levelQuestion.findUnique({
    where: { id: questionId },
    include: { session: { include: { task: { include: { enrollment: true } } } } },
  })
  if (
    !question ||
    question.sessionId !== sessionId ||
    question.session.task.enrollment.studentId !== studentId
  ) {
    return null
  }
  return question
}

function progressOf(question: any): QuestionAttemptProgress {
  return {
    attemptsUsed: question.attemptsUsed,
    hintLevel: question.hintLevel,
    firstTryCorrect: question.firstTryCorrect,
    eventuallyCorrect: question.eventuallyCorrect,
    answerRevealed: question.answerRevealed,
  }
}

function replayResult(stored: any, question: any): AnswerResult {
  return {
    submissionId: stored.submissionId ?? '',
    questionId: stored.questionId ?? question.id,
    correct: stored.correct,
    verdict: stored.correct ? 'correct' : 'wrong',
    attemptNo: stored.attemptNo,
    firstAttempt: stored.attemptNo === 1,
    retryAllowed: !question.answerRevealed && question.attemptsUsed < 3,
    revealAnswer: question.answerRevealed ? question.correctAnswer : null,
    feedback: stored.correct ? '答对了！' : question.answerRevealed ? `正确答案是：${question.correctAnswer}` : '再想想，还有机会',
    questionFinished: question.answeredAt !== null,
    progress: { completed: question.session.questionCount, total: question.session.questionCount },
    replayed: true,
  }
}

export async function submitLevelAnswer(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  input: AnswerInput,
  now: Date = new Date(),
): Promise<AnswerResult | { error: string; status: number }> {
  const question = await loadSessionQuestion(prisma, studentId, sessionId, input.questionId)
  if (!question) return { error: 'Question not found', status: 404 }
  if (question.session.state !== 'IN_PROGRESS') return { error: 'Session already finished', status: 409 }

  const existing = await prisma.levelAnswer.findUnique({
    where: { sessionId_submissionId: { sessionId, submissionId: input.submissionId } },
  })
  if (existing) return replayResult(existing, question)

  if (question.answeredAt !== null) {
    return { error: 'Question already finished', status: 409 }
  }

  const judgement = judgeQuestionAnswer(question as any, input.answer)

  try {
    return await prisma.$transaction(async (tx) => {
      const latest = await tx.levelQuestion.findUnique({ where: { id: question.id } })
      if (!latest || latest.answeredAt !== null) return { error: 'Question already finished', status: 409 }

      const outcome = applyQuestionAttempt(progressOf(latest), { correct: judgement.correct })
      const updated = await tx.levelQuestion.updateMany({
        where: { id: latest.id, attemptsUsed: latest.attemptsUsed, answerRevealed: false },
        data: {
          ...outcome.next,
          answeredAt: outcome.finished ? now : null,
        },
      })
      if (updated.count === 0) return { error: 'Question changed, retry', status: 409 }

      await tx.levelAnswer.create({
        data: {
          sessionId,
          questionId: latest.id,
          submissionId: input.submissionId,
          answer: input.answer,
          correct: judgement.correct,
          attemptNo: outcome.attemptNo,
          hintLevel: latest.hintLevel,
          responseMs: input.responseMs ?? null,
          submittedAt: now,
        },
      })
      await tx.levelSession.update({
        where: { id: sessionId },
        data: { sessionVersion: { increment: 1 } },
      })

      const answered = await tx.levelQuestion.count({
        where: { sessionId, answeredAt: { not: null } },
      })

      return {
        submissionId: input.submissionId,
        questionId: latest.id,
        correct: judgement.correct,
        verdict: judgement.verdict,
        attemptNo: outcome.attemptNo,
        firstAttempt: outcome.attemptNo === 1,
        retryAllowed: outcome.retryAllowed,
        revealAnswer: outcome.revealAnswer ? latest.correctAnswer : null,
        feedback: feedbackFor(judgement.verdict, outcome.finished, outcome.revealAnswer ? latest.correctAnswer : null),
        questionFinished: outcome.finished,
        progress: { completed: answered, total: latest.session.questionCount },
      }
    })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const stored = await prisma.levelAnswer.findUnique({
        where: { sessionId_submissionId: { sessionId, submissionId: input.submissionId } },
      })
      if (stored) return replayResult(stored, question)
    }
    throw error
  }
}

export interface HintResult {
  questionId: string
  hintLevel: number
  hint: string | null
  excludedOption: string | null
}

export async function requestLevelHint(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  questionId: string,
): Promise<HintResult | { error: string; status: number }> {
  const question = await loadSessionQuestion(prisma, studentId, sessionId, questionId)
  if (!question) return { error: 'Question not found', status: 404 }
  if (question.session.state !== 'IN_PROGRESS') return { error: 'Session already finished', status: 409 }
  if (question.answeredAt !== null) return { error: 'Question already finished', status: 409 }

  const nextLevel = Math.min(2, question.hintLevel + 1)
  const hint =
    question.questionType === 'L5' ? spellingHint(question.correctAnswer, nextLevel) : null
  const excludedOption =
    question.questionType === 'L5'
      ? null
      : pickExcludedOption(
          question.correctAnswer,
          Array.isArray(question.options) ? (question.options as string[]) : [],
          `${question.id}:${nextLevel}`,
        )

  if (nextLevel !== question.hintLevel) {
    await prisma.levelQuestion.update({
      where: { id: question.id },
      data: { hintLevel: nextLevel },
    })
  }
  return { questionId: question.id, hintLevel: nextLevel, hint, excludedOption }
}
```

> 注意：提交事务里 `progressOf(latest)` 使用数据库中的最新值；`updateMany` 的 `where.attemptsUsed` 防止并发重复计数。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -w server -- --run src/__tests__/levelAttempt.answer.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/services/levelAttempt.service.ts server/src/__tests__/levelAttempt.answer.test.ts
git commit -m "feat(task): 关卡幂等答题、重试与提示"
```

---

### Task 6: 关卡结算、FSRS 调度与每日奖励

**Files:**
- Modify: `server/src/services/levelAttempt.service.ts`
- Test: `server/src/__tests__/levelAttempt.complete.test.ts`

**Interfaces:**
- Consumes: `summarizeQuestions`、`levelOutcome`、`shouldScheduleLevel`、`evaluateDailyTask`、`buildTaskSummary`、`selectSchedulingAnswer`、`rateAnswerAttempt`、`settleRewardsForUser`、共享 `schedule`。
- Produces:
  - `completeLevel(prisma, studentId, sessionId, now?): Promise<LevelCompletionResult | { error, status }>`
  - `LevelCompletionResult`：星级、统计、调度词数、奖励、任务摘要、错词列表。

- [ ] **Step 1: 写失败测试**

`server/src/__tests__/levelAttempt.complete.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/reward.service', () => ({
  settleRewardsForUser: vi.fn().mockResolvedValue({
    studyDate: '2026-11-23',
    xp: 40,
    coins: 60,
    awarded: [],
  }),
}))

import { settleRewardsForUser } from '../services/reward.service'
import { completeLevel } from '../services/levelAttempt.service'

const NOW = new Date('2026-11-23T02:00:00Z')

function q(id: string, type: string, firstTry: boolean, eventually: boolean, revealed = false) {
  return {
    id,
    taskWordId: `tw-${id}`,
    questionType: type,
    prompt: 'p',
    pos: null,
    options: null,
    correctAnswer: 'apple',
    acceptedAnswers: ['apple'],
    sortOrder: 0,
    attemptsUsed: eventually ? 1 : 3,
    hintLevel: 0,
    firstTryCorrect: firstTry,
    eventuallyCorrect: eventually,
    answerRevealed: revealed,
    answeredAt: NOW,
  }
}

function makePrisma(sessionOverrides: any = {}) {
  const session: any = {
    id: 'session-1',
    taskId: 'task-1',
    level: 'L5',
    attemptNo: 1,
    state: 'IN_PROGRESS',
    sessionVersion: 4,
    questionCount: 4,
    firstTryCorrect: 0,
    eventuallyCorrect: 0,
    stars: 0,
    cleared: null,
    startedAt: NOW,
    endedAt: null,
    questions: [
      q('q1', 'L5', true, true),
      q('q2', 'L5', false, true),
      q('q3', 'L5', false, false, true),
      q('q4', 'L5', false, true),
    ],
    task: {
      id: 'task-1',
      studyDate: '2026-11-23',
      status: 'ACTIVE',
      version: 1,
      config: { levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'] },
      completedAt: null,
      enrollment: { studentId: 'student-1', student: { userId: 'user-1' }, deck: { id: 'deck-1', fsrsParams: {} } },
      words: [
        { id: 'tw-q1', cardInstanceId: 'i1', kind: 'NEW', word: 'apple', scheduledAt: null },
        { id: 'tw-q2', cardInstanceId: 'i2', kind: 'NEW', word: 'banana', scheduledAt: null },
        { id: 'tw-q3', cardInstanceId: 'i3', kind: 'NEW', word: 'cat', scheduledAt: null },
        { id: 'tw-q4', cardInstanceId: 'i4', kind: 'NEW', word: 'dog', scheduledAt: null },
      ],
      sessions: [],
    },
    ...sessionOverrides,
  }
  session.task.sessions = [session]
  const prisma: any = {
    levelSession: {
      findUnique: vi.fn().mockResolvedValue(session),
      update: vi.fn().mockResolvedValue({}),
    },
    dailyStudyTask: {
      findUnique: vi.fn().mockResolvedValue(session.task),
      update: vi.fn().mockResolvedValue({}),
    },
    dailyTaskWord: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    cardInstance: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'i1', stability: 1, difficulty: 2, reps: 1, lapses: 0,
        state: 'LEARNING', lastReview: NOW, due: NOW,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    levelQuestion: { count: vi.fn().mockResolvedValue(4) },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  }
  return prisma
}

describe('completeLevel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes stars, schedules each word once and settles rewards', async () => {
    const prisma = makePrisma()
    const result = await completeLevel(prisma, 'student-1', 'session-1', NOW)
    if ('error' in result) throw new Error(result.error)

    expect(result).toMatchObject({
      cleared: true,
      stars: 1,
      stats: { questionCount: 4, firstTryCorrect: 1, eventuallyCorrect: 3 },
    })
    expect(result.scheduledWords).toBe(4)
    expect(prisma.cardInstance.update).toHaveBeenCalledTimes(4)
    expect(prisma.dailyTaskWord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expect.any(String), scheduledAt: null },
      }),
    )
    expect(settleRewardsForUser).toHaveBeenCalled()
  })

  it('does not schedule or clear when the pass mark is missed', async () => {
    const prisma = makePrisma({
      questions: [q('q1', 'L5', false, false, true), q('q2', 'L5', false, false, true)],
      questionCount: 2,
    })
    const result = await completeLevel(prisma, 'student-1', 'session-1', NOW)
    if ('error' in result) throw new Error(result.error)
    expect(result.cleared).toBe(false)
    expect(result.scheduledWords).toBe(0)
    expect(prisma.cardInstance.update).not.toHaveBeenCalled()
  })

  it('rejects completion while questions are unanswered', async () => {
    const prisma = makePrisma({
      questions: [q('q1', 'L5', true, true), { ...q('q2', 'L5', false, false), answeredAt: null }],
    })
    const result = await completeLevel(prisma, 'student-1', 'session-1', NOW)
    expect(result).toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -w server -- --run src/__tests__/levelAttempt.complete.test.ts`
Expected: FAIL — `completeLevel` is not exported.

- [ ] **Step 3: 在 `levelAttempt.service.ts` 追加结算实现**

```ts
import { schedule, type FSRSParams } from '@vanilla-srs/shared/fsrs'
import {
  rateAnswerAttempt,
  rewardEventKey,
  selectSchedulingAnswer,
  type RewardCandidate,
  type SessionAnswerRecord,
} from '@vanilla-srs/shared/word-camp'
import { settleRewardsForUser, type RewardSettlement } from './reward.service'
import { buildTaskSummary, type DailyTaskSummary } from './dailyTask.service'
import {
  levelOutcome,
  shouldScheduleLevel,
  summarizeQuestions,
  type DailyTaskConfig,
  type LevelKind,
} from './levelRules'

export interface LevelCompletionResult {
  sessionId: string
  taskId: string
  level: LevelKind
  attemptNo: number
  cleared: boolean
  stars: number
  stats: {
    questionCount: number
    firstTryCorrect: number
    eventuallyCorrect: number
    firstTryAccuracy: number
    finalAccuracy: number
  }
  scheduledWords: number
  rewards: RewardSettlement
  task: DailyTaskSummary
  weakWords: { taskWordId: string; word: string }[]
}

function toSharedQuestionType(type: 'L2' | 'L3' | 'L5'): SessionAnswerRecord['questionType'] {
  if (type === 'L5') return 'l5_spelling'
  if (type === 'L3') return 'l3_zh_to_en'
  return 'l2_en_to_zh'
}

function schedulingRecord(question: any): SessionAnswerRecord {
  return {
    questionType: toSharedQuestionType(question.questionType),
    correct: question.eventuallyCorrect,
    attemptNo: Math.max(1, question.attemptsUsed),
    hintLevel: question.hintLevel,
    answerRevealed: question.answerRevealed,
  }
}

function rewardCandidatesForLevel(
  level: LevelKind,
  task: any,
  questions: any[],
  wordsById: Map<string, any>,
): RewardCandidate[] {
  const studyDate = task.studyDate as string
  const candidates: RewardCandidate[] = []
  const seen = new Set<string>()

  for (const question of questions) {
    if (!question.firstTryCorrect) continue
    const word = wordsById.get(question.taskWordId)
    if (!word) continue
    const key = `${word.id}:${question.questionType}`
    if (seen.has(key)) continue
    seen.add(key)

    if (word.kind === 'NEW' && (question.questionType === 'L2' || question.questionType === 'L3')) {
      candidates.push({
        userId: task.enrollment.student.userId,
        rewardType: 'word_learned',
        eventKey: rewardEventKey({
          rewardType: 'word_learned',
          contextId: task.enrollment.deck.id,
          wordId: word.cardId,
        }),
      })
    }
    if (word.kind === 'REVIEW') {
      candidates.push({
        userId: task.enrollment.student.userId,
        rewardType: 'review_ok',
        eventKey: rewardEventKey({
          rewardType: 'review_ok',
          contextId: task.enrollment.deck.id,
          wordId: word.cardId,
          cycleStartDate: studyDate,
        }),
      })
    }
  }

  if (level === 'BOSS') {
    candidates.push({
      userId: task.enrollment.student.userId,
      rewardType: 'boss_clear',
      eventKey: rewardEventKey({
        rewardType: 'boss_clear',
        assignmentId: task.id,
        assignmentVersion: task.version,
        bossId: 'boss',
      }),
    })
  }
  return candidates
}

async function scheduleClearedWords(
  prisma: PrismaClient,
  session: any,
  config: DailyTaskConfig,
  now: Date,
): Promise<number> {
  if (!shouldScheduleLevel(session.level, config)) return 0

  const wordsById = new Map<string, any>(session.task.words.map((word: any) => [word.id, word]))
  const questionsByWord = new Map<string, any[]>()
  for (const question of session.questions) {
    const list = questionsByWord.get(question.taskWordId) ?? []
    list.push(question)
    questionsByWord.set(question.taskWordId, list)
  }

  let scheduled = 0
  for (const [taskWordId, questions] of questionsByWord) {
    const word = wordsById.get(taskWordId)
    if (!word || word.scheduledAt) continue

    const record = selectSchedulingAnswer(questions.map(schedulingRecord))
    if (!record) continue
    const decision = rateAnswerAttempt(record)

    const marked = await prisma.dailyTaskWord.updateMany({
      where: { id: word.id, scheduledAt: null },
      data: { scheduledAt: now, scheduledRating: decision.rating, scheduledSessionId: session.id },
    })
    if (marked.count === 0) continue

    const instance = await prisma.cardInstance.findUnique({ where: { id: word.cardInstanceId } })
    if (!instance) continue
    const params = session.task.enrollment.deck.fsrsParams as FSRSParams
    const next = schedule(
      {
        stability: instance.stability,
        difficulty: instance.difficulty,
        reps: instance.reps,
        lapses: instance.lapses,
        state: instance.state as any,
        lastReview: instance.lastReview,
        due: instance.due,
      },
      decision.rating,
      params,
      now,
    )
    await prisma.cardInstance.update({
      where: { id: instance.id },
      data: {
        stability: next.stability,
        difficulty: next.difficulty,
        retrievability: next.retrievability,
        reps: next.reps,
        lapses: next.lapses,
        state: next.state,
        due: next.due,
        lastReview: next.lastReview,
      },
    })
    scheduled += 1
  }
  return scheduled
}

export async function completeLevel(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<LevelCompletionResult | { error: string; status: number }> {
  const session = await prisma.levelSession.findUnique({
    where: { id: sessionId },
    include: {
      questions: { orderBy: { sortOrder: 'asc' } },
      task: {
        include: {
          words: { orderBy: { sortOrder: 'asc' } },
          sessions: { include: { questions: { select: { answeredAt: true } } } },
          enrollment: { include: { student: true, deck: true } },
        },
      },
    },
  })
  if (!session || session.task.enrollment.studentId !== studentId) {
    return { error: 'Session not found', status: 404 }
  }

  const config = session.task.config as unknown as DailyTaskConfig
  const wordsById = new Map<string, any>(session.task.words.map((word: any) => [word.id, word]))
  let cleared = session.cleared === true
  let stars = session.stars
  let scheduledWords = 0

  if (session.state !== 'COMPLETED') {
    if (session.questions.some((question) => question.answeredAt === null)) {
      return { error: 'Level has unanswered questions', status: 409 }
    }
    const stats = summarizeQuestions(session.questions)
    const outcome = session.level === 'L1'
      ? { cleared: true, stars: 0, firstTryAccuracy: 1, finalAccuracy: 1 }
      : levelOutcome(session.level as any, stats)
    cleared = outcome.cleared
    stars = outcome.stars

    const result = await prisma.$transaction(async (tx) => {
      await tx.levelSession.update({
        where: { id: session.id },
        data: {
          state: 'COMPLETED',
          endedAt: now,
          questionCount: stats.questionCount,
          firstTryCorrect: stats.firstTryCorrect,
          eventuallyCorrect: stats.eventuallyCorrect,
          stars: outcome.stars,
          cleared: outcome.cleared,
        },
      })

      let scheduled = 0
      if (outcome.cleared) {
        scheduled = await scheduleClearedWords(tx as unknown as PrismaClient, { ...session, cleared: true }, config, now)
      }

      const refreshed = await tx.dailyStudyTask.findUnique({
        where: { id: session.taskId },
        include: {
          words: { orderBy: { sortOrder: 'asc' } },
          sessions: {
            orderBy: [{ level: 'asc' }, { attemptNo: 'desc' }],
            include: { questions: { select: { answeredAt: true } } },
          },
        },
      })
      const taskSummary = buildTaskSummary(refreshed)
      if (taskSummary.progress.completed && refreshed!.status !== 'COMPLETED') {
        await tx.dailyStudyTask.update({
          where: { id: session.taskId },
          data: { status: 'COMPLETED', completedAt: now },
        })
      }
      return { scheduled, taskSummary }
    })

    scheduledWords = result.scheduled
    // Rebuild the summary after the potential status update so the response is current.
    const finalTask = await prisma.dailyStudyTask.findUnique({
      where: { id: session.taskId },
      include: {
        words: { orderBy: { sortOrder: 'asc' } },
        sessions: {
          orderBy: [{ level: 'asc' }, { attemptNo: 'desc' }],
          include: { questions: { select: { answeredAt: true } } },
        },
      },
    })
    const taskSummary = buildTaskSummary(finalTask)
    const candidates = rewardCandidatesForLevel(session.level, session.task, session.questions, wordsById)
    if (taskSummary.progress.completed) {
      candidates.push({
        userId: session.task.enrollment.student.userId,
        rewardType: 'daily_done',
        eventKey: rewardEventKey({ rewardType: 'daily_done', studyDate: session.task.studyDate }),
      })
    }
    const rewards = await settleRewardsForUser(
      prisma,
      session.task.enrollment.student.userId,
      session.task.studyDate,
      candidates,
    )
    const stats = summarizeQuestions(session.questions)
    return {
      sessionId: session.id,
      taskId: session.taskId,
      level: session.level,
      attemptNo: session.attemptNo,
      cleared,
      stars,
      stats: {
        ...stats,
        firstTryAccuracy: stats.questionCount ? stats.firstTryCorrect / stats.questionCount : 0,
        finalAccuracy: stats.questionCount ? stats.eventuallyCorrect / stats.questionCount : 0,
      },
      scheduledWords,
      rewards,
      task: taskSummary,
      weakWords: session.questions
        .filter((question) => !question.eventuallyCorrect)
        .map((question) => {
          const word = wordsById.get(question.taskWordId)
          return { taskWordId: question.taskWordId, word: word?.word ?? '' }
        }),
    }
  }

  // Already completed: return the stored outcome and re-settle idempotently.
  const task = await prisma.dailyStudyTask.findUnique({
    where: { id: session.taskId },
    include: {
      words: { orderBy: { sortOrder: 'asc' } },
      sessions: {
        orderBy: [{ level: 'asc' }, { attemptNo: 'desc' }],
        include: { questions: { select: { answeredAt: true } } },
      },
    },
  })
  const taskSummary = buildTaskSummary(task)
  const candidates = rewardCandidatesForLevel(session.level, session.task, session.questions, wordsById)
  if (taskSummary.progress.completed) {
    candidates.push({
      userId: session.task.enrollment.student.userId,
      rewardType: 'daily_done',
      eventKey: rewardEventKey({ rewardType: 'daily_done', studyDate: session.task.studyDate }),
    })
  }
  const rewards = await settleRewardsForUser(
    prisma,
    session.task.enrollment.student.userId,
    session.task.studyDate,
    candidates,
  )
  const stats = summarizeQuestions(session.questions)
  return {
    sessionId: session.id,
    taskId: session.taskId,
    level: session.level,
    attemptNo: session.attemptNo,
    cleared,
    stars,
    stats: {
      ...stats,
      firstTryAccuracy: stats.questionCount ? stats.firstTryCorrect / stats.questionCount : 0,
      finalAccuracy: stats.questionCount ? stats.eventuallyCorrect / stats.questionCount : 0,
    },
    scheduledWords,
    rewards,
    task: taskSummary,
    weakWords: session.questions
      .filter((question) => !question.eventuallyCorrect)
      .map((question) => {
        const word = wordsById.get(question.taskWordId)
        return { taskWordId: question.taskWordId, word: word?.word ?? '' }
      }),
  }
}
```

> 实现时把 `buildTaskSummary` 的 `task` 参数类型保持为 `any` 或导出的宽松类型，避免 Prisma include 的泛型地狱；测试与运行期已覆盖结构。若 `tx.dailyStudyTask` 在类型上不可用，用 `tx as unknown as PrismaClient` 统一转换。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -w server -- --run src/__tests__/levelAttempt.complete.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/services/levelAttempt.service.ts server/src/__tests__/levelAttempt.complete.test.ts
git commit -m "feat(task): 关卡结算、一次性调度与每日奖励"
```

---

### Task 7: HTTP 路由与挂载

**Files:**
- Create: `server/src/routes/studentTask.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `getOrCreateDailyTask`、`startLevel`、`getLevelSession`、`submitLevelAnswer`、`requestLevelHint`、`completeLevel`。
- Produces: 六个 `/api/students/...` 接口。

- [ ] **Step 1: 实现路由**

```ts
import { Request, Response } from 'express'
import { z } from 'zod'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { requireAuth, requireStudent, requirePasswordChanged } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { getOrCreateDailyTask } from '../services/dailyTask.service'
import { startLevel, getLevelSession } from '../services/levelSession.service'
import {
  completeLevel,
  requestLevelHint,
  submitLevelAnswer,
} from '../services/levelAttempt.service'

const router = asyncRouter()
router.use(requireAuth, requireStudent, requirePasswordChanged)

async function getStudent(userId: string) {
  return prisma.student.findUnique({ where: { userId } })
}

const p = (req: Request, key: string) => req.params[key] as string

const LevelEnum = z.enum(['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'])

// GET /api/students/task/today?enrollmentId=
router.get('/task/today', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const task = await getOrCreateDailyTask(prisma, student.id, enrollmentId)
  if ('error' in task) { res.status(task.status).json({ error: task.error }); return }
  res.json(task)
})

const StartLevelSchema = z.object({
  taskId: z.string().uuid(),
  level: LevelEnum,
})

// POST /api/students/levels/start
router.post('/levels/start', validate(StartLevelSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const view = await startLevel(prisma, student.id, req.body.taskId, req.body.level)
  if ('error' in view) { res.status(view.status).json({ error: view.error }); return }
  res.status(201).json(view)
})

// GET /api/students/levels/:id
router.get('/levels/:id', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const view = await getLevelSession(prisma, student.id, p(req, 'id'))
  if ('error' in view) { res.status(view.status).json({ error: view.error }); return }
  res.json(view)
})

const AnswerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string().min(1).max(200),
  submissionId: z.string().min(1).max(100),
  responseMs: z.number().int().positive().optional(),
})

// POST /api/students/levels/:id/answer
router.post('/levels/:id/answer', validate(AnswerSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await submitLevelAnswer(prisma, student.id, p(req, 'id'), req.body)
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.json(result)
})

const HintSchema = z.object({ questionId: z.string().uuid() })

// POST /api/students/levels/:id/hint
router.post('/levels/:id/hint', validate(HintSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await requestLevelHint(prisma, student.id, p(req, 'id'), req.body.questionId)
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.json(result)
})

// POST /api/students/levels/:id/complete
router.post('/levels/:id/complete', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await completeLevel(prisma, student.id, p(req, 'id'))
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.json(result)
})

export default router
```

- [ ] **Step 2: 在 `server/src/index.ts` 挂载**

```ts
import studentTaskRouter from './routes/studentTask'
```

```ts
app.use('/api/students', studentTaskRouter)
app.use('/api/students', studentsRouter)
```

- [ ] **Step 3: 构建服务端**

Run: `npm run build -w server`
Expected: 0 errors。

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/studentTask.ts server/src/index.ts
git commit -m "feat(task): 学生每日任务与关卡接口"
```

---

### Task 8: 回归、干净库迁移与文档

**Files:**
- Modify: `docs/WORD_CAMP_STAGE1_PROGRESS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/WORD_CAMP_HANDOFF.md`

- [ ] **Step 1: 跑全量服务端测试**

Run: `npm run test -w server`
Expected: 全绿；记录新的 passed/skipped 计数。

- [ ] **Step 2: 三包构建**

Run: `npm run build -w shared && npm run build -w server && npm run build -w client`
Expected: 全部通过。

- [ ] **Step 3: 干净库应用迁移**

按 `docs/WORD_CAMP_VERSIONING.md` 的干净库流程，在临时库（如 `task_fresh`）从初始迁移完整应用 15 个迁移：

```powershell
docker build -f server/Dockerfile --target migrator -t wordcamp-migrate .
docker run --rm --network wordcamp_default `
  -e "DATABASE_URL=postgresql://srs_user:<password>@db:5432/task_fresh" `
  wordcamp-migrate
```

Expected: 15 个迁移全部应用，无报错。

- [ ] **Step 4: Docker 端到端走一轮任务**

在现有学生账号下：

1. `GET /api/students/task/today?enrollmentId=...` → 返回 10 新词 + 到期复习。
2. `POST /levels/start` L2 → 四选一题；提交正确 → `retryAllowed:false`。
3. 重复同一 `submissionId` → `replayed:true`，答题数不变。
4. L3、L5 完成 → `complete` 返回星级；检查 `DailyTaskWord.scheduledAt` 已写、`CardInstance.due` 已变。
5. BOSS 通关 → `boss_clear` 奖励入账。
6. REVIEW 完成且新词关全清 → `daily_done` 奖励入账，任务 `COMPLETED`。
7. 重复调用 `complete` → 奖励不重复入账。

Expected: 上述全部通过；把真实命令与返回值写入进展文档。

- [ ] **Step 5: 更新文档**

`docs/WORD_CAMP_STAGE1_PROGRESS.md` 新增一节：

```markdown
## 14. 每日任务与关卡服务端闭环（2026-11-23）

- 新增 `DailyStudyTask` / `DailyTaskWord` / `LevelSession` / `LevelQuestion` / `LevelAnswer`（迁移 `20261123050000_daily_study_tasks`）。
- `GET /api/students/task/today` 按上海学习日取建任务，冻结新词与到期复习词快照。
- 关卡 L1/L2/L3/L5/BOSS/REVIEW：服务端固定题目与选项、答案不下发、每题 3 次重试、第 3 次揭晓、拼写两级提示。
- `(sessionId, submissionId)` 幂等；重复提交返回原结果。
- 结算按 70%/80% 通关、首答 90%/100% 星级；L5（缺省时 L3）与 REVIEW 每词只调度一次 FSRS。
- 奖励：L2/L3 首次独立答对 `word_learned`、复习首次独立答对 `review_ok`、Boss 首通 `boss_clear`、任务完成 `daily_done`。
- 验证：服务端全量测试、三包构建、干净库 15 个迁移、Docker 端到端一轮任务。
- 未做：学生 UI、教师任务完成看板、L4 音频、错词重练、教师自定义配置。
```

`CHANGELOG.md` 的 `[Unreleased]` 增加：

```markdown
### Added
- 每日任务与关卡服务端闭环：任务快照、L1/L2/L3/L5/Boss/复习会话、幂等答题、重试提示、星级、一次性 FSRS 调度与每日奖励结算。
```

`docs/WORD_CAMP_HANDOFF.md` 更新“一句话状态”“已完成能力”“测试基线”“未完成优先级”：把“每日任务/关卡”从“尚未完成”改为“服务端闭环已完成，学生 UI/教师看板待做”。

- [ ] **Step 6: 提交**

```bash
git add docs/WORD_CAMP_STAGE1_PROGRESS.md CHANGELOG.md docs/WORD_CAMP_HANDOFF.md
git commit -m "docs(task): 记录每日任务关卡服务端闭环与验证"
```

---

## 自检

- **规格覆盖**：任务实体/快照（Task 1/3）、L2/L3/L5/Boss/复习（Task 2/4）、幂等答题/重试/提示（Task 5）、星级/调度/奖励/每日完成（Task 6）、接口（Task 7）、验证与文档（Task 8）。
- **明确不做**：学生 UI、教师看板、真实音频、错词重练、教师配置 UI。
- **类型一致性**：`LevelKind`、`QuestionKind`、`DailyTaskConfig`、`LevelSessionView`、`LevelCompletionResult` 在后续任务中的字段与 Task 2/3/4/6 定义一致；奖励事件键全部走 `rewardEventKey`。

/**
 * Level answer submission: server-authoritative judging, (sessionId,
 * submissionId) idempotency, per-question retry state machine and hints.
 * FSRS scheduling and level completion live at the bottom of this module.
 */

import type { PrismaClient } from '@prisma/client'
import { judgeSpelling, normalizeSpelling } from './spelling.service'
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
    const verdict = judgeSpelling(answer, question.correctAnswer, question.acceptedAnswers)
    return { correct: verdict === 'correct', verdict }
  }
  const correct = normalizeSpelling(answer) === normalizeSpelling(question.correctAnswer)
  return { correct, verdict: correct ? 'correct' : 'wrong' }
}

function feedbackFor(verdict: 'correct' | 'close' | 'wrong', reveal: string | null) {
  if (verdict === 'correct') return '答对了！'
  if (verdict === 'close') return '很接近了，再试一次'
  if (reveal) return `正确答案是：${reveal}`
  return '再想想，还有机会'
}

async function loadSessionQuestion(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  questionId: string,
) {
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
    feedback: stored.correct
      ? '答对了！'
      : question.answerRevealed
        ? `正确答案是：${question.correctAnswer}`
        : '再想想，还有机会',
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

  if (question.answeredAt !== null || question.answerRevealed || question.attemptsUsed >= 3) {
    return { error: 'Question already finished', status: 409 }
  }

  const judgement = judgeQuestionAnswer(question as any, input.answer)

  try {
    return await prisma.$transaction(async (tx) => {
      const latest = await tx.levelQuestion.findUnique({
        where: { id: question.id },
        include: { session: true },
      })
      if (!latest || latest.answeredAt !== null) return { error: 'Question already finished', status: 409 as const }

      const outcome = applyQuestionAttempt(progressOf(latest), { correct: judgement.correct })
      const updated = await tx.levelQuestion.updateMany({
        where: { id: latest.id, attemptsUsed: latest.attemptsUsed, answerRevealed: false },
        data: {
          ...outcome.next,
          answeredAt: outcome.finished ? now : null,
        },
      })
      if (updated.count === 0) return { error: 'Question changed, retry', status: 409 as const }

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
        feedback: feedbackFor(judgement.verdict, outcome.revealAnswer ? latest.correctAnswer : null),
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
  const hint = question.questionType === 'L5' ? spellingHint(question.correctAnswer, nextLevel) : null
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

// ── Level completion: stars, one-shot FSRS scheduling, daily rewards ─────────

import { schedule, type FSRSParams } from '@vanilla-srs/shared/fsrs'
import { mapFsrsToEbbinghausStage } from '@vanilla-srs/shared/ebbinghaus'
import { rarityFromStage, type GameLevelType } from '@vanilla-srs/shared/gamification'
import {
  rateAnswerAttempt,
  rewardEventKey,
  selectSchedulingAnswer,
  type RewardCandidate,
  type SessionAnswerRecord,
} from '@vanilla-srs/shared/word-camp'
import { settleRewardsForUser, type RewardSettlement } from './reward.service'
import { buildTaskSummary, type DailyTaskSummary } from './dailyTask.service'
import { getEffectiveGameConfig } from './gameConfig.service'
import {
  countTomorrowDueCards,
  isGamificationAvailable,
  recordGameRewardEventInTx,
  type RewardFeedback,
} from './gamification.service'
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
  gameReward?: RewardFeedback
  tomorrowDueCount?: number
  upgradedCards?: Array<{ word: string; fromRarity: string | null; toRarity: string }>
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
): Promise<{
  scheduled: number
  upgradedCards: Array<{ word: string; fromRarity: string | null; toRarity: string }>
}> {
  if (!shouldScheduleLevel(session.level, config)) return { scheduled: 0, upgradedCards: [] }

  const wordsById = new Map<string, any>(session.task.words.map((word: any) => [word.id, word]))
  const questionsByWord = new Map<string, any[]>()
  for (const question of session.questions) {
    const list = questionsByWord.get(question.taskWordId) ?? []
    list.push(question)
    questionsByWord.set(question.taskWordId, list)
  }

  let scheduled = 0
  const upgradedCards: Array<{ word: string; fromRarity: string | null; toRarity: string }> = []
  const trackStage = isGamificationAvailable(prisma)

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

    const newStage = mapFsrsToEbbinghausStage(next.state, next.stability, next.reps)
    const prevBestStage =
      instance.bestStage !== null && instance.bestStage !== undefined
        ? instance.bestStage
        : instance.state === 'NEW' && instance.reps <= 0
          ? null
          : mapFsrsToEbbinghausStage(instance.state as any, instance.stability, instance.reps)
    const nextBestStage = Math.max(prevBestStage ?? -1, newStage)

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
        ...(trackStage ? { bestStage: nextBestStage } : {}),
      },
    })

    const prevRarity = rarityFromStage(prevBestStage)
    const nextRarity = rarityFromStage(nextBestStage)
    if (nextRarity && (!prevRarity || prevRarity.key !== nextRarity.key)) {
      upgradedCards.push({
        word: word.word,
        fromRarity: prevRarity?.label ?? null,
        toRarity: nextRarity.label,
      })
    }

    scheduled += 1
  }
  return { scheduled, upgradedCards }
}

const completionTaskInclude = {
  words: { orderBy: { sortOrder: 'asc' as const } },
  sessions: {
    orderBy: [{ level: 'asc' as const }, { attemptNo: 'desc' as const }],
    include: { questions: { select: { answeredAt: true } } },
  },
}

function completionResultOf(
  session: any,
  cleared: boolean,
  stars: number,
  scheduledWords: number,
  rewards: RewardSettlement,
  taskSummary: DailyTaskSummary,
  wordsById: Map<string, any>,
): LevelCompletionResult {
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
      .filter((question: any) => !question.eventuallyCorrect)
      .map((question: any) => {
        const word = wordsById.get(question.taskWordId)
        return { taskWordId: question.taskWordId, word: word?.word ?? '' }
      }),
  }
}

async function settleLevelRewards(
  prisma: PrismaClient,
  session: any,
  taskSummary: DailyTaskSummary,
  wordsById: Map<string, any>,
): Promise<RewardSettlement> {
  const candidates = rewardCandidatesForLevel(session.level, session.task, session.questions, wordsById)
  if (taskSummary.progress.completed) {
    candidates.push({
      userId: session.task.enrollment.student.userId,
      rewardType: 'daily_done',
      eventKey: rewardEventKey({ rewardType: 'daily_done', studyDate: session.task.studyDate }),
    })
  }
  return settleRewardsForUser(
    prisma,
    session.task.enrollment.student.userId,
    session.task.studyDate,
    candidates,
  )
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

  if (session.state === 'COMPLETED') {
    // Already completed: return the stored outcome and re-settle idempotently.
    const task = await prisma.dailyStudyTask.findUnique({
      where: { id: session.taskId },
      include: completionTaskInclude,
    })
    const taskSummary = buildTaskSummary(task)
    const rewards = await settleLevelRewards(prisma, session, taskSummary, wordsById)
    return completionResultOf(session, session.cleared === true, session.stars, 0, rewards, taskSummary, wordsById)
  }

  if (session.questions.some((question) => question.answeredAt === null)) {
    return { error: 'Level has unanswered questions', status: 409 }
  }
  const stats = summarizeQuestions(session.questions)
  const outcome =
    session.level === 'L1'
      ? { cleared: true, stars: 0, firstTryAccuracy: 1, finalAccuracy: 1 }
      : levelOutcome(session.level as any, stats)

  const gamificationOn = isGamificationAvailable(prisma)
  const { config: gameConfig, configVersion } = gamificationOn
    ? await getEffectiveGameConfig(prisma, session.task.enrollment.classId)
    : { config: undefined, configVersion: 'default' }

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
    let upgradedCards: Array<{ word: string; fromRarity: string | null; toRarity: string }> = []
    if (outcome.cleared) {
      const sched = await scheduleClearedWords(tx as unknown as PrismaClient, session, config, now)
      scheduled = sched.scheduled
      upgradedCards = sched.upgradedCards
    }

    const refreshed = await tx.dailyStudyTask.findUnique({
      where: { id: session.taskId },
      include: completionTaskInclude,
    })
    const taskSummary = buildTaskSummary(refreshed)
    if (taskSummary.progress.completed && refreshed!.status !== 'COMPLETED') {
      await tx.dailyStudyTask.update({
        where: { id: session.taskId },
        data: { status: 'COMPLETED', completedAt: now },
      })
    }

    let gameReward: RewardFeedback | undefined
    const deckId = session.task.enrollment.deck?.id
    if (outcome.cleared && gamificationOn && gameConfig && deckId) {
      const levelType = session.level as GameLevelType
      const reviewCardIds =
        session.level === 'REVIEW'
          ? session.task.words
              .filter((w: any) => w.kind === 'REVIEW')
              .map((w: any) => w.cardInstanceId as string)
          : []
      gameReward = await recordGameRewardEventInTx({
        tx: tx as unknown as PrismaClient,
        studentId,
        enrollmentId: session.task.enrollmentId,
        deckId,
        classId: session.task.enrollment.classId,
        type: 'LEVEL_CLEAR',
        sourceId: `${session.task.studyDate}:${session.level}`,
        baseXp: gameConfig.levelXp[levelType] ?? 0,
        localDate: session.task.studyDate,
        now,
        config: gameConfig,
        configVersion,
        levelCleared: session.level === 'REVIEW' ? undefined : session.level,
        countAsReviewCardIds: reviewCardIds,
        meta: {
          level: session.level,
          campDay: session.task.campDay ?? null,
          stars: outcome.stars,
          sessionId: session.id,
        },
      })
    }

    return { scheduled, upgradedCards, gameReward }
  })

  const finalTask = await prisma.dailyStudyTask.findUnique({
    where: { id: session.taskId },
    include: completionTaskInclude,
  })
  const taskSummary = buildTaskSummary(finalTask)
  const rewards = await settleLevelRewards(prisma, session, taskSummary, wordsById)
  const tomorrowDueCount =
    gamificationOn && session.task.enrollment.deck?.id
      ? await countTomorrowDueCards(prisma, session.task.enrollment.deck.id, now)
      : undefined

  return {
    ...completionResultOf(session, outcome.cleared, outcome.stars, result.scheduled, rewards, taskSummary, wordsById),
    ...(result.gameReward ? { gameReward: result.gameReward } : {}),
    ...(tomorrowDueCount !== undefined ? { tomorrowDueCount } : {}),
    ...(result.upgradedCards.length > 0 ? { upgradedCards: result.upgradedCards } : {}),
  }
}

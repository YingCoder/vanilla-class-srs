/**
 * Daily study task: one frozen word list per enrollment per Shanghai study day.
 *
 * Words are snapshotted into `DailyTaskWord` at creation so card edits later
 * in the day never mutate a task a student is already working on. Creation is
 * idempotent via the `(enrollmentId, studyDate)` unique constraint.
 */

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
    levels:
      Array.isArray(config.levels) && config.levels.length > 0
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

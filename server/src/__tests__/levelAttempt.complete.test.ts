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
      enrollment: { studentId: 'student-1', student: { userId: 'user-1' }, deck: { id: 'deck-1', fsrsParams: { requestRetention: 0.9, maximumInterval: 36500, w: [], newCardsPerDay: 10 } } },
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

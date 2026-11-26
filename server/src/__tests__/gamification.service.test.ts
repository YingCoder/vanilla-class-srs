import { describe, it, expect, vi } from 'vitest'
import { ZHONGKAO_23_DAYS } from '@vanilla-srs/shared/vocab'
import { gradeCard } from '../services/review.service'
import { completeLevel } from '../services/levelAttempt.service'
import { getCampMap, getCardAlbum, getClassLeaderboard, getStudentBadges } from '../services/gamification.service'

const NOW = new Date('2026-11-25T04:00:00Z') // 12:00 Asia/Shanghai

function createInMemoryGamePrisma(opts: {
  cardDue?: Date
  cardState?: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING'
  cardStability?: number
  cardReps?: number
  cardBestStage?: number | null
  priorTodayReviews?: number
  initialDailyXp?: number
  rawDueCount?: number
  lastStudiedDate?: string | null
  leaderboardOpen?: boolean
} = {}) {
  const state = {
    cardInstance: {
      id: 'inst-1',
      deckId: 'deck-1',
      cardId: 'card-1',
      state: opts.cardState ?? 'REVIEW',
      stability: opts.cardStability ?? 1.2,
      difficulty: 5,
      retrievability: 0.9,
      due: opts.cardDue ?? NOW,
      lastReview: new Date('2026-11-24T04:00:00Z'),
      reps: opts.cardReps ?? 3,
      lapses: 0,
      bestStage: opts.cardBestStage ?? 3,
      card: { id: 'card-1', word: 'make' },
    },
    reviewEvents: [] as any[],
    gameEvents: [] as any[],
    profile: {
      studentId: 'student-1',
      nickname: '糖果测试员',
      avatarKey: 'vanilla',
      avatarFrame: 'vanilla',
      cardSkin: 'classic',
      soundEnabled: false,
      totalXp: opts.initialDailyXp ?? 0,
      level: 1,
      streakDays: 0,
      longestStreak: 0,
      freezeTickets: 0,
      lastAchievedDate: null as string | null,
      streakCursorDate: null as string | null,
      lastStudiedDate: opts.lastStudiedDate ?? '2026-11-24',
    },
    dailyState: opts.initialDailyXp !== undefined
      ? {
          studentId: 'student-1',
          localDate: '2026-11-25',
          xpEarned: opts.initialDailyXp,
          reviewDue: 10,
          reviewDone: 0,
          reviewedCardIds: [] as string[],
          levelsPassed: [] as string[],
          ringsClosed: false,
          weakBossDone: false,
        }
      : null as any,
    badges: [] as any[],
  }

  let evSeq = 1
  const prisma: any = {
    appRelease: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    enrollment: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'enr-1',
        studentId: 'student-1',
        classId: 'class-1',
        archivedAt: null,
        deck: {
          id: 'deck-1',
          fsrsParams: { requestRetention: 0.9, maximumInterval: 36500, w: [], newCardsPerDay: 10 },
        },
        class: { id: 'class-1', name: '11A' },
        student: { id: 'student-1', userId: 'user-1' },
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          studentId: 'student-1',
          student: {
            user: { name: '张三真实姓名' },
            gameProfile: { nickname: '奶昔小张', avatarKey: 'strawberry', avatarFrame: 'vanilla' },
          },
        },
      ]),
    },
    reviewSession: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'sess-1',
        deckId: 'deck-1',
        endedAt: null,
        deck: {
          id: 'deck-1',
          fsrsParams: { requestRetention: 0.9, maximumInterval: 36500, w: [], newCardsPerDay: 10 },
          enrollment: { id: 'enr-1', studentId: 'student-1', classId: 'class-1' },
        },
      }),
    },
    cardInstance: {
      findUnique: vi.fn().mockImplementation(async () => state.cardInstance),
      findMany: vi.fn().mockImplementation(async () => [state.cardInstance]),
      count: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.bestStage?.gte === 6) return (state.cardInstance.bestStage ?? -1) >= 6 ? 1 : 0
        return opts.rawDueCount ?? 5
      }),
      update: vi.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(state.cardInstance, data)
        return state.cardInstance
      }),
    },
    reviewEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.sessionId_submissionId) {
          return (
            state.reviewEvents.find(
              (e) =>
                e.sessionId === where.sessionId_submissionId.sessionId &&
                e.submissionId === where.sessionId_submissionId.submissionId,
            ) ?? null
          )
        }
        return null
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.NOT) return 0
        return (opts.priorTodayReviews ?? 0) + state.reviewEvents.length
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        if (
          data.submissionId &&
          state.reviewEvents.some((e) => e.sessionId === data.sessionId && e.submissionId === data.submissionId)
        ) {
          throw Object.assign(new Error('dup'), { code: 'P2002' })
        }
        const row = { id: `rev-${evSeq++}`, ...data }
        state.reviewEvents.push(row)
        return row
      }),
    },
    gameEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const k = where?.studentId_type_sourceId
        return (
          state.gameEvents.find(
            (e) => e.studentId === k.studentId && e.type === k.type && e.sourceId === k.sourceId,
          ) ?? null
        )
      }),
      findMany: vi.fn().mockResolvedValue([{ studentId: 'student-1', xp: 30, localDate: '2026-11-25' }]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        if (
          state.gameEvents.some(
            (e) => e.studentId === data.studentId && e.type === data.type && e.sourceId === data.sourceId,
          )
        ) {
          throw Object.assign(new Error('dup'), { code: 'P2002' })
        }
        const row = { id: `ge-${evSeq++}`, ...data }
        state.gameEvents.push(row)
        return row
      }),
    },
    studentGameProfile: {
      findUnique: vi.fn().mockImplementation(async () => state.profile),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(state.profile, data)
        return state.profile
      }),
      update: vi.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(state.profile, data)
        return state.profile
      }),
    },
    dailyGameState: {
      findUnique: vi.fn().mockImplementation(async () => state.dailyState),
      findMany: vi.fn().mockImplementation(async () => (state.dailyState ? [state.dailyState] : [])),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        state.dailyState = {
          xpEarned: 0,
          reviewDue: 0,
          reviewDone: 0,
          reviewedCardIds: [],
          levelsPassed: [],
          ringsClosed: false,
          weakBossDone: false,
          ...data,
        }
        return state.dailyState
      }),
      update: vi.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(state.dailyState, data)
        return state.dailyState
      }),
    },
    dailyStudyTask: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    studentBadge: {
      findMany: vi.fn().mockImplementation(async () => state.badges),
      count: vi.fn().mockImplementation(async () => state.badges.length),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        state.badges.push(data)
        return data
      }),
    },
    classChallenge: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null) },
    classGameSetting: {
      findUnique: vi.fn().mockResolvedValue({ classId: 'class-1', leaderboardOpen: opts.leaderboardOpen ?? false }),
    },
    teacherCheer: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  }

  return { prisma, state }
}

describe('Stage 3 gamification service & anti-cheat', () => {
  it('QA-G01: awards +5 XP for grade 3 and keeps submissionId replay idempotent', async () => {
    const { prisma, state } = createInMemoryGamePrisma()
    const first = await gradeCard(prisma, 'student-1', 'sess-1', 'inst-1', 3, 1200, NOW, 'sub-1')
    if ('error' in first) throw new Error(first.error)

    expect(first.reward?.xp).toBe(5)
    expect(state.gameEvents).toHaveLength(1)

    const replay = await gradeCard(prisma, 'student-1', 'sess-1', 'inst-1', 3, 1200, NOW, 'sub-1')
    if ('error' in replay) throw new Error(replay.error)

    expect(replay.reward?.xp).toBe(0)
    expect(replay.reward?.replayed).toBe(true)
    expect(state.gameEvents).toHaveLength(1)
  })

  it('QA-G02: enforces 2/day card cap and 0 XP for un-due cards', async () => {
    const { prisma: thirdPrisma } = createInMemoryGamePrisma({ priorTodayReviews: 2 })
    const thirdRes = await gradeCard(thirdPrisma, 'student-1', 'sess-1', 'inst-1', 4, 500, NOW, 'sub-3')
    if ('error' in thirdRes) throw new Error(thirdRes.error)
    expect(thirdRes.reward?.xp).toBe(0)

    const { prisma: unduePrisma } = createInMemoryGamePrisma({
      cardDue: new Date(NOW.getTime() + 86_400_000),
      cardState: 'REVIEW',
    })
    const undueRes = await gradeCard(unduePrisma, 'student-1', 'sess-1', 'inst-1', 4, 500, NOW, 'sub-undue')
    if ('error' in undueRes) throw new Error(undueRes.error)
    expect(undueRes.reward?.xp).toBe(0)
  })

  it('QA-G04: enforces daily 400 XP cap and sets capped=true', async () => {
    const { prisma, state } = createInMemoryGamePrisma({ initialDailyXp: 398 })
    const res = await gradeCard(prisma, 'student-1', 'sess-1', 'inst-1', 3, 800, NOW, 'sub-cap')
    if ('error' in res) throw new Error(res.error)

    expect(res.reward?.xp).toBe(2)
    expect(res.reward?.dailyXp).toBe(400)
    expect(res.reward?.capped).toBe(true)
    expect(state.profile.totalXp).toBe(400)
  })

  it('QA-G10: keeps historical bestStage on card lapse and counts 688 cards (D23 = 28)', async () => {
    const { prisma, state } = createInMemoryGamePrisma({
      cardState: 'REVIEW',
      cardStability: 0.7, // stage 3 (银箔卡)
      cardReps: 3,
      cardBestStage: 3,
    })

    const lapse = await gradeCard(prisma, 'student-1', 'sess-1', 'inst-1', 1, 900, NOW, 'sub-lapse')
    if ('error' in lapse) throw new Error(lapse.error)
    expect(state.cardInstance.bestStage).toBe(3)

    const albumD23 = await getCardAlbum(prisma, 'student-1', 'enr-1', 23)
    expect(albumD23?.summary.totalWords).toBe(688)
    expect(albumD23?.cards).toHaveLength(28)

    const albumD1 = await getCardAlbum(prisma, 'student-1', 'enr-1', 1)
    const makeCard = albumD1?.cards.find((c) => c.word === 'make')
    expect(makeCard?.rarity?.key).toBe('SILVER')
  })

  it('QA-G13: evaluates badges idempotently and exposes progress text for locked badges', async () => {
    const { prisma } = createInMemoryGamePrisma()
    const badges = await getStudentBadges(prisma, 'student-1', 'enr-1', NOW)
    expect(badges?.totalCount).toBeGreaterThanOrEqual(18)
    const streak3 = badges?.badges.find((b) => b.key === 'streak_3')
    expect(streak3?.earned).toBe(false)
    expect(streak3?.progressText).toContain('3')
  })

  it('QA-G18: leaderboard is disabled by default and never leaks real user.name when enabled', async () => {
    const { prisma: closedPrisma } = createInMemoryGamePrisma({ leaderboardOpen: false })
    const closed = await getClassLeaderboard(closedPrisma, 'student-1', 'enr-1', NOW)
    expect(closed?.enabled).toBe(false)
    expect(closed?.entries).toHaveLength(0)

    const { prisma: openPrisma } = createInMemoryGamePrisma({ leaderboardOpen: true })
    const open = await getClassLeaderboard(openPrisma, 'student-1', 'enr-1', NOW)
    expect(open?.enabled).toBe(true)
    expect(open?.entries[0].nickname).toBe('奶昔小张')
    expect(JSON.stringify(open)).not.toContain('张三真实姓名')
  })

  it('QA-G06: closes both rings when L1-L3 pass with 0 due reviews, awarding +30 XP and streak +1', async () => {
    const { prisma, state } = createInMemoryGamePrisma({ rawDueCount: 0 })
    state.dailyState = {
      studentId: 'student-1',
      localDate: '2026-11-25',
      xpEarned: 50,
      reviewDue: 0,
      reviewDone: 0,
      reviewedCardIds: [],
      levelsPassed: ['L1', 'L2'],
      ringsClosed: false,
      weakBossDone: false,
    }
    state.profile.totalXp = 50

    const session = {
      id: 'lvl-sess-l3',
      taskId: 'task-1',
      level: 'L3',
      attemptNo: 1,
      state: 'IN_PROGRESS',
      questionCount: 1,
      questions: [
        {
          id: 'q1',
          taskWordId: 'tw1',
          questionType: 'L3',
          prompt: '做',
          correctAnswer: 'make',
          acceptedAnswers: ['make'],
          attemptsUsed: 1,
          hintLevel: 0,
          firstTryCorrect: true,
          eventuallyCorrect: true,
          answerRevealed: false,
          answeredAt: NOW,
        },
      ],
      task: {
        id: 'task-1',
        enrollmentId: 'enr-1',
        studyDate: '2026-11-25',
        campDay: 1,
        status: 'ACTIVE',
        version: 1,
        config: { levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'] },
        enrollment: {
          studentId: 'student-1',
          classId: 'class-1',
          student: { userId: 'user-1' },
          deck: {
            id: 'deck-1',
            fsrsParams: { requestRetention: 0.9, maximumInterval: 36500, w: [], newCardsPerDay: 10 },
          },
        },
        words: [{ id: 'tw1', cardInstanceId: 'inst-1', cardId: 'card-1', kind: 'NEW', word: 'make', scheduledAt: null }],
        sessions: [],
      },
    }
    session.task.sessions = [session] as any

    prisma.levelSession = {
      findUnique: vi.fn().mockResolvedValue(session),
      update: vi.fn().mockResolvedValue({}),
    }
    prisma.dailyStudyTask = {
      findUnique: vi.fn().mockResolvedValue(session.task),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    }
    prisma.rewardEvent = {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    }

    const res = await completeLevel(prisma, 'student-1', 'lvl-sess-l3', NOW)
    if ('error' in res) throw new Error(res.error)

    expect(res.gameReward?.xp).toBe(20) // L3 clear
    expect(res.gameReward?.bonusXp).toBe(30) // dual rings closed!
    expect(res.gameReward?.ringsClosedJustNow).toBe(true)
    expect(res.gameReward?.streakDays).toBe(1)
    expect(res.gameReward?.level).toBe(2) // 50 + 20 + 30 = 100 XP -> Lv2!
    expect(res.gameReward?.levelUp).toEqual({ fromLevel: 1, toLevel: 2, newTitle: '香草学徒' })
  })

  it('QA-G11: computes 23-day camp map node stars (1★ -> 2★ -> 3★)', async () => {
    const { prisma } = createInMemoryGamePrisma()
    const day1Words = ZHONGKAO_23_DAYS[0].words.slice(0, 24).map((w) => w.word) // 24 words (80% of 30)
    prisma.dailyStudyTask.findMany.mockResolvedValue([
      {
        id: 't1',
        studyDate: '2026-11-25',
        campDay: 1,
        sessions: [{ level: 'L1' }, { level: 'L2' }, { level: 'L3' }, { level: 'BOSS' }],
      },
    ])
    prisma.cardInstance.findMany.mockResolvedValue(
      day1Words.map((word) => ({
        state: 'REVIEW',
        stability: 2.0, // stage >= 4
        reps: 4,
        bestStage: 5,
        card: { word },
      })),
    )

    const map = await getCampMap(prisma, 'student-1', 'enr-1')
    expect(map?.days[0]).toMatchObject({
      day: 1,
      status: 'CLEARED',
      stars: 3,
      stage4Count: 24,
      stage4Target: 24,
      isMajorBoss: false,
    })
    expect(map?.days[1].status).toBe('IN_PROGRESS')
    expect(map?.days[2].status).toBe('LOCKED')
    expect(map?.days[6].isMajorBoss).toBe(true)
    expect(map?.days[22].isFinale).toBe(true)
  })
})

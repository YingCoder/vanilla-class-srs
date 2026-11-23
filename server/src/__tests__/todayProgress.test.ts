import { describe, it, expect, vi } from 'vitest'
import { getTodayProgress } from '../services/todayProgress.service'

function makePrisma() {
  return {
    enrollment: {
      findFirst: vi.fn().mockResolvedValue({
        deck: { id: 'deck-1', fsrsParams: { newCardsPerDay: 12 } },
        student: { userId: 'user-1' },
      }),
    },
    cardInstance: {
      groupBy: vi.fn().mockResolvedValue([
        { state: 'NEW', _count: { _all: 3 } },
        { state: 'REVIEW', _count: { _all: 2 } },
        { state: 'LEARNING', _count: { _all: 1 } },
      ]),
      count: vi.fn().mockResolvedValue(4),
    },
    reviewEvent: {
      findMany: vi.fn().mockResolvedValue([
        { cardInstanceId: 'a' },
        { cardInstanceId: 'a' },
        { cardInstanceId: 'b' },
      ]),
    },
    rewardEvent: {
      groupBy: vi.fn().mockResolvedValue([
        { rewardType: 'XP', _sum: { amount: 30 } },
        { rewardType: 'COIN', _sum: { amount: 10 } },
      ]),
    },
  }
}

const NOW = new Date('2024-06-01T16:30:00Z') // Shanghai 2024-06-02 00:30

describe('getTodayProgress', () => {
  it('reports today activity, due counts and Shanghai day bounds', async () => {
    const prisma = makePrisma()
    const progress = await getTodayProgress(prisma as any, 'student-1', 'enrollment-1', NOW)

    expect(progress).toMatchObject({
      studyDate: '2024-06-02',
      dueNow: 6,
      newAvailable: 3,
      reviewsDue: 3,
      todayNewCards: 4,
      todayReviews: 3,
      todayDistinctCards: 2,
      targets: { newCards: 12, reviews: 10 },
      xpToday: 30,
      coinsToday: 10,
    })
    expect(prisma.reviewEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        reviewedAt: {
          gte: new Date('2024-06-01T16:00:00Z'),
          lt: new Date('2024-06-02T16:00:00Z'),
        },
      }),
    }))
  })

  it('returns null when the enrollment does not belong to the student', async () => {
    const prisma = makePrisma()
    prisma.enrollment.findFirst.mockResolvedValue(null)
    await expect(getTodayProgress(prisma as any, 'other', 'enrollment-1', NOW)).resolves.toBeNull()
  })

  it('falls back to 10 new cards when the deck has no valid target', async () => {
    const prisma = makePrisma()
    prisma.enrollment.findFirst.mockResolvedValue({
      deck: { id: 'deck-1', fsrsParams: {} },
      student: { userId: 'user-1' },
    })
    const progress = await getTodayProgress(prisma as any, 'student-1', 'enrollment-1', NOW)
    expect(progress?.targets.newCards).toBe(10)
  })
})
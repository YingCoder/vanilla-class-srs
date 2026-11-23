import { describe, it, expect, vi } from 'vitest'
import { getTodayRoster, shanghaiDayBounds } from '../services/todayRoster.service'

function makePrisma() {
  return {
    enrollment: {
      findMany: vi.fn().mockResolvedValue([
        {
          studentId: 's1',
          student: { user: { name: '张三', username: 'zhangsan' } },
          deck: { id: 'd1' },
        },
        {
          studentId: 's2',
          student: { user: { name: '李四', username: 'lisi' } },
          deck: { id: 'd2' },
        },
        {
          studentId: 's3',
          student: { user: { name: '王五', username: null } },
          deck: null,
        },
      ]),
    },
    reviewSession: {
      groupBy: vi.fn().mockResolvedValue([
        { deckId: 'd1', _sum: { cardsReviewed: 4 }, _max: { endedAt: new Date('2024-06-01T17:30:00Z') } },
      ]),
    },
  }
}

describe('shanghaiDayBounds', () => {
  it('starts at Shanghai midnight, not UTC midnight', () => {
    const { studyDate, dayStart, dayEnd } = shanghaiDayBounds(new Date('2024-06-01T16:30:00Z'))
    expect(studyDate).toBe('2024-06-02')
    expect(dayStart.toISOString()).toBe('2024-06-01T16:00:00.000Z')
    expect(dayEnd.toISOString()).toBe('2024-06-02T16:00:00.000Z')
  })

  it('keeps the previous study date one second before Shanghai midnight', () => {
    expect(shanghaiStudyDateAt('2024-06-01T15:59:59Z')).toBe('2024-06-01')
  })
})

function shanghaiStudyDateAt(iso: string): string {
  return shanghaiDayBounds(new Date(iso)).studyDate
}

describe('getTodayRoster', () => {
  it('separates studied and never-started students by reviewed cards', async () => {
    const prisma = makePrisma()
    const roster = await getTodayRoster(
      prisma as any,
      'class-1',
      new Date('2024-06-01T16:30:00Z'),
    )

    expect(prisma.reviewSession.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        deckId: { in: ['d1', 'd2'] },
        endedAt: {
          gte: new Date('2024-06-01T16:00:00Z'),
          lt: new Date('2024-06-02T16:00:00Z'),
        },
        cardsReviewed: { gt: 0 },
      }),
    }))
    expect(roster.studyDate).toBe('2024-06-02')
    expect(roster.totalStudents).toBe(3)
    expect(roster.studiedCount).toBe(1)
    expect(roster.studied.map((entry) => entry.studentId)).toEqual(['s1'])
    expect(roster.studied[0].reviewedCards).toBe(4)
    expect(roster.pending.map((entry) => entry.studentId)).toEqual(['s2', 's3'])
  })

  it('skips the session query when nobody has a deck', async () => {
    const prisma = makePrisma()
    prisma.enrollment.findMany.mockResolvedValue([
      { studentId: 's1', student: { user: { name: '张三', username: 'zhangsan' } }, deck: null },
    ])
    const roster = await getTodayRoster(prisma as any, 'class-1', new Date())
    expect(prisma.reviewSession.groupBy).not.toHaveBeenCalled()
    expect(roster.pending).toHaveLength(1)
  })
})
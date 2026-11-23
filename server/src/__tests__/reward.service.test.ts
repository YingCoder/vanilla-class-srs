import { describe, it, expect, vi } from 'vitest'
import { settleRewardsForUser, settleSessionRewards } from '../services/reward.service'
import { rewardEventKey } from '@vanilla-srs/shared/word-camp'

interface MakePrismaOptions {
  recorded?: { userId: string; rewardType: 'XP' | 'COIN'; eventKey: string }[]
  usage?: { rewardType: 'XP' | 'COIN'; _sum: { amount: number | null } }[]
  createError?: unknown
}

function makePrisma({ recorded = [], usage = [], createError }: MakePrismaOptions = {}) {
  return {
    rewardEvent: {
      findMany: vi.fn().mockResolvedValue(recorded),
      groupBy: vi.fn().mockResolvedValue(usage),
      create: vi.fn().mockImplementation(() => {
        if (createError) return Promise.reject(createError)
        return Promise.resolve({})
      }),
    },
  }
}

const wordCandidate = (userId: string, contextId = 'deck-1', wordId = 'word-1') => ({
  userId,
  rewardType: 'word_learned' as const,
  eventKey: rewardEventKey({ rewardType: 'word_learned' as const, contextId, wordId }),
})

describe('settleRewardsForUser', () => {
  it('awards the canonical word_learned amount once', async () => {
    const prisma = makePrisma()
    const result = await settleRewardsForUser(prisma as any, 'user-1', '2026-11-23', [wordCandidate('user-1')])

    expect(result.xp).toBe(10)
    expect(result.coins).toBe(0)
    expect(result.awarded).toHaveLength(1)
    expect(prisma.rewardEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        eventKey: 'word_learned:deck-1:word-1',
        rewardType: 'XP',
        amount: 10,
        studyDate: '2026-11-23',
      }),
    })
  })

  it('does not write an already-recorded event again', async () => {
    const prisma = makePrisma({
      recorded: [{ userId: 'user-1', rewardType: 'XP', eventKey: 'word_learned:deck-1:word-1' }],
    })
    const result = await settleRewardsForUser(prisma as any, 'user-1', '2026-11-23', [wordCandidate('user-1')])

    expect(result.xp).toBe(0)
    expect(prisma.rewardEvent.create).not.toHaveBeenCalled()
  })

  it('respects the remaining daily XP cap (clamp)', async () => {
    const prisma = makePrisma({
      usage: [{ rewardType: 'XP', _sum: { amount: 245 } }],
    })
    const result = await settleRewardsForUser(prisma as any, 'user-1', '2026-11-23', [wordCandidate('user-1')])

    expect(result.xp).toBe(5)
    expect(prisma.rewardEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 5 }),
    })
  })

  it('tolerates a duplicate-key race without failing the session', async () => {
    const prisma = makePrisma({ createError: Object.assign(new Error('duplicate'), { code: 'P2002' }) })
    const result = await settleRewardsForUser(prisma as any, 'user-1', '2026-11-23', [wordCandidate('user-1')])
    expect(result.awarded).toHaveLength(1)
    await expect(
      settleRewardsForUser(
        makePrisma({ createError: Object.assign(new Error('db down'), { code: 'P1001' }) }) as any,
        'user-1',
        '2026-11-23',
        [wordCandidate('user-1')],
      ),
    ).rejects.toThrow('db down')
  })
})

function makeSessionPrisma(priorSuccesses: number, grade = 3) {
  return {
    reviewSession: {
      findUnique: vi.fn().mockResolvedValue({
        deckId: 'deck-1',
        deck: { enrollment: { student: { userId: 'user-1' } } },
        events: [{ cardInstanceId: 'instance-1', grade, reviewedAt: new Date('2026-11-23T02:00:00Z') }],
      }),
    },
    cardInstance: { findUnique: vi.fn().mockResolvedValue({ cardId: 'card-1' }) },
    reviewEvent: {
      count: vi.fn().mockResolvedValue(priorSuccesses),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    rewardEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
  }
}

describe('settleSessionRewards', () => {
  it('awards word_learned for a first successful exposure', async () => {
    const prisma = makeSessionPrisma(0)
    const result = await settleSessionRewards(prisma as any, 'session-1', new Date('2026-11-23T02:00:00Z'))

    expect(result.xp).toBe(10)
    expect(result.awarded[0].eventKey).toBe('word_learned:deck-1:card-1')
  })

  it('awards review_ok for a later successful review, keyed by study date', async () => {
    const prisma = makeSessionPrisma(1)
    const result = await settleSessionRewards(prisma as any, 'session-1', new Date('2026-11-23T02:00:00Z'))

    expect(result.xp).toBe(5)
    expect(result.awarded[0].eventKey).toBe('review_ok:deck-1:card-1:2026-11-23')
  })

  it('awards nothing for a failed recall', async () => {
    const prisma = makeSessionPrisma(0, 1)
    const result = await settleSessionRewards(prisma as any, 'session-1', new Date('2026-11-23T02:00:00Z'))
    expect(result.awarded).toHaveLength(0)
    expect(result.xp).toBe(0)
  })
})
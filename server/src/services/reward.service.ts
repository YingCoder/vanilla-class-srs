/**
 * Reward ledger settlement.
 *
 * The database is the idempotency authority: `(userId, eventKey, rewardType)`
 * is unique, and every write tolerates a duplicate-key race by ignoring it.
 * Award amounts, event keys, daily caps and level thresholds come from the
 * pure helpers in `@vanilla-srs/shared/word-camp`, so the client never decides
 * a score.
 */

import { PrismaClient, RewardType as DbRewardType } from '@prisma/client'
import {
  settleDailyRewards,
  rewardEventKey,
  shanghaiStudyDate,
  levelForXp,
  type RewardCandidate,
  type RewardType,
} from '@vanilla-srs/shared/word-camp'

export interface RewardSettlement {
  studyDate: string
  xp: number
  coins: number
  awarded: { rewardType: RewardType; eventKey: string; xp: number; coins: number }[]
}

/** Award a set of already-validated candidates for one student and study date. */
export async function settleRewardsForUser(
  prisma: PrismaClient,
  userId: string,
  studyDate: string,
  candidates: RewardCandidate[],
): Promise<RewardSettlement> {
  if (candidates.length === 0) return { studyDate, xp: 0, coins: 0, awarded: [] }

  const eventKeys = [...new Set(candidates.map((candidate) => candidate.eventKey))]
  const [recordedRows, usageGroups] = await Promise.all([
    prisma.rewardEvent.findMany({
      where: { userId, eventKey: { in: eventKeys } },
      select: { userId: true, rewardType: true, eventKey: true },
    }),
    prisma.rewardEvent.groupBy({
      by: ['rewardType'],
      where: { userId, studyDate },
      _sum: { amount: true },
    }),
  ])

  const usage = {
    userId,
    xpEarned: usageGroups.find((row) => row.rewardType === DbRewardType.XP)?._sum.amount ?? 0,
    coinsEarned: usageGroups.find((row) => row.rewardType === DbRewardType.COIN)?._sum.amount ?? 0,
  }

  const result = settleDailyRewards({
    studyDate,
    candidates,
    recorded: recordedRows.map((row) => ({
      userId: row.userId,
      // RewardEvent.rewardType is the currency (XP/COIN); the pure helper
      // dedupes by business event type, which is the event key prefix.
      rewardType: row.eventKey.split(':')[0] as RewardType,
      eventKey: row.eventKey,
    })),
    usage: [usage],
    capOverflow: 'clamp',
  })

  let xp = 0
  let coins = 0
  const awarded: RewardSettlement['awarded'] = []

  for (const award of result.awards) {
    if (award.xp === 0 && award.coins === 0) continue

    const rows: { rewardType: DbRewardType; amount: number }[] = []
    if (award.xp > 0) rows.push({ rewardType: DbRewardType.XP, amount: award.xp })
    if (award.coins > 0) rows.push({ rewardType: DbRewardType.COIN, amount: award.coins })

    for (const row of rows) {
      try {
        await prisma.rewardEvent.create({
          data: {
            userId,
            eventKey: award.eventKey,
            rewardType: row.rewardType,
            amount: row.amount,
            reason: award.rewardType,
            studyDate,
          },
        })
      } catch (error: any) {
        // P2002 = unique violation: another request settled this exact award
        // first. It is already in the ledger, so this award is a no-op.
        if (error?.code !== 'P2002') throw error
      }
    }

    xp += award.xp
    coins += award.coins
    awarded.push({ rewardType: award.rewardType, eventKey: award.eventKey, xp: award.xp, coins: award.coins })
  }

  return { studyDate, xp, coins, awarded }
}

/**
 * Settle the rewards earned by one finished review session.
 *
 * A card's first successful exposure (grade >= 3 and no earlier review event)
 * earns `word_learned`; subsequent successful reviews earn `review_ok`, keyed
 * by the Shanghai study date so repeated same-day reviews remain one award.
 * Grade 1/2 ("Again"/"Hard", i.e. hinted or retried) earn nothing.
 */
export async function settleSessionRewards(
  prisma: PrismaClient,
  sessionId: string,
  now: Date = new Date(),
): Promise<RewardSettlement> {
  const session = await prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: {
      deck: { include: { enrollment: { include: { student: true } } } },
      events: { orderBy: { reviewedAt: 'asc' } },
    },
  })
  if (!session) return { studyDate: shanghaiStudyDate(now), xp: 0, coins: 0, awarded: [] }

  const studyDate = shanghaiStudyDate(now)
  const userId = session.deck.enrollment.student.userId
  const contextId = session.deckId

  // Only the first successful event per card counts; later retries in the same
  // session are not separate learning achievements.
  const firstSuccess = new Map<string, { cardId: string; reviewedAt: Date }>()
  for (const event of session.events) {
    if (event.grade < 3) continue
    const instance = await prisma.cardInstance.findUnique({
      where: { id: event.cardInstanceId },
      select: { cardId: true },
    })
    if (!instance) continue
    if (!firstSuccess.has(event.cardInstanceId)) {
      firstSuccess.set(event.cardInstanceId, { cardId: instance.cardId, reviewedAt: event.reviewedAt })
    }
  }

  const candidates: RewardCandidate[] = []
  for (const [instanceId, success] of firstSuccess) {
    const priorSuccesses = await prisma.reviewEvent.count({
      where: {
        cardInstanceId: instanceId,
        grade: { gte: 3 },
        reviewedAt: { lt: success.reviewedAt },
      },
    })

    if (priorSuccesses === 0) {
      candidates.push({
        userId,
        rewardType: 'word_learned',
        eventKey: rewardEventKey({ rewardType: 'word_learned', contextId, wordId: success.cardId }),
      })
    } else {
      candidates.push({
        userId,
        rewardType: 'review_ok',
        eventKey: rewardEventKey({
          rewardType: 'review_ok',
          contextId,
          wordId: success.cardId,
          cycleStartDate: studyDate,
        }),
      })
    }
  }

  return settleRewardsForUser(prisma, userId, studyDate, candidates)
}

export interface RewardSummary {
  totalXp: number
  coinBalance: number
  todayXp: number
  todayCoins: number
  studyDate: string
  level: ReturnType<typeof levelForXp>
  recent: {
    id: string
    eventKey: string
    rewardType: string
    amount: number
    reason: string
    studyDate: string
    createdAt: Date
  }[]
}

export async function getRewardSummary(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<RewardSummary> {
  const studyDate = shanghaiStudyDate(now)
  const [totalGroups, todayGroups, recent] = await Promise.all([
    prisma.rewardEvent.groupBy({
      by: ['rewardType'],
      where: { userId },
      _sum: { amount: true },
    }),
    prisma.rewardEvent.groupBy({
      by: ['rewardType'],
      where: { userId, studyDate },
      _sum: { amount: true },
    }),
    prisma.rewardEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        eventKey: true,
        rewardType: true,
        amount: true,
        reason: true,
        studyDate: true,
        createdAt: true,
      },
    }),
  ])

  const sum = (groups: typeof totalGroups, type: DbRewardType) =>
    groups.find((row) => row.rewardType === type)?._sum.amount ?? 0

  const totalXp = sum(totalGroups, DbRewardType.XP)
  return {
    totalXp,
    coinBalance: sum(totalGroups, DbRewardType.COIN),
    todayXp: sum(todayGroups, DbRewardType.XP),
    todayCoins: sum(todayGroups, DbRewardType.COIN),
    studyDate,
    level: levelForXp(totalXp),
    recent: recent.map((row) => ({ ...row, rewardType: row.rewardType.toLowerCase() })),
  }
}
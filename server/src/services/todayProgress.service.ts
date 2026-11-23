/**
 * Student-facing "today" progress.
 *
 * This reports measurable activity (cards first learned today, review events
 * today, cards currently due) against the default daily targets. It is not the
 * full Word Camp daily-task completion: that needs the L1–L5 + Boss flow, which
 * is not built yet, so `completed` is intentionally absent.
 */

import type { PrismaClient } from '@prisma/client'
import { shanghaiStudyDate } from '@vanilla-srs/shared/word-camp'

export interface TodayProgress {
  studyDate: string
  dueNow: number
  newAvailable: number
  reviewsDue: number
  todayNewCards: number
  todayReviews: number
  todayDistinctCards: number
  targets: { newCards: number; reviews: number }
  xpToday: number
  coinsToday: number
}

function shanghaiDayBounds(now: Date): { start: Date; end: Date; studyDate: string } {
  const studyDate = shanghaiStudyDate(now)
  const start = new Date(`${studyDate}T00:00:00+08:00`)
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), studyDate }
}

function newCardsPerDay(fsrsParams: unknown): number {
  const value = (fsrsParams as { newCardsPerDay?: unknown } | null)?.newCardsPerDay
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 10
}

export async function getTodayProgress(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
): Promise<TodayProgress | null> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, studentId, archivedAt: null },
    select: {
      deck: { select: { id: true, fsrsParams: true } },
      student: { select: { userId: true } },
    },
  })
  if (!enrollment?.deck) return null

  const { start, end, studyDate } = shanghaiDayBounds(now)
  const deckId = enrollment.deck.id
  const userId = enrollment.student.userId

  const [dueGroups, sessionGroups, newCardsToday, rewards] = await Promise.all([
    prisma.cardInstance.groupBy({
      by: ['state'],
      where: { deckId, due: { lte: now } },
      _count: { _all: true },
    }),
    prisma.reviewEvent.findMany({
      where: {
        cardInstance: { deckId },
        reviewedAt: { gte: start, lt: end },
      },
      select: { cardInstanceId: true },
    }),
    prisma.cardInstance.count({
      where: { deckId, reps: 1, lastReview: { gte: start, lt: end } },
    }),
    prisma.rewardEvent.groupBy({
      by: ['rewardType'],
      where: { userId, createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
  ])

  let newAvailable = 0
  let reviewsDue = 0
  for (const group of dueGroups) {
    if (group.state === 'NEW') newAvailable += group._count._all
    else reviewsDue += group._count._all
  }

  const targetNew = newCardsPerDay(enrollment.deck.fsrsParams)
  const xpToday = rewards.find((row) => row.rewardType === 'XP')?._sum.amount ?? 0
  const coinsToday = rewards.find((row) => row.rewardType === 'COIN')?._sum.amount ?? 0

  return {
    studyDate,
    dueNow: newAvailable + reviewsDue,
    newAvailable,
    reviewsDue,
    todayNewCards: newCardsToday,
    todayReviews: sessionGroups.length,
    todayDistinctCards: new Set(sessionGroups.map((event) => event.cardInstanceId)).size,
    targets: { newCards: targetNew, reviews: 10 },
    xpToday,
    coinsToday,
  }
}
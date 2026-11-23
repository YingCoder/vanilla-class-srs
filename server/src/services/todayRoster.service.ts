/**
 * Today's class roster status, used by the teacher/admin "今日未完成" list.
 *
 * Scope of the claim: a student counts as "已学习" when they have at least one
 * finished review session today (Asia/Shanghai calendar day) with more than
 * zero reviewed cards. This is activity, not full Word Camp daily-task
 * completion (that requires the L1–L5 + Boss flow, not built yet), so the UI
 * labels it 今日已学习 / 今日未学习 rather than claiming task completion.
 */

import type { PrismaClient } from '@prisma/client'
import { shanghaiStudyDate } from '@vanilla-srs/shared/word-camp'

export interface TodayRosterEntry {
  studentId: string
  name: string
  username: string | null
  reviewedCards: number
  lastEndedAt: string | null
}

export interface TodayRoster {
  studyDate: string
  dayStart: string
  dayEnd: string
  totalStudents: number
  studiedCount: number
  pending: TodayRosterEntry[]
  studied: TodayRosterEntry[]
}

/** UTC bounds of a Shanghai calendar day, expressed as ISO strings. */
export function shanghaiDayBounds(now: Date): { studyDate: string; dayStart: Date; dayEnd: Date } {
  const studyDate = shanghaiStudyDate(now)
  const dayStart = new Date(`${studyDate}T00:00:00+08:00`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  return { studyDate, dayStart, dayEnd }
}

export async function getTodayRoster(
  prisma: PrismaClient,
  classId: string,
  now: Date = new Date(),
): Promise<TodayRoster> {
  const { studyDate, dayStart, dayEnd } = shanghaiDayBounds(now)

  const enrollments = await prisma.enrollment.findMany({
    where: { classId, archivedAt: null },
    select: {
      studentId: true,
      student: { select: { user: { select: { name: true, username: true } } } },
      deck: { select: { id: true } },
    },
    orderBy: { joinedAt: 'asc' },
  })

  const deckToStudent = new Map<string, string>()
  for (const enrollment of enrollments) {
    if (enrollment.deck) deckToStudent.set(enrollment.deck.id, enrollment.studentId)
  }

  const sessions = deckToStudent.size === 0
    ? []
    : await prisma.reviewSession.groupBy({
        by: ['deckId'],
        where: {
          deckId: { in: [...deckToStudent.keys()] },
          endedAt: { gte: dayStart, lt: dayEnd },
          cardsReviewed: { gt: 0 },
        },
        _sum: { cardsReviewed: true },
        _max: { endedAt: true },
      })

  const progress = new Map<string, { reviewedCards: number; lastEndedAt: Date | null }>()
  for (const session of sessions) {
    const studentId = deckToStudent.get(session.deckId)
    if (!studentId) continue
    progress.set(studentId, {
      reviewedCards: session._sum.cardsReviewed ?? 0,
      lastEndedAt: session._max.endedAt ?? null,
    })
  }

  const studied: TodayRosterEntry[] = []
  const pending: TodayRosterEntry[] = []
  for (const enrollment of enrollments) {
    const entry: TodayRosterEntry = {
      studentId: enrollment.studentId,
      name: enrollment.student.user.name,
      username: enrollment.student.user.username,
      reviewedCards: progress.get(enrollment.studentId)?.reviewedCards ?? 0,
      lastEndedAt: progress.get(enrollment.studentId)?.lastEndedAt?.toISOString() ?? null,
    }
    if (entry.reviewedCards > 0) studied.push(entry)
    else pending.push(entry)
  }

  return {
    studyDate,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    totalStudents: enrollments.length,
    studiedCount: studied.length,
    pending,
    studied,
  }
}
/**
 * R8 Weekly Teacher Report Service.
 *
 * Generates & archives weekly class reports (scheduled Mondays 07:00 Asia/Shanghai
 * or on-demand), including:
 *  - Core metrics vs previous week
 *  - Top 3 most-improved students (delta XP matching F9 privacy/metric rules)
 *  - Staff-only falling-behind list
 *  - Rule-based GAME_CONFIG tuning suggestions (never auto-mutates config!)
 */

import type { PrismaClient, Role } from '@prisma/client'
import {
  addCalendarDays,
  diffCalendarDays,
  shanghaiTimeParts,
} from '@vanilla-srs/shared/gamification'
import { generateWeeklyConfigAdvice } from '@vanilla-srs/shared/stage4'
import { computeClassEffectMetricsCore } from './analytics.service'
import { verifyClassManagerAccess } from './teacherGame.service'

export async function generateClassWeeklyReport(
  prisma: PrismaClient,
  classId: string,
  targetWeekStart?: string,
  now: Date = new Date(),
) {
  const { localDate, weekStart: currentWeekStart } = shanghaiTimeParts(now)
  const weekStart = targetWeekStart || currentWeekStart
  const weekEnd = addCalendarDays(weekStart, 6)
  const prevWeekStart = addCalendarDays(weekStart, -7)
  const prevWeekEnd = addCalendarDays(weekStart, -1)

  const [cls, enrollments, effectData] = await Promise.all([
    prisma.class.findUnique({
      where: { id: classId },
      include: { subjectGrade: { select: { name: true } } },
    }),
    prisma.enrollment.findMany({
      where: { classId, archivedAt: null },
      include: {
        student: {
          include: {
            user: { select: { name: true, username: true } },
            gameProfile: { select: { nickname: true, streakDays: true, lastAchievedDate: true, lastStudiedDate: true } },
          },
        },
      },
    }),
    computeClassEffectMetricsCore(prisma, classId, 2, now),
  ])

  const studentIds = enrollments.map((e) => e.studentId)
  const events =
    studentIds.length > 0
      ? await prisma.gameEvent.findMany({
          where: {
            studentId: { in: studentIds },
            localDate: { gte: prevWeekStart, lte: weekEnd },
          },
          select: { studentId: true, xp: true, localDate: true },
        })
      : []

  const thisWeekXp = new Map<string, number>()
  const prevWeekXp = new Map<string, number>()
  for (const ev of events) {
    if (ev.localDate >= weekStart && ev.localDate <= weekEnd) {
      thisWeekXp.set(ev.studentId, (thisWeekXp.get(ev.studentId) ?? 0) + ev.xp)
    } else if (ev.localDate >= prevWeekStart && ev.localDate <= prevWeekEnd) {
      prevWeekXp.set(ev.studentId, (prevWeekXp.get(ev.studentId) ?? 0) + ev.xp)
    }
  }

  const topImproved = enrollments
    .map((e) => {
      const cur = thisWeekXp.get(e.studentId) ?? 0
      const prev = prevWeekXp.get(e.studentId) ?? 0
      return {
        studentId: e.studentId,
        name: e.student.user.name,
        nickname: e.student.gameProfile?.nickname ?? null,
        thisWeekXp: cur,
        prevWeekXp: prev,
        deltaXp: cur - prev,
      }
    })
    .sort((a, b) => b.deltaXp - a.deltaXp || b.thisWeekXp - a.thisWeekXp)
    .slice(0, 3)

  const atRiskStudents: Array<{
    studentId: string
    name: string
    username: string | null
    daysInactive: number
    lastStudiedDate: string | null
  }> = []

  for (const e of enrollments) {
    const profile = e.student.gameProfile
    const lastDate = profile?.lastAchievedDate ?? profile?.lastStudiedDate ?? null
    const daysInactive = lastDate
      ? Math.max(0, diffCalendarDays(lastDate, localDate))
      : Math.max(0, diffCalendarDays(e.joinedAt.toISOString().slice(0, 10), localDate))
    if (daysInactive >= 3) {
      atRiskStudents.push({
        studentId: e.studentId,
        name: e.student.user.name,
        username: e.student.user.username,
        daysInactive,
        lastStudiedDate: lastDate,
      })
    }
  }
  atRiskStudents.sort((a, b) => b.daysInactive - a.daysInactive)

  const trends = effectData.weeklyTrends
  const currentMetrics = trends[trends.length - 1] ?? {
    weeklyActiveDaysAvg: effectData.summary.weeklyActiveDaysAvg,
    dueCompletionRate: effectData.summary.dueCompletionRate,
    dualRingCloseRate: effectData.summary.dualRingCloseRate,
    retention7dRate: effectData.summary.retention7dRate,
    xpCapHitRate: effectData.summary.xpCapHitRate,
    gamificationOptOutRate: effectData.summary.gamificationOptOutRate,
  }
  const previousMetrics = trends.length >= 2 ? trends[trends.length - 2] : null

  const advice = generateWeeklyConfigAdvice({
    xpCapHitRate: currentMetrics.xpCapHitRate,
    dueCompletionRate: currentMetrics.dueCompletionRate,
    dualRingCloseRate: currentMetrics.dualRingCloseRate,
    retention7dRate: currentMetrics.retention7dRate,
    gamificationOptOutRate: currentMetrics.gamificationOptOutRate,
    atRiskCount: atRiskStudents.length,
    totalStudents: enrollments.length,
  })

  const payload = {
    classInfo: {
      id: classId,
      name: cls?.name ?? '',
      subjectGradeName: cls?.subjectGrade?.name ?? '',
    },
    weekStart,
    weekEnd,
    generatedAt: now.toISOString(),
    totalStudents: enrollments.length,
    metrics: currentMetrics,
    previousMetrics,
    delta: previousMetrics
      ? {
          weeklyActiveDaysAvg: Math.round((currentMetrics.weeklyActiveDaysAvg - previousMetrics.weeklyActiveDaysAvg) * 100) / 100,
          dueCompletionRate: Math.round((currentMetrics.dueCompletionRate - previousMetrics.dueCompletionRate) * 1000) / 1000,
          dualRingCloseRate: Math.round((currentMetrics.dualRingCloseRate - previousMetrics.dualRingCloseRate) * 1000) / 1000,
          retention7dRate: Math.round((currentMetrics.retention7dRate - previousMetrics.retention7dRate) * 1000) / 1000,
        }
      : null,
    topImproved,
    atRiskStudents,
    advice,
    activeConfigVersion: effectData.activeConfigVersion,
  }

  const saved = await prisma.weeklyReport.upsert({
    where: { classId_weekStart: { classId, weekStart } },
    create: { classId, weekStart, payload: payload as any, generatedAt: now },
    update: { payload: payload as any, generatedAt: now },
  })

  return saved
}

export async function getTeacherWeeklyReport(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  classId: string,
  weekParam?: string,
  now: Date = new Date(),
) {
  await verifyClassManagerAccess(prisma, userId, role, classId)
  const { weekStart: currentWeekStart } = shanghaiTimeParts(now)
  const weekStart = weekParam?.trim() || currentWeekStart

  const [archivedWeeks, existing] = await Promise.all([
    prisma.weeklyReport.findMany({
      where: { classId },
      orderBy: { weekStart: 'desc' },
      take: 16,
      select: { weekStart: true, generatedAt: true },
    }),
    prisma.weeklyReport.findUnique({
      where: { classId_weekStart: { classId, weekStart } },
    }),
  ])

  const report =
    existing && weekStart < currentWeekStart
      ? existing
      : await generateClassWeeklyReport(prisma, classId, weekStart, now)

  return {
    report,
    availableWeeks: archivedWeeks.some((w) => w.weekStart === weekStart)
      ? archivedWeeks
      : [{ weekStart, generatedAt: report.generatedAt }, ...archivedWeeks],
  }
}

export async function generateAllClassWeeklyReports(
  prisma: PrismaClient,
  now: Date = new Date(),
) {
  const { weekStart } = shanghaiTimeParts(now)
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true },
  })
  const generated = []
  for (const c of classes) {
    const r = await generateClassWeeklyReport(prisma, c.id, weekStart, now)
    generated.push({ classId: c.id, className: c.name, weekStart: r.weekStart })
  }
  return generated
}

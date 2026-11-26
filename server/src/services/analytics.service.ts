/**
 * R2 Analytics & Effect Dashboard Service.
 *
 * Strictly separated from the GameEvent reward ledger:
 *  - `AnalyticsEvent` records user behavior idempotently via `(studentId, clientEventId)`.
 *  - Never stores device fingerprints or raw IP addresses.
 *  - Shared single implementation used by both `/api/teachers/game/effect` and
 *    `/api/admin/game/effect` so metrics never drift across roles.
 */

import type { PrismaClient, Role } from '@prisma/client'
import {
  addCalendarDays,
  ringProgress,
  shanghaiDateString,
  shanghaiTimeParts,
} from '@vanilla-srs/shared/gamification'
import { ANALYTICS_EVENT_TYPES } from '@vanilla-srs/shared/stage4'
import { getZhongkaoCoverageStats } from '@vanilla-srs/shared/vocab'
import { verifyClassManagerAccess } from './teacherGame.service'
import { getEffectiveGameConfig } from './gameConfig.service'

const DISALLOWED_PROP_KEYS = new Set([
  'fingerprint',
  'devicefingerprint',
  'deviceid',
  'imei',
  'mac',
  'idfa',
  'ip',
  'ipaddress',
  'useragent',
])

export function sanitizeAnalyticsProps(props: unknown): Record<string, unknown> | null {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (DISALLOWED_PROP_KEYS.has(k.trim().toLowerCase())) continue
    if (typeof v === 'string' && v.length > 200) {
      out[k] = v.slice(0, 200)
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

export interface IngestAnalyticsItem {
  clientEventId: string
  type: string
  classId?: string | null
  enrollmentId?: string | null
  props?: unknown
  occurredAt?: string | Date
}

export async function ingestAnalyticsEvents(
  prisma: PrismaClient,
  studentId: string,
  items: IngestAnalyticsItem[],
  clientVersion?: string | null,
  now: Date = new Date(),
): Promise<{ accepted: number; deduplicated: number }> {
  if (items.length === 0) return { accepted: 0, deduplicated: 0 }

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, archivedAt: null },
    select: { id: true, classId: true },
  })
  const allowedClassIds = new Set(enrollments.map((e) => e.classId))
  const classByEnrollment = new Map(enrollments.map((e) => [e.id, e.classId]))
  const defaultClassId = enrollments[0]?.classId ?? null

  const allowedTypes = new Set<string>(ANALYTICS_EVENT_TYPES)
  const rows: Array<{
    studentId: string
    classId: string | null
    clientEventId: string
    type: string
    props: any
    clientVersion: string | null
    occurredAt: Date
    dayKey: string
  }> = []

  const seenClientIds = new Set<string>()
  for (const item of items) {
    const cid = item.clientEventId?.trim()
    if (!cid || seenClientIds.has(cid)) continue
    seenClientIds.add(cid)

    if (!allowedTypes.has(item.type)) continue
    const occurred = item.occurredAt ? new Date(item.occurredAt) : now
    const safeOccurred = Number.isNaN(occurred.getTime()) ? now : occurred
    const dayKey = shanghaiDateString(safeOccurred)

    let resolvedClassId = item.enrollmentId ? (classByEnrollment.get(item.enrollmentId) ?? null) : null
    if (!resolvedClassId && item.classId && allowedClassIds.has(item.classId)) {
      resolvedClassId = item.classId
    }
    if (!resolvedClassId) resolvedClassId = defaultClassId

    rows.push({
      studentId,
      classId: resolvedClassId,
      clientEventId: cid,
      type: item.type,
      props: sanitizeAnalyticsProps(item.props) as any,
      clientVersion: clientVersion?.slice(0, 40) ?? null,
      occurredAt: safeOccurred,
      dayKey,
    })
  }

  if (rows.length === 0) return { accepted: 0, deduplicated: items.length }

  const result = await prisma.analyticsEvent.createMany({
    data: rows,
    skipDuplicates: true,
  })
  return {
    accepted: result.count,
    deduplicated: items.length - result.count,
  }
}

export async function recordServerAnalyticsEvent(
  prisma: PrismaClient,
  params: {
    studentId: string
    classId?: string | null
    type: (typeof ANALYTICS_EVENT_TYPES)[number]
    clientEventId: string
    props?: Record<string, unknown>
    clientVersion?: string | null
    now?: Date
  },
): Promise<void> {
  try {
    if (!(prisma as any)?.analyticsEvent?.createMany) return
    const when = params.now ?? new Date()
    await prisma.analyticsEvent.createMany({
      data: [
        {
          studentId: params.studentId,
          classId: params.classId ?? null,
          clientEventId: params.clientEventId,
          type: params.type,
          props: sanitizeAnalyticsProps(params.props) as any,
          clientVersion: params.clientVersion ?? 'server',
          occurredAt: when,
          dayKey: shanghaiDateString(when),
        },
      ],
      skipDuplicates: true,
    })
  } catch {
    /* analytics must never break core grading/session transactions */
  }
}

export interface WeeklyEffectPoint {
  weekStart: string
  label: string
  weeklyActiveDaysAvg: number
  dueCompletionRate: number
  dualRingCloseRate: number
  retention7dRate: number
  xpCapHitRate: number
  gamificationOptOutRate: number
  activeStudents: number
}

export interface ClassEffectDashboardData {
  classInfo: { id: string; name: string; subjectGradeName: string }
  asOfDate: string
  weeks: number
  totalStudents: number
  activeConfigVersion: string
  activeConfigScope: unknown
  summary: {
    weeklyActiveDaysAvg: number
    dueCompletionRate: number
    dualRingCloseRate: number
    todayDualRingCloseRate: number
    retention7dRate: number
    reminderRecallRate: number
    mnemonicCoverageRate: number
    xpCapHitRate: number
    gamificationOptOutRate: number
  }
  weeklyTrends: WeeklyEffectPoint[]
  funnel: {
    appOpen: number
    reviewStart: number
    reviewRingClosed: number
    levelRingClosed: number
    dualRingClosed: number
  }
  badgeDistribution: Array<{ key: string; name: string; icon: string; earnedCount: number }>
  bossParticipationRate: number
  challengeParticipationRate: number
}

export async function computeClassEffectMetricsCore(
  prisma: PrismaClient,
  classId: string,
  weeks: number = 8,
  now: Date = new Date(),
): Promise<ClassEffectDashboardData> {
  const safeWeeks = Math.max(1, Math.min(16, Math.floor(weeks)))
  const { localDate: todayDate, weekStart: currentWeekStart } = shanghaiTimeParts(now)
  const oldestWeekStart = addCalendarDays(currentWeekStart, -7 * (safeWeeks - 1))

  const [cls, enrollments, effectiveCfg, approvedMnemonicWords] = await Promise.all([
    prisma.class.findUnique({
      where: { id: classId },
      include: { subjectGrade: { select: { name: true } } },
    }),
    prisma.enrollment.findMany({
      where: { classId, archivedAt: null },
      select: {
        studentId: true,
        deck: { select: { id: true } },
        student: {
          select: {
            gameProfile: { select: { reduceMotion: true, soundEnabled: true, lowSpecMode: true } },
          },
        },
      },
    }),
    getEffectiveGameConfig(prisma, classId),
    (prisma as any).mnemonicEntry?.findMany
      ? prisma.mnemonicEntry.findMany({
          where: { status: 'APPROVED' },
          select: { word: true },
        })
      : Promise.resolve([]),
  ])

  const studentIds = [...new Set(enrollments.map((e) => e.studentId))]
  const deckIds = enrollments.map((e) => e.deck?.id).filter((id): id is string => Boolean(id))
  const totalStudents = studentIds.length

  // Mnemonic coverage rate (R4)
  const zkStats = getZhongkaoCoverageStats()
  const coveredWordsSet = new Set<string>()
  const { lookupZhongkaoWord } = await import('@vanilla-srs/shared/vocab')
  const { ZHONGKAO_23_DAYS } = await import('@vanilla-srs/shared/vocab')
  for (const d of ZHONGKAO_23_DAYS) {
    for (const w of d.words) {
      if (w.mnemonic) coveredWordsSet.add(w.word.trim().toLowerCase())
    }
  }
  for (const m of approvedMnemonicWords as Array<{ word: string }>) {
    const key = m.word.trim().toLowerCase()
    if (lookupZhongkaoWord(key)) coveredWordsSet.add(key)
  }
  const mnemonicCoverageRate =
    zkStats.totalWords > 0 ? Math.min(1, coveredWordsSet.size / zkStats.totalWords) : 0

  if (totalStudents === 0) {
    return {
      classInfo: {
        id: classId,
        name: cls?.name ?? '',
        subjectGradeName: cls?.subjectGrade?.name ?? '',
      },
      asOfDate: todayDate,
      weeks: safeWeeks,
      totalStudents: 0,
      activeConfigVersion: effectiveCfg.configVersion,
      activeConfigScope: effectiveCfg.scope,
      summary: {
        weeklyActiveDaysAvg: 0,
        dueCompletionRate: 0,
        dualRingCloseRate: 0,
        todayDualRingCloseRate: 0,
        retention7dRate: 0,
        reminderRecallRate: 0,
        mnemonicCoverageRate,
        xpCapHitRate: 0,
        gamificationOptOutRate: 0,
      },
      weeklyTrends: [],
      funnel: { appOpen: 0, reviewStart: 0, reviewRingClosed: 0, levelRingClosed: 0, dualRingClosed: 0 },
      badgeDistribution: effectiveCfg.config.badges.map((b) => ({
        key: b.key,
        name: b.name,
        icon: b.icon,
        earnedCount: 0,
      })),
      bossParticipationRate: 0,
      challengeParticipationRate: 0,
    }
  }

  const [
    dailyStates,
    gameEvents,
    analyticsEvents,
    reviewEvents,
    badges,
    reminderLogs,
    reviewSessions,
  ] = await Promise.all([
    prisma.dailyGameState.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        studentId: true,
        localDate: true,
        xpEarned: true,
        reviewDue: true,
        reviewDone: true,
        levelsPassed: true,
        ringsClosed: true,
        weakBossDone: true,
      },
    }),
    prisma.gameEvent.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, type: true, localDate: true, xp: true, createdAt: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, type: true, dayKey: true, props: true, occurredAt: true },
    }),
    deckIds.length > 0
      ? prisma.reviewEvent.findMany({
          where: { session: { deckId: { in: deckIds } } },
          select: { reviewedAt: true, session: { select: { deck: { select: { enrollment: { select: { studentId: true } } } } } } },
        })
      : Promise.resolve([]),
    prisma.studentBadge.findMany({
      where: { studentId: { in: studentIds } },
      select: { badgeKey: true, studentId: true },
    }),
    prisma.reminderLog.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, sentAt: true, openedAt: true, localDate: true },
    }),
    deckIds.length > 0
      ? prisma.reviewSession.findMany({
          where: { deckId: { in: deckIds }, startedAt: { gte: new Date(`${currentWeekStart}T00:00:00+08:00`) } },
          select: { deck: { select: { enrollment: { select: { studentId: true } } } } },
        })
      : Promise.resolve([]),
  ])

  // Build per-student sets of grade-submission dates and any-activity dates/timestamps
  const gradeDatesByStudent = new Map<string, Set<string>>()
  const allActivityDatesByStudent = new Map<string, Set<string>>()
  const allActivityTimesByStudent = new Map<string, number[]>()

  const markActivity = (studentId: string, dayKey: string, ts?: Date, isGrade = false) => {
    if (!allActivityDatesByStudent.has(studentId)) allActivityDatesByStudent.set(studentId, new Set())
    allActivityDatesByStudent.get(studentId)!.add(dayKey)
    if (ts) {
      if (!allActivityTimesByStudent.has(studentId)) allActivityTimesByStudent.set(studentId, [])
      allActivityTimesByStudent.get(studentId)!.push(ts.getTime())
    }
    if (isGrade) {
      if (!gradeDatesByStudent.has(studentId)) gradeDatesByStudent.set(studentId, new Set())
      gradeDatesByStudent.get(studentId)!.add(dayKey)
    }
  }

  for (const ev of gameEvents) {
    markActivity(ev.studentId, ev.localDate, ev.createdAt, ev.type === 'REVIEW_GRADE')
  }
  for (const a of analyticsEvents) {
    const isStudy = a.type === 'grade_submit' || a.type === 'level_complete' || a.type === 'review_start'
    if (isStudy) {
      markActivity(a.studentId, a.dayKey, a.occurredAt, a.type === 'grade_submit')
    }
  }
  for (const re of reviewEvents as any[]) {
    const sid = re.session?.deck?.enrollment?.studentId
    if (!sid) continue
    markActivity(sid, shanghaiDateString(re.reviewedAt), re.reviewedAt, true)
  }

  // Compute global first-study date for 7-day retention
  const firstStudyByStudent = new Map<string, string>()
  for (const [sid, dates] of allActivityDatesByStudent.entries()) {
    const sorted = [...dates].sort()
    if (sorted[0]) firstStudyByStudent.set(sid, sorted[0])
  }

  function computeRetention7d(asOf: string): number {
    let cohort = 0
    let retained = 0
    for (const [sid, d0] of firstStudyByStudent.entries()) {
      const targetDay7 = addCalendarDays(d0, 7)
      if (targetDay7 <= asOf) {
        cohort += 1
        const dates = allActivityDatesByStudent.get(sid)
        if (dates?.has(targetDay7)) {
          retained += 1
        }
      }
    }
    return cohort > 0 ? retained / cohort : 0
  }

  // Explicit gamification opt-outs (reduceMotion or explicit setting toggle off)
  const explicitOptOutStudents = new Set<string>()
  for (const enr of enrollments) {
    if (enr.student.gameProfile?.reduceMotion) {
      explicitOptOutStudents.add(enr.studentId)
    }
  }
  for (const a of analyticsEvents) {
    if (a.type === 'game_setting_toggle' && a.props && typeof a.props === 'object') {
      const p = a.props as { enabled?: boolean; value?: boolean }
      if (p.enabled === false || p.value === false) {
        explicitOptOutStudents.add(a.studentId)
      } else if (p.enabled === true || p.value === true) {
        explicitOptOutStudents.delete(a.studentId)
      }
    }
  }

  const dailyCap = effectiveCfg.config.dailyXpCap

  // Weekly trends (oldest -> newest)
  const weeklyTrends: WeeklyEffectPoint[] = []
  for (let i = 0; i < safeWeeks; i++) {
    const wStart = addCalendarDays(oldestWeekStart, i * 7)
    const wEnd = addCalendarDays(wStart, 6)
    const asOfForWeek = wEnd < todayDate ? wEnd : todayDate

    let activeStudentDays = 0
    const activeStudentsInWeek = new Set<string>()
    for (const sid of studentIds) {
      const dates = gradeDatesByStudent.get(sid)
      if (!dates) continue
      for (const d of dates) {
        if (d >= wStart && d <= wEnd) {
          activeStudentDays += 1
          activeStudentsInWeek.add(sid)
        }
      }
    }

    const weekDailyRows = dailyStates.filter((ds) => ds.localDate >= wStart && ds.localDate <= wEnd)
    let sumDue = 0
    let sumDone = 0
    let capHits = 0
    const activeDatesWithDaily = new Set<string>()
    let ringsClosedInstances = 0

    for (const ds of weekDailyRows) {
      activeDatesWithDaily.add(ds.localDate)
      sumDue += ds.reviewDue
      sumDone += ds.reviewDue > 0 ? Math.min(ds.reviewDone, ds.reviewDue) : 0
      if (ds.xpEarned >= dailyCap) capHits += 1
      if (ds.ringsClosed) ringsClosedInstances += 1
    }

    const activeDaysCount = Math.max(1, activeDatesWithDaily.size)
    const dualRingCloseRate =
      weekDailyRows.length > 0 ? Math.min(1, ringsClosedInstances / (totalStudents * activeDaysCount)) : 0

    weeklyTrends.push({
      weekStart: wStart,
      label: wStart.slice(5),
      weeklyActiveDaysAvg: Math.round((activeStudentDays / totalStudents) * 100) / 100,
      dueCompletionRate: sumDue > 0 ? Math.round((sumDone / sumDue) * 1000) / 1000 : 0,
      dualRingCloseRate: Math.round(dualRingCloseRate * 1000) / 1000,
      retention7dRate: Math.round(computeRetention7d(asOfForWeek) * 1000) / 1000,
      xpCapHitRate: weekDailyRows.length > 0 ? Math.round((capHits / weekDailyRows.length) * 1000) / 1000 : 0,
      gamificationOptOutRate: Math.round((explicitOptOutStudents.size / totalStudents) * 1000) / 1000,
      activeStudents: activeStudentsInWeek.size,
    })
  }

  const latestWeek = weeklyTrends[weeklyTrends.length - 1]
  const todayRows = dailyStates.filter((d) => d.localDate === todayDate)
  const todayDualRingCloseRate =
    totalStudents > 0
      ? Math.round((todayRows.filter((r) => r.ringsClosed).length / totalStudents) * 1000) / 1000
      : 0

  // Reminder recall rate (24h window)
  let reminderSentCount = reminderLogs.length
  let reminderRecalledCount = 0
  for (const log of reminderLogs) {
    const sentMs = log.sentAt.getTime()
    const windowEnd = sentMs + 86_400_000
    const openedWithin24h = log.openedAt && log.openedAt.getTime() >= sentMs && log.openedAt.getTime() <= windowEnd
    const studiedWithin24h = (allActivityTimesByStudent.get(log.studentId) ?? []).some(
      (ts) => ts >= sentMs && ts <= windowEnd,
    )
    if (openedWithin24h || studiedWithin24h) reminderRecalledCount += 1
  }
  const reminderRecallRate =
    reminderSentCount > 0 ? Math.round((reminderRecalledCount / reminderSentCount) * 1000) / 1000 : 0

  // Current week Funnel: 打开 -> 开始复习 -> 复习环合拢 -> 闯关环合拢
  const weekEnd = addCalendarDays(currentWeekStart, 6)
  const openSet = new Set<string>()
  const reviewStartSet = new Set<string>()
  const reviewRingSet = new Set<string>()
  const levelRingSet = new Set<string>()
  const dualRingSet = new Set<string>()

  for (const a of analyticsEvents) {
    if (a.dayKey < currentWeekStart || a.dayKey > weekEnd) continue
    if (a.type === 'app_open') openSet.add(a.studentId)
    if (a.type === 'review_start' || a.type === 'grade_submit') {
      openSet.add(a.studentId)
      reviewStartSet.add(a.studentId)
    }
  }
  for (const rs of reviewSessions as any[]) {
    const sid = rs.deck?.enrollment?.studentId
    if (sid) {
      openSet.add(sid)
      reviewStartSet.add(sid)
    }
  }
  for (const ds of dailyStates) {
    if (ds.localDate < currentWeekStart || ds.localDate > weekEnd) continue
    const rp = ringProgress({
      reviewDue: ds.reviewDue,
      reviewDone: ds.reviewDone,
      levelsPassed: ds.levelsPassed,
    })
    if (rp.reviewClosed && (ds.reviewDone > 0 || ds.levelsPassed.length > 0)) {
      reviewRingSet.add(ds.studentId)
      openSet.add(ds.studentId)
    }
    if (rp.levelClosed) {
      levelRingSet.add(ds.studentId)
      openSet.add(ds.studentId)
    }
    if (ds.ringsClosed) {
      dualRingSet.add(ds.studentId)
    }
  }

  // Badge distribution
  const badgeCounts = new Map<string, number>()
  for (const b of badges) {
    badgeCounts.set(b.badgeKey, (badgeCounts.get(b.badgeKey) ?? 0) + 1)
  }
  const badgeDistribution = effectiveCfg.config.badges.map((def) => ({
    key: def.key,
    name: def.name,
    icon: def.icon,
    earnedCount: badgeCounts.get(def.key) ?? 0,
  }))

  // Boss & weekly challenge participation rates (current week)
  const bossStudents = new Set<string>()
  const challengeStudents = new Set<string>()
  for (const ds of dailyStates) {
    if (ds.localDate < currentWeekStart || ds.localDate > weekEnd) continue
    if (ds.levelsPassed.includes('BOSS') || ds.weakBossDone) bossStudents.add(ds.studentId)
    if (ds.reviewDone > 0 || ds.xpEarned > 0) challengeStudents.add(ds.studentId)
  }
  for (const a of analyticsEvents) {
    if (a.dayKey < currentWeekStart || a.dayKey > weekEnd) continue
    if (a.type === 'boss_start' || a.type === 'boss_clear') bossStudents.add(a.studentId)
  }

  return {
    classInfo: {
      id: classId,
      name: cls?.name ?? '',
      subjectGradeName: cls?.subjectGrade?.name ?? '',
    },
    asOfDate: todayDate,
    weeks: safeWeeks,
    totalStudents,
    activeConfigVersion: effectiveCfg.configVersion,
    activeConfigScope: effectiveCfg.scope,
    summary: {
      weeklyActiveDaysAvg: latestWeek?.weeklyActiveDaysAvg ?? 0,
      dueCompletionRate: latestWeek?.dueCompletionRate ?? 0,
      dualRingCloseRate: latestWeek?.dualRingCloseRate ?? 0,
      todayDualRingCloseRate,
      retention7dRate: latestWeek?.retention7dRate ?? 0,
      reminderRecallRate,
      mnemonicCoverageRate: Math.round(mnemonicCoverageRate * 1000) / 1000,
      xpCapHitRate: latestWeek?.xpCapHitRate ?? 0,
      gamificationOptOutRate: latestWeek?.gamificationOptOutRate ?? 0,
    },
    weeklyTrends,
    funnel: {
      appOpen: openSet.size,
      reviewStart: reviewStartSet.size,
      reviewRingClosed: reviewRingSet.size,
      levelRingClosed: levelRingSet.size,
      dualRingClosed: dualRingSet.size,
    },
    badgeDistribution,
    bossParticipationRate: Math.round((bossStudents.size / totalStudents) * 1000) / 1000,
    challengeParticipationRate: Math.round((challengeStudents.size / totalStudents) * 1000) / 1000,
  }
}

export async function getClassEffectMetrics(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  classId: string,
  weeks: number = 8,
  now: Date = new Date(),
): Promise<ClassEffectDashboardData> {
  await verifyClassManagerAccess(prisma, userId, role, classId)
  return computeClassEffectMetricsCore(prisma, classId, weeks, now)
}

/**
 * R2 180-day raw analytics retention & rollup archive.
 */
export async function archiveOldAnalyticsEvents(
  prisma: PrismaClient,
  retentionDays: number = 180,
  now: Date = new Date(),
): Promise<{ archivedEvents: number; rollupRows: number }> {
  const cutoffDate = new Date(now.getTime() - retentionDays * 86_400_000)
  const cutoffDayKey = shanghaiDateString(cutoffDate)

  const oldEvents = await prisma.analyticsEvent.findMany({
    where: { dayKey: { lt: cutoffDayKey } },
    select: { id: true, classId: true, dayKey: true, type: true, studentId: true },
  })
  if (oldEvents.length === 0) return { archivedEvents: 0, rollupRows: 0 }

  const groups = new Map<string, { classId: string; dayKey: string; type: string; count: number; students: Set<string> }>()
  for (const ev of oldEvents) {
    const cid = ev.classId ?? 'NONE'
    const key = `${cid}|${ev.dayKey}|${ev.type}`
    if (!groups.has(key)) {
      groups.set(key, { classId: cid, dayKey: ev.dayKey, type: ev.type, count: 0, students: new Set() })
    }
    const g = groups.get(key)!
    g.count += 1
    g.students.add(ev.studentId)
  }

  let rollupRows = 0
  for (const g of groups.values()) {
    await prisma.analyticsDailyRollup.upsert({
      where: { classId_dayKey_type: { classId: g.classId, dayKey: g.dayKey, type: g.type } },
      create: {
        classId: g.classId,
        dayKey: g.dayKey,
        type: g.type,
        eventCount: g.count,
        uniqueStudents: g.students.size,
        archivedAt: now,
      },
      update: {
        eventCount: { increment: g.count },
        uniqueStudents: g.students.size,
        archivedAt: now,
      },
    })
    rollupRows += 1
  }

  const deleted = await prisma.analyticsEvent.deleteMany({
    where: { id: { in: oldEvents.map((e) => e.id) } },
  })
  return { archivedEvents: deleted.count, rollupRows }
}

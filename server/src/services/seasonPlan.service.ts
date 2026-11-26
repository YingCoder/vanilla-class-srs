/**
 * R6 Sprint Season & R7 Smart Today Plan Service.
 *
 * Strictly preserves FSRS scheduling authority:
 *  - Season & Smart Plan ONLY control new-word throttle & queue ordering.
 *  - They NEVER mutate FSRS `due`, `stability`, or `difficulty`.
 */

import type { PrismaClient, Role } from '@prisma/client'
import { mapFsrsToEbbinghausStage } from '@vanilla-srs/shared/ebbinghaus'
import {
  addCalendarDays,
  computeReviewDueSnapshot,
  shanghaiDateString,
} from '@vanilla-srs/shared/gamification'
import {
  SEASON_MILESTONES,
  computeDefaultSeasonStartDate,
  computeSeasonMilestones,
  computeSmartTodayPlan,
  evaluateSeasonState,
} from '@vanilla-srs/shared/stage4'
import { lookupZhongkaoWord } from '@vanilla-srs/shared/vocab'
import { getEffectiveGameConfig } from './gameConfig.service'
import { defaultNicknameForStudent, getActiveEnrollmentForStudent } from './gamification.service'
import { verifyClassManagerAccess } from './teacherGame.service'

export async function getClassSeasonConfig(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  classId: string,
  now: Date = new Date(),
) {
  await verifyClassManagerAccess(prisma, userId, role, classId)
  const season = await prisma.classSeason.findUnique({ where: { classId } })
  if (!season) return null
  const todayDate = shanghaiDateString(now)
  return {
    ...season,
    runtime: evaluateSeasonState({
      examDate: season.examDate,
      startDate: season.startDate,
      status: season.status,
      todayDate,
    }),
  }
}

export async function upsertClassSeasonConfig(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  classId: string,
  input: {
    name?: string
    examDate: string
    startDate?: string
    status?: 'AUTO' | 'ACTIVE' | 'PAUSED' | 'ENDED'
  },
) {
  await verifyClassManagerAccess(prisma, userId, role, classId)
  const startDate = input.startDate?.trim() || computeDefaultSeasonStartDate(input.examDate)
  return prisma.classSeason.upsert({
    where: { classId },
    create: {
      classId,
      name: input.name?.trim() || '中考冲刺赛季',
      examDate: input.examDate,
      startDate,
      status: input.status ?? 'AUTO',
      updatedBy: userId,
    },
    update: {
      ...(input.name ? { name: input.name.trim() } : {}),
      examDate: input.examDate,
      startDate,
      ...(input.status ? { status: input.status } : {}),
      updatedBy: userId,
    },
  })
}

export async function isClassSeasonActive(
  prisma: PrismaClient,
  classId: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    if (!(prisma as any)?.classSeason?.findUnique) return false
    const season = await prisma.classSeason.findUnique({ where: { classId } })
    if (!season) return false
    const state = evaluateSeasonState({
      examDate: season.examDate,
      startDate: season.startDate,
      status: season.status,
      todayDate: shanghaiDateString(now),
    })
    return state.isActive
  } catch {
    return false
  }
}

export async function getStudentSeasonStatus(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const season = await prisma.classSeason.findUnique({
    where: { classId: enrollment.classId },
  })
  if (!season) {
    return {
      configured: false,
      isActive: false,
      isEnded: false,
    }
  }

  const todayDate = shanghaiDateString(now)
  const runtime = evaluateSeasonState({
    examDate: season.examDate,
    startDate: season.startDate,
    status: season.status,
    todayDate,
  })

  const [instances, profile] = await Promise.all([
    prisma.cardInstance.findMany({
      where: { deckId: enrollment.deck!.id },
      select: {
        state: true,
        stability: true,
        reps: true,
        bestStage: true,
        card: { select: { word: true } },
      },
    }),
    prisma.studentGameProfile.findUnique({ where: { studentId } }),
  ])

  const stage4Words = new Set<string>()
  for (const inst of instances) {
    const w = inst.card.word.trim().toLowerCase()
    if (!lookupZhongkaoWord(w)) continue
    const curStage =
      inst.state === 'NEW' && inst.reps <= 0
        ? 0
        : mapFsrsToEbbinghausStage(inst.state as any, inst.stability, inst.reps)
    const best = Math.max(curStage, inst.bestStage ?? 0)
    if (best >= 4) stage4Words.add(w)
  }

  const milestones = computeSeasonMilestones(stage4Words.size)

  // Auto-award reached milestone badges & skins idempotently when active/ended
  if ((runtime.isActive || runtime.isEnded) && milestones.reachedMilestones.length > 0) {
    const targetSkinSet = new Set(profile?.unlockedSkins ?? [])
    let skinAdded = false
    for (const m of milestones.reachedMilestones) {
      if (!targetSkinSet.has(m.skinKey)) {
        targetSkinSet.add(m.skinKey)
        skinAdded = true
      }
      try {
        await prisma.studentBadge.create({
          data: { studentId, badgeKey: m.badgeKey, earnedAt: now },
        })
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err
      }
    }
    if (skinAdded && profile) {
      await prisma.studentGameProfile.update({
        where: { studentId },
        data: { unlockedSkins: [...targetSkinSet] },
      })
    }
  }

  return {
    configured: true,
    name: season.name,
    examDate: season.examDate,
    startDate: runtime.effectiveStartDate,
    status: season.status,
    isActive: runtime.isActive,
    isEnded: runtime.isEnded,
    daysRemaining: runtime.daysRemaining,
    milestones,
    allMilestones: SEASON_MILESTONES,
    recap: {
      nickname: profile?.nickname || defaultNicknameForStudent(studentId),
      avatarKey: profile?.avatarKey ?? 'vanilla',
      level: profile?.level ?? 1,
      streakDays: profile?.streakDays ?? 0,
      stage4Count: milestones.stage4Count,
      totalWords: milestones.totalWords,
      pct: milestones.pct,
      studyDate: todayDate,
    },
  }
}

export async function getSmartTodayPlan(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const { config } = await getEffectiveGameConfig(prisma, enrollment.classId)
  const todayDate = shanghaiDateString(now)
  const sevenDaysAgoDate = addCalendarDays(todayDate, -7)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)

  const [
    rawDueCount,
    profile,
    todayDaily,
    recentStates,
    recentReviewEvents,
    recentAnalyticsGrades,
    seasonActive,
  ] = await Promise.all([
    prisma.cardInstance.count({
      where: {
        deckId: enrollment.deck!.id,
        state: { in: ['LEARNING', 'REVIEW', 'RELEARNING'] },
        due: { lte: now },
      },
    }),
    prisma.studentGameProfile.findUnique({ where: { studentId } }),
    prisma.dailyGameState.findUnique({
      where: { studentId_localDate: { studentId, localDate: todayDate } },
    }),
    prisma.dailyGameState.findMany({
      where: { studentId, localDate: { gte: sevenDaysAgoDate, lt: todayDate } },
      orderBy: { localDate: 'desc' },
    }),
    prisma.reviewEvent.findMany({
      where: {
        session: { deckId: enrollment.deck!.id },
        reviewedAt: { gte: sevenDaysAgo },
        responseTimeMs: { not: null },
      },
      select: { responseTimeMs: true },
      take: 100,
    }),
    prisma.analyticsEvent.findMany({
      where: { studentId, type: 'grade_submit', dayKey: { gte: sevenDaysAgoDate } },
      select: { props: true },
      take: 100,
    }),
    isClassSeasonActive(prisma, enrollment.classId, now),
  ])

  const snapshot = computeReviewDueSnapshot(
    rawDueCount,
    profile?.lastStudiedDate ?? null,
    todayDate,
    config,
  )
  const backlogCap = snapshot.returnProtected ? config.backlogCapReturn : config.backlogCapNormal

  // Count consecutive prior days with >= 90% due completion
  const stateByDate = new Map(recentStates.map((s) => [s.localDate, s]))
  let consecutiveHigh = 0
  for (let offset = 1; offset <= 7; offset++) {
    const d = addCalendarDays(todayDate, -offset)
    const st = stateByDate.get(d)
    if (!st) break
    const ratio = st.reviewDue === 0 ? 1 : st.reviewDone / st.reviewDue
    if (ratio >= 0.9) consecutiveHigh += 1
    else break
  }

  // Average response seconds from R2 analytics (`durationMs`) or ReviewEvent (`responseTimeMs`)
  const durationsMs: number[] = []
  for (const ev of recentAnalyticsGrades) {
    const d = (ev.props as { durationMs?: unknown } | null)?.durationMs
    if (typeof d === 'number' && d > 500 && d < 120_000) durationsMs.push(d)
  }
  for (const re of recentReviewEvents) {
    if (re.responseTimeMs && re.responseTimeMs > 500 && re.responseTimeMs < 120_000) {
      durationsMs.push(re.responseTimeMs)
    }
  }
  const avgSecondsPerWord =
    durationsMs.length > 0
      ? Math.round(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length / 1000)
      : 12

  const deckParams = (enrollment.deck!.fsrsParams as { newCardsPerDay?: number } | null) ?? {}
  const defaultNewPerDay = deckParams.newCardsPerDay ?? 10

  const plan = computeSmartTodayPlan({
    rawDueCount,
    backlogCap,
    defaultNewPerDay,
    dueReviewedToday: todayDaily?.reviewDone ?? 0,
    consecutiveHighCompletionDays: consecutiveHigh,
    avgSecondsPerWord,
    seasonActive,
  })

  return {
    studyDate: todayDate,
    seasonActive,
    returnProtected: snapshot.returnProtected,
    backlogCap,
    consecutiveHighCompletionDays: consecutiveHigh,
    ...plan,
  }
}

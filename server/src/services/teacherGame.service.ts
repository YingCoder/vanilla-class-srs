/**
 * Stage 3 Teacher & Admin Gamification Dashboard Service (F8, F9, F10).
 *
 * Strict authorization:
 *  - Teacher may only access/manage classes where `cls.teacherId === teacher.id` (else 403).
 *  - Admin may access/manage any active class (Admin/Teacher parity).
 *  - Falling-behind student roster ("掉队名单") is NEVER exposed on student endpoints.
 */

import type { PrismaClient, Role } from '@prisma/client'
import {
  TEACHER_CHEER_PRESETS,
  addCalendarDays,
  diffCalendarDays,
  shanghaiTimeParts,
} from '@vanilla-srs/shared/gamification'
import { getClassChallengeProgress } from './gamification.service'

export class ClassForbiddenError extends Error {
  status = 403
  constructor(message = '无权操作该班级') {
    super(message)
  }
}

export class ClassNotFoundError extends Error {
  status = 404
  constructor(message = '班级不存在') {
    super(message)
  }
}

export async function verifyClassManagerAccess(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  classId: string,
) {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    include: {
      subjectGrade: { select: { id: true, name: true } },
    },
  })
  if (!cls || cls.archivedAt) throw new ClassNotFoundError()
  if (role === 'ADMIN') return cls

  const teacher = await prisma.teacher.findUnique({ where: { userId } })
  if (!teacher || cls.teacherId !== teacher.id) {
    throw new ClassForbiddenError()
  }
  return cls
}

export async function listManagedClassesForGame(
  prisma: PrismaClient,
  userId: string,
  role: Role,
) {
  if (role === 'ADMIN') {
    return prisma.class.findMany({
      where: {
        archivedAt: null,
        subjectGrade: { archivedAt: null, department: { archivedAt: null } },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        subjectGrade: { select: { name: true } },
        _count: { select: { enrollments: { where: { archivedAt: null } } } },
      },
    })
  }
  const teacher = await prisma.teacher.findUnique({ where: { userId } })
  if (!teacher) return []
  return prisma.class.findMany({
    where: {
      teacherId: teacher.id,
      archivedAt: null,
      subjectGrade: { archivedAt: null, department: { archivedAt: null } },
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      subjectGrade: { select: { name: true } },
      _count: { select: { enrollments: { where: { archivedAt: null } } } },
    },
  })
}

export async function getTeacherGameOverview(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  classId: string,
  now: Date = new Date(),
) {
  const cls = await verifyClassManagerAccess(prisma, userId, role, classId)
  const { localDate, weekStart } = shanghaiTimeParts(now)
  const lastWeekStart = addCalendarDays(weekStart, -7)
  const lastWeekEnd = addCalendarDays(weekStart, -1)

  const [enrollments, setting, challenge, recentCheers] = await Promise.all([
    prisma.enrollment.findMany({
      where: { classId, archivedAt: null },
      orderBy: { student: { user: { name: 'asc' } } },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true, username: true } },
            gameProfile: true,
          },
        },
      },
    }),
    prisma.classGameSetting.findUnique({ where: { classId } }),
    getClassChallengeProgress(prisma, classId, now),
    prisma.teacherCheer.findMany({
      where: { classId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  const studentIds = enrollments.map((e) => e.studentId)
  const [todayStates, lastWeekReviewSum] = await Promise.all([
    studentIds.length > 0
      ? prisma.dailyGameState.findMany({
          where: { studentId: { in: studentIds }, localDate },
          select: { studentId: true, ringsClosed: true, xpEarned: true, reviewDone: true },
        })
      : Promise.resolve([]),
    studentIds.length > 0
      ? prisma.dailyGameState.aggregate({
          where: {
            studentId: { in: studentIds },
            localDate: { gte: lastWeekStart, lte: lastWeekEnd },
          },
          _sum: { reviewDone: true },
        })
      : Promise.resolve({ _sum: { reviewDone: 0 } }),
  ])

  const todayMap = new Map(todayStates.map((s) => [s.studentId, s]))

  let todayAchievedCount = 0
  const streakDistribution = { zero: 0, d1to2: 0, d3to6: 0, d7plus: 0 }
  const atRiskStudents: Array<{
    studentId: string
    name: string
    username: string | null
    daysInactive: number
    lastStudiedDate: string | null
    streakDays: number
  }> = []

  const studentsSummary = enrollments.map((enr) => {
    const profile = enr.student.gameProfile
    const today = todayMap.get(enr.studentId)
    const achievedToday = Boolean(today?.ringsClosed)
    if (achievedToday) todayAchievedCount += 1

    const streak = profile?.streakDays ?? 0
    if (streak <= 0) streakDistribution.zero += 1
    else if (streak <= 2) streakDistribution.d1to2 += 1
    else if (streak <= 6) streakDistribution.d3to6 += 1
    else streakDistribution.d7plus += 1

    const lastDate = profile?.lastAchievedDate ?? profile?.lastStudiedDate ?? null
    const daysInactive = lastDate
      ? Math.max(0, diffCalendarDays(lastDate, localDate))
      : Math.max(0, diffCalendarDays(enr.joinedAt.toISOString().slice(0, 10), localDate))

    if (!achievedToday && daysInactive >= 3) {
      atRiskStudents.push({
        studentId: enr.studentId,
        name: enr.student.user.name,
        username: enr.student.user.username,
        daysInactive,
        lastStudiedDate: lastDate,
        streakDays: streak,
      })
    }

    return {
      studentId: enr.studentId,
      name: enr.student.user.name,
      username: enr.student.user.username,
      nickname: profile?.nickname ?? null,
      level: profile?.level ?? 1,
      totalXp: profile?.totalXp ?? 0,
      streakDays: streak,
      achievedToday,
      todayXp: today?.xpEarned ?? 0,
    }
  })

  const lastWeekDone = lastWeekReviewSum._sum.reviewDone ?? 0
  const recommendedTarget = Math.max(
    50,
    Math.round(Math.max(lastWeekDone * 1.15, enrollments.length * 25) / 10) * 10,
  )

  return {
    studyDate: localDate,
    classInfo: {
      id: cls.id,
      name: cls.name,
      subjectGradeName: cls.subjectGrade.name,
    },
    totalStudents: enrollments.length,
    todayAchievedCount,
    streakDistribution,
    atRiskStudents: atRiskStudents.sort((a, b) => b.daysInactive - a.daysInactive),
    students: studentsSummary,
    settings: {
      leaderboardOpen: setting?.leaderboardOpen ?? false,
      weeklyTargetCards: setting?.weeklyTargetCards ?? recommendedTarget,
      mnemonicCoCreateOpen: setting?.mnemonicCoCreateOpen ?? false,
      squadEnabled: setting?.squadEnabled ?? false,
      activePackId: setting?.activePackId ?? null,
    },
    challenge: {
      ...challenge,
      recommendedTarget,
    },
    recentCheers,
    presets: TEACHER_CHEER_PRESETS,
  }
}

export async function updateClassGameSettings(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  input: {
    classId: string
    leaderboardOpen?: boolean
    weeklyTargetCards?: number
    challengeTitle?: string
    mnemonicCoCreateOpen?: boolean
    squadEnabled?: boolean
    activePackId?: string | null
  },
  now: Date = new Date(),
) {
  await verifyClassManagerAccess(prisma, userId, role, input.classId)
  const { weekStart } = shanghaiTimeParts(now)

  const existingSetting = await prisma.classGameSetting.findUnique({
    where: { classId: input.classId },
  })

  const nextLeaderboardOpen =
    input.leaderboardOpen !== undefined ? input.leaderboardOpen : (existingSetting?.leaderboardOpen ?? false)
  const nextTarget =
    input.weeklyTargetCards !== undefined ? input.weeklyTargetCards : (existingSetting?.weeklyTargetCards ?? 300)
  const nextCoCreate =
    input.mnemonicCoCreateOpen !== undefined
      ? input.mnemonicCoCreateOpen
      : (existingSetting?.mnemonicCoCreateOpen ?? false)
  const nextSquadEnabled =
    input.squadEnabled !== undefined ? input.squadEnabled : (existingSetting?.squadEnabled ?? false)
  const nextActivePackId =
    input.activePackId !== undefined ? input.activePackId : (existingSetting?.activePackId ?? null)

  const setting = await prisma.classGameSetting.upsert({
    where: { classId: input.classId },
    create: {
      classId: input.classId,
      leaderboardOpen: nextLeaderboardOpen,
      weeklyTargetCards: nextTarget,
      mnemonicCoCreateOpen: nextCoCreate,
      squadEnabled: nextSquadEnabled,
      activePackId: nextActivePackId,
    },
    update: {
      leaderboardOpen: nextLeaderboardOpen,
      weeklyTargetCards: nextTarget,
      mnemonicCoCreateOpen: nextCoCreate,
      squadEnabled: nextSquadEnabled,
      activePackId: nextActivePackId,
    },
  })

  if (input.weeklyTargetCards !== undefined || input.challengeTitle !== undefined) {
    await prisma.classChallenge.upsert({
      where: { classId_weekStart: { classId: input.classId, weekStart } },
      create: {
        classId: input.classId,
        weekStart,
        targetCount: nextTarget,
        title: input.challengeTitle?.trim() || '本周全班挑战 · 到期复习清零',
      },
      update: {
        ...(input.weeklyTargetCards !== undefined ? { targetCount: nextTarget } : {}),
        ...(input.challengeTitle !== undefined ? { title: input.challengeTitle.trim() || '本周全班挑战 · 到期复习清零' } : {}),
      },
    })
  }

  return setting
}

export async function sendTeacherCheer(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  input: {
    classId: string
    studentId?: string | null
    presetKey: string
  },
) {
  await verifyClassManagerAccess(prisma, userId, role, input.classId)
  const preset = TEACHER_CHEER_PRESETS.find((p) => p.key === input.presetKey)
  if (!preset) {
    const err: any = new Error('无效的鼓励模板')
    err.status = 400
    throw err
  }

  if (input.studentId) {
    const enrolled = await prisma.enrollment.findFirst({
      where: { classId: input.classId, studentId: input.studentId, archivedAt: null },
    })
    if (!enrolled) {
      const err: any = new Error('该学生不在本班中')
      err.status = 404
      throw err
    }
  }

  const sender = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, username: true },
  })

  return prisma.teacherCheer.create({
    data: {
      classId: input.classId,
      senderId: userId,
      senderName: sender?.name ?? sender?.username ?? '老师',
      studentId: input.studentId ?? null,
      presetKey: preset.key,
      message: preset.message,
      sticker: preset.sticker,
    },
  })
}

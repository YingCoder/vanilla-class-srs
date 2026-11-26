/**
 * R5 Learning Squads Service (2–3 member cooperative teams).
 *
 * Privacy & fairness rules:
 *  - Default OFF per class (`ClassGameSetting.squadEnabled`).
 *  - Weekly goal: every member closes review ring >= 4 days in the week ->
 *    "小队徽章" (`squad_weekly`) + one-time XP (subject to 400 XP daily cap).
 *  - Student squad view ONLY returns weekly progress bar & closed-member count;
 *    never exposes who failed to study.
 *  - Preset cheers only (max 3/day per student), no free text.
 *  - No inter-squad rankings; leaving preserves historical SquadWeek credit.
 */

import type { PrismaClient, Role } from '@prisma/client'
import {
  addCalendarDays,
  shanghaiTimeParts,
} from '@vanilla-srs/shared/gamification'
import {
  MAX_SQUAD_CHEERS_PER_DAY,
  SQUAD_CHEER_PRESETS,
  SQUAD_GOAL_MIN_DAYS,
  SQUAD_MAX_SIZE,
  SQUAD_MIN_SIZE,
  evaluateSquadWeeklyGoal,
} from '@vanilla-srs/shared/stage4'
import { getEffectiveGameConfig } from './gameConfig.service'
import {
  defaultNicknameForStudent,
  getActiveEnrollmentForStudent,
  recordGameRewardEventInTx,
} from './gamification.service'
import { verifyClassManagerAccess } from './teacherGame.service'

async function evaluateAndAwardSquadGoal(
  prisma: PrismaClient,
  squad: { id: string; classId: string; name: string },
  memberIds: string[],
  weekStart: string,
  localDate: string,
  now: Date,
) {
  const weekEnd = addCalendarDays(weekStart, 6)
  const states =
    memberIds.length > 0
      ? await prisma.dailyGameState.findMany({
          where: {
            studentId: { in: memberIds },
            localDate: { gte: weekStart, lte: weekEnd },
          },
          select: { studentId: true, reviewDue: true, reviewDone: true },
        })
      : []

  const closedDaysByStudent = new Map<string, number>()
  for (const sid of memberIds) closedDaysByStudent.set(sid, 0)
  for (const s of states) {
    const reviewClosed = s.reviewDue === 0 || s.reviewDone >= s.reviewDue
    if (reviewClosed && (s.reviewDone > 0 || s.reviewDue === 0)) {
      closedDaysByStudent.set(s.studentId, (closedDaysByStudent.get(s.studentId) ?? 0) + 1)
    }
  }

  const evalRes = evaluateSquadWeeklyGoal(
    memberIds.map((sid) => closedDaysByStudent.get(sid) ?? 0),
    SQUAD_GOAL_MIN_DAYS,
  )

  const existingWeek = await prisma.squadWeek.findUnique({
    where: { squadId_weekStart: { squadId: squad.id, weekStart } },
  })

  if (evalRes.goalAchieved && !existingWeek?.achieved) {
    await prisma.$transaction(async (tx) => {
      await tx.squadWeek.upsert({
        where: { squadId_weekStart: { squadId: squad.id, weekStart } },
        create: { squadId: squad.id, weekStart, achieved: true, achievedAt: now },
        update: { achieved: true, achievedAt: now },
      })
      const { config, configVersion } = await getEffectiveGameConfig(
        tx as unknown as PrismaClient,
        squad.classId,
      )
      for (const sid of memberIds) {
        const enr = await tx.enrollment.findFirst({
          where: { studentId: sid, classId: squad.classId, archivedAt: null },
          include: { deck: true },
        })
        if (enr?.deck) {
          await recordGameRewardEventInTx({
            tx: tx as unknown as PrismaClient,
            studentId: sid,
            enrollmentId: enr.id,
            deckId: enr.deck.id,
            classId: squad.classId,
            type: 'SQUAD_WEEKLY_GOAL',
            sourceId: `${weekStart}:${squad.id}`,
            baseXp: config.squadGoalXp,
            localDate,
            now,
            config,
            configVersion,
            meta: { squadId: squad.id, squadName: squad.name, weekStart },
          })
        }
      }
    })
  }

  return evalRes
}

export async function listClassSquadsForStaff(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  classId: string,
  now: Date = new Date(),
) {
  await verifyClassManagerAccess(prisma, userId, role, classId)
  const { weekStart, localDate } = shanghaiTimeParts(now)
  const [setting, squads, enrollments] = await Promise.all([
    prisma.classGameSetting.findUnique({ where: { classId } }),
    prisma.squad.findMany({
      where: { classId, archivedAt: null },
      include: {
        members: {
          where: { leftAt: null },
          include: {
            student: {
              include: {
                user: { select: { name: true, username: true } },
                gameProfile: { select: { nickname: true } },
              },
            },
          },
        },
        weeks: { where: { weekStart } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.enrollment.findMany({
      where: { classId, archivedAt: null },
      include: {
        student: { include: { user: { select: { name: true, username: true } } } },
      },
      orderBy: { student: { user: { name: 'asc' } } },
    }),
  ])

  const enriched = []
  for (const sq of squads) {
    const memberIds = sq.members.map((m) => m.studentId)
    const evalRes = await evaluateAndAwardSquadGoal(prisma, sq, memberIds, weekStart, localDate, now)
    enriched.push({
      id: sq.id,
      name: sq.name,
      members: sq.members.map((m) => ({
        studentId: m.studentId,
        name: m.student.user.name,
        username: m.student.user.username,
        nickname: m.student.gameProfile?.nickname ?? defaultNicknameForStudent(m.studentId),
      })),
      weeklyProgress: evalRes,
      achievedThisWeek: Boolean(sq.weeks[0]?.achieved || evalRes.goalAchieved),
    })
  }

  return {
    squadEnabled: setting?.squadEnabled ?? false,
    weekStart,
    squads: enriched,
    students: enrollments.map((e) => ({
      studentId: e.studentId,
      name: e.student.user.name,
      username: e.student.user.username,
    })),
  }
}

export async function updateClassSquadsForStaff(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  classId: string,
  input: {
    squadEnabled?: boolean
    squads?: Array<{ id?: string; name: string; studentIds: string[] }>
  },
) {
  await verifyClassManagerAccess(prisma, userId, role, classId)

  if (input.squadEnabled !== undefined) {
    await prisma.classGameSetting.upsert({
      where: { classId },
      create: { classId, squadEnabled: input.squadEnabled },
      update: { squadEnabled: input.squadEnabled },
    })
  }

  if (input.squads !== undefined) {
    const enrolled = await prisma.enrollment.findMany({
      where: { classId, archivedAt: null },
      select: { studentId: true },
    })
    const validStudents = new Set(enrolled.map((e) => e.studentId))
    const seen = new Set<string>()

    for (const s of input.squads) {
      const uniq = [...new Set(s.studentIds)]
      if (uniq.length < SQUAD_MIN_SIZE || uniq.length > SQUAD_MAX_SIZE) {
        const err: any = new Error(`小队「${s.name}」人数必须为 ${SQUAD_MIN_SIZE}–${SQUAD_MAX_SIZE} 人`)
        err.status = 400
        throw err
      }
      for (const sid of uniq) {
        if (!validStudents.has(sid)) {
          const err: any = new Error('小队成员必须属于当前班级')
          err.status = 400
          throw err
        }
        if (seen.has(sid)) {
          const err: any = new Error('同一名学生只能在一个小队中')
          err.status = 400
          throw err
        }
        seen.add(sid)
      }
    }

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      const existingSquads = await tx.squad.findMany({
        where: { classId, archivedAt: null },
        include: { members: { where: { leftAt: null } } },
      })
      const keepIds = new Set(input.squads!.map((s) => s.id).filter(Boolean) as string[])
      for (const old of existingSquads) {
        if (!keepIds.has(old.id)) {
          await tx.squadMember.updateMany({
            where: { squadId: old.id, leftAt: null },
            data: { leftAt: now },
          })
          await tx.squad.update({ where: { id: old.id }, data: { archivedAt: now } })
        }
      }

      for (const s of input.squads!) {
        if (s.id) {
          const target = existingSquads.find((x) => x.id === s.id)
          if (target) {
            await tx.squad.update({ where: { id: target.id }, data: { name: s.name.trim() } })
            await tx.squadMember.updateMany({
              where: { squadId: target.id, leftAt: null, studentId: { notIn: s.studentIds } },
              data: { leftAt: now },
            })
            for (const sid of s.studentIds) {
              await tx.squadMember.upsert({
                where: { squadId_studentId: { squadId: target.id, studentId: sid } },
                create: { squadId: target.id, studentId: sid },
                update: { leftAt: null, joinedAt: now },
              })
            }
            continue
          }
        }
        const created = await tx.squad.create({
          data: { classId, name: s.name.trim() },
        })
        await tx.squadMember.createMany({
          data: s.studentIds.map((sid) => ({ squadId: created.id, studentId: sid })),
        })
      }
    })
  }

  return listClassSquadsForStaff(prisma, userId, role, classId)
}

export async function getStudentSquadView(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const setting = await prisma.classGameSetting.findUnique({
    where: { classId: enrollment.classId },
  })
  if (!setting?.squadEnabled) {
    return {
      enabled: false,
      weekStart: shanghaiTimeParts(now).weekStart,
      mySquad: null,
      availableSquads: [],
      presets: SQUAD_CHEER_PRESETS,
    }
  }

  const { weekStart, localDate } = shanghaiTimeParts(now)
  const activeMembership = await prisma.squadMember.findFirst({
    where: {
      studentId,
      leftAt: null,
      squad: { classId: enrollment.classId, archivedAt: null },
    },
    include: {
      squad: {
        include: {
          members: {
            where: { leftAt: null },
            include: {
              student: {
                include: { gameProfile: { select: { nickname: true, avatarKey: true, avatarFrame: true } } },
              },
            },
          },
          cheers: {
            where: { weekStart },
            orderBy: { createdAt: 'desc' },
            take: 15,
            include: {
              sender: { include: { gameProfile: { select: { nickname: true } } } },
            },
          },
        },
      },
    },
  })

  if (!activeMembership) {
    const classSquads = await prisma.squad.findMany({
      where: { classId: enrollment.classId, archivedAt: null },
      include: { members: { where: { leftAt: null }, select: { studentId: true } } },
    })
    return {
      enabled: true,
      weekStart,
      mySquad: null,
      availableSquads: classSquads
        .filter((sq) => sq.members.length < SQUAD_MAX_SIZE)
        .map((sq) => ({ id: sq.id, name: sq.name, memberCount: sq.members.length, maxSize: SQUAD_MAX_SIZE })),
      presets: SQUAD_CHEER_PRESETS,
    }
  }

  const sq = activeMembership.squad
  const memberIds = sq.members.map((m) => m.studentId)
  const [evalRes, cheersSentToday] = await Promise.all([
    evaluateAndAwardSquadGoal(prisma, sq, memberIds, weekStart, localDate, now),
    prisma.squadCheer.count({
      where: { senderStudentId: studentId, localDate },
    }),
  ])

  // Privacy: NEVER expose per-member completion status or real names!
  return {
    enabled: true,
    weekStart,
    mySquad: {
      id: sq.id,
      name: sq.name,
      members: sq.members.map((m) => ({
        nickname: m.student.gameProfile?.nickname || defaultNicknameForStudent(m.studentId),
        avatarKey: m.student.gameProfile?.avatarKey ?? 'vanilla',
        avatarFrame: m.student.gameProfile?.avatarFrame ?? 'vanilla',
        isSelf: m.studentId === studentId,
      })),
      progress: evalRes,
      cheersSentToday,
      maxCheersPerDay: MAX_SQUAD_CHEERS_PER_DAY,
      recentCheers: sq.cheers.map((c) => ({
        id: c.id,
        senderNickname: c.sender.gameProfile?.nickname || defaultNicknameForStudent(c.senderStudentId),
        sticker: c.sticker,
        message: c.message,
        createdAt: c.createdAt,
      })),
    },
    availableSquads: [],
    presets: SQUAD_CHEER_PRESETS,
  }
}

export async function joinOrCreateStudentSquad(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  input: { squadId?: string; name?: string },
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) {
    const err: any = new Error('Enrollment not found')
    err.status = 404
    throw err
  }
  const setting = await prisma.classGameSetting.findUnique({ where: { classId: enrollment.classId } })
  if (!setting?.squadEnabled) {
    const err: any = new Error('本班暂未开启学习搭子小队')
    err.status = 403
    throw err
  }

  const already = await prisma.squadMember.findFirst({
    where: { studentId, leftAt: null, squad: { classId: enrollment.classId, archivedAt: null } },
  })
  if (already) {
    const err: any = new Error('你已经加入了一个学习小队')
    err.status = 409
    throw err
  }

  if (input.squadId) {
    const squad = await prisma.squad.findUnique({
      where: { id: input.squadId },
      include: { members: { where: { leftAt: null } } },
    })
    if (!squad || squad.archivedAt || squad.classId !== enrollment.classId) {
      const err: any = new Error('小队不存在')
      err.status = 404
      throw err
    }
    if (squad.members.length >= SQUAD_MAX_SIZE) {
      const err: any = new Error('该小队人数已满（最多 3 人）')
      err.status = 409
      throw err
    }
    await prisma.squadMember.upsert({
      where: { squadId_studentId: { squadId: squad.id, studentId } },
      create: { squadId: squad.id, studentId },
      update: { leftAt: null, joinedAt: new Date() },
    })
    return getStudentSquadView(prisma, studentId, enrollmentId)
  }

  const name = input.name?.trim() || '香草并肩小队'
  await prisma.squad.create({
    data: {
      classId: enrollment.classId,
      name,
      members: { create: { studentId } },
    },
  })
  return getStudentSquadView(prisma, studentId, enrollmentId)
}

export async function sendSquadCheer(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  presetKey: string,
  now: Date = new Date(),
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) {
    const err: any = new Error('Enrollment not found')
    err.status = 404
    throw err
  }
  const setting = await prisma.classGameSetting.findUnique({ where: { classId: enrollment.classId } })
  if (!setting?.squadEnabled) {
    const err: any = new Error('本班暂未开启学习搭子小队')
    err.status = 403
    throw err
  }

  const preset = SQUAD_CHEER_PRESETS.find((p) => p.key === presetKey)
  if (!preset) {
    const err: any = new Error('只允许发送预设击掌鼓励')
    err.status = 400
    throw err
  }

  const membership = await prisma.squadMember.findFirst({
    where: { studentId, leftAt: null, squad: { classId: enrollment.classId, archivedAt: null } },
  })
  if (!membership) {
    const err: any = new Error('请先加入学习小队')
    err.status = 404
    throw err
  }

  const { localDate, weekStart } = shanghaiTimeParts(now)
  const sentToday = await prisma.squadCheer.count({
    where: { senderStudentId: studentId, localDate },
  })
  if (sentToday >= MAX_SQUAD_CHEERS_PER_DAY) {
    const err: any = new Error(`每人每日最多发送 ${MAX_SQUAD_CHEERS_PER_DAY} 次搭子击掌`)
    err.status = 429
    throw err
  }

  return prisma.squadCheer.create({
    data: {
      squadId: membership.squadId,
      senderStudentId: studentId,
      presetKey: preset.key,
      message: preset.message,
      sticker: preset.sticker,
      localDate,
      weekStart,
      createdAt: now,
    },
  })
}

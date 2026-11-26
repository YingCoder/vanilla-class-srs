/**
 * Stage 3 Gamification Service (G0, F1–F12).
 *
 * Server-authoritative ledger (`GameEvent`), derived profile (`StudentGameProfile`),
 * daily dual-ring state (`DailyGameState`), badges (`StudentBadge`), 23-day camp map,
 * 688-card album, weak-word Boss, class weekly challenge & leaderboard.
 */

import type { PrismaClient } from '@prisma/client'
import { mapFsrsToEbbinghausStage } from '@vanilla-srs/shared/ebbinghaus'
import { ZHONGKAO_23_DAYS, lookupZhongkaoWord } from '@vanilla-srs/shared/vocab'
import {
  DEFAULT_GAME_CONFIG,
  addCalendarDays,
  clampDailyXp,
  computeCampNodeStars,
  computeReviewDueSnapshot,
  diffCalendarDays,
  isLateNightQuiet,
  levelFromXp,
  nextStreak,
  rarityFromStage,
  ringProgress,
  shanghaiDateString,
  shanghaiDayBounds,
  shanghaiTimeParts,
  type BadgeDef,
  type GameConfig,
  type GamificationLevelInfo,
  type RingProgressResult,
} from '@vanilla-srs/shared/gamification'
import { getEffectiveGameConfig } from './gameConfig.service'
import { getRuntimeMnemonicOverlays } from './mnemonicOverlay.service'
import { recordServerAnalyticsEvent } from './analytics.service'

export interface NewBadgeInfo {
  key: string
  name: string
  icon: string
  description: string
}

export interface RewardFeedback {
  xp: number
  bonusXp: number
  totalAwardedXp: number
  totalXp: number
  dailyXp: number
  dailyCap: number
  remainingDailyXp: number
  capped: boolean
  level: number
  title: string
  levelUp: { fromLevel: number; toLevel: number; newTitle: string } | null
  ringsClosed: boolean
  ringsClosedJustNow: boolean
  streakDays: number
  freezeTickets: number
  ticketEarned: number
  newBadges: NewBadgeInfo[]
  configVersion: string
  replayed?: boolean
}

export function isGamificationAvailable(db: unknown): boolean {
  const anyDb = db as any
  return Boolean(
    anyDb?.gameEvent &&
      anyDb?.studentGameProfile &&
      anyDb?.dailyGameState &&
      anyDb?.studentBadge,
  )
}

export function defaultNicknameForStudent(studentId: string): string {
  return `小营员#${studentId.replace(/-/g, '').slice(0, 4).toUpperCase()}`
}

async function ensureProfileAndDailyState(
  tx: PrismaClient,
  studentId: string,
  deckId: string,
  localDate: string,
  config: GameConfig,
  now: Date,
) {
  let profile = await tx.studentGameProfile.findUnique({ where: { studentId } })
  if (!profile) {
    if (typeof (tx.studentGameProfile as any).createMany === 'function') {
      await (tx.studentGameProfile as any).createMany({
        data: [
          {
            studentId,
            nickname: defaultNicknameForStudent(studentId),
          },
        ],
        skipDuplicates: true,
      })
      profile = await tx.studentGameProfile.findUnique({ where: { studentId } })
    } else {
      try {
        profile = await tx.studentGameProfile.create({
          data: {
            studentId,
            nickname: defaultNicknameForStudent(studentId),
          },
        })
      } catch (err: any) {
        if (err?.code === 'P2002') {
          profile = (await tx.studentGameProfile.findUnique({ where: { studentId } }))!
        } else {
          throw err
        }
      }
    }
  }

  // Acquire per-student row lock in PostgreSQL before settling streaks or daily XP
  // so concurrent requests never overwrite DailyGameState/totalXp or breach dailyXpCap.
  if (typeof (tx as any).$queryRaw === 'function') {
    await (tx as any).$queryRaw`SELECT "studentId" FROM "StudentGameProfile" WHERE "studentId" = ${studentId} FOR UPDATE`
    profile = (await tx.studentGameProfile.findUnique({ where: { studentId } }))!
  }
  if (!profile) {
    throw new Error('Failed to initialize StudentGameProfile')
  }

  // Settle any missed days / auto-consume freeze ticket on new-day check
  const settledStreak = nextStreak(
    {
      streakDays: profile.streakDays,
      longestStreak: profile.longestStreak,
      freezeTickets: profile.freezeTickets,
      lastAchievedDate: profile.lastAchievedDate,
      streakCursorDate: profile.streakCursorDate,
    },
    false,
    localDate,
    config,
  )
  if (settledStreak.ticketConsumed > 0 || settledStreak.streakReset) {
    profile = await tx.studentGameProfile.update({
      where: { studentId },
      data: {
        streakDays: settledStreak.streakDays,
        longestStreak: settledStreak.longestStreak,
        freezeTickets: settledStreak.freezeTickets,
        streakCursorDate: settledStreak.streakCursorDate,
      },
    })
    if (settledStreak.ticketConsumed > 0) {
      try {
        await tx.gameEvent.create({
          data: {
            studentId,
            type: 'FREEZE_TICKET_USED',
            sourceId: localDate,
            xp: 0,
            localDate,
            meta: {
              consumed: settledStreak.ticketConsumed,
              remaining: settledStreak.freezeTickets,
            } as any,
            createdAt: now,
          },
        })
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err
      }
    }
  }

  let dailyState = await tx.dailyGameState.findUnique({
    where: { studentId_localDate: { studentId, localDate } },
  })
  if (!dailyState) {
    const rawDueCount = await tx.cardInstance.count({
      where: {
        deckId,
        state: { in: ['LEARNING', 'REVIEW', 'RELEARNING'] },
        due: { lte: now },
      },
    })
    const snapshot = computeReviewDueSnapshot(
      rawDueCount,
      profile.lastStudiedDate,
      localDate,
      config,
    )
    try {
      dailyState = await tx.dailyGameState.create({
        data: {
          studentId,
          localDate,
          reviewDue: snapshot.reviewDue,
        },
      })
    } catch (err: any) {
      if (err?.code === 'P2002') {
        dailyState = (await tx.dailyGameState.findUnique({
          where: { studentId_localDate: { studentId, localDate } },
        }))!
      } else {
        throw err
      }
    }
  }

  return { profile, dailyState }
}

function buildFeedbackFromState(params: {
  xp: number
  bonusXp: number
  profile: { totalXp: number; level: number; streakDays: number; freezeTickets: number }
  dailyState: { xpEarned: number; ringsClosed: boolean }
  levelUp: RewardFeedback['levelUp']
  ringsClosedJustNow: boolean
  ticketEarned: number
  newBadges: NewBadgeInfo[]
  config: GameConfig
  configVersion: string
  replayed?: boolean
}): RewardFeedback {
  const info = levelFromXp(params.profile.totalXp, params.config)
  const remainingDailyXp = Math.max(0, params.config.dailyXpCap - params.dailyState.xpEarned)
  return {
    xp: params.xp,
    bonusXp: params.bonusXp,
    totalAwardedXp: params.xp + params.bonusXp,
    totalXp: params.profile.totalXp,
    dailyXp: params.dailyState.xpEarned,
    dailyCap: params.config.dailyXpCap,
    remainingDailyXp,
    capped: remainingDailyXp === 0,
    level: info.level,
    title: info.title,
    levelUp: params.levelUp,
    ringsClosed: params.dailyState.ringsClosed,
    ringsClosedJustNow: params.ringsClosedJustNow,
    streakDays: params.profile.streakDays,
    freezeTickets: params.profile.freezeTickets,
    ticketEarned: params.ticketEarned,
    newBadges: params.newBadges,
    configVersion: params.configVersion,
    ...(params.replayed ? { replayed: true } : {}),
  }
}

export async function getActiveEnrollmentForStudent(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { deck: true, class: true, student: true },
  })
  if (!enrollment || enrollment.studentId !== studentId || enrollment.archivedAt || !enrollment.deck) {
    return null
  }
  return enrollment
}

async function computeClearedCampDaysCount(
  db: PrismaClient,
  studentId: string,
  enrollmentId: string,
): Promise<number> {
  const tasks = await db.dailyStudyTask.findMany({
    where: { enrollmentId },
    orderBy: { studyDate: 'asc' },
    include: {
      sessions: {
        where: { cleared: true },
        select: { level: true },
      },
    },
  })
  const dailyStates = await db.dailyGameState.findMany({
    where: { studentId },
    select: { localDate: true, levelsPassed: true },
  })
  const byDate = new Map(dailyStates.map((d) => [d.localDate, d.levelsPassed]))

  let highestCleared = 0
  let fallbackIdx = 0
  const unassignedTasks = tasks.filter((t) => t.campDay == null)
  for (let day = 1; day <= ZHONGKAO_23_DAYS.length; day++) {
    const explicit = tasks.find((t) => t.campDay === day)
    const task = explicit ?? (unassignedTasks[fallbackIdx++] ?? null)
    if (!task) continue
    const clearedLevels = new Set(task.sessions.map((s) => s.level as string))
    for (const lvl of byDate.get(task.studyDate) ?? []) clearedLevels.add(lvl)
    if (clearedLevels.has('L1') && clearedLevels.has('L2') && clearedLevels.has('L3')) {
      highestCleared = day
    }
  }
  return highestCleared
}

function computeBossStreakDays(bossDatesDesc: string[]): number {
  if (bossDatesDesc.length === 0) return 0
  const uniqueDesc = [...new Set(bossDatesDesc)].sort((a, b) => b.localeCompare(a))
  let best = 1
  let run = 1
  for (let i = 1; i < uniqueDesc.length; i++) {
    if (diffCalendarDays(uniqueDesc[i], uniqueDesc[i - 1]) === 1) {
      run += 1
      if (run > best) best = run
    } else {
      run = 1
    }
  }
  return best
}

async function gatherBadgeMetrics(
  db: PrismaClient,
  studentId: string,
  enrollmentId: string,
  deckId: string,
  classId: string,
  profile: { streakDays: number; longestStreak: number },
  ringsClosedToday: boolean,
  now: Date,
): Promise<Record<BadgeDef['metric'], number>> {
  const [
    goldPlusCards,
    bossStates,
    comebackCount,
    weakBossWins,
    weakClearDays,
    highestCampDay,
    currentChallenge,
    mnemonicCreated,
    squadWeeklyWins,
    stage4Instances,
  ] = await Promise.all([
    db.cardInstance.count({ where: { deckId, bestStage: { gte: 6 } } }),
    db.dailyGameState.findMany({
      where: { studentId, levelsPassed: { has: 'BOSS' } },
      select: { localDate: true },
    }),
    db.gameEvent.count({ where: { studentId, type: 'COMEBACK_EASY' } }),
    db.gameEvent.count({ where: { studentId, type: 'WEAK_BOSS_WIN' } }),
    db.gameEvent.count({ where: { studentId, type: { in: ['WEAK_BOSS_WIN', 'WEAK_CLEAR_DAY'] } } }),
    computeClearedCampDaysCount(db, studentId, enrollmentId),
    (db as any).classChallenge?.findFirst
      ? db.classChallenge.findFirst({
          where: { classId, weekStart: shanghaiTimeParts(now).weekStart },
        })
      : Promise.resolve(null),
    (db as any).mnemonicEntry?.count
      ? db.mnemonicEntry.count({ where: { authorId: studentId, authorRole: 'STUDENT', status: 'APPROVED' } })
      : Promise.resolve(0),
    (db as any).squadWeek?.count
      ? db.squadWeek.count({
          where: {
            achieved: true,
            squad: { classId, members: { some: { studentId } } },
          },
        })
      : Promise.resolve(0),
    db.cardInstance.findMany({
      where: { deckId, bestStage: { gte: 4 } },
      select: { card: { select: { word: true } } },
    }),
  ])

  let classChallengeWins = 0
  if (currentChallenge && currentChallenge.status === 'COMPLETED') {
    const participated = await db.gameEvent.count({
      where: {
        studentId,
        localDate: { gte: currentChallenge.weekStart },
      },
    })
    if (participated > 0) classChallengeWins = 1
  }

  let seasonStage4Pct = 0
  if (stage4Instances && stage4Instances.length > 0) {
    const uniqueStage4 = new Set(
      stage4Instances
        .map((i: any) => i.card?.word?.trim().toLowerCase())
        .filter((w: string | undefined): w is string => Boolean(w && lookupZhongkaoWord(w))),
    )
    seasonStage4Pct = Math.min(100, Math.round((uniqueStage4.size / 688) * 100))
  }

  return {
    streak_days: Math.max(profile.streakDays, profile.longestStreak),
    gold_plus_cards: goldPlusCards,
    boss_clears: bossStates.length,
    boss_streak_days: computeBossStreakDays(bossStates.map((b) => b.localDate)),
    camp_day_cleared: highestCampDay,
    comeback_easy_cards: comebackCount,
    weak_boss_wins: weakBossWins,
    weak_clear_days: weakClearDays,
    graduation_23d: highestCampDay >= 23 && ringsClosedToday ? 1 : 0,
    class_challenge_wins: classChallengeWins,
    mnemonic_created: mnemonicCreated,
    squad_weekly_wins: squadWeeklyWins,
    season_stage4_pct: seasonStage4Pct,
  }
}

export async function evaluateAndAwardBadgesInTx(
  tx: PrismaClient,
  studentId: string,
  enrollmentId: string,
  deckId: string,
  classId: string,
  profile: { streakDays: number; longestStreak: number },
  ringsClosedToday: boolean,
  config: GameConfig,
  now: Date,
): Promise<NewBadgeInfo[]> {
  const existing = await tx.studentBadge.findMany({
    where: { studentId },
    select: { badgeKey: true },
  })
  const owned = new Set(existing.map((b) => b.badgeKey))
  const candidates = config.badges.filter((b) => !owned.has(b.key))
  if (candidates.length === 0) return []

  const metrics = await gatherBadgeMetrics(
    tx,
    studentId,
    enrollmentId,
    deckId,
    classId,
    profile,
    ringsClosedToday,
    now,
  )

  const newlyEarned: NewBadgeInfo[] = []
  for (const badge of candidates) {
    const val = metrics[badge.metric] ?? 0
    if (val >= badge.target) {
      try {
        await tx.studentBadge.create({
          data: { studentId, badgeKey: badge.key, earnedAt: now },
        })
        newlyEarned.push({
          key: badge.key,
          name: badge.name,
          icon: badge.icon,
          description: badge.description,
        })
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err
      }
    }
  }
  return newlyEarned
}

export interface RecordGameEventParams {
  tx: PrismaClient
  studentId: string
  enrollmentId: string
  deckId: string
  classId: string
  type: 'REVIEW_GRADE' | 'LEVEL_CLEAR' | 'WEAK_RESTUDY' | 'WEAK_BOSS_WIN' | 'COMEBACK_EASY' | 'WEAK_CLEAR_DAY' | 'MNEMONIC_CREATE' | 'SQUAD_WEEKLY_GOAL'
  sourceId: string
  baseXp: number
  localDate: string
  now: Date
  config: GameConfig
  configVersion: string
  meta?: Record<string, unknown>
  countAsReviewCardIds?: string[]
  levelCleared?: string
  markWeakBossDone?: boolean
  isWeakRestudy?: boolean
}

export async function recordGameRewardEventInTx(
  params: RecordGameEventParams,
): Promise<RewardFeedback> {
  const {
    tx,
    studentId,
    enrollmentId,
    deckId,
    classId,
    type,
    sourceId,
    localDate,
    now,
    config,
    configVersion,
  } = params

  const { profile, dailyState } = await ensureProfileAndDailyState(
    tx,
    studentId,
    deckId,
    localDate,
    config,
    now,
  )

  const duplicate = await tx.gameEvent.findUnique({
    where: { studentId_type_sourceId: { studentId, type, sourceId } },
  })
  if (duplicate) {
    return buildFeedbackFromState({
      xp: 0,
      bonusXp: 0,
      profile,
      dailyState,
      levelUp: null,
      ringsClosedJustNow: false,
      ticketEarned: 0,
      newBadges: [],
      config,
      configVersion,
      replayed: true,
    })
  }

  let effectiveBaseXp = Math.max(0, Math.floor(params.baseXp))
  if (params.isWeakRestudy) {
    const todayRestudyCount = await tx.gameEvent.count({
      where: { studentId, type: 'WEAK_RESTUDY', localDate, xp: { gt: 0 } },
    })
    if (todayRestudyCount >= config.weakRetryMaxPerDay) {
      effectiveBaseXp = 0
    }
  }

  const primaryClamp = clampDailyXp(effectiveBaseXp, dailyState.xpEarned, config)
  const awardedXp = primaryClamp.awarded

  try {
    await tx.gameEvent.create({
      data: {
        studentId,
        type,
        sourceId,
        xp: awardedXp,
        sugarCrystalRatio: config.sugarCrystalRatio,
        localDate,
        meta: { ...(params.meta ?? {}), configVersion } as any,
        createdAt: now,
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return buildFeedbackFromState({
        xp: 0,
        bonusXp: 0,
        profile,
        dailyState,
        levelUp: null,
        ringsClosedJustNow: false,
        ticketEarned: 0,
        newBadges: [],
        config,
        configVersion,
        replayed: true,
      })
    }
    throw err
  }

  let xpEarnedToday = dailyState.xpEarned + awardedXp
  const reviewedSet = new Set(dailyState.reviewedCardIds)
  for (const cid of params.countAsReviewCardIds ?? []) {
    reviewedSet.add(cid)
  }
  const nextReviewedIds = [...reviewedSet]
  const nextReviewDone = nextReviewedIds.length

  const levelsSet = new Set(dailyState.levelsPassed)
  if (params.levelCleared) levelsSet.add(params.levelCleared)
  const nextLevelsPassed = [...levelsSet]
  const nextWeakBossDone = dailyState.weakBossDone || Boolean(params.markWeakBossDone)

  const ringCheck = ringProgress(
    {
      reviewDue: dailyState.reviewDue,
      reviewDone: nextReviewDone,
      levelsPassed: nextLevelsPassed,
    },
    config,
  )

  let bonusXp = 0
  let ringsClosedJustNow = false
  let nextStreakState = {
    streakDays: profile.streakDays,
    longestStreak: profile.longestStreak,
    freezeTickets: profile.freezeTickets,
    lastAchievedDate: profile.lastAchievedDate,
    streakCursorDate: profile.streakCursorDate,
    ticketEarned: 0,
  }

  if (ringCheck.ringsClosed && !dailyState.ringsClosed) {
    ringsClosedJustNow = true
    const bonusClamp = clampDailyXp(config.ringsClosedXp, xpEarnedToday, config)
    bonusXp = bonusClamp.awarded
    try {
      await tx.gameEvent.create({
        data: {
          studentId,
          type: 'RINGS_CLOSED',
          sourceId: localDate,
          xp: bonusXp,
          sugarCrystalRatio: config.sugarCrystalRatio,
          localDate,
          meta: { configVersion } as any,
          createdAt: now,
        },
      })
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err
      bonusXp = 0
    }
    xpEarnedToday += bonusXp

    const transitioned = nextStreak(
      {
        streakDays: profile.streakDays,
        longestStreak: profile.longestStreak,
        freezeTickets: profile.freezeTickets,
        lastAchievedDate: profile.lastAchievedDate,
        streakCursorDate: profile.streakCursorDate,
      },
      true,
      localDate,
      config,
    )
    nextStreakState = {
      streakDays: transitioned.streakDays,
      longestStreak: transitioned.longestStreak,
      freezeTickets: transitioned.freezeTickets,
      lastAchievedDate: transitioned.lastAchievedDate,
      streakCursorDate: transitioned.streakCursorDate,
      ticketEarned: transitioned.ticketEarned,
    }
  }

  const updatedDaily = await tx.dailyGameState.update({
    where: { studentId_localDate: { studentId, localDate } },
    data: {
      xpEarned: xpEarnedToday,
      reviewDone: nextReviewDone,
      reviewedCardIds: nextReviewedIds,
      levelsPassed: nextLevelsPassed,
      ringsClosed: dailyState.ringsClosed || ringCheck.ringsClosed,
      weakBossDone: nextWeakBossDone,
    },
  })

  const prevLevelInfo = levelFromXp(profile.totalXp, config)
  const newTotalXp = profile.totalXp + awardedXp + bonusXp
  const newLevelInfo = levelFromXp(newTotalXp, config)
  const levelUp =
    newLevelInfo.level > prevLevelInfo.level
      ? {
          fromLevel: prevLevelInfo.level,
          toLevel: newLevelInfo.level,
          newTitle: newLevelInfo.title,
        }
      : null

  const updatedProfile = await tx.studentGameProfile.update({
    where: { studentId },
    data: {
      totalXp: newTotalXp,
      level: newLevelInfo.level,
      streakDays: nextStreakState.streakDays,
      longestStreak: nextStreakState.longestStreak,
      freezeTickets: nextStreakState.freezeTickets,
      lastAchievedDate: nextStreakState.lastAchievedDate,
      streakCursorDate: nextStreakState.streakCursorDate,
      lastStudiedDate: localDate,
    },
  })

  const newBadges = await evaluateAndAwardBadgesInTx(
    tx,
    studentId,
    enrollmentId,
    deckId,
    classId,
    updatedProfile,
    updatedDaily.ringsClosed,
    config,
    now,
  )

  if (ringsClosedJustNow) {
    await recordServerAnalyticsEvent(tx, {
      studentId,
      classId,
      type: 'rings_closed',
      clientEventId: `rings-closed-${studentId}-${localDate}`,
      props: { streakDays: updatedProfile.streakDays, bonusXp },
      now,
    })
  }
  if (params.levelCleared === 'BOSS') {
    await recordServerAnalyticsEvent(tx, {
      studentId,
      classId,
      type: 'boss_clear',
      clientEventId: `boss-clear-${studentId}-${localDate}`,
      props: { campDay: (params.meta as any)?.campDay ?? null },
      now,
    })
  }
  for (const b of newBadges) {
    await recordServerAnalyticsEvent(tx, {
      studentId,
      classId,
      type: 'badge_earned',
      clientEventId: `badge-${studentId}-${b.key}`,
      props: { badgeKey: b.key },
      now,
    })
  }

  return buildFeedbackFromState({
    xp: awardedXp,
    bonusXp,
    profile: updatedProfile,
    dailyState: updatedDaily,
    levelUp,
    ringsClosedJustNow,
    ticketEarned: nextStreakState.ticketEarned,
    newBadges,
    config,
    configVersion,
  })
}

export async function recordComebackIfEligibleInTx(
  tx: PrismaClient,
  studentId: string,
  cardInstanceId: string,
  grade: number,
  localDate: string,
  configVersion: string,
  now: Date,
): Promise<void> {
  if (grade !== 4) return
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
  const priorAgain = await tx.reviewEvent.findFirst({
    where: {
      cardInstanceId,
      grade: 1,
      reviewedAt: { lte: sevenDaysAgo },
    },
    select: { id: true },
  })
  if (!priorAgain) return
  try {
    await tx.gameEvent.create({
      data: {
        studentId,
        type: 'COMEBACK_EASY',
        sourceId: cardInstanceId,
        xp: 0,
        localDate,
        meta: { configVersion } as any,
        createdAt: now,
      },
    })
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err
  }
}

export async function countTomorrowDueCards(
  prisma: PrismaClient,
  deckId: string,
  now: Date = new Date(),
): Promise<number> {
  const { end: todayEnd } = shanghaiDayBounds(now)
  const tomorrowEnd = new Date(todayEnd.getTime() + 86_400_000)
  return prisma.cardInstance.count({
    where: {
      deckId,
      state: { in: ['LEARNING', 'REVIEW', 'RELEARNING'] },
      due: { gt: now, lte: tomorrowEnd },
    },
  })
}

// ── Weak Word Pool (F7) ─────────────────────────────────────────────────────

export async function getWeakBossPool(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
  const localDate = shanghaiDateString(now)

  const recentAgains = await prisma.reviewEvent.findMany({
    where: {
      grade: 1,
      reviewedAt: { gte: sevenDaysAgo },
      cardInstance: { deckId: enrollment.deck!.id },
    },
    orderBy: { reviewedAt: 'desc' },
    include: {
      cardInstance: {
        include: { card: true },
      },
    },
  })

  const seen = new Set<string>()
  const words: Array<{
    instanceId: string
    cardId: string
    word: string
    ipa: string | null
    definitionL1: string | null
    definitionL2: string | null
    stage: number
    mnemonic: unknown
  }> = []

  for (const ev of recentAgains) {
    const inst = ev.cardInstance
    if (!inst || seen.has(inst.id)) continue
    seen.add(inst.id)
    const stage = mapFsrsToEbbinghausStage(inst.state as any, inst.stability, inst.reps)
    if (stage > 2) continue
    const zk = lookupZhongkaoWord(inst.card.word)
    words.push({
      instanceId: inst.id,
      cardId: inst.cardId,
      word: inst.card.word,
      ipa: inst.card.ipa ?? zk?.ipa ?? null,
      definitionL1: inst.definitionL1 ?? inst.card.definitionL1,
      definitionL2: inst.card.definitionL2,
      stage,
      mnemonic: inst.card.mnemonic ?? zk?.mnemonic ?? null,
    })
    if (words.length >= 10) break
  }

  const daily = await prisma.dailyGameState.findUnique({
    where: { studentId_localDate: { studentId, localDate } },
    select: { weakBossDone: true },
  })

  return {
    available: words.length > 0,
    wordCount: words.length,
    alreadyClearedToday: Boolean(daily?.weakBossDone),
    words,
  }
}

// ── Class Challenge Helper (F8) ─────────────────────────────────────────────

export async function getClassChallengeProgress(
  prisma: PrismaClient,
  classId: string,
  now: Date = new Date(),
) {
  const { weekStart } = shanghaiTimeParts(now)
  const [enrollments, setting, challenge] = await Promise.all([
    prisma.enrollment.findMany({
      where: { classId, archivedAt: null },
      select: { studentId: true },
    }),
    prisma.classGameSetting.findUnique({ where: { classId } }),
    prisma.classChallenge.findUnique({ where: { classId_weekStart: { classId, weekStart } } }),
  ])

  const studentIds = [...new Set(enrollments.map((e) => e.studentId))]
  const totalStudents = studentIds.length
  const targetCount = challenge?.targetCount ?? setting?.weeklyTargetCards ?? Math.max(50, totalStudents * 25)
  const title = challenge?.title ?? '本周全班挑战 · 到期复习清零'

  if (studentIds.length === 0) {
    return {
      weekStart,
      title,
      targetCount,
      currentCount: 0,
      participatingStudents: 0,
      totalStudents: 0,
      completed: false,
      progressPct: 0,
    }
  }

  const weeklyStates = await prisma.dailyGameState.findMany({
    where: {
      studentId: { in: studentIds },
      localDate: { gte: weekStart },
    },
    select: { studentId: true, reviewDone: true, xpEarned: true },
  })

  let currentCount = 0
  const participants = new Set<string>()
  for (const row of weeklyStates) {
    currentCount += row.reviewDone
    if (row.reviewDone > 0 || row.xpEarned > 0) {
      participants.add(row.studentId)
    }
  }
  const completed = currentCount >= targetCount

  return {
    weekStart,
    title,
    targetCount,
    currentCount,
    participatingStudents: participants.size,
    totalStudents,
    completed,
    progressPct: targetCount > 0 ? Math.min(100, Math.round((currentCount / targetCount) * 100)) : 0,
  }
}

// ── Student Summary (F1, F2, F5, F8, F10) ───────────────────────────────────

export interface StudentGameSummaryResponse {
  studyDate: string
  weekStart: string
  configVersion: string
  lateNightQuiet: boolean
  profile: {
    nickname: string
    avatarKey: string
    avatarFrame: string
    cardSkin: string
    soundEnabled: boolean
    streakDays: number
    longestStreak: number
    freezeTickets: number
    lastAchievedDate: string | null
    fontScale: string
    reduceMotion: boolean
    lowSpecMode: boolean
    unlockedSkins: string[]
  }
  classSettings: {
    mnemonicCoCreateOpen: boolean
    squadEnabled: boolean
    activePackId: string | null
  }
  level: GamificationLevelInfo
  today: {
    xpEarned: number
    dailyCap: number
    remainingDailyXp: number
    capped: boolean
    rings: RingProgressResult
    weakBossDone: boolean
  }
  weekDays: Array<{
    localDate: string
    label: string
    ringsClosed: boolean
    xpEarned: number
    isToday: boolean
  }>
  tomorrowDueCount: number
  weakWordCount: number
  badgesEarnedCount: number
  badgesTotalCount: number
  classChallenge: Awaited<ReturnType<typeof getClassChallengeProgress>>
  unreadCheers: Array<{
    id: string
    senderName: string
    presetKey: string
    message: string
    sticker: string
    createdAt: Date
  }>
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export async function getStudentGameSummary(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
): Promise<StudentGameSummaryResponse | null> {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const { config, configVersion } = await getEffectiveGameConfig(prisma, enrollment.classId)
  const { localDate, weekStart } = shanghaiTimeParts(now)
  const deckId = enrollment.deck!.id

  const { profile, dailyState } = await prisma.$transaction((tx) =>
    ensureProfileAndDailyState(tx as unknown as PrismaClient, studentId, deckId, localDate, config, now),
  )

  const weekEnd = addCalendarDays(weekStart, 6)
  const [weekRows, tomorrowDueCount, weakPool, badgesCount, classChallenge, cheers, classSetting] = await Promise.all([
    prisma.dailyGameState.findMany({
      where: { studentId, localDate: { gte: weekStart, lte: weekEnd } },
      select: { localDate: true, ringsClosed: true, xpEarned: true },
    }),
    countTomorrowDueCards(prisma, deckId, now),
    getWeakBossPool(prisma, studentId, enrollmentId, now),
    prisma.studentBadge.count({ where: { studentId } }),
    getClassChallengeProgress(prisma, enrollment.classId, now),
    prisma.teacherCheer.findMany({
      where: {
        classId: enrollment.classId,
        OR: [{ studentId: null }, { studentId }],
        reads: { none: { studentId } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        senderName: true,
        presetKey: true,
        message: true,
        sticker: true,
        createdAt: true,
      },
    }),
    (prisma as any).classGameSetting?.findUnique
      ? prisma.classGameSetting.findUnique({ where: { classId: enrollment.classId } })
      : Promise.resolve(null),
  ])

  const rowByDate = new Map(weekRows.map((r) => [r.localDate, r]))
  const weekDays = WEEKDAY_LABELS.map((label, idx) => {
    const d = addCalendarDays(weekStart, idx)
    const row = rowByDate.get(d)
    return {
      localDate: d,
      label: `周${label}`,
      ringsClosed: Boolean(row?.ringsClosed),
      xpEarned: row?.xpEarned ?? 0,
      isToday: d === localDate,
    }
  })

  const rings = ringProgress(
    {
      reviewDue: dailyState.reviewDue,
      reviewDone: dailyState.reviewDone,
      levelsPassed: dailyState.levelsPassed,
    },
    config,
  )
  const remainingDailyXp = Math.max(0, config.dailyXpCap - dailyState.xpEarned)

  return {
    studyDate: localDate,
    weekStart,
    configVersion,
    lateNightQuiet: isLateNightQuiet(now, config),
    profile: {
      nickname: profile.nickname || defaultNicknameForStudent(studentId),
      avatarKey: profile.avatarKey,
      avatarFrame: profile.avatarFrame,
      cardSkin: profile.cardSkin,
      soundEnabled: profile.soundEnabled,
      streakDays: profile.streakDays,
      longestStreak: profile.longestStreak,
      freezeTickets: profile.freezeTickets,
      lastAchievedDate: profile.lastAchievedDate,
      fontScale: (profile as any).fontScale ?? 'normal',
      reduceMotion: Boolean((profile as any).reduceMotion),
      lowSpecMode: Boolean((profile as any).lowSpecMode),
      unlockedSkins: Array.isArray((profile as any).unlockedSkins) ? (profile as any).unlockedSkins : [],
    },
    classSettings: {
      mnemonicCoCreateOpen: Boolean((classSetting as any)?.mnemonicCoCreateOpen),
      squadEnabled: Boolean((classSetting as any)?.squadEnabled),
      activePackId: (classSetting as any)?.activePackId ?? null,
    },
    level: levelFromXp(profile.totalXp, config),
    today: {
      xpEarned: dailyState.xpEarned,
      dailyCap: config.dailyXpCap,
      remainingDailyXp,
      capped: remainingDailyXp === 0,
      rings,
      weakBossDone: dailyState.weakBossDone,
    },
    weekDays,
    tomorrowDueCount,
    weakWordCount: weakPool?.wordCount ?? 0,
    badgesEarnedCount: badgesCount,
    badgesTotalCount: config.badges.length,
    classChallenge,
    unreadCheers: cheers,
  }
}

// ── 23-Day Camp Map (F3) ────────────────────────────────────────────────────

export async function getCampMap(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const [tasks, dailyStates, instances] = await Promise.all([
    prisma.dailyStudyTask.findMany({
      where: { enrollmentId },
      orderBy: { studyDate: 'asc' },
      include: {
        sessions: {
          where: { cleared: true },
          select: { level: true },
        },
      },
    }),
    prisma.dailyGameState.findMany({
      where: { studentId },
      select: { localDate: true, levelsPassed: true },
    }),
    prisma.cardInstance.findMany({
      where: { deckId: enrollment.deck!.id },
      include: { card: { select: { word: true } } },
    }),
  ])

  const stateByDate = new Map(dailyStates.map((d) => [d.localDate, d.levelsPassed]))
  const wordStageMap = new Map<string, number>()
  for (const inst of instances) {
    const key = inst.card.word.trim().toLowerCase()
    const currentStage =
      inst.state === 'NEW' && inst.reps <= 0
        ? -1
        : mapFsrsToEbbinghausStage(inst.state as any, inst.stability, inst.reps)
    const effective = Math.max(inst.bestStage ?? -1, currentStage)
    const prev = wordStageMap.get(key) ?? -1
    if (effective > prev) wordStageMap.set(key, effective)
  }

  const unassignedTasks = tasks.filter((t) => t.campDay == null)
  let unassignedCursor = 0

  let firstUnclearedSeen = false
  let currentDay = 1
  let clearedDays = 0
  let totalStars = 0

  const days = ZHONGKAO_23_DAYS.map((dayItem) => {
    const explicitTask = tasks.find((t) => t.campDay === dayItem.day)
    const task = explicitTask ?? (unassignedTasks[unassignedCursor++] ?? null)
    const clearedSet = new Set<string>(task?.sessions.map((s) => s.level as string) ?? [])
    if (task) {
      for (const lvl of stateByDate.get(task.studyDate) ?? []) clearedSet.add(lvl)
    }

    const l1To3Done = clearedSet.has('L1') && clearedSet.has('L2') && clearedSet.has('L3')
    const bossDone = clearedSet.has('BOSS')

    let stage4Count = 0
    let learnedCount = 0
    for (const w of dayItem.words) {
      const st = wordStageMap.get(w.word.trim().toLowerCase()) ?? -1
      if (st >= 0) learnedCount += 1
      if (st >= 4) stage4Count += 1
    }

    const starInfo = computeCampNodeStars({
      l1To3Done,
      bossDone,
      stage4Count,
      totalWords: dayItem.words.length,
    })

    let status: 'CLEARED' | 'IN_PROGRESS' | 'LOCKED'
    if (l1To3Done) {
      status = 'CLEARED'
      clearedDays += 1
    } else if (!firstUnclearedSeen) {
      status = 'IN_PROGRESS'
      firstUnclearedSeen = true
      currentDay = dayItem.day
    } else if (task !== null || learnedCount > 0) {
      status = 'IN_PROGRESS'
    } else {
      status = 'LOCKED'
    }

    totalStars += starInfo.stars

    return {
      day: dayItem.day,
      totalWords: dayItem.words.length,
      learnedCount,
      stage4Count,
      stage4Target: starInfo.stage4Target,
      l1To3Done,
      bossDone,
      stars: starInfo.stars,
      status,
      isMajorBoss: dayItem.day === 7 || dayItem.day === 14 || dayItem.day === 21,
      isFinale: dayItem.day === 23,
    }
  })

  if (!firstUnclearedSeen && clearedDays === ZHONGKAO_23_DAYS.length) {
    currentDay = 23
  }

  return {
    days,
    currentDay,
    clearedDays,
    totalStars,
    maxStars: ZHONGKAO_23_DAYS.length * 3,
  }
}

// ── 688-Card Album & Rarities (F4) ──────────────────────────────────────────

export async function getCardAlbum(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  dayParam?: number,
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const [instances, overlays] = await Promise.all([
    prisma.cardInstance.findMany({
      where: { deckId: enrollment.deck!.id },
      include: { card: { select: { word: true } } },
    }),
    getRuntimeMnemonicOverlays(prisma),
  ])

  const wordMap = new Map<
    string,
    { bestStage: number | null; currentStage: number; due: Date }
  >()

  for (const inst of instances) {
    const key = inst.card.word.trim().toLowerCase()
    const currentStage =
      inst.state === 'NEW' && inst.reps <= 0
        ? -1
        : mapFsrsToEbbinghausStage(inst.state as any, inst.stability, inst.reps)
    const effectiveBest =
      inst.bestStage !== null && inst.bestStage !== undefined
        ? Math.max(inst.bestStage, currentStage >= 0 ? currentStage : inst.bestStage)
        : currentStage >= 0
          ? currentStage
          : null

    const prev = wordMap.get(key)
    if (!prev || (effectiveBest ?? -1) > (prev.bestStage ?? -1)) {
      wordMap.set(key, {
        bestStage: effectiveBest,
        currentStage: Math.max(0, currentStage),
        due: inst.due,
      })
    }
  }

  let totalWords = 0
  let collectedCount = 0
  let candyCount = 0
  let silverCount = 0
  let goldCount = 0
  let diamondCount = 0

  const daySummaries = ZHONGKAO_23_DAYS.map((dayItem) => {
    let dayCollected = 0
    let dayDiamond = 0
    for (const w of dayItem.words) {
      totalWords += 1
      const entry = wordMap.get(w.word.trim().toLowerCase())
      const rarity = rarityFromStage(entry?.bestStage)
      if (rarity) {
        collectedCount += 1
        dayCollected += 1
        if (rarity.key === 'CANDY') candyCount += 1
        else if (rarity.key === 'SILVER') silverCount += 1
        else if (rarity.key === 'GOLD') goldCount += 1
        else if (rarity.key === 'DIAMOND') {
          diamondCount += 1
          dayDiamond += 1
        }
      }
    }
    return {
      day: dayItem.day,
      totalWords: dayItem.words.length,
      collectedCount: dayCollected,
      diamondCount: dayDiamond,
    }
  })

  const targetDay = dayParam && dayParam >= 1 && dayParam <= 23 ? dayParam : 1
  const selected = ZHONGKAO_23_DAYS.find((d) => d.day === targetDay) ?? ZHONGKAO_23_DAYS[0]
  const cards = selected.words.map((w) => {
    const key = w.word.trim().toLowerCase()
    const entry = wordMap.get(key)
    const bestStage = entry?.bestStage ?? null
    const rarity = rarityFromStage(bestStage)
    const patchedMnemonic = overlays.teacherPatches.get(key) ?? w.mnemonic ?? null
    return {
      word: w.word,
      ipa: w.ipa,
      meaning: w.meaning,
      mnemonic: patchedMnemonic,
      studentAlternatives: overlays.studentAlternatives.get(key) ?? [],
      collected: rarity !== null,
      bestStage,
      currentStage: entry?.currentStage ?? 0,
      rarity,
    }
  })

  return {
    summary: {
      totalWords,
      collectedCount,
      candyCount,
      silverCount,
      goldCount,
      diamondCount,
    },
    day: selected.day,
    daySummaries,
    cards,
  }
}

// ── Badges Wall (F6) ────────────────────────────────────────────────────────

function badgeProgressText(def: BadgeDef, current: number, earned: boolean): string {
  if (earned) return '已解锁'
  const remaining = Math.max(0, def.target - current)
  switch (def.metric) {
    case 'streak_days':
      return `再坚持 ${remaining} 天`
    case 'gold_plus_cards':
      return `已收集 ${current}/${def.target} 张金箔+卡`
    case 'boss_clears':
      return '通关 1 次每日 BOSS'
    case 'boss_streak_days':
      return `已连胜 ${current}/${def.target} 天`
    case 'camp_day_cleared':
      return `当前已推进至 D${current}/${def.target}`
    case 'comeback_easy_cards':
      return `已逆袭 ${current}/${def.target} 词`
    case 'weak_boss_wins':
      return '击败 1 次弱词 Boss'
    case 'weak_clear_days':
      return '完成一轮弱词清零'
    case 'graduation_23d':
      return '通关 D23 并合拢当日双环'
    case 'class_challenge_wins':
      return '参与并达成一次班级周挑战'
    case 'mnemonic_created':
      return '贡献 1 条通过审核的同学版口诀'
    case 'squad_weekly_wins':
      return '和搭子共同达成 1 次小队周目标'
    case 'season_stage4_pct':
      return `赛季 4 阶词进度 ${current}%/${def.target}%`
    default:
      return `${current}/${def.target}`
  }
}

export async function getStudentBadges(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const { config } = await getEffectiveGameConfig(prisma, enrollment.classId)
  const localDate = shanghaiDateString(now)
  const [profile, dailyState, earnedRows] = await Promise.all([
    prisma.studentGameProfile.findUnique({ where: { studentId } }),
    prisma.dailyGameState.findUnique({ where: { studentId_localDate: { studentId, localDate } } }),
    prisma.studentBadge.findMany({ where: { studentId } }),
  ])

  const metrics = await gatherBadgeMetrics(
    prisma,
    studentId,
    enrollmentId,
    enrollment.deck!.id,
    enrollment.classId,
    {
      streakDays: profile?.streakDays ?? 0,
      longestStreak: profile?.longestStreak ?? 0,
    },
    Boolean(dailyState?.ringsClosed),
    now,
  )

  const earnedMap = new Map(earnedRows.map((r) => [r.badgeKey, r.earnedAt]))

  const badges = config.badges.map((def) => {
    const earnedAt = earnedMap.get(def.key) ?? null
    const earned = earnedAt !== null
    const currentValue = Math.min(def.target, metrics[def.metric] ?? 0)
    return {
      ...def,
      earned,
      earnedAt,
      currentValue,
      progressText: badgeProgressText(def, currentValue, earned),
    }
  })

  return {
    earnedCount: earnedRows.length,
    totalCount: badges.length,
    badges,
  }
}

// ── Class Improvement Leaderboard (F9 — Default OFF, Nickname & Avatar only) ─

export async function getClassLeaderboard(
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
  if (!setting?.leaderboardOpen) {
    return { enabled: false, weekStart: shanghaiTimeParts(now).weekStart, entries: [], myEntry: null }
  }

  const { weekStart, localDate } = shanghaiTimeParts(now)
  const lastWeekStart = addCalendarDays(weekStart, -7)
  const lastWeekEnd = addCalendarDays(weekStart, -1)

  const classEnrollments = await prisma.enrollment.findMany({
    where: { classId: enrollment.classId, archivedAt: null },
    select: {
      studentId: true,
      student: {
        select: {
          gameProfile: {
            select: { nickname: true, avatarKey: true, avatarFrame: true },
          },
        },
      },
    },
  })

  const studentIds = classEnrollments.map((e) => e.studentId)
  const events = await prisma.gameEvent.findMany({
    where: {
      studentId: { in: studentIds },
      localDate: { gte: lastWeekStart, lte: localDate },
    },
    select: { studentId: true, xp: true, localDate: true },
  })

  const thisWeekMap = new Map<string, number>()
  const lastWeekMap = new Map<string, number>()
  for (const ev of events) {
    if (ev.localDate >= weekStart) {
      thisWeekMap.set(ev.studentId, (thisWeekMap.get(ev.studentId) ?? 0) + ev.xp)
    } else if (ev.localDate >= lastWeekStart && ev.localDate <= lastWeekEnd) {
      lastWeekMap.set(ev.studentId, (lastWeekMap.get(ev.studentId) ?? 0) + ev.xp)
    }
  }

  const ranked = classEnrollments
    .map((e) => {
      const thisWeekXp = thisWeekMap.get(e.studentId) ?? 0
      const lastWeekXp = lastWeekMap.get(e.studentId) ?? 0
      const deltaXp = thisWeekXp - lastWeekXp
      return {
        studentId: e.studentId,
        nickname: e.student.gameProfile?.nickname || defaultNicknameForStudent(e.studentId),
        avatarKey: e.student.gameProfile?.avatarKey ?? 'vanilla',
        avatarFrame: e.student.gameProfile?.avatarFrame ?? 'vanilla',
        thisWeekXp,
        lastWeekXp,
        deltaXp,
      }
    })
    .sort((a, b) => b.deltaXp - a.deltaXp || b.thisWeekXp - a.thisWeekXp || a.studentId.localeCompare(b.studentId))

  const allWithRank = ranked.map((item, idx) => ({
    rank: idx + 1,
    nickname: item.nickname,
    avatarKey: item.avatarKey,
    avatarFrame: item.avatarFrame,
    deltaXp: item.deltaXp,
    thisWeekXp: item.thisWeekXp,
    isSelf: item.studentId === studentId,
  }))

  const myEntry = allWithRank.find((e) => e.isSelf) ?? null
  return {
    enabled: true,
    weekStart,
    entries: allWithRank.slice(0, 10),
    myEntry,
  }
}

export async function updateStudentGameProfile(
  prisma: PrismaClient,
  studentId: string,
  input: {
    nickname?: string
    avatarKey?: string
    avatarFrame?: string
    cardSkin?: string
    soundEnabled?: boolean
    fontScale?: 'normal' | 'large' | 'xlarge'
    reduceMotion?: boolean
    lowSpecMode?: boolean
  },
) {
  const existing = await prisma.studentGameProfile.findUnique({ where: { studentId } })
  if (!existing) {
    return prisma.studentGameProfile.create({
      data: {
        studentId,
        nickname: input.nickname?.trim() || defaultNicknameForStudent(studentId),
        avatarKey: input.avatarKey ?? 'vanilla',
        avatarFrame: input.avatarFrame ?? 'vanilla',
        cardSkin: input.cardSkin ?? 'classic',
        soundEnabled: input.soundEnabled ?? false,
        fontScale: input.fontScale ?? 'normal',
        reduceMotion: input.reduceMotion ?? false,
        lowSpecMode: input.lowSpecMode ?? false,
      },
    })
  }
  return prisma.studentGameProfile.update({
    where: { studentId },
    data: {
      ...(input.nickname !== undefined
        ? { nickname: input.nickname.trim() || defaultNicknameForStudent(studentId) }
        : {}),
      ...(input.avatarKey !== undefined ? { avatarKey: input.avatarKey } : {}),
      ...(input.avatarFrame !== undefined ? { avatarFrame: input.avatarFrame } : {}),
      ...(input.cardSkin !== undefined ? { cardSkin: input.cardSkin } : {}),
      ...(input.soundEnabled !== undefined ? { soundEnabled: input.soundEnabled } : {}),
      ...(input.fontScale !== undefined ? { fontScale: input.fontScale } : {}),
      ...(input.reduceMotion !== undefined ? { reduceMotion: input.reduceMotion } : {}),
      ...(input.lowSpecMode !== undefined ? { lowSpecMode: input.lowSpecMode } : {}),
    },
  })
}

export async function markCheerRead(
  prisma: PrismaClient,
  studentId: string,
  cheerId: string,
): Promise<{ ok: boolean }> {
  const cheer = await prisma.teacherCheer.findUnique({ where: { id: cheerId } })
  if (!cheer) return { ok: false }
  const enrolled = await prisma.enrollment.findFirst({
    where: { studentId, classId: cheer.classId, archivedAt: null },
  })
  if (!enrolled) return { ok: false }
  if (cheer.studentId && cheer.studentId !== studentId) return { ok: false }

  await prisma.teacherCheerRead.upsert({
    where: { cheerId_studentId: { cheerId, studentId } },
    create: { cheerId, studentId },
    update: {},
  })
  return { ok: true }
}

export { DEFAULT_GAME_CONFIG }

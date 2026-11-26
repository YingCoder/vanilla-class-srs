/**
 * Review session logic — spec §24.
 *
 * Session lifecycle:
 *  1. start  — closes any open session, builds ordered card queue, creates ReviewSession
 *  2. grade  — applies FSRS, writes ReviewEvent, handles lapse re-queue
 *  3. finish — closes session, calculates accuracyRate
 */

import { PrismaClient, FSRSState } from '@prisma/client'
import { schedule } from '@vanilla-srs/shared/fsrs'
import type { FSRSParams } from '@vanilla-srs/shared/fsrs'
import { mapFsrsToEbbinghausStage } from '@vanilla-srs/shared/ebbinghaus'
import {
  rarityFromStage,
  shanghaiDayBounds,
  xpForGrade,
} from '@vanilla-srs/shared/gamification'
import { preferHighestRetentionDueFirst } from '@vanilla-srs/shared/world'
import { lookupZhongkaoWord, type WordMnemonic } from '@vanilla-srs/shared/vocab'
import { DEFAULT_MIN_CARDS_PER_SESSION, getWeeklyGoal, WeeklyGoal } from './homework.service'
import { computeStreakAndBestDay } from './streak.service'
import { settleSessionRewards, type RewardSettlement } from './reward.service'
import { getEffectiveGameConfig } from './gameConfig.service'
import { getRuntimeMnemonicOverlays, type RuntimeMnemonicOverlays } from './mnemonicOverlay.service'
import { isClassSeasonActive } from './seasonPlan.service'
import {
  countTomorrowDueCards,
  getStudentGameSummary,
  getWeakBossPool,
  isGamificationAvailable,
  recordComebackIfEligibleInTx,
  recordGameRewardEventInTx,
  type RewardFeedback,
} from './gamification.service'

// Caps how many due/review cards appear in a single session — a UX/session-length decision,
// not an FSRS scheduling parameter, so it lives here rather than in the configurable
// per-deck fsrsParams JSON. Any due cards beyond this roll over to the next session/day.
// Does not apply to the separate newCardsPerDay cap on brand-new cards.
const MAX_DUE_CARDS_PER_SESSION = 20
const PERSONAL_CARD_PRIORITY = 3

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionCard {
  instanceId: string
  cardId: string
  word: string
  pos: string | null
  ipa: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null // student override first, then card default
  mnemonic: WordMnemonic | null
  state: FSRSState
  due: Date
  stability: number
  difficulty: number
  lapses: number
  reps: number
  bestStage: number | null
  lastReview: Date | null
}

export interface StartSessionResult {
  sessionId: string
  cards: SessionCard[]
  deckId: string
  /** True when an in-progress session was returned instead of creating a new one. */
  resumed?: boolean
  totalCards?: number
  /**
   * Set when `cards` is empty, so the client can offer the right next step instead of a
   * dead-end "nothing to do" screen:
   *  - 'capped'    — no learned cards available, but NEW cards exist beyond today's per-day cap.
   *                  Client can retry with `bypassNewCardCap: true`.
   *  - 'exhausted' — no cards available anywhere in the deck.
   */
  emptyReason?: 'capped' | 'exhausted'
}

export interface StartSessionOptions {
  /** Pull extra NEW cards beyond the deck's configured daily limit for this one session. */
  bypassNewCardCap?: boolean
  /**
   * Legacy client option. Short queues now automatically include upcoming learned
   * cards, so reviewing early no longer requires an explicit opt-in.
   */
  reviewAhead?: boolean
  /**
   * Restrict every card in the session to these CardSets, including upcoming
   * reviews and repeats. Omitted or empty means the whole deck.
   */
  cardSetIds?: string[]
}

// ── Helper: close an open session ────────────────────────────────────────────

export async function closeSession(prisma: PrismaClient, sessionId: string, now: Date): Promise<void> {
  const events = await prisma.reviewEvent.findMany({ where: { sessionId }, orderBy: { reviewedAt: 'asc' } })
  const total = events.length
  const correct = events.filter((e) => e.grade >= 2).length
  const accuracyRate = total > 0 ? correct / total : null

  // Stamp endedAt from the student's actual last review, not the caller's
  // clock — this function also closes sessions IMPLICITLY (a prior session
  // left open because the student closed the tab without hitting Finish,
  // discovered and closed only when they next open the app, possibly days
  // later). Using `now` there would misattribute real study time to
  // whatever day the student happened to come back, or collide with the
  // anti-gaming spacing rule in homework.service.ts and silently drop a
  // legitimately-earned qualifying day. Falls back to `now` only when there
  // are no events (nothing was actually reviewed, so it can't qualify for
  // homework credit either way) — matches `now` almost exactly for the
  // normal explicit-Finish path anyway, since that's called moments after
  // the last card was graded.
  const endedAt = total > 0 ? events[events.length - 1].reviewedAt : now

  await prisma.reviewSession.update({
    where: { id: sessionId },
    data: {
      endedAt,
      cardsReviewed: total,
      accuracyRate,
    },
  })
}

// ── Helper: count new cards introduced today ─────────────────────────────────

async function newCardsReviewedToday(prisma: PrismaClient, deckId: string): Promise<number> {
  // Count ReviewEvents today where the card's state at event time would have been NEW.
  // We detect this by looking at events for CardInstances that were first reviewed today:
  // i.e. ReviewEvents where the CardInstance.reps was 0 before the event.
  // Simplest proxy: CardInstances in this deck whose first ReviewEvent is today.
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // Count distinct cardInstanceIds that have at least one event today and
  // whose CardInstance.state became non-NEW (meaning the review today was their first).
  // Actually the spec says: count ReviewEvents where CardInstance.state was NEW at time of event.
  // We approximate: count CardInstances in this deck whose reps count > 0 and lastReview is today.
  // More precisely: count instances whose createdAt < todayStart (existed before today) is not useful.
  // The spec says: count ReviewEvent records where CardInstance.state was NEW at the time of the event.
  // Since FSRS moves NEW→REVIEW/LEARNING on first grade, and reps increments, we detect first-time reviews:
  // reps=0 → reps=1 on first grade. But we don't snapshot the state at event time.
  //
  // Practical approach: count CardInstances in this deck that have their first ReviewEvent today.
  // "First ReviewEvent" = MIN(reviewedAt) is today.

  const result = await prisma.reviewEvent.groupBy({
    by: ['cardInstanceId'],
    where: {
      session: { deckId },
      reviewedAt: { gte: todayStart },
    },
    _min: { reviewedAt: true },
  })

  // For each card with an event today, check if their EARLIEST event ever is also today.
  // If yes → it was a NEW card today.
  let count = 0
  for (const row of result) {
    const earliest = await prisma.reviewEvent.findFirst({
      where: { cardInstanceId: row.cardInstanceId },
      orderBy: { reviewedAt: 'asc' },
      select: { reviewedAt: true },
    })
    if (earliest && earliest.reviewedAt >= todayStart) {
      count++
    }
  }
  return count
}

// ── start ────────────────────────────────────────────────────────────────────

function toSessionCard(inst: any, overlays?: RuntimeMnemonicOverlays): SessionCard {
  const zhongkao = lookupZhongkaoWord(inst.card.word)
  const key = inst.card.word.trim().toLowerCase()
  const patchedMnemonic = overlays?.teacherPatches.get(key)
  return {
    instanceId: inst.id,
    cardId: inst.cardId,
    word: inst.card.word,
    pos: inst.card.pos,
    ipa: inst.card.ipa ?? zhongkao?.ipa ?? null,
    definitionL2: inst.card.definitionL2,
    definitionL1: inst.definitionL1 ?? inst.card.definitionL1,
    exampleSentence: inst.exampleSentence ?? inst.card.exampleSentence,
    mnemonic: patchedMnemonic ?? (inst.card.mnemonic as WordMnemonic | null | undefined) ?? zhongkao?.mnemonic ?? null,
    state: inst.state,
    due: inst.due,
    stability: inst.stability,
    difficulty: inst.difficulty,
    lapses: inst.lapses,
    reps: inst.reps,
    bestStage: inst.bestStage ?? null,
    lastReview: inst.lastReview ?? null,
  }
}

async function resumeOpenSession(
  prisma: PrismaClient,
  session: { id: string; deckId: string; queue: unknown; events: { cardInstanceId: string }[] },
  queue: string[],
): Promise<StartSessionResult | null> {
  const reviewed = new Set(session.events.map((event) => event.cardInstanceId))
  const remainingIds = queue.filter((id) => !reviewed.has(id))
  if (remainingIds.length === 0) return null

  const instances = await prisma.cardInstance.findMany({
    where: { id: { in: [...new Set(remainingIds)] } },
    include: { card: true },
  })
  const byId = new Map(instances.map((instance) => [instance.id, instance]))
  const overlays = await getRuntimeMnemonicOverlays(prisma)
  const cards = remainingIds
    .map((id) => byId.get(id))
    .filter((instance): instance is NonNullable<typeof instance> => Boolean(instance))
    .map((instance) => toSessionCard(instance, overlays))

  if (cards.length === 0) return null
  return {
    sessionId: session.id,
    cards,
    deckId: session.deckId,
    resumed: true,
    totalCards: queue.length,
  }
}

export async function startSession(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
  options: StartSessionOptions = {},
): Promise<StartSessionResult | { error: string; status: number }> {
  // Resolve enrollment → deck
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { deck: true },
  })
  if (!enrollment || enrollment.studentId !== studentId || enrollment.archivedAt) {
    return { error: 'Enrollment not found', status: 404 }
  }
  if (!enrollment.deck) {
    return { error: 'Deck not found', status: 404 }
  }
  const deck = enrollment.deck
  const params = deck.fsrsParams as unknown as FSRSParams

  // Close any open (abandoned) session, or resume it when it has a persisted
  // queue and still has unreviewed cards. Resuming is what makes a phone reload
  // (or returning from a backgrounded WeChat tab) continue the same questions.
  const openSession = await prisma.reviewSession.findFirst({
    where: { deckId: deck.id, endedAt: null },
    include: { events: { select: { cardInstanceId: true } } },
    orderBy: { startedAt: 'desc' },
  })
  if (openSession) {
    const queue = Array.isArray(openSession.queue) ? (openSession.queue as string[]) : null
    const resumed = queue ? await resumeOpenSession(prisma, openSession, queue) : null
    if (resumed) return resumed
    await closeSession(prisma, openSession.id, now)
  }

  // Explicit focus is a strict boundary for every queue query.
  const cardSetFilter = options.cardSetIds && options.cardSetIds.length > 0
    ? { cardSetId: { in: options.cardSetIds } }
    : undefined

  // Build session card list — spec §24 decisions 1, 2, 4
  // Due cards: LEARNING / REVIEW / RELEARNING where due <= now, ordered by due asc.
  // Capped per session — any remainder rolls over to the next session/day rather than
  // dumping an entire backlog (e.g. from a freshly-seeded deck) on the student at once.
  const dueInstances = await prisma.cardInstance.findMany({
    where: {
      deckId: deck.id,
      state: { in: ['LEARNING', 'REVIEW', 'RELEARNING'] },
      due: { lte: now },
      ...(cardSetFilter && { card: cardSetFilter }),
    },
    include: { card: true },
    orderBy: { due: 'asc' },
    take: MAX_DUE_CARDS_PER_SESSION,
  })

  // New cards: NEW state, ordered by CardSet assignment priority (§24 decision 2)
  // Priority comes from Assignment.priority on the assignment linking the CardSet to the class
  const newCardsAlreadyToday = await newCardsReviewedToday(prisma, deck.id)
  const newCardLimit = (params as any).newCardsPerDay ?? 10
  const newCardSlots = options.bypassNewCardCap ? Infinity : Math.max(0, newCardLimit - newCardsAlreadyToday)

  let newInstances: typeof dueInstances = []
  let moreNewCardsExistBeyondCap = false
  if (newCardSlots > 0) {
    // Get all NEW instances, join through card → cardSet → assignments for priority
    const allNew = await prisma.cardInstance.findMany({
      where: {
        deckId: deck.id,
        state: 'NEW',
        ...(cardSetFilter && { card: cardSetFilter }),
      },
      include: {
        card: {
          include: {
            cardSet: {
              include: {
                assignments: {
                  where: { class: { enrollments: { some: { id: enrollmentId } } } },
                  select: { priority: true },
                },
              },
            },
          },
        },
      },
    })

    // Sort by assignment priority (lower = higher priority), then by cardInstance createdAt
    allNew.sort((a, b) => {
      const aPrio = a.card.cardSet.isPersonal ? PERSONAL_CARD_PRIORITY : (a.card.cardSet.assignments[0]?.priority ?? 9999)
      const bPrio = b.card.cardSet.isPersonal ? PERSONAL_CARD_PRIORITY : (b.card.cardSet.assignments[0]?.priority ?? 9999)
      if (aPrio !== bPrio) return aPrio - bPrio
      return a.createdAt.getTime() - b.createdAt.getTime()
    })

    moreNewCardsExistBeyondCap = allNew.length > newCardSlots
    newInstances = allNew.slice(0, newCardSlots)
  } else {
    // Cap is 0 (already hit today) — check if there's anything beyond it worth offering.
    const anyNew = await prisma.cardInstance.findFirst({
      where: { deckId: deck.id, state: 'NEW', ...(cardSetFilter && { card: cardSetFilter }) },
    })
    moreNewCardsExistBeyondCap = !!anyNew
  }

  let allInstances = [...dueInstances, ...newInstances]

  const homework = await prisma.homeworkRequirement.findFirst({
    where: { classId: enrollment.classId, isActive: true },
    include: { cardSets: true },
  })
  const minimumReviews = Math.max(DEFAULT_MIN_CARDS_PER_SESSION, homework?.minCardsPerSession ?? 0)
  const paddingFocusIds = options.cardSetIds?.length
    ? options.cardSetIds
    : homework?.cardSets.map((set) => set.cardSetId) ?? []

  // DECISION: Fill short queues at the start so students can see the full session
  // length. Use learned cards due soonest, strictly within an explicit focus, without
  // introducing extra new cards beyond the daily allowance.
  if (allInstances.length < minimumReviews) {
    const addUpcoming = async (focusIds?: string[]) => {
      const remaining = minimumReviews - allInstances.length
      if (remaining <= 0) return
      const upcoming = await prisma.cardInstance.findMany({
        where: {
          deckId: deck.id,
          state: { in: ['LEARNING', 'REVIEW', 'RELEARNING'] },
          id: { notIn: allInstances.map((instance) => instance.id) },
          ...(focusIds?.length && { card: { cardSetId: { in: focusIds } } }),
        },
        include: { card: true },
        orderBy: [{ due: 'asc' }, { id: 'asc' }],
        take: remaining,
      })
      allInstances.push(...upcoming)
    }
    if (paddingFocusIds.length > 0) await addUpcoming(paddingFocusIds)
    if (!cardSetFilter) await addUpcoming()
  }

  // No eligible cards within the selected scope. Never substitute another set.
  if (allInstances.length === 0) {
    const emptyReason: 'capped' | 'exhausted' = moreNewCardsExistBeyondCap ? 'capped' : 'exhausted'
    return { sessionId: '', cards: [], deckId: deck.id, emptyReason }
  }

  // DECISION: A tiny deck still supports a qualifying session. Append repeats
  // after all distinct cards, cycling through them until the minimum is met.
  const distinctInstances = [...allInstances]
  for (let repeatIndex = 0; allInstances.length < minimumReviews; repeatIndex++) {
    allInstances.push(distinctInstances[repeatIndex % distinctInstances.length])
  }

  const [overlays, seasonActive] = await Promise.all([
    getRuntimeMnemonicOverlays(prisma),
    isClassSeasonActive(prisma, enrollment.classId, now),
  ])

  // World hook: only a newly-created queue's first due card changes. An open
  // session returns above with its persisted order untouched; FSRS scheduling is unchanged.
  allInstances = preferHighestRetentionDueFirst(allInstances, now)

  const queueIds = allInstances.map((inst) => inst.id)
  if (seasonActive && allInstances.length > 1) {
    // R6 Sprint Season queue priority (no FSRS due mutation!):
    // 1) due <= now, 2) weak (Again in 7d), 3) stage <= 3, 4) remaining
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
    const weakSet = new Set<string>()
    if (typeof (prisma as any)?.reviewEvent?.findMany === 'function') {
      const recentAgains = await prisma.reviewEvent.findMany({
        where: {
          grade: 1,
          reviewedAt: { gte: sevenDaysAgo },
          cardInstanceId: { in: queueIds },
        },
        select: { cardInstanceId: true },
      })
      for (const ev of recentAgains) weakSet.add(ev.cardInstanceId)
    }
    const rankOf = (inst: any): number => {
      const isDue = inst.state !== 'NEW' && inst.due <= now
      if (isDue) return 0
      if (weakSet.has(inst.id)) return 1
      const stage = mapFsrsToEbbinghausStage(inst.state, inst.stability, inst.reps)
      if (stage <= 3) return 2
      return 3
    }
    allInstances.sort((a, b) => rankOf(a) - rankOf(b))
  }

  // Create the ReviewSession record
  const session = await prisma.reviewSession.create({
    data: {
      deckId: deck.id,
      startedAt: now,
      queue: allInstances.map((inst) => inst.id),
    },
  })

  const cards: SessionCard[] = allInstances.map((inst) => toSessionCard(inst, overlays))

  return { sessionId: session.id, cards, deckId: deck.id }
}

// ── restudy ──────────────────────────────────────────────────────────────────

export async function startRestudy(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  instanceIds: string[],
  now: Date = new Date(),
): Promise<StartSessionResult | { error: string; status: number }> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { deck: true },
  })
  if (!enrollment || enrollment.studentId !== studentId || enrollment.archivedAt) {
    return { error: 'Enrollment not found', status: 404 }
  }
  if (!enrollment.deck) {
    return { error: 'Deck not found', status: 404 }
  }
  const deck = enrollment.deck

  // Close any open (abandoned) session
  const openSession = await prisma.reviewSession.findFirst({
    where: { deckId: deck.id, endedAt: null },
  })
  if (openSession) {
    await closeSession(prisma, openSession.id, now)
  }

  const instances = await prisma.cardInstance.findMany({
    where: { id: { in: instanceIds }, deckId: deck.id },
    include: { card: true },
  })

  const session = await prisma.reviewSession.create({
    data: { deckId: deck.id, startedAt: now },
  })

  // Preserve the caller's ordering
  const overlays = await getRuntimeMnemonicOverlays(prisma)
  const byId = Object.fromEntries(instances.map((i) => [i.id, i]))
  const cards: SessionCard[] = instanceIds
    .filter((id) => byId[id])
    .map((id) => toSessionCard(byId[id], overlays))

  return { sessionId: session.id, cards, deckId: deck.id }
}

// ── grade ────────────────────────────────────────────────────────────────────

export interface GradeResult {
  instanceId: string
  state: FSRSState
  due: Date
  stability: number
  difficulty: number
  retrievability: number
  lapses: number
  reps: number
  bestStage?: number | null
  /** If true, card should be re-appended to the session queue at the client. */
  requeue: boolean
  upgradedCard?: {
    word: string
    fromRarity: string | null
    toRarity: string
  } | null
  reward?: RewardFeedback
}

export async function gradeCard(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  instanceId: string,
  grade: number,
  responseTimeMs: number | undefined,
  now: Date = new Date(),
  submissionId?: string,
): Promise<GradeResult | { error: string; status: number }> {
  if (grade < 1 || grade > 4) {
    return { error: 'Grade must be 1–4', status: 400 }
  }

  // Verify session belongs to student's deck
  const session = await prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: { deck: { include: { enrollment: true } } },
  })
  if (!session || session.endedAt) {
    return { error: 'Session not found or already closed', status: 404 }
  }
  if (session.deck.enrollment.studentId !== studentId) {
    return { error: 'Session not found', status: 404 }
  }

  // Verify instance belongs to deck
  const instance = await prisma.cardInstance.findUnique({
    where: { id: instanceId },
    include: { card: true },
  })
  if (!instance || instance.deckId !== session.deckId) {
    return { error: 'Card instance not found', status: 404 }
  }

  const gamificationOn = isGamificationAvailable(prisma)
  const { config, configVersion } = gamificationOn
    ? await getEffectiveGameConfig(prisma, session.deck.enrollment.classId)
    : { config: undefined, configVersion: 'default' }
  const { localDate, start: dayStart, end: dayEnd } = shanghaiDayBounds(now)

  // Fast idempotent replay check when submissionId is supplied
  if (submissionId && (prisma.reviewEvent as any)?.findUnique) {
    const existing = await prisma.reviewEvent.findUnique({
      where: { sessionId_submissionId: { sessionId, submissionId } },
    })
    if (existing) {
      const summary = gamificationOn
        ? await getStudentGameSummary(prisma, studentId, session.deck.enrollment.id, now)
        : null
      return {
        instanceId,
        state: instance.state,
        due: instance.due,
        stability: instance.stability,
        difficulty: instance.difficulty,
        retrievability: instance.retrievability,
        lapses: instance.lapses,
        reps: instance.reps,
        bestStage: instance.bestStage,
        requeue: false,
        reward: summary
          ? {
              xp: 0,
              bonusXp: 0,
              totalAwardedXp: 0,
              totalXp: summary.level.totalXp,
              dailyXp: summary.today.xpEarned,
              dailyCap: summary.today.dailyCap,
              remainingDailyXp: summary.today.remainingDailyXp,
              capped: summary.today.capped,
              level: summary.level.level,
              title: summary.level.title,
              levelUp: null,
              ringsClosed: summary.today.rings.ringsClosed,
              ringsClosedJustNow: false,
              streakDays: summary.profile.streakDays,
              freezeTickets: summary.profile.freezeTickets,
              ticketEarned: 0,
              newBadges: [],
              configVersion: summary.configVersion,
              replayed: true,
            }
          : undefined,
      }
    }
  }

  const params = session.deck.fsrsParams as unknown as FSRSParams
  const isDue = instance.state === 'NEW' || instance.due <= now
  const wasDueReview = instance.state !== 'NEW' && instance.due <= now

  // Apply FSRS scheduling
  const fsrsResult = schedule(
    {
      stability: instance.stability,
      difficulty: instance.difficulty,
      reps: instance.reps,
      lapses: instance.lapses,
      state: instance.state as any,
      lastReview: instance.lastReview,
      due: instance.due,
    },
    grade,
    params,
    now,
  )

  const newStage = mapFsrsToEbbinghausStage(fsrsResult.state, fsrsResult.stability, fsrsResult.reps)
  const prevBestStage =
    instance.bestStage !== null && instance.bestStage !== undefined
      ? instance.bestStage
      : instance.state === 'NEW' && instance.reps <= 0
        ? null
        : mapFsrsToEbbinghausStage(instance.state as any, instance.stability, instance.reps)
  const nextBestStage = Math.max(prevBestStage ?? -1, newStage)
  const prevRarity = rarityFromStage(prevBestStage)
  const nextRarity = rarityFromStage(nextBestStage)
  const upgradedCard =
    nextRarity && (!prevRarity || prevRarity.key !== nextRarity.key)
      ? {
          word: instance.card.word,
          fromRarity: prevRarity?.label ?? null,
          toRarity: nextRarity.label,
        }
      : null

  const runGrade = async (tx: PrismaClient): Promise<GradeResult> => {
    const priorTodayCount = gamificationOn
      ? await tx.reviewEvent.count({
          where: {
            cardInstanceId: instanceId,
            reviewedAt: { gte: dayStart, lt: dayEnd },
          },
        })
      : 0
    const nthToday = priorTodayCount + 1

    await tx.cardInstance.update({
      where: { id: instanceId },
      data: {
        stability: fsrsResult.stability,
        difficulty: fsrsResult.difficulty,
        retrievability: fsrsResult.retrievability,
        reps: fsrsResult.reps,
        lapses: fsrsResult.lapses,
        state: fsrsResult.state,
        due: fsrsResult.due,
        lastReview: fsrsResult.lastReview,
        ...(gamificationOn ? { bestStage: nextBestStage } : {}),
      },
    })

    const event = await tx.reviewEvent.create({
      data: {
        sessionId,
        cardInstanceId: instanceId,
        grade,
        responseTimeMs: responseTimeMs ?? null,
        ...(submissionId ? { submissionId } : {}),
        reviewedAt: now,
      },
    })

    let requeue = false
    if (grade === 1) {
      const priorAgainCount = await tx.reviewEvent.count({
        where: {
          sessionId,
          cardInstanceId: instanceId,
          grade: 1,
          NOT: { id: event.id },
        },
      })
      requeue = priorAgainCount < 3
    }

    let reward: RewardFeedback | undefined
    if (gamificationOn && config) {
      await recordComebackIfEligibleInTx(
        tx,
        studentId,
        instanceId,
        grade,
        localDate,
        configVersion,
        now,
      )
      const baseXp = xpForGrade(grade, isDue, nthToday, config)
      reward = await recordGameRewardEventInTx({
        tx,
        studentId,
        enrollmentId: session.deck.enrollment.id,
        deckId: session.deckId,
        classId: session.deck.enrollment.classId,
        type: 'REVIEW_GRADE',
        sourceId: submissionId ?? event.id,
        baseXp,
        localDate,
        now,
        config,
        configVersion,
        meta: {
          cardId: instance.cardId,
          cardInstanceId: instanceId,
          word: instance.card.word,
          grade,
          isDue,
          nthToday,
          prevBestStage,
          nextBestStage,
        },
        countAsReviewCardIds: wasDueReview ? [instanceId] : [],
      })
    }

    return {
      instanceId,
      state: fsrsResult.state,
      due: fsrsResult.due,
      stability: fsrsResult.stability,
      difficulty: fsrsResult.difficulty,
      retrievability: fsrsResult.retrievability,
      lapses: fsrsResult.lapses,
      reps: fsrsResult.reps,
      bestStage: nextBestStage,
      requeue,
      upgradedCard,
      reward,
    }
  }

  if (typeof (prisma as any).$transaction === 'function') {
    try {
      return await prisma.$transaction((tx) => runGrade(tx as unknown as PrismaClient))
    } catch (err: any) {
      if (err?.code === 'P2002' && submissionId) {
        const current = await prisma.cardInstance.findUnique({ where: { id: instanceId } })
        const summary = gamificationOn
          ? await getStudentGameSummary(prisma, studentId, session.deck.enrollment.id, now)
          : null
        return {
          instanceId,
          state: current?.state ?? instance.state,
          due: current?.due ?? instance.due,
          stability: current?.stability ?? instance.stability,
          difficulty: current?.difficulty ?? instance.difficulty,
          retrievability: current?.retrievability ?? instance.retrievability,
          lapses: current?.lapses ?? instance.lapses,
          reps: current?.reps ?? instance.reps,
          bestStage: current?.bestStage ?? instance.bestStage,
          requeue: false,
          reward: summary
            ? {
                xp: 0,
                bonusXp: 0,
                totalAwardedXp: 0,
                totalXp: summary.level.totalXp,
                dailyXp: summary.today.xpEarned,
                dailyCap: summary.today.dailyCap,
                remainingDailyXp: summary.today.remainingDailyXp,
                capped: summary.today.capped,
                level: summary.level.level,
                title: summary.level.title,
                levelUp: null,
                ringsClosed: summary.today.rings.ringsClosed,
                ringsClosedJustNow: false,
                streakDays: summary.profile.streakDays,
                freezeTickets: summary.profile.freezeTickets,
                ticketEarned: 0,
                newBadges: [],
                configVersion: summary.configVersion,
                replayed: true,
              }
            : undefined,
        }
      }
      throw err
    }
  }

  return runGrade(prisma)
}

// ── finish ───────────────────────────────────────────────────────────────────

/**
 * Was `todayKey` a NEW personal-best day — i.e. strictly more cards than any
 * OTHER day on record? Excludes today from its own comparison so a repeat of
 * an already-standing record doesn't re-trigger the "new personal best"
 * callout (only the day it was first set should).
 */
export function isNewPersonalBestDay(cardsPerDay: Record<string, number>, todayKey: string): boolean {
  const todayTotal = cardsPerDay[todayKey] ?? 0
  const bestOtherDay = Object.entries(cardsPerDay)
    .filter(([day]) => day !== todayKey)
    .reduce((max, [, count]) => Math.max(max, count), 0)
  return todayTotal > 0 && todayTotal > bestOtherDay
}

export async function finishSession(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  now: Date = new Date(),
  tz: string = 'UTC',
  options?: { isWeakRestudy?: boolean },
): Promise<
  | {
      ok: boolean
      cardsReviewed: number
      accuracyRate: number | null
      weeklyGoal: WeeklyGoal | null
      newPersonalBestDay: boolean
      todayCardsTotal: number
      currentStreak: number
      rewards: RewardSettlement
      restudyReward?: RewardFeedback | null
      tomorrowDueCount?: number
      gameSummary?: Awaited<ReturnType<typeof getStudentGameSummary>>
    }
  | { error: string; status: number }
> {
  const session = await prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: { deck: { include: { enrollment: true } } },
  })
  if (!session || session.endedAt) {
    return { error: 'Session not found or already closed', status: 404 }
  }
  if (session.deck.enrollment.studentId !== studentId) {
    return { error: 'Session not found', status: 404 }
  }

  await closeSession(prisma, sessionId, now)

  const updated = await prisma.reviewSession.findUnique({ where: { id: sessionId } })
  // Recomputed post-close so the student sees whether THIS session actually moved the
  // count — e.g. a too-soon repeat won't increment sessionsCompleted, and passing
  // sessionId lets the client explain why rather than leaving them to guess.
  const weeklyGoal = await getWeeklyGoal(prisma, session.deck.enrollment.classId, session.deckId, now, sessionId)

  // "New personal best" / streak — computed from the session's ACTUAL closed
  // endedAt (which closeSession may have backdated to the student's last real
  // review, not this request's `now`), so "today" reflects when they truly
  // studied, not when the finish request happened to reach the server.
  const { currentStreak, cardsPerDay } = await computeStreakAndBestDay(
    prisma,
    session.deckId,
    session.deck.enrollment.id,
    tz,
    updated?.endedAt ?? now,
  )
  const endedAtForToday = updated?.endedAt ?? now
  let todayKey: string
  try {
    todayKey = endedAtForToday.toLocaleDateString('en-CA', { timeZone: tz })
  } catch {
    todayKey = endedAtForToday.toISOString().slice(0, 10)
  }
  const newPersonalBestDay = isNewPersonalBestDay(cardsPerDay, todayKey)

  // Settle after the session is closed. Settlement is idempotent by ledger
  // uniqueness, so a retried finish cannot duplicate XP or coins.
  const rewards = await settleSessionRewards(prisma, sessionId, endedAtForToday)

  let restudyReward: RewardFeedback | null = null
  let tomorrowDueCount: number | undefined
  let gameSummary: Awaited<ReturnType<typeof getStudentGameSummary>> = null

  if (isGamificationAvailable(prisma)) {
    const { config, configVersion } = await getEffectiveGameConfig(prisma)
    const { localDate } = shanghaiDayBounds(endedAtForToday)

    if (options?.isWeakRestudy && (updated?.cardsReviewed ?? 0) > 0) {
      const weakPool = await getWeakBossPool(prisma, studentId, session.deck.enrollment.id, endedAtForToday)
      restudyReward = await prisma.$transaction(async (tx) => {
        const resReward = await recordGameRewardEventInTx({
          tx: tx as unknown as PrismaClient,
          studentId,
          enrollmentId: session.deck.enrollment.id,
          deckId: session.deckId,
          classId: session.deck.enrollment.classId,
          type: 'WEAK_RESTUDY',
          sourceId: sessionId,
          baseXp: config.weakRetryXp,
          localDate,
          now: endedAtForToday,
          config,
          configVersion,
          isWeakRestudy: true,
          meta: { sessionId, cardsReviewed: updated?.cardsReviewed ?? 0 },
        })
        if (weakPool && weakPool.wordCount === 0) {
          await recordGameRewardEventInTx({
            tx: tx as unknown as PrismaClient,
            studentId,
            enrollmentId: session.deck.enrollment.id,
            deckId: session.deckId,
            classId: session.deck.enrollment.classId,
            type: 'WEAK_CLEAR_DAY',
            sourceId: localDate,
            baseXp: 0,
            localDate,
            now: endedAtForToday,
            config,
            configVersion,
          })
        }
        return resReward
      })
    }

    tomorrowDueCount = await countTomorrowDueCards(prisma, session.deckId, endedAtForToday)
    gameSummary = await getStudentGameSummary(prisma, studentId, session.deck.enrollment.id, endedAtForToday)
  }

  return {
    ok: true,
    cardsReviewed: updated?.cardsReviewed ?? 0,
    accuracyRate: updated?.accuracyRate ?? null,
    weeklyGoal,
    newPersonalBestDay,
    // Total across ALL of today's qualifying sessions, not just this one —
    // "new personal best" is a day-level record, so the number shown for it
    // must be the day's total, not this single session's cardsReviewed.
    todayCardsTotal: cardsPerDay[todayKey] ?? 0,
    currentStreak,
    rewards,
    ...(restudyReward !== null ? { restudyReward } : {}),
    ...(tomorrowDueCount !== undefined ? { tomorrowDueCount } : {}),
    ...(gameSummary !== null ? { gameSummary } : {}),
  }
}

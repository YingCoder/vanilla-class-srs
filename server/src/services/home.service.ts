import { Prisma, type PrismaClient } from '@prisma/client'
import { computeRetrievability, mapFsrsToEbbinghausStage } from '@vanilla-srs/shared/ebbinghaus'
import { shanghaiDateString, shanghaiDayBounds } from '@vanilla-srs/shared/gamification'
import {
  HOME_BUILDINGS,
  HOME_FORECAST_SLOTS,
  SUGAR_CRYSTAL_LEARNING_EVENTS,
  homeBuildingState,
  spiritAppearanceSeed,
  spiritFormFromStage,
  type HomeBuildingKey,
  type HomeBuildResponse,
  type HomeErrorCode,
  type HomeResponse,
} from '@vanilla-srs/shared/world'
import { getActiveEnrollmentForStudent, getCampMap } from './gamification.service'
import { getSmartTodayPlan } from './seasonPlan.service'
import { getEffectiveGameConfig } from './gameConfig.service'

type Db = Prisma.TransactionClient

type ActiveEnrollment = NonNullable<Awaited<ReturnType<typeof getActiveEnrollmentForStudent>>>

export class HomeError extends Error {
  constructor(public readonly status: 404 | 409, public readonly code: HomeErrorCode, message: string) {
    super(message)
  }
}

async function requireEnrollment(db: Db, studentId: string, enrollmentId: string): Promise<ActiveEnrollment> {
  const enrollment = await getActiveEnrollmentForStudent(db as PrismaClient, studentId, enrollmentId)
  if (!enrollment || enrollment.class.archivedAt) {
    throw new HomeError(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found')
  }
  return enrollment
}

function safeInteger(value: string | number | bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid home ledger total')
  return result
}

/** One account-wide SUM, never one sum per enrollment. No currency-claim endpoint exists. */
async function getWallet(db: Db, studentId: string) {
  const [income, purchases] = await Promise.all([
    db.$queryRaw<Array<{ earned: string }>>`
      SELECT FLOOR(COALESCE(SUM("xp"::numeric * "sugarCrystalRatio"), 0))::text AS earned
      FROM "GameEvent"
      WHERE "studentId" = ${studentId} AND "xp" > 0
        AND "type" IN (${Prisma.join([...SUGAR_CRYSTAL_LEARNING_EVENTS])})
    `,
    db.studentHomeBuilding.findMany({ where: { studentId } }),
  ])
  const totalEarned = safeInteger(income[0]?.earned ?? 0)
  const totalSpent = safeInteger(purchases.reduce((sum, purchase) => sum + purchase.cost, 0))
  // Failing closed exposes ledger corruption instead of manufacturing a spendable balance.
  if (totalSpent > totalEarned) throw new Error('Home spending exceeds authoritative XP income')
  return { totalEarned, totalSpent, balance: totalEarned - totalSpent, purchases }
}

async function getTomorrowForecast(db: Db, deckId: string, now: Date): Promise<NonNullable<HomeResponse['tomorrowForecast']>> {
  const { end: start } = shanghaiDayBounds(now)
  const end = new Date(start.getTime() + 86_400_000)
  // Prisma timestamps are stored as UTC without timezone. +8h explicitly selects Shanghai
  // hours independently of the database session timezone. Boundary is [00:00, next 00:00).
  const rows = await db.$queryRaw<Array<{ slot: number; count: bigint }>>`
    SELECT (EXTRACT(HOUR FROM ("due" + INTERVAL '8 hours'))::int / 6) AS slot, COUNT(*) AS count
    FROM "CardInstance"
    WHERE "deckId" = ${deckId} AND "state" IN ('LEARNING', 'REVIEW', 'RELEARNING')
      AND "due" >= ${start} AND "due" < ${end}
    GROUP BY slot
  `
  const bySlot = new Map(rows.map((row) => [row.slot, safeInteger(row.count)]))
  const slots = HOME_FORECAST_SLOTS.map((slot, index) => ({ ...slot, count: bySlot.get(index) ?? 0 }))
  return { date: shanghaiDateString(start), total: slots.reduce((sum, slot) => sum + slot.count, 0), timeZone: 'Asia/Shanghai', slots }
}

async function readHome(db: Db, studentId: string, enrollment: ActiveEnrollment, now: Date): Promise<HomeResponse> {
  const deckId = enrollment.deck!.id
  const [wallet, effective, instances, dueCount, plan, map] = await Promise.all([
    getWallet(db, studentId),
    getEffectiveGameConfig(db as PrismaClient, enrollment.classId),
    db.cardInstance.findMany({
      where: { deckId, bestStage: { not: null } },
      orderBy: [{ bestStage: 'desc' }, { id: 'asc' }],
      take: 3,
      select: {
        id: true, cardId: true, bestStage: true, state: true, stability: true,
        reps: true, lastReview: true, due: true, definitionL1: true,
        card: { select: { word: true, definitionL1: true } },
      },
    }),
    db.cardInstance.count({
      where: { deckId, state: { in: ['LEARNING', 'REVIEW', 'RELEARNING'] }, due: { lte: now } },
    }),
    getSmartTodayPlan(db as PrismaClient, studentId, enrollment.id, now),
    getCampMap(db as PrismaClient, studentId, enrollment.id),
  ])
  if (!plan || !map) throw new HomeError(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found')
  const buildings = HOME_BUILDINGS.map((def) => {
    const level = wallet.purchases.reduce((max, row) => row.buildingKey === def.key ? Math.max(max, row.level) : max, 0)
    return homeBuildingState(def, level, wallet.balance)
  })
  const lighthouseBuilt = buildings.some((building) => building.key === 'lighthouse' && building.level > 0)
  return {
    enrollmentId: enrollment.id,
    serverNow: now.toISOString(),
    sugarCrystals: {
      balance: wallet.balance, totalEarned: wallet.totalEarned, totalSpent: wallet.totalSpent,
      ratio: effective.config.sugarCrystalRatio, ratioPolicy: 'EVENT_SNAPSHOT',
    },
    buildings,
    spirits: instances.map((instance) => ({
      instanceId: instance.id,
      cardId: instance.cardId,
      word: instance.card.word,
      definitionL1: instance.definitionL1 ?? instance.card.definitionL1,
      bestStage: instance.bestStage!,
      currentStage: mapFsrsToEbbinghausStage(instance.state, instance.stability, instance.reps),
      form: spiritFormFromStage(instance.bestStage),
      appearanceSeed: spiritAppearanceSeed(instance.card.word),
      retention: computeRetrievability(instance.stability, instance.lastReview, now),
      due: instance.due.toISOString(),
      isDue: instance.state !== 'NEW' && instance.due <= now,
    })),
    dueCount,
    tomorrowForecast: lighthouseBuilt ? await getTomorrowForecast(db, deckId, now) : null,
    estimatedMinutes: plan.estimatedMinutes,
    campMap: {
      currentDay: map.currentDay,
      days: map.days.map(({ day, stars, status, isMajorBoss, isFinale }) => ({ day, stars, status, isMajorBoss, isFinale })),
    },
  }
}

export async function getStudentHome(prisma: PrismaClient, studentId: string, enrollmentId: string, now = new Date()): Promise<HomeResponse> {
  // A consistent snapshot prevents an overlapping purchase from mixing old income/new costs.
  return prisma.$transaction(async (tx) => {
    const enrollment = await requireEnrollment(tx, studentId, enrollmentId)
    return readHome(tx, studentId, enrollment, now)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export async function buildStudentHome(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  buildingKey: HomeBuildingKey,
  requestId: string,
  now = new Date(),
): Promise<HomeBuildResponse> {
  return prisma.$transaction(async (tx) => {
    // All buildings and enrollments share this lock. The balance check and debit stay
    // in the SAME transaction, so competing builds cannot both spend the same crystals.
    await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${studentId} FOR UPDATE`
    const enrollment = await requireEnrollment(tx, studentId, enrollmentId)
    const wallet = await getWallet(tx, studentId)
    const prior = wallet.purchases.find((row) => row.requestId === requestId)
    if (prior) {
      if (prior.buildingKey !== buildingKey) throw new HomeError(409, 'IDEMPOTENCY_KEY_REUSED', '该建造请求已用于其他建筑')
      return { home: await readHome(tx, studentId, enrollment, now), buildingKey, level: prior.level, spent: 0, replayed: true }
    }
    const def = HOME_BUILDINGS.find((building) => building.key === buildingKey)!
    const purchasedLevel = wallet.purchases.reduce((max, row) => row.buildingKey === buildingKey ? Math.max(max, row.level) : max, 0)
    const state = homeBuildingState(def, purchasedLevel, wallet.balance)
    if (state.nextCost === null) throw new HomeError(409, 'BUILDING_MAX_LEVEL', '这座建筑已达到最高等级')
    if (!state.canBuild) throw new HomeError(409, 'INSUFFICIENT_SUGAR_CRYSTALS', '糖晶不足，学习所得会自动累积')
    const level = state.level + 1
    const cost = state.nextCost
    await tx.studentHomeBuilding.create({ data: { studentId, buildingKey, level, cost, requestId, builtAt: now } })
    return { home: await readHome(tx, studentId, enrollment, now), buildingKey, level, spent: cost, replayed: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
}

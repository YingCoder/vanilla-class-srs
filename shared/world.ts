/** Pure world rules. Currency is derived from the existing, capped XP ledger. */
import { computeRetrievability } from './ebbinghaus'

export const SUGAR_CRYSTAL_RATIO_DEFAULT = 0.1
export const SUGAR_CRYSTAL_RATIO_SCALE = 10_000

/** Four decimal places, inclusive range [0, 1]. Zero pauses future earnings. */
export function isSugarCrystalRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    && Math.abs(value * SUGAR_CRYSTAL_RATIO_SCALE - Math.round(value * SUGAR_CRYSTAL_RATIO_SCALE)) < 1e-8
}

// Explicit allowlist: social, creator, administrative and unknown rewards never buy buildings.
export const SUGAR_CRYSTAL_LEARNING_EVENTS = [
  'REVIEW_GRADE', 'LEVEL_CLEAR', 'WEAK_RESTUDY', 'WEAK_BOSS_WIN',
  'RINGS_CLOSED', 'COMEBACK_EASY', 'WEAK_CLEAR_DAY',
] as const

/**
 * Fractions carry across events, dates and classes; floor only the lifetime sum.
 * The ratio belongs to the XP event, never the class currently viewing the wallet.
 * Legacy XP events use 0.1 permanently. Configuration changes affect new events only.
 * The database uses NUMERIC for the equivalent aggregate; integer units avoid float drift here.
 */
export function sugarCrystalsFromLearningXp(events: readonly {
  type: string
  xp: number
  sugarCrystalRatio?: number
}[]): number {
  let units = 0n
  for (const event of events) {
    if (!(SUGAR_CRYSTAL_LEARNING_EVENTS as readonly string[]).includes(event.type)) continue
    if (!Number.isSafeInteger(event.xp) || event.xp < 0) throw new RangeError('Invalid ledger XP')
    const ratio = event.sugarCrystalRatio ?? SUGAR_CRYSTAL_RATIO_DEFAULT
    if (!isSugarCrystalRatio(ratio)) throw new RangeError('Invalid sugar crystal ratio')
    units += BigInt(event.xp) * BigInt(Math.round(ratio * SUGAR_CRYSTAL_RATIO_SCALE))
  }
  const total = Number(units / BigInt(SUGAR_CRYSTAL_RATIO_SCALE))
  if (!Number.isSafeInteger(total)) throw new RangeError('Sugar crystal total exceeds safe integer range')
  return total
}

export const HOME_BUILDING_KEYS = ['campfire', 'hatchery', 'lighthouse', 'album_tower', 'flag_square'] as const
export type HomeBuildingKey = typeof HOME_BUILDING_KEYS[number]
export interface HomeBuildingDef {
  key: HomeBuildingKey
  name: string
  initialLevel: number
  /** Index 0 is level 1's cost; the free buildings are permanent initial entitlements. */
  costs: readonly number[]
}
export const HOME_BUILDINGS: readonly HomeBuildingDef[] = [
  { key: 'campfire', name: '篝火', initialLevel: 1, costs: [0] },
  { key: 'hatchery', name: '孵化屋', initialLevel: 1, costs: [0] },
  { key: 'lighthouse', name: '灯塔', initialLevel: 0, costs: [80, 120] },
  { key: 'album_tower', name: '图鉴塔', initialLevel: 0, costs: [80, 120] },
  { key: 'flag_square', name: '战旗广场', initialLevel: 0, costs: [80, 120] },
]

export interface HomeBuilding {
  key: HomeBuildingKey
  name: string
  level: number
  maxLevel: number
  nextCost: number | null
  canBuild: boolean
}

export function homeBuildingState(def: HomeBuildingDef, purchasedLevel: number, balance: number): HomeBuilding {
  const owned = Math.max(def.initialLevel, Math.min(def.costs.length, purchasedLevel))
  const nextCost = owned < def.costs.length ? def.costs[owned] ?? null : null
  return { key: def.key, name: def.name, level: owned, maxLevel: def.costs.length, nextCost, canBuild: nextCost !== null && balance >= nextCost }
}

export type WordSpiritForm = 'egg' | 'hatchling' | 'young' | 'mature' | 'radiant'
export const WORD_SPIRIT_FORMS: Record<WordSpiritForm, { name: string; minStage: number }> = {
  egg: { name: '蛋', minStage: 0 },
  hatchling: { name: '雏灵', minStage: 1 },
  young: { name: '幼灵', minStage: 2 },
  mature: { name: '成灵', minStage: 4 },
  radiant: { name: '光灵', minStage: 7 },
}

/** Pass historical bestStage, never current stage/retention: form cannot regress. */
export function spiritFormFromStage(bestStage: number | null | undefined): WordSpiritForm {
  const stage = Number.isFinite(bestStage) ? Math.max(0, Math.min(8, Math.floor(bestStage!))) : 0
  if (stage >= 7) return 'radiant'
  if (stage >= 4) return 'mature'
  if (stage >= 2) return 'young'
  if (stage === 1) return 'hatchling'
  return 'egg'
}

/** Stable across requests, devices, enrollments and stage changes; not random loot. */
export function spiritAppearanceSeed(wordOrId: string): number {
  const key = wordOrId.trim().toLowerCase()
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
  return hash >>> 0
}

export const WORLD_ISLANDS = [
  { key: 'strawberry', name: '草莓海岸', startDay: 1, endDay: 6, bossDay: 6 },
  { key: 'vanilla', name: '香草森林', startDay: 7, endDay: 12, bossDay: 12 },
  { key: 'cocoa', name: '可可山脉', startDay: 13, endDay: 18, bossDay: 18 },
  { key: 'star', name: '星糖云海', startDay: 19, endDay: 23, bossDay: 23 },
] as const

export function worldIslandForDay(day: number) {
  return Number.isInteger(day) ? WORLD_ISLANDS.find((island) => day >= island.startDay && day <= island.endDay) ?? null : null
}

/** Move only the easiest due card to the front; preserve the order of every other card. */
export function preferHighestRetentionDueFirst<T extends {
  state: string; due: Date; stability: number; lastReview: Date | string | null
}>(queue: readonly T[], now: Date): T[] {
  let bestIndex = -1
  let bestRetention = -1
  queue.forEach((card, index) => {
    if (card.state === 'NEW' || card.due > now) return
    const retention = computeRetrievability(card.stability, card.lastReview, now)
    if (retention > bestRetention) { bestRetention = retention; bestIndex = index }
  })
  if (bestIndex <= 0) return [...queue]
  return [queue[bestIndex], ...queue.slice(0, bestIndex), ...queue.slice(bestIndex + 1)]
}

export interface HomeSpirit {
  instanceId: string
  cardId: string
  word: string
  definitionL1: string | null
  bestStage: number
  currentStage: number
  form: WordSpiritForm
  appearanceSeed: number
  /** Current FSRS R(t,S), 0..1, calculated at serverNow. */
  retention: number
  due: string
  isDue: boolean
}

export const HOME_FORECAST_SLOTS = [
  { key: 'night', label: '凌晨', startHour: 0, endHour: 6 },
  { key: 'morning', label: '上午', startHour: 6, endHour: 12 },
  { key: 'afternoon', label: '下午', startHour: 12, endHour: 18 },
  { key: 'evening', label: '晚间', startHour: 18, endHour: 24 },
] as const

export interface HomeResponse {
  enrollmentId: string
  serverNow: string
  sugarCrystals: {
    balance: number
    totalEarned: number
    totalSpent: number
    /** Current class ratio for future XP, not a multiplier for past earnings. */
    ratio: number
    ratioPolicy: 'EVENT_SNAPSHOT'
  }
  buildings: HomeBuilding[]
  spirits: HomeSpirit[]
  dueCount: number
  tomorrowForecast: null | {
    date: string
    total: number
    timeZone: 'Asia/Shanghai'
    slots: Array<{ key: string; label: string; startHour: number; endHour: number; count: number }>
  }
  estimatedMinutes: number
  campMap: {
    currentDay: number
    days: Array<{
      day: number
      stars: 0 | 1 | 2 | 3
      status: 'CLEARED' | 'IN_PROGRESS' | 'LOCKED'
      isMajorBoss: boolean
      isFinale: boolean
    }>
  }
}

export interface HomeBuildResponse {
  home: HomeResponse
  buildingKey: HomeBuildingKey
  level: number
  /** Cost charged by THIS call; zero for a replay. */
  spent: number
  replayed: boolean
}

export interface HomeBuildRequest { enrollmentId: string; buildingKey: HomeBuildingKey }
export type HomeErrorCode = 'ENROLLMENT_NOT_FOUND' | 'BUILDING_MAX_LEVEL' | 'INSUFFICIENT_SUGAR_CRYSTALS' | 'IDEMPOTENCY_KEY_REUSED'
export interface HomeErrorResponse { error: string; code: HomeErrorCode }

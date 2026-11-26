/**
 * Word Camp Stage 3 — pure gamification rules, defaults & guardrails.
 *
 * Zero database/HTTP/DOM dependencies so both Node services and React UI
 * share the exact same calculations without pulling server-only grading code
 * into the client bundle.
 */

const SUGAR_CRYSTAL_RATIO_DEFAULT = 0.1
const SUGAR_CRYSTAL_RATIO_SCALE = 10_000
/** Kept here to preserve the existing one-way gamification -> stage4 dependency. */
function isSugarCrystalRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    && Math.abs(value * SUGAR_CRYSTAL_RATIO_SCALE - Math.round(value * SUGAR_CRYSTAL_RATIO_SCALE)) < 1e-8
}
import {
  DEFAULT_REMINDER_TEMPLATES,
  checkReminderTemplateSafety,
  type ReminderTemplate,
} from './stage4'

export type GameGrade = 1 | 2 | 3 | 4
export type GameLevelType = 'L1' | 'L2' | 'L3' | 'L5' | 'BOSS' | 'REVIEW'
export type CardRarityKey = 'CANDY' | 'SILVER' | 'GOLD' | 'DIAMOND'
export type BadgeCategory = 'persistence' | 'memory' | 'challenge' | 'comeback' | 'graduation'

export type BadgeMetric =
  | 'streak_days'
  | 'gold_plus_cards'
  | 'boss_clears'
  | 'boss_streak_days'
  | 'camp_day_cleared'
  | 'comeback_easy_cards'
  | 'weak_boss_wins'
  | 'weak_clear_days'
  | 'graduation_23d'
  | 'class_challenge_wins'
  | 'mnemonic_created'
  | 'squad_weekly_wins'
  | 'season_stage4_pct'

export interface BadgeDef {
  key: string
  name: string
  category: BadgeCategory
  categoryLabel: string
  description: string
  icon: string
  metric: BadgeMetric
  target: number
  isLimited?: boolean
}

export interface GameTitleTier {
  minLevel: number
  maxLevel: number | null
  title: string
}

export interface GameConfig {
  xpByGrade: Record<GameGrade, number>
  levelXp: Record<GameLevelType, number>
  weakRetryXp: number
  weakRetryMaxPerDay: number
  weakBossXp: number
  ringsClosedXp: number
  mnemonicCreatorXp: number
  squadGoalXp: number
  dailyXpCap: number
  /** Snapshotted on each XP ledger event; future events only, never revalues past earnings. */
  sugarCrystalRatio: number
  maxScoredReviewsPerCardPerDay: number
  backlogCapNormal: number
  backlogCapReturn: number
  returnGapDaysThreshold: number
  streakTicketInterval: number
  maxFreezeTickets: number
  lateNightHour: number
  lateNightMinute: number
  titleTiers: GameTitleTier[]
  badges: BadgeDef[]
  reminderTemplates: ReminderTemplate[]
}

export const DEFAULT_BADGE_DEFS: BadgeDef[] = [
  // 坚持 (4)
  {
    key: 'streak_3',
    name: '三日火苗',
    category: 'persistence',
    categoryLabel: '坚持',
    description: '连续 3 天双环合拢打卡',
    icon: '🔥',
    metric: 'streak_days',
    target: 3,
  },
  {
    key: 'streak_7',
    name: '七日营火',
    category: 'persistence',
    categoryLabel: '坚持',
    description: '连续 7 天双环合拢打卡，获赠冻结券',
    icon: '🏕️',
    metric: 'streak_days',
    target: 7,
  },
  {
    key: 'streak_14',
    name: '半月星芒',
    category: 'persistence',
    categoryLabel: '坚持',
    description: '连续 14 天双环合拢打卡',
    icon: '🌟',
    metric: 'streak_days',
    target: 14,
  },
  {
    key: 'streak_23',
    name: '二十三日满贯',
    category: 'persistence',
    categoryLabel: '坚持',
    description: '连续 23 天坚持完成每日双环',
    icon: '👑',
    metric: 'streak_days',
    target: 23,
  },

  // 记忆 (4)
  {
    key: 'gold_50',
    name: '金箔初藏',
    category: 'memory',
    categoryLabel: '记忆',
    description: '累计 50 张词卡达到金箔及以上稀有度',
    icon: '🪙',
    metric: 'gold_plus_cards',
    target: 50,
  },
  {
    key: 'gold_200',
    name: '金库小成',
    category: 'memory',
    categoryLabel: '记忆',
    description: '累计 200 张词卡达到金箔及以上稀有度',
    icon: '🍯',
    metric: 'gold_plus_cards',
    target: 200,
  },
  {
    key: 'gold_500',
    name: '词海藏家',
    category: 'memory',
    categoryLabel: '记忆',
    description: '累计 500 张词卡达到金箔及以上稀有度',
    icon: '💎',
    metric: 'gold_plus_cards',
    target: 500,
  },
  {
    key: 'gold_688',
    name: '688 全卡金殿',
    category: 'memory',
    categoryLabel: '记忆',
    description: '全部 688 词达到金箔及以上稀有度',
    icon: '🏆',
    metric: 'gold_plus_cards',
    target: 688,
  },

  // 闯关 (6)
  {
    key: 'boss_first',
    name: '首战破关',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '首次击败每日关卡 BOSS',
    icon: '⚔️',
    metric: 'boss_clears',
    target: 1,
  },
  {
    key: 'boss_streak_3',
    name: '连斩三日',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '连续 3 天通关每日 BOSS',
    icon: '🛡️',
    metric: 'boss_streak_days',
    target: 3,
  },
  {
    key: 'camp_d7',
    name: 'D7 一周大关',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '营地地图解锁并通关第 7 天大关',
    icon: '🚩',
    metric: 'camp_day_cleared',
    target: 7,
  },
  {
    key: 'camp_d14',
    name: 'D14 半程堡垒',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '营地地图解锁并通关第 14 天大关',
    icon: '🏰',
    metric: 'camp_day_cleared',
    target: 14,
  },
  {
    key: 'camp_d21',
    name: 'D21 决战前哨',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '营地地图解锁并通关第 21 天大关',
    icon: '🌋',
    metric: 'camp_day_cleared',
    target: 21,
  },
  {
    key: 'camp_d23',
    name: 'D23 终章登顶',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '营地地图通关第 23 天终章',
    icon: '🏔️',
    metric: 'camp_day_cleared',
    target: 23,
  },

  // 逆袭 (3)
  {
    key: 'comeback_10',
    name: '十词逆袭',
    category: 'comeback',
    categoryLabel: '逆袭',
    description: '曾「重来」的词在 7 天后被评「秒杀」累计 10 个',
    icon: '⚡',
    metric: 'comeback_easy_cards',
    target: 10,
  },
  {
    key: 'weak_boss_first',
    name: '弱词克星',
    category: 'comeback',
    categoryLabel: '逆袭',
    description: '首次击败个人弱词 Boss',
    icon: '🎯',
    metric: 'weak_boss_wins',
    target: 1,
  },
  {
    key: 'weak_clear_day',
    name: '当日弱词清零',
    category: 'comeback',
    categoryLabel: '逆袭',
    description: '完成一轮弱词急救或弱词 Boss 并清空当日弱词',
    icon: '✨',
    metric: 'weak_clear_days',
    target: 1,
  },

  // 结业 (1)
  {
    key: 'graduate_23d',
    name: '香草特训营毕业',
    category: 'graduation',
    categoryLabel: '结业',
    description: '完成 D23 终章并合拢当日双环',
    icon: '🎓',
    metric: 'graduation_23d',
    target: 1,
  },
  // 班级周挑战限定 (F8)
  {
    key: 'class_challenge_win',
    name: '班级周挑战优胜',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '参与并共同达成班级周挑战目标',
    icon: '🎉',
    metric: 'class_challenge_wins',
    target: 1,
    isLimited: true,
  },
  // Stage 4: R4 邪修共创 + R5 小队 + R6 冲刺赛季 4 枚徽章
  {
    key: 'mnemonic_creator',
    name: '邪修创作者',
    category: 'memory',
    categoryLabel: '记忆',
    description: '原创邪修口诀通过老师审核入选词库',
    icon: '✍️',
    metric: 'mnemonic_created',
    target: 1,
  },
  {
    key: 'squad_weekly',
    name: '小队徽章',
    category: 'persistence',
    categoryLabel: '坚持',
    description: '学习搭子小队全员本周至少 4 天合拢复习环',
    icon: '🤝',
    metric: 'squad_weekly_wins',
    target: 1,
    isLimited: true,
  },
  {
    key: 'season_25',
    name: '冲刺启航 25%',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '冲刺赛季内 688 词中 25% 达到第 4 阶以上',
    icon: '🥉',
    metric: 'season_stage4_pct',
    target: 25,
    isLimited: true,
  },
  {
    key: 'season_50',
    name: '冲刺半程 50%',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '冲刺赛季内 688 词中 50% 达到第 4 阶以上',
    icon: '🥈',
    metric: 'season_stage4_pct',
    target: 50,
    isLimited: true,
  },
  {
    key: 'season_75',
    name: '冲刺决胜 75%',
    category: 'challenge',
    categoryLabel: '闯关',
    description: '冲刺赛季内 688 词中 75% 达到第 4 阶以上',
    icon: '🥇',
    metric: 'season_stage4_pct',
    target: 75,
    isLimited: true,
  },
  {
    key: 'season_100',
    name: '冲刺满分登顶',
    category: 'graduation',
    categoryLabel: '结业',
    description: '冲刺赛季内 688 词全部达到第 4 阶以上',
    icon: '👑',
    metric: 'season_stage4_pct',
    target: 100,
    isLimited: true,
  },
]

export const DEFAULT_TITLE_TIERS: GameTitleTier[] = [
  { minLevel: 1, maxLevel: 3, title: '香草学徒' },
  { minLevel: 4, maxLevel: 7, title: '糖霜新秀' },
  { minLevel: 8, maxLevel: 11, title: '焦糖达人' },
  { minLevel: 12, maxLevel: 15, title: '可可大师' },
  { minLevel: 16, maxLevel: null, title: '奶昔王牌' },
]

export const DEFAULT_GAME_CONFIG: GameConfig = {
  xpByGrade: { 1: 1, 2: 3, 3: 5, 4: 6 },
  levelXp: { L1: 10, L2: 20, L3: 20, L5: 20, BOSS: 50, REVIEW: 0 },
  weakRetryXp: 15,
  weakRetryMaxPerDay: 2,
  weakBossXp: 25,
  ringsClosedXp: 30,
  mnemonicCreatorXp: 20,
  squadGoalXp: 40,
  dailyXpCap: 400,
  sugarCrystalRatio: SUGAR_CRYSTAL_RATIO_DEFAULT,
  maxScoredReviewsPerCardPerDay: 2,
  backlogCapNormal: 50,
  backlogCapReturn: 20,
  returnGapDaysThreshold: 3,
  streakTicketInterval: 7,
  maxFreezeTickets: 2,
  lateNightHour: 22,
  lateNightMinute: 30,
  titleTiers: DEFAULT_TITLE_TIERS,
  badges: DEFAULT_BADGE_DEFS,
  reminderTemplates: [...DEFAULT_REMINDER_TEMPLATES],
}

export const GAME_CONFIG_BOUNDS = {
  xpGradeMin: 0,
  xpGradeMax: 30,
  levelXpMin: 0,
  levelXpMax: 100,
  bossXpMax: 200,
  weakRetryXpMin: 0,
  weakRetryXpMax: 100,
  weakRetryMaxPerDayMin: 0,
  weakRetryMaxPerDayMax: 10,
  weakBossXpMin: 0,
  weakBossXpMax: 150,
  ringsClosedXpMin: 0,
  ringsClosedXpMax: 150,
  mnemonicCreatorXpMin: 0,
  mnemonicCreatorXpMax: 100,
  squadGoalXpMin: 0,
  squadGoalXpMax: 150,
  dailyXpCapMin: 50,
  dailyXpCapMax: 1000,
  maxScoredReviewsPerCardPerDayMin: 1,
  maxScoredReviewsPerCardPerDayMax: 10,
  backlogCapNormalMin: 10,
  backlogCapNormalMax: 200,
  backlogCapReturnMin: 5,
  backlogCapReturnMax: 100,
  returnGapDaysThresholdMin: 1,
  returnGapDaysThresholdMax: 14,
  streakTicketIntervalMin: 3,
  streakTicketIntervalMax: 30,
  maxFreezeTicketsMin: 0,
  maxFreezeTicketsMax: 5,
} as const

function isIntInRange(val: unknown, min: number, max: number): val is number {
  return typeof val === 'number' && Number.isInteger(val) && val >= min && val <= max
}

export function mergeWithDefaultGameConfig(partial: unknown): GameConfig {
  if (!partial || typeof partial !== 'object') return structuredClone(DEFAULT_GAME_CONFIG)
  const p = partial as Partial<GameConfig>
  return {
    xpByGrade: {
      1: p.xpByGrade?.[1] ?? DEFAULT_GAME_CONFIG.xpByGrade[1],
      2: p.xpByGrade?.[2] ?? DEFAULT_GAME_CONFIG.xpByGrade[2],
      3: p.xpByGrade?.[3] ?? DEFAULT_GAME_CONFIG.xpByGrade[3],
      4: p.xpByGrade?.[4] ?? DEFAULT_GAME_CONFIG.xpByGrade[4],
    },
    levelXp: {
      L1: p.levelXp?.L1 ?? DEFAULT_GAME_CONFIG.levelXp.L1,
      L2: p.levelXp?.L2 ?? DEFAULT_GAME_CONFIG.levelXp.L2,
      L3: p.levelXp?.L3 ?? DEFAULT_GAME_CONFIG.levelXp.L3,
      L5: p.levelXp?.L5 ?? DEFAULT_GAME_CONFIG.levelXp.L5,
      BOSS: p.levelXp?.BOSS ?? DEFAULT_GAME_CONFIG.levelXp.BOSS,
      REVIEW: p.levelXp?.REVIEW ?? DEFAULT_GAME_CONFIG.levelXp.REVIEW,
    },
    weakRetryXp: p.weakRetryXp ?? DEFAULT_GAME_CONFIG.weakRetryXp,
    weakRetryMaxPerDay: p.weakRetryMaxPerDay ?? DEFAULT_GAME_CONFIG.weakRetryMaxPerDay,
    weakBossXp: p.weakBossXp ?? DEFAULT_GAME_CONFIG.weakBossXp,
    ringsClosedXp: p.ringsClosedXp ?? DEFAULT_GAME_CONFIG.ringsClosedXp,
    mnemonicCreatorXp: p.mnemonicCreatorXp ?? DEFAULT_GAME_CONFIG.mnemonicCreatorXp,
    squadGoalXp: p.squadGoalXp ?? DEFAULT_GAME_CONFIG.squadGoalXp,
    dailyXpCap: p.dailyXpCap ?? DEFAULT_GAME_CONFIG.dailyXpCap,
    sugarCrystalRatio: p.sugarCrystalRatio ?? DEFAULT_GAME_CONFIG.sugarCrystalRatio,
    maxScoredReviewsPerCardPerDay:
      p.maxScoredReviewsPerCardPerDay ?? DEFAULT_GAME_CONFIG.maxScoredReviewsPerCardPerDay,
    backlogCapNormal: p.backlogCapNormal ?? DEFAULT_GAME_CONFIG.backlogCapNormal,
    backlogCapReturn: p.backlogCapReturn ?? DEFAULT_GAME_CONFIG.backlogCapReturn,
    returnGapDaysThreshold: p.returnGapDaysThreshold ?? DEFAULT_GAME_CONFIG.returnGapDaysThreshold,
    streakTicketInterval: p.streakTicketInterval ?? DEFAULT_GAME_CONFIG.streakTicketInterval,
    maxFreezeTickets: p.maxFreezeTickets ?? DEFAULT_GAME_CONFIG.maxFreezeTickets,
    lateNightHour: p.lateNightHour ?? DEFAULT_GAME_CONFIG.lateNightHour,
    lateNightMinute: p.lateNightMinute ?? DEFAULT_GAME_CONFIG.lateNightMinute,
    titleTiers:
      Array.isArray(p.titleTiers) && p.titleTiers.length > 0 ? p.titleTiers : DEFAULT_TITLE_TIERS,
    badges: Array.isArray(p.badges) && p.badges.length > 0 ? p.badges : DEFAULT_BADGE_DEFS,
    reminderTemplates:
      Array.isArray(p.reminderTemplates) && p.reminderTemplates.length > 0
        ? p.reminderTemplates
        : [...DEFAULT_REMINDER_TEMPLATES],
  }
}

export function validateGameConfig(
  input: unknown,
): { ok: true; config: GameConfig } | { ok: false; errors: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['configPayload must be an object'] }
  }
  const cfg = mergeWithDefaultGameConfig(input)
  const errors: string[] = []
  const B = GAME_CONFIG_BOUNDS

  if (!isSugarCrystalRatio(cfg.sugarCrystalRatio)) {
    errors.push('sugarCrystalRatio must be a number between 0 and 1 with at most 4 decimal places')
  }

  for (const g of [1, 2, 3, 4] as const) {
    if (!isIntInRange(cfg.xpByGrade[g], B.xpGradeMin, B.xpGradeMax)) {
      errors.push(`xpByGrade.${g} must be an integer between ${B.xpGradeMin} and ${B.xpGradeMax}`)
    }
  }
  for (const lvl of ['L1', 'L2', 'L3', 'L5', 'REVIEW'] as const) {
    if (!isIntInRange(cfg.levelXp[lvl], B.levelXpMin, B.levelXpMax)) {
      errors.push(`levelXp.${lvl} must be an integer between ${B.levelXpMin} and ${B.levelXpMax}`)
    }
  }
  if (!isIntInRange(cfg.levelXp.BOSS, B.levelXpMin, B.bossXpMax)) {
    errors.push(`levelXp.BOSS must be an integer between ${B.levelXpMin} and ${B.bossXpMax}`)
  }
  if (!isIntInRange(cfg.weakRetryXp, B.weakRetryXpMin, B.weakRetryXpMax)) {
    errors.push(`weakRetryXp must be an integer between ${B.weakRetryXpMin} and ${B.weakRetryXpMax}`)
  }
  if (!isIntInRange(cfg.weakRetryMaxPerDay, B.weakRetryMaxPerDayMin, B.weakRetryMaxPerDayMax)) {
    errors.push(`weakRetryMaxPerDay must be an integer between ${B.weakRetryMaxPerDayMin} and ${B.weakRetryMaxPerDayMax}`)
  }
  if (!isIntInRange(cfg.weakBossXp, B.weakBossXpMin, B.weakBossXpMax)) {
    errors.push(`weakBossXp must be an integer between ${B.weakBossXpMin} and ${B.weakBossXpMax}`)
  }
  if (!isIntInRange(cfg.ringsClosedXp, B.ringsClosedXpMin, B.ringsClosedXpMax)) {
    errors.push(`ringsClosedXp must be an integer between ${B.ringsClosedXpMin} and ${B.ringsClosedXpMax}`)
  }
  if (!isIntInRange(cfg.mnemonicCreatorXp, B.mnemonicCreatorXpMin, B.mnemonicCreatorXpMax)) {
    errors.push(`mnemonicCreatorXp must be an integer between ${B.mnemonicCreatorXpMin} and ${B.mnemonicCreatorXpMax}`)
  }
  if (!isIntInRange(cfg.squadGoalXp, B.squadGoalXpMin, B.squadGoalXpMax)) {
    errors.push(`squadGoalXp must be an integer between ${B.squadGoalXpMin} and ${B.squadGoalXpMax}`)
  }
  if (!isIntInRange(cfg.dailyXpCap, B.dailyXpCapMin, B.dailyXpCapMax)) {
    errors.push(`dailyXpCap must be an integer between ${B.dailyXpCapMin} and ${B.dailyXpCapMax}`)
  }
  if (!isIntInRange(cfg.maxScoredReviewsPerCardPerDay, B.maxScoredReviewsPerCardPerDayMin, B.maxScoredReviewsPerCardPerDayMax)) {
    errors.push(`maxScoredReviewsPerCardPerDay must be an integer between ${B.maxScoredReviewsPerCardPerDayMin} and ${B.maxScoredReviewsPerCardPerDayMax}`)
  }
  if (!isIntInRange(cfg.backlogCapNormal, B.backlogCapNormalMin, B.backlogCapNormalMax)) {
    errors.push(`backlogCapNormal must be an integer between ${B.backlogCapNormalMin} and ${B.backlogCapNormalMax}`)
  }
  if (!isIntInRange(cfg.backlogCapReturn, B.backlogCapReturnMin, B.backlogCapReturnMax)) {
    errors.push(`backlogCapReturn must be an integer between ${B.backlogCapReturnMin} and ${B.backlogCapReturnMax}`)
  }
  if (cfg.backlogCapReturn > cfg.backlogCapNormal) {
    errors.push('backlogCapReturn must not exceed backlogCapNormal')
  }
  if (!isIntInRange(cfg.returnGapDaysThreshold, B.returnGapDaysThresholdMin, B.returnGapDaysThresholdMax)) {
    errors.push(`returnGapDaysThreshold must be an integer between ${B.returnGapDaysThresholdMin} and ${B.returnGapDaysThresholdMax}`)
  }
  if (!isIntInRange(cfg.streakTicketInterval, B.streakTicketIntervalMin, B.streakTicketIntervalMax)) {
    errors.push(`streakTicketInterval must be an integer between ${B.streakTicketIntervalMin} and ${B.streakTicketIntervalMax}`)
  }
  if (!isIntInRange(cfg.maxFreezeTickets, B.maxFreezeTicketsMin, B.maxFreezeTicketsMax)) {
    errors.push(`maxFreezeTickets must be an integer between ${B.maxFreezeTicketsMin} and ${B.maxFreezeTicketsMax}`)
  }
  if (!isIntInRange(cfg.lateNightHour, 20, 23)) {
    errors.push('lateNightHour must be an integer between 20 and 23')
  }
  if (!isIntInRange(cfg.lateNightMinute, 0, 59)) {
    errors.push('lateNightMinute must be an integer between 0 and 59')
  }

  for (const badge of cfg.badges) {
    if (!badge || typeof badge.key !== 'string' || !badge.key.trim() || typeof badge.name !== 'string' || !badge.name.trim()) {
      errors.push('every badge must have non-empty key and name')
      break
    }
    if (!isIntInRange(badge.target, 1, 10000)) {
      errors.push(`badge ${badge.key} target must be an integer between 1 and 10000`)
      break
    }
  }

  for (const tpl of cfg.reminderTemplates) {
    if (!tpl || typeof tpl.id !== 'string' || !tpl.title?.trim() || !tpl.body?.trim()) {
      errors.push('every reminderTemplate must have non-empty id, title and body')
      break
    }
    const safety = checkReminderTemplateSafety(`${tpl.title} ${tpl.body}`)
    if (!safety.ok) {
      errors.push(`reminderTemplate ${tpl.id} contains disallowed phrasing: ${safety.matched.join(',')}`)
      break
    }
  }

  return errors.length === 0 ? { ok: true, config: cfg } : { ok: false, errors }
}

// ── Asia/Shanghai Timezone & Calendar Math ──────────────────────────────────

const SHANGHAI_TZ = 'Asia/Shanghai'

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function shanghaiDateString(now: Date = new Date()): string {
  const parts = shanghaiFormatter.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function shanghaiDayBounds(now: Date = new Date()): {
  localDate: string
  start: Date
  end: Date
} {
  const localDate = shanghaiDateString(now)
  const start = new Date(`${localDate}T00:00:00+08:00`)
  return { localDate, start, end: new Date(start.getTime() + 86_400_000) }
}

export function diffCalendarDays(fromDateStr: string, toDateStr: string): number {
  const fromMs = Date.parse(`${fromDateStr}T00:00:00Z`)
  const toMs = Date.parse(`${toDateStr}T00:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0
  return Math.round((toMs - fromMs) / 86_400_000)
}

export function addCalendarDays(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

export function shanghaiTimeParts(now: Date = new Date()): {
  localDate: string
  hour: number
  minute: number
  weekStart: string
} {
  const parts = shanghaiFormatter.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  const localDate = `${get('year')}-${get('month')}-${get('day')}`
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  const d = new Date(`${localDate}T00:00:00Z`)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow
  const weekStart = addCalendarDays(localDate, offsetToMon)
  return { localDate, hour, minute, weekStart }
}

export function isLateNightQuiet(
  now: Date = new Date(),
  config: GameConfig = DEFAULT_GAME_CONFIG,
): boolean {
  const { hour, minute } = shanghaiTimeParts(now)
  return hour > config.lateNightHour || (hour === config.lateNightHour && minute >= config.lateNightMinute)
}

// ── XP & Level Progression ──────────────────────────────────────────────────

/**
 * Pure XP calculation for a single review grade.
 * - `isDue`: false returns 0 (first exposure of NEW cards counts as due).
 * - `nthToday`: 1-based ordinal review count for this card on this natural day.
 *   Only the first `maxScoredReviewsPerCardPerDay` (default 2) earn XP.
 */
export function xpForGrade(
  grade: number,
  isDue: boolean,
  nthToday: number,
  config: GameConfig = DEFAULT_GAME_CONFIG,
): number {
  if (!isDue) return 0
  if (!Number.isInteger(nthToday) || nthToday < 1 || nthToday > config.maxScoredReviewsPerCardPerDay) {
    return 0
  }
  return config.xpByGrade[grade as GameGrade] ?? 0
}

export function clampDailyXp(
  amount: number,
  alreadyEarnedToday: number,
  config: GameConfig = DEFAULT_GAME_CONFIG,
): { awarded: number; capped: boolean; remainingAfter: number } {
  const safeEarned = Math.max(0, alreadyEarnedToday)
  const remainingBefore = Math.max(0, config.dailyXpCap - safeEarned)
  const awarded = Math.max(0, Math.min(amount, remainingBefore))
  const remainingAfter = Math.max(0, remainingBefore - awarded)
  return {
    awarded,
    capped: remainingAfter === 0,
    remainingAfter,
  }
}

export function xpRequiredForLevelStep(level: number): number {
  const safe = Math.max(1, Math.floor(level))
  return 100 + (safe - 1) * 50
}

export function titleForLevel(
  level: number,
  config: GameConfig = DEFAULT_GAME_CONFIG,
): string {
  const safe = Math.max(1, Math.floor(level))
  for (const tier of config.titleTiers) {
    if (safe >= tier.minLevel && (tier.maxLevel === null || safe <= tier.maxLevel)) {
      return tier.title
    }
  }
  return config.titleTiers[config.titleTiers.length - 1]?.title ?? '奶昔王牌'
}

export interface GamificationLevelInfo {
  level: number
  title: string
  totalXp: number
  minXp: number
  nextLevelXp: number
  nextLevelTitle: string
  xpIntoLevel: number
  xpForNextLevel: number
  progressPct: number
}

export function levelFromXp(
  totalXp: number,
  config: GameConfig = DEFAULT_GAME_CONFIG,
): GamificationLevelInfo {
  const safeXp = Math.max(0, Math.floor(Number.isFinite(totalXp) ? totalXp : 0))
  let level = 1
  let minXp = 0
  while (true) {
    const stepCost = xpRequiredForLevelStep(level)
    if (safeXp < minXp + stepCost) {
      const xpIntoLevel = safeXp - minXp
      return {
        level,
        title: titleForLevel(level, config),
        totalXp: safeXp,
        minXp,
        nextLevelXp: minXp + stepCost,
        nextLevelTitle: titleForLevel(level + 1, config),
        xpIntoLevel,
        xpForNextLevel: stepCost,
        progressPct: Math.min(100, Math.round((xpIntoLevel / stepCost) * 100)),
      }
    }
    minXp += stepCost
    level += 1
  }
}

// ── Card Rarity (F4) ────────────────────────────────────────────────────────

export interface CardRarityInfo {
  key: CardRarityKey
  label: string
  cssClass: string
  minStage: number
}

export function rarityFromStage(stage: number | null | undefined): CardRarityInfo | null {
  if (stage === null || stage === undefined || stage < 0 || !Number.isFinite(stage)) {
    return null
  }
  if (stage >= 8) {
    return { key: 'DIAMOND', label: '闪钻卡', cssClass: 'rarity-diamond', minStage: 8 }
  }
  if (stage >= 6) {
    return { key: 'GOLD', label: '金箔卡', cssClass: 'rarity-gold', minStage: 6 }
  }
  if (stage >= 3) {
    return { key: 'SILVER', label: '银箔卡', cssClass: 'rarity-silver', minStage: 3 }
  }
  return { key: 'CANDY', label: '糖纸卡', cssClass: 'rarity-candy', minStage: 0 }
}

// ── Dual Rings & Backlog Protection (F2) ────────────────────────────────────

export function computeReviewDueSnapshot(
  rawDueCount: number,
  lastStudiedDate: string | null,
  todayDate: string,
  config: GameConfig = DEFAULT_GAME_CONFIG,
): { reviewDue: number; backlogProtected: boolean; returnProtected: boolean } {
  const safeRaw = Math.max(0, Math.floor(rawDueCount))
  const gap = lastStudiedDate ? diffCalendarDays(lastStudiedDate, todayDate) : 0
  const returnProtected = lastStudiedDate !== null && gap >= config.returnGapDaysThreshold
  const cap = returnProtected ? config.backlogCapReturn : config.backlogCapNormal
  return {
    reviewDue: Math.min(safeRaw, cap),
    backlogProtected: safeRaw > cap,
    returnProtected,
  }
}

export interface RingProgressState {
  reviewDue: number
  reviewDone: number
  levelsPassed: readonly string[]
}

export interface RingProgressResult {
  reviewDue: number
  reviewDone: number
  reviewRatio: number
  reviewClosed: boolean
  levelDone: number
  levelTotal: number
  levelRatio: number
  levelClosed: boolean
  ringsClosed: boolean
  requiredLevels: readonly ('L1' | 'L2' | 'L3')[]
}

const REQUIRED_RING_LEVELS = ['L1', 'L2', 'L3'] as const

export function ringProgress(
  state: RingProgressState,
  _config: GameConfig = DEFAULT_GAME_CONFIG,
): RingProgressResult {
  const reviewDue = Math.max(0, Math.floor(state.reviewDue))
  const reviewDone = Math.max(0, Math.floor(state.reviewDone))
  const reviewClosed = reviewDue === 0 || reviewDone >= reviewDue
  const reviewRatio = reviewDue === 0 ? 1 : Math.min(1, reviewDone / reviewDue)

  const passedSet = new Set(state.levelsPassed)
  const levelDone = REQUIRED_RING_LEVELS.filter((lvl) => passedSet.has(lvl)).length
  const levelTotal = REQUIRED_RING_LEVELS.length
  const levelClosed = levelDone === levelTotal
  const levelRatio = levelDone / levelTotal

  return {
    reviewDue,
    reviewDone: reviewDue === 0 ? 0 : Math.min(reviewDone, reviewDue),
    reviewRatio,
    reviewClosed,
    levelDone,
    levelTotal,
    levelRatio,
    levelClosed,
    ringsClosed: reviewClosed && levelClosed,
    requiredLevels: REQUIRED_RING_LEVELS,
  }
}

// ── Streak & Freeze Tickets (F2) ────────────────────────────────────────────

export interface StreakState {
  streakDays: number
  longestStreak: number
  freezeTickets: number
  lastAchievedDate: string | null
  streakCursorDate?: string | null
}

export interface StreakTransition extends StreakState {
  streakCursorDate: string | null
  ticketConsumed: number
  ticketEarned: number
  streakReset: boolean
}

export function nextStreak(
  prev: StreakState,
  achieved: boolean,
  todayDate: string,
  config: GameConfig = DEFAULT_GAME_CONFIG,
): StreakTransition {
  if (prev.lastAchievedDate === todayDate) {
    return {
      streakDays: prev.streakDays,
      longestStreak: prev.longestStreak,
      freezeTickets: prev.freezeTickets,
      lastAchievedDate: prev.lastAchievedDate,
      streakCursorDate: prev.streakCursorDate ?? prev.lastAchievedDate,
      ticketConsumed: 0,
      ticketEarned: 0,
      streakReset: false,
    }
  }

  let streakDays = Math.max(0, prev.streakDays)
  let longestStreak = Math.max(streakDays, prev.longestStreak)
  let freezeTickets = Math.max(0, Math.min(config.maxFreezeTickets, prev.freezeTickets))
  let lastAchievedDate = prev.lastAchievedDate
  let cursor = prev.streakCursorDate ?? prev.lastAchievedDate
  let ticketConsumed = 0
  let ticketEarned = 0
  let streakReset = false

  if (cursor !== null && streakDays > 0) {
    const gap = diffCalendarDays(cursor, todayDate)
    if (gap >= 2) {
      const missedDays = gap - 1
      if (freezeTickets >= missedDays) {
        freezeTickets -= missedDays
        ticketConsumed = missedDays
        cursor = addCalendarDays(todayDate, -1)
      } else {
        streakDays = 0
        streakReset = true
        cursor = addCalendarDays(todayDate, -1)
      }
    }
  }

  if (achieved) {
    streakDays += 1
    longestStreak = Math.max(longestStreak, streakDays)
    lastAchievedDate = todayDate
    cursor = todayDate
    if (streakDays > 0 && streakDays % config.streakTicketInterval === 0) {
      const nextTickets = Math.min(config.maxFreezeTickets, freezeTickets + 1)
      ticketEarned = nextTickets - freezeTickets
      freezeTickets = nextTickets
    }
  }

  return {
    streakDays,
    longestStreak,
    freezeTickets,
    lastAchievedDate,
    streakCursorDate: cursor,
    ticketConsumed,
    ticketEarned,
    streakReset,
  }
}

// ── Camp Map Star Calculation (F3) ──────────────────────────────────────────

export function computeCampNodeStars(params: {
  l1To3Done: boolean
  bossDone: boolean
  stage4Count: number
  totalWords: number
}): { stars: 0 | 1 | 2 | 3; stage4Target: number; memoryMastered80: boolean } {
  const stage4Target = Math.ceil(params.totalWords * 0.8)
  const memoryMastered80 = params.totalWords > 0 && params.stage4Count >= stage4Target
  let stars: 0 | 1 | 2 | 3 = 0
  if (params.l1To3Done) {
    stars = 1
    if (params.bossDone) {
      stars = 2
      if (memoryMastered80) {
        stars = 3
      }
    }
  }
  return { stars, stage4Target, memoryMastered80 }
}

// ── Teacher Cheer Presets (F10) & Personalization (F11) ─────────────────────

export interface CheerPreset {
  key: string
  sticker: string
  message: string
}

export const TEACHER_CHEER_PRESETS: readonly CheerPreset[] = [
  { key: 'great_streak', sticker: '🔥', message: '连胜状态太稳啦，继续保持这份节奏！' },
  { key: 'come_back', sticker: '🍦', message: '好久不见！今天先背 5 分钟热热身，老师为你打气～' },
  { key: 'boss_hunter', sticker: '⚔️', message: '弱词 Boss 并不可怕，用邪修口诀拿下它！' },
  { key: 'review_first', sticker: '💎', message: '先把到期复习清零，记忆会越来越牢固！' },
  { key: 'class_push', sticker: '🚀', message: '全班周挑战只差一点点了，一起冲刺合拢双环！' },
  { key: 'rest_well', sticker: '🌙', message: '今天进度超棒，记得早点休息保护好脑力哦！' },
]

export const AVATAR_OPTIONS = [
  { key: 'vanilla', emoji: '🍦', label: '香草甜筒' },
  { key: 'strawberry', emoji: '🍓', label: '草莓大福' },
  { key: 'cocoa', emoji: '🍫', label: '可可猫' },
  { key: 'mango', emoji: '🥭', label: '芒果布丁' },
  { key: 'mint', emoji: '🌿', label: '薄荷狐' },
  { key: 'star', emoji: '⭐', label: '奶昔星' },
] as const

export const AVATAR_FRAME_OPTIONS = [
  { key: 'vanilla', label: '香草素框', minLevel: 1, badgeKey: null },
  { key: 'berry', label: '草莓糖霜框', minLevel: 4, badgeKey: null },
  { key: 'caramel', label: '焦糖星环', minLevel: 8, badgeKey: null },
  { key: 'cocoa', label: '可可金边', minLevel: 12, badgeKey: null },
  { key: 'rainbow', label: '奶昔虹彩框', minLevel: 16, badgeKey: null },
  { key: 'camp7', label: '七日营火框', minLevel: 1, badgeKey: 'streak_7' },
] as const

export const CARD_SKIN_OPTIONS = [
  { key: 'classic', label: '香草经典', minLevel: 1, badgeKey: null },
  { key: 'berry_pop', label: '草莓波点', minLevel: 4, badgeKey: null },
  { key: 'mint_breeze', label: '薄荷清风', minLevel: 8, badgeKey: null },
  { key: 'starlight', label: '星夜金箔', minLevel: 12, badgeKey: null },
  { key: 'season_spring', label: '冲刺春芽', minLevel: 1, badgeKey: 'season_25' },
  { key: 'season_summer', label: '冲刺晴空', minLevel: 1, badgeKey: 'season_50' },
  { key: 'season_autumn', label: '冲刺金秋', minLevel: 1, badgeKey: 'season_75' },
  { key: 'season_champ', label: '冲刺夺冠金', minLevel: 1, badgeKey: 'season_100' },
] as const

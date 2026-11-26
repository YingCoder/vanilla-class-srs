/**
 * Word Camp Stage 4 — pure retention, analytics, reminder, mnemonic, squad,
 * sprint-season, smart-plan, weekly-report & accessibility rules.
 *
 * Zero database/HTTP/DOM dependencies so server services, Vitest suites and
 * the React client share identical calculations.
 */

import { addCalendarDays, diffCalendarDays, shanghaiTimeParts } from './gamification'
import type { WordMnemonic } from './vocab'

// ── R2: Analytics Events & Canary Release Scope ─────────────────────────────

export const WORLD_ANALYTICS_EVENT_TYPES = [
  'world_home_open',
  'world_wake_start',
  'world_first_word',
  'world_onboarding_complete',
  'world_spirit_wake',
  'world_story_view',
  'world_story_skip',
  'world_build',
  'world_secret_open',
] as const

export const ANALYTICS_EVENT_TYPES = [
  'app_open',
  'review_start',
  'grade_submit',
  'level_complete',
  'rings_closed',
  'freeze_ticket_used',
  'boss_start',
  'boss_clear',
  'badge_earned',
  'card_upgraded',
  'share_card_save',
  'hot_update_shown',
  'hot_update_click',
  'reminder_sent',
  'reminder_open',
  'game_setting_toggle',
  ...WORLD_ANALYTICS_EVENT_TYPES,
] as const

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number]

export type GameConfigScope =
  | { mode: 'ALL' }
  | { mode: 'CLASSES'; classIds: string[] }

export function normalizeGameConfigScope(scope: unknown): GameConfigScope {
  if (!scope || typeof scope !== 'object') return { mode: 'ALL' }
  const raw = scope as { mode?: unknown; classIds?: unknown }
  if (raw.mode === 'CLASSES' && Array.isArray(raw.classIds)) {
    const clean = [...new Set(raw.classIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((s) => s.trim()))]
    return { mode: 'CLASSES', classIds: clean }
  }
  return { mode: 'ALL' }
}

export function validateGameConfigScope(scope: unknown): { ok: true; scope: GameConfigScope } | { ok: false; error: string } {
  if (scope === undefined || scope === null) return { ok: true, scope: { mode: 'ALL' } }
  if (typeof scope !== 'object' || Array.isArray(scope)) {
    return { ok: false, error: 'scope 必须是对象' }
  }
  const raw = scope as { mode?: unknown; classIds?: unknown }
  if (raw.mode === 'ALL') return { ok: true, scope: { mode: 'ALL' } }
  if (raw.mode === 'CLASSES') {
    if (!Array.isArray(raw.classIds)) {
      return { ok: false, error: '指定班级范围时 classIds 必须为数组' }
    }
    const clean = [...new Set(raw.classIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((s) => s.trim()))]
    if (clean.length === 0) {
      return { ok: false, error: '指定班级范围至少需要选择 1 个班级' }
    }
    return { ok: true, scope: { mode: 'CLASSES', classIds: clean } }
  }
  return { ok: false, error: 'scope.mode 只能为 ALL 或 CLASSES' }
}

export function doesScopeMatchClass(scope: unknown, classId?: string | null): boolean {
  const norm = normalizeGameConfigScope(scope)
  if (norm.mode === 'ALL') return true
  if (!classId) return false
  return norm.classIds.includes(classId)
}

// ── R3: Reminders, Quiet Hours & Safe Copy ──────────────────────────────────

export interface ReminderTemplate {
  id: string
  title: string
  body: string
}

export const DEFAULT_REMINDER_TEMPLATES: readonly ReminderTemplate[] = [
  {
    id: 'due_gentle',
    title: '香草单词营 · 记忆小站',
    body: '今天有 {{dueCount}} 个词快到复习点了，花 3 分钟巩固一下刚刚好～',
  },
  {
    id: 'streak_warm',
    title: '香草单词营 · 打卡贴士',
    body: '你已经保持了自己的节奏（{{streakDays}} 天），今天来复习几张卡吧！',
  },
  {
    id: 'camp_step',
    title: '香草单词营 · 今日一站',
    body: '今日复习与闯关已经备好，随时打开就能轻松推进一小步。',
  },
  {
    id: 'mnemonic_peek',
    title: '香草单词营 · 邪修贴士',
    body: '今日词库里有几张趣味邪修口诀卡片等着和你见面，来看看吧～',
  },
  {
    id: 'light_session',
    title: '香草单词营 · 轻享 5 分钟',
    body: '不需要一次背很多，先完成几个到期词也是很棒的记忆保持。',
  },
  {
    id: 'evening_calm',
    title: '香草单词营 · 晚间温习',
    body: '晚间安静复习 1 轮，睡前巩固印象更清晰哦。',
  },
]

export const FORBIDDEN_REMINDER_KEYWORDS = [
  '再不',
  '断了',
  '惩罚',
  '失败',
  '落后',
  '完蛋',
  '警告',
  '最后通牒',
  '来不及',
  '丢人',
  '扣分',
  '倒数',
] as const

export function checkReminderTemplateSafety(text: string): { ok: true } | { ok: false; matched: string[] } {
  const matched = FORBIDDEN_REMINDER_KEYWORDS.filter((kw) => text.includes(kw))
  return matched.length === 0 ? { ok: true } : { ok: false, matched }
}

export function renderReminderTemplate(
  tpl: ReminderTemplate,
  vars: { dueCount: number; streakDays: number },
): { title: string; body: string } {
  const replace = (s: string) =>
    s
      .replace(/\{\{dueCount\}\}/g, String(Math.max(0, vars.dueCount)))
      .replace(/\{\{streakDays\}\}/g, String(Math.max(0, vars.streakDays)))
  return { title: replace(tpl.title), body: replace(tpl.body) }
}

export const REMINDER_LIMITS = {
  maxPerDay: 1,
  maxPerWeek: 4,
  quietStartHour: 21,
  quietStartMinute: 30,
  morningHour: 7,
  autoPauseAfterUnopened: 3,
  autoPauseDays: 7,
} as const

export interface ReminderEligibilityInput {
  enabled: boolean
  preferredHour: number
  pausedUntil: string | null
  ringsClosedToday: boolean
  sentTodayCount: number
  sentThisWeekCount: number
  now: Date
  ignorePreferredHour?: boolean
}

export function isWithinReminderWindow(now: Date): boolean {
  const { hour, minute } = shanghaiTimeParts(now)
  if (hour < REMINDER_LIMITS.morningHour) return false
  if (hour > REMINDER_LIMITS.quietStartHour) return false
  if (hour === REMINDER_LIMITS.quietStartHour && minute > REMINDER_LIMITS.quietStartMinute) {
    return false
  }
  return true
}

export function evaluateReminderEligibility(
  input: ReminderEligibilityInput,
): { eligible: boolean; reason: string } {
  if (!input.enabled) return { eligible: false, reason: 'disabled' }
  if (input.ringsClosedToday) return { eligible: false, reason: 'rings_already_closed' }

  const { localDate, hour } = shanghaiTimeParts(input.now)
  if (input.pausedUntil && localDate <= input.pausedUntil) {
    return { eligible: false, reason: 'auto_paused' }
  }
  if (!isWithinReminderWindow(input.now)) {
    return { eligible: false, reason: 'quiet_hours' }
  }
  if (!input.ignorePreferredHour && hour < input.preferredHour) {
    return { eligible: false, reason: 'before_preferred_hour' }
  }
  if (input.sentTodayCount >= REMINDER_LIMITS.maxPerDay) {
    return { eligible: false, reason: 'daily_limit_reached' }
  }
  if (input.sentThisWeekCount >= REMINDER_LIMITS.maxPerWeek) {
    return { eligible: false, reason: 'weekly_limit_reached' }
  }
  return { eligible: true, reason: 'ok' }
}

// ── R4: Mnemonic Validation & Safety Filter ─────────────────────────────────

export const SENSITIVE_MNEMONIC_WORDS = [
  '傻逼',
  '操你',
  '妈的',
  '滚蛋',
  '去死',
  '自杀',
  '暴力',
  '色情',
  '赌博',
  '毒品',
  '代写',
  '作弊',
  '<script',
  'javascript:',
  'http://',
  'https://',
] as const

export function checkMnemonicSafety(fields: {
  word?: string
  tag?: string
  hook?: string
  story?: string
  trap?: string
  example?: string
  chunks?: Array<[string, string]>
}): { ok: true } | { ok: false; reason: string } {
  const parts = [
    fields.word ?? '',
    fields.tag ?? '',
    fields.hook ?? '',
    fields.story ?? '',
    fields.trap ?? '',
    fields.example ?? '',
    ...(fields.chunks ?? []).flat(),
  ]
  const combined = parts.join(' ').toLowerCase()
  for (const kw of SENSITIVE_MNEMONIC_WORDS) {
    if (combined.includes(kw.toLowerCase())) {
      return { ok: false, reason: `包含敏感或不合规内容：${kw}` }
    }
  }
  return { ok: true }
}

export interface MnemonicDraftInput {
  word: string
  campDay?: number | null
  tag: string
  hook: string
  story: string
  chunks: Array<[string, string]>
  trap?: string | null
  example?: string | null
}

export function validateMnemonicDraft(
  input: Partial<MnemonicDraftInput>,
): { ok: true; data: MnemonicDraftInput & { mnemonic: WordMnemonic } } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const word = typeof input.word === 'string' ? input.word.trim() : ''
  const tag = typeof input.tag === 'string' ? input.tag.trim() : ''
  const hook = typeof input.hook === 'string' ? input.hook.trim() : ''
  const story = typeof input.story === 'string' ? input.story.trim() : ''
  const trap = typeof input.trap === 'string' && input.trap.trim() ? input.trap.trim() : undefined
  const example = typeof input.example === 'string' && input.example.trim() ? input.example.trim() : undefined

  if (!word) errors.push('单词 word 不能为空')
  else if (word.length > 64) errors.push('单词长度不能超过 64 字符')

  if (!tag) errors.push('流派标签 tag 不能为空')
  else if (tag.length > 24) errors.push('流派标签长度不能超过 24 字符')

  if (!hook) errors.push('记忆钩子 hook 不能为空')
  else if (hook.length > 40) errors.push('记忆钩子长度不能超过 40 字符')

  if (!story) errors.push('记忆故事 story 不能为空')
  else if (story.length > 240) errors.push('记忆故事长度不能超过 240 字符')

  if (trap && trap.length > 160) errors.push('考场防坑提示不能超过 160 字符')
  if (example && example.length > 240) errors.push('例句长度不能超过 240 字符')

  const rawChunks = Array.isArray(input.chunks) ? input.chunks : []
  const chunks: Array<[string, string]> = rawChunks
    .filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length >= 2)
    .map(([a, b]) => [String(a ?? '').trim(), String(b ?? '').trim()] as [string, string])
    .filter(([a, b]) => a.length > 0 && b.length > 0)
  if (chunks.length === 0) errors.push('至少需要 1 组字母块拆解 chunks')

  let campDay: number | null = null
  if (input.campDay !== undefined && input.campDay !== null) {
    if (!Number.isInteger(input.campDay) || input.campDay < 1 || input.campDay > 23) {
      errors.push('campDay 必须为 1–23 的整数')
    } else {
      campDay = input.campDay
    }
  }

  const safety = checkMnemonicSafety({ word, tag, hook, story, trap, example, chunks })
  if (!safety.ok) errors.push(safety.reason)

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    data: {
      word,
      campDay,
      tag,
      hook,
      story,
      chunks: chunks.slice(0, 6),
      trap: trap ?? null,
      example: example ?? null,
      mnemonic: {
        tag,
        hook,
        story,
        chunks: chunks.slice(0, 6),
        ...(trap ? { trap } : {}),
        ...(example ? { example } : {}),
      },
    },
  }
}

// ── R5: Learning Squads ─────────────────────────────────────────────────────

export const SQUAD_MIN_SIZE = 2
export const SQUAD_MAX_SIZE = 3
export const SQUAD_GOAL_MIN_DAYS = 4
export const MAX_SQUAD_CHEERS_PER_DAY = 3

export interface SquadCheerPreset {
  key: string
  sticker: string
  message: string
}

export const SQUAD_CHEER_PRESETS: readonly SquadCheerPreset[] = [
  { key: 'high_five', sticker: '🙌', message: '搭子击掌！今天一起把复习清零吧！' },
  { key: 'keep_going', sticker: '🔥', message: '小队节奏超稳，继续冲本周目标！' },
  { key: 'got_your_back', sticker: '🍦', message: '慢慢背不着急，我先打个样等你～' },
  { key: 'boss_cheer', sticker: '⚔️', message: '遇到难词用邪修口诀拆掉它，加油！' },
  { key: 'done_today', sticker: '✅', message: '我今天双环合拢啦，一起打卡！' },
  { key: 'good_night', sticker: '🌙', message: '早点休息，明天继续并肩背词！' },
]

export function evaluateSquadWeeklyGoal(
  memberClosedDaysCounts: readonly number[],
  minDays: number = SQUAD_GOAL_MIN_DAYS,
): {
  totalMembers: number
  qualifiedMembers: number
  progressPct: number
  goalAchieved: boolean
} {
  const totalMembers = memberClosedDaysCounts.length
  if (totalMembers === 0) {
    return { totalMembers: 0, qualifiedMembers: 0, progressPct: 0, goalAchieved: false }
  }
  const qualifiedMembers = memberClosedDaysCounts.filter((d) => d >= minDays).length
  const cappedSum = memberClosedDaysCounts.reduce((sum, d) => sum + Math.min(minDays, Math.max(0, d)), 0)
  const progressPct = Math.min(100, Math.round((cappedSum / (totalMembers * minDays)) * 100))
  const goalAchieved = totalMembers >= SQUAD_MIN_SIZE && qualifiedMembers === totalMembers
  return { totalMembers, qualifiedMembers, progressPct, goalAchieved }
}

// ── R6: Sprint Season ───────────────────────────────────────────────────────

export const SEASON_TOTAL_TARGET_WORDS = 688
export const SEASON_DEFAULT_LEAD_DAYS = 100

export const SEASON_MILESTONES = [
  { pct: 25, badgeKey: 'season_25', skinKey: 'season_spring', label: '冲刺 25%' },
  { pct: 50, badgeKey: 'season_50', skinKey: 'season_summer', label: '半程 50%' },
  { pct: 75, badgeKey: 'season_75', skinKey: 'season_autumn', label: '决战 75%' },
  { pct: 100, badgeKey: 'season_100', skinKey: 'season_champ', label: '满分登顶' },
] as const

export function computeDefaultSeasonStartDate(examDate: string): string {
  return addCalendarDays(examDate, -SEASON_DEFAULT_LEAD_DAYS)
}

export function evaluateSeasonState(params: {
  examDate: string
  startDate?: string | null
  status: 'AUTO' | 'ACTIVE' | 'PAUSED' | 'ENDED' | string
  todayDate: string
}): {
  isActive: boolean
  isEnded: boolean
  daysRemaining: number
  daysSinceStart: number
  effectiveStartDate: string
} {
  const effectiveStartDate = params.startDate || computeDefaultSeasonStartDate(params.examDate)
  const daysRemaining = diffCalendarDays(params.todayDate, params.examDate)
  const daysSinceStart = diffCalendarDays(effectiveStartDate, params.todayDate)

  if (params.status === 'ENDED' || daysRemaining < 0) {
    return {
      isActive: false,
      isEnded: true,
      daysRemaining: Math.max(0, daysRemaining),
      daysSinceStart,
      effectiveStartDate,
    }
  }
  if (params.status === 'PAUSED') {
    return {
      isActive: false,
      isEnded: false,
      daysRemaining: Math.max(0, daysRemaining),
      daysSinceStart,
      effectiveStartDate,
    }
  }
  if (params.status === 'ACTIVE') {
    return {
      isActive: true,
      isEnded: false,
      daysRemaining: Math.max(0, daysRemaining),
      daysSinceStart,
      effectiveStartDate,
    }
  }
  // AUTO: active when today >= effectiveStartDate (default 100 days before examDate)
  const isActive = params.todayDate >= effectiveStartDate && params.todayDate <= params.examDate
  return {
    isActive,
    isEnded: false,
    daysRemaining: Math.max(0, daysRemaining),
    daysSinceStart,
    effectiveStartDate,
  }
}

export function computeSeasonMilestones(
  stage4WordsCount: number,
  totalWords: number = SEASON_TOTAL_TARGET_WORDS,
): {
  stage4Count: number
  totalWords: number
  pct: number
  reachedMilestones: Array<(typeof SEASON_MILESTONES)[number]>
  nextMilestone: (typeof SEASON_MILESTONES)[number] | null
} {
  const safeTotal = Math.max(1, totalWords)
  const safeCount = Math.max(0, Math.min(safeTotal, stage4WordsCount))
  const pct = Math.min(100, Math.round((safeCount / safeTotal) * 100))
  const reachedMilestones = SEASON_MILESTONES.filter((m) => pct >= m.pct)
  const nextMilestone = SEASON_MILESTONES.find((m) => pct < m.pct) ?? null
  return {
    stage4Count: safeCount,
    totalWords: safeTotal,
    pct,
    reachedMilestones,
    nextMilestone,
  }
}

// ── R7: Smart Today Plan ────────────────────────────────────────────────────

export interface SmartPlanInput {
  rawDueCount: number
  backlogCap: number
  defaultNewPerDay: number
  dueReviewedToday: number
  consecutiveHighCompletionDays: number
  avgSecondsPerWord: number
  seasonActive?: boolean
}

export interface SmartPlanResult {
  rawDueCount: number
  todayDueTarget: number
  remainingDueToday: number
  newWordTarget: number
  isDebtPaydownMode: boolean
  debtDays: number
  debtDailyPlan: Array<{ dayOffset: number; reviewCount: number }>
  extraNewAvailable: boolean
  suggestedExtraNew: number
  estimatedMinutes: number
  avgSecondsPerWord: number
  queuePriorityOrder: string[]
  reasonText: string
}

export function computeSmartTodayPlan(input: SmartPlanInput): SmartPlanResult {
  const rawDue = Math.max(0, Math.floor(input.rawDueCount))
  const cap = Math.max(10, Math.floor(input.backlogCap))
  const defaultNew = Math.max(0, Math.floor(input.defaultNewPerDay))
  const doneToday = Math.max(0, Math.floor(input.dueReviewedToday))
  const avgSec = Math.max(4, Math.min(60, Math.round(input.avgSecondsPerWord || 12)))

  const isDebtPaydownMode = rawDue > cap
  const todayDueTarget = Math.min(rawDue, cap)
  const remainingDueToday = Math.max(0, todayDueTarget - doneToday)
  const newWordTarget = isDebtPaydownMode ? 0 : defaultNew

  const debtDays = isDebtPaydownMode ? Math.ceil(rawDue / cap) : rawDue > 0 ? 1 : 0
  const debtDailyPlan: Array<{ dayOffset: number; reviewCount: number }> = []
  if (isDebtPaydownMode) {
    let rem = rawDue
    for (let d = 0; d < Math.min(7, debtDays); d++) {
      const slice = Math.min(rem, cap)
      debtDailyPlan.push({ dayOffset: d, reviewCount: slice })
      rem -= slice
    }
  }

  const extraNewAvailable = !isDebtPaydownMode && input.consecutiveHighCompletionDays >= 3
  const suggestedExtraNew = extraNewAvailable ? 5 : 0

  const workloadCount = remainingDueToday + newWordTarget
  const estimatedMinutes = workloadCount === 0 ? 0 : Math.max(1, Math.ceil((workloadCount * avgSec) / 60))

  const queuePriorityOrder = input.seasonActive
    ? ['到期复习词', '近7天重来弱词', '第3阶及以下巩固词']
    : ['到期复习词', '今日新学词']

  let reasonText = '节奏均衡，按今日目标稳步推进即可'
  if (isDebtPaydownMode) {
    reasonText = `当前到期词积压（${rawDue} 词），已自动将今日新词降为 0，分 ${debtDays} 天平稳还清`
  } else if (extraNewAvailable) {
    reasonText = '连续 3 天到期词完成率 ≥ 90%，状态超棒！可按需自选「加餐」新词'
  } else if (input.seasonActive) {
    reasonText = '冲刺赛季进行中：队列已优先安排到期词、7天弱词与 ≤3 阶词'
  }

  return {
    rawDueCount: rawDue,
    todayDueTarget,
    remainingDueToday,
    newWordTarget,
    isDebtPaydownMode,
    debtDays,
    debtDailyPlan,
    extraNewAvailable,
    suggestedExtraNew,
    estimatedMinutes,
    avgSecondsPerWord: avgSec,
    queuePriorityOrder,
    reasonText,
  }
}

// ── R8: Weekly Teacher Report Config Advisor ────────────────────────────────

export interface WeeklyAdviceInput {
  xpCapHitRate: number
  dueCompletionRate: number
  dualRingCloseRate: number
  retention7dRate: number
  gamificationOptOutRate: number
  atRiskCount: number
  totalStudents: number
}

export interface ConfigAdviceItem {
  level: 'warn' | 'tip' | 'good'
  metric: string
  configKey: string
  title: string
  detail: string
}

export function generateWeeklyConfigAdvice(metrics: WeeklyAdviceInput): ConfigAdviceItem[] {
  const advice: ConfigAdviceItem[] = []

  if (metrics.xpCapHitRate > 0.05) {
    advice.push({
      level: 'warn',
      metric: `XP 封顶触达率 ${(metrics.xpCapHitRate * 100).toFixed(1)}%`,
      configKey: 'dailyXpCap',
      title: '多名学生触发每日 400 XP 封顶',
      detail: '建议核查是否存在刷分行为；若属高活跃班级，可由管理员在 GAME_CONFIG 中微调 dailyXpCap（当前默认 400）或 xpByGrade。',
    })
  }

  if (metrics.dueCompletionRate < 0.5) {
    advice.push({
      level: 'warn',
      metric: `到期词完成率 ${(metrics.dueCompletionRate * 100).toFixed(1)}%`,
      configKey: 'backlogCapNormal',
      title: '到期词完成率低于 50%',
      detail: '建议降低每日新词投放量（newCardsPerDay）或收紧积压保护上限 backlogCapNormal / backlogCapReturn，减少学生畏难情绪。',
    })
  }

  if (metrics.gamificationOptOutRate > 0.15) {
    advice.push({
      level: 'warn',
      metric: `游戏化关闭率 ${(metrics.gamificationOptOutRate * 100).toFixed(1)}%`,
      configKey: 'ringsClosedXp',
      title: '关闭反馈或榜单的学生比例偏高',
      detail: '建议在班级设置中保持进步榜关闭，减少动效与提醒频次，保持低打扰体验。',
    })
  }

  if (metrics.dualRingCloseRate < 0.4) {
    advice.push({
      level: 'tip',
      metric: `双环合拢率 ${(metrics.dualRingCloseRate * 100).toFixed(1)}%`,
      configKey: 'ringsClosedXp',
      title: '双环合拢率有提升空间（目标 ≥ 40%）',
      detail: '可通过教师端「一键击掌」鼓励完成闯关环，或评估适当提高 ringsClosedXp 合拢奖励。',
    })
  }

  if (metrics.totalStudents > 0 && metrics.atRiskCount / metrics.totalStudents >= 0.25) {
    advice.push({
      level: 'tip',
      metric: `掉队人数 ${metrics.atRiskCount}/${metrics.totalStudents}`,
      configKey: 'returnGapDaysThreshold',
      title: '掉队学生占比较高',
      detail: '建议对掉队名单发送「回归鼓励」，并确认断学回归阈值 returnGapDaysThreshold（默认 3 天）及回归上限 backlogCapReturn（默认 20）。',
    })
  }

  if (advice.length === 0) {
    advice.push({
      level: 'good',
      metric: `双环合拢率 ${(metrics.dualRingCloseRate * 100).toFixed(1)}%`,
      configKey: 'ALL',
      title: '本周班级各项激励与护栏指标健康',
      detail: '暂无需调整 GAME_CONFIG 参数，可继续保持当前学习节奏。',
    })
  }

  return advice
}

// ── R11: Accessibility & Low-Spec Mode ──────────────────────────────────────

export const FONT_SCALE_OPTIONS = [
  { key: 'normal', label: '标准字号' },
  { key: 'large', label: '大字号' },
  { key: 'xlarge', label: '特大护眼' },
] as const

export type FontScaleKey = (typeof FONT_SCALE_OPTIONS)[number]['key']

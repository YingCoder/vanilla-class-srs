/**
 * Word Camp — pure learning, mastery and gamification rules.
 *
 * Source: word-camp-development-v1.1.md §4.1 (daily task, judging, FSRS rating
 * mapping, mastery, stars) and §5 (XP / coins, daily caps, level tiers, event
 * keys). Everything here is a pure function: no database, no HTTP, no clock
 * reads and no randomness. Callers pass every authoritative value explicitly
 * (including "now", the ledger snapshot and already-earned daily totals), so
 * each rule is deterministic and unit-testable.
 *
 * Server authority (§4.1, §12): spelling, hints, variants, FSRS ratings and
 * rewards are decided on the server. These helpers compare an answer with the
 * expected word, so they must never be shipped into the client bundle or used
 * to decide a verdict on the client. `judgeSpelling` deliberately does not
 * return the expected answer text.
 *
 * Idempotency note (§5.1, §9): reward helpers compute candidate awards and
 * detect duplicates ONLY against the ledger snapshot that the caller supplies.
 * They do NOT make settlement idempotent across requests. The database unique
 * constraint on `(user_id, event_key, reward_type)` inside the settlement
 * transaction remains the only real guarantee; callers must still catch the
 * conflict and re-read the ledger.
 */

import { GRADE } from './fsrs/constants'
import type { FSRSState } from './fsrs/fsrs'

// ── Shared validation helpers ────────────────────────────────────────────────

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field}: expected an object`)
  }
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field}: expected a boolean`)
}

function assertInteger(value: unknown, field: string, min: number, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${field}: expected an integer`)
  }
  if (value < min || value > max) throw new RangeError(`${field}: must be between ${min} and ${max}`)
}

function assertValidDate(value: unknown, field: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${field}: expected a valid Date`)
  }
}

// ── Spelling: normalisation, variants, "almost right" feedback (§4.1) ────────
//
// 拼写判分: trim, ignore case, collapse runs of whitespace (phrases such as
// "ice cream"), accept teacher-defined variants (colour / color). Missing or
// extra letters are wrong. A single character difference from an accepted form
// only produces the "almost right" hint and still counts as wrong on the first
// attempt; retry policy stays with the caller.

export interface SpellingTask {
  /** Canonical spelling of the word, as frozen in the task's word version. */
  word: string
  /** Teacher-approved alternative spellings (e.g. colour / color). */
  variants?: readonly string[]
}

export interface SpellingJudgement {
  /** Answer after trim / lowercase / whitespace collapsing. */
  normalizedAnswer: string
  correct: boolean
  /** Which accepted form matched, without exposing the expected text. */
  matchedForm: 'word' | 'variant' | null
  /** Exactly one character away from an accepted form (still incorrect). */
  nearMiss: boolean
}

/** Normalise a spelling answer or accepted form (§4.1). */
export function normalizeSpelling(value: string): string {
  if (typeof value !== 'string') throw new TypeError('spelling: expected a string')
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

interface PreparedSpellingTask {
  word: string
  variants: string[]
}

function prepareSpellingTask(task: SpellingTask): PreparedSpellingTask {
  if (typeof task !== 'object' || task === null) throw new TypeError('spelling task: expected an object')

  assertRecord(task, 'spelling task')
  if (typeof task.word !== 'string') throw new TypeError('spelling task.word: expected a string')
  const word = normalizeSpelling(task.word)
  if (word === '') throw new RangeError('spelling task.word: must not be blank after normalisation')

  let variants: string[] = []
  if (task.variants !== undefined) {
    if (!Array.isArray(task.variants)) throw new TypeError('spelling task.variants: expected an array')
    variants = task.variants.map((variant, index) => {
      if (typeof variant !== 'string') {
        throw new TypeError(`spelling task.variants[${index}]: expected a string`)
      }
      const normalized = normalizeSpelling(variant)
      if (normalized === '') {
        throw new RangeError(`spelling task.variants[${index}]: must not be blank after normalisation`)
      }
      return normalized
    })
  }

  // Duplicates are harmless: dedupe them and drop a variant that repeats the
  // canonical form. Both are import-time concerns, not learner errors.
  const unique = variants.filter((variant) => variant !== word)
  return { word, variants: [...new Set(unique)] }
}

/** True when `a` and `b` differ by exactly one substitution, insertion or deletion. */
function isOneCharacterApart(a: string, b: string): boolean {
  const left = Array.from(a)
  const right = Array.from(b)
  const lengthDelta = Math.abs(left.length - right.length)
  if (lengthDelta > 1) return false

  if (lengthDelta === 0) {
    let differences = 0
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) differences += 1
      if (differences > 1) return false
    }
    return differences === 1
  }

  const short = left.length < right.length ? left : right
  const long = left.length < right.length ? right : left
  let shortIndex = 0
  let longIndex = 0
  let skipped = false

  while (shortIndex < short.length && longIndex < long.length) {
    if (short[shortIndex] === long[longIndex]) {
      shortIndex += 1
      longIndex += 1
      continue
    }
    if (skipped) return false
    skipped = true
    longIndex += 1
  }

  if (shortIndex !== short.length) return false
  return skipped ? longIndex === long.length : long.length - longIndex === 1
}

/**
 * Judge one spelling submission (§4.1).
 *
 * `nearMiss` means "very close, try again" — it never makes the answer correct.
 * The caller still records `correct: false` for the first attempt, counts
 * hints/attempts and lets `rateAnswerAttempt` map the final outcome to FSRS.
 * Server-side only: the expected word must not be sent to the client.
 */
export function judgeSpelling(answer: string, task: SpellingTask): SpellingJudgement {
  if (typeof answer !== 'string') throw new TypeError('spelling answer: expected a string')
  const prepared = prepareSpellingTask(task)
  const normalizedAnswer = normalizeSpelling(answer)

  let matchedForm: SpellingJudgement['matchedForm'] = null
  if (normalizedAnswer !== '') {
    if (normalizedAnswer === prepared.word) matchedForm = 'word'
    else if (prepared.variants.includes(normalizedAnswer)) matchedForm = 'variant'
  }

  const correct = matchedForm !== null
  const nearMiss =
    !correct &&
    normalizedAnswer !== '' &&
    (isOneCharacterApart(normalizedAnswer, prepared.word) ||
      prepared.variants.some((variant) => isOneCharacterApart(normalizedAnswer, variant)))

  return { normalizedAnswer, correct, matchedForm, nearMiss }
}

// ── FSRS rating mapping (§4.1) ───────────────────────────────────────────────
//
// 首次独立答对 → Good; 提示后答对 / 重试后答对 → Hard; 最终答错或展示答案 →
// Again. Easy is intentionally never produced (V1.1 stays out of speed-based
// grading). Every word produces at most one scheduling rating per session, taken
// from its final independent recall question (spelling first, else L3).

export const MAX_HINT_LEVEL = 2
export const MAX_QUESTION_ATTEMPTS = 3

export const WORD_CAMP_RATING = {
  AGAIN: GRADE.AGAIN,
  HARD: GRADE.HARD,
  GOOD: GRADE.GOOD,
} as const

export type WordCampRating = (typeof WORD_CAMP_RATING)[keyof typeof WORD_CAMP_RATING]

const RATING_NAMES: Record<WordCampRating, 'again' | 'hard' | 'good'> = {
  1: 'again',
  2: 'hard',
  3: 'good',
}

export interface AnswerAttempt {
  correct: boolean
  /** 1-based attempt number within the question (1 = first independent try). */
  attemptNo: number
  /** 0 = no hint, 1 = first letter, 2 = letter by letter. */
  hintLevel: number
  /** The correct answer was shown to the student before this attempt. */
  answerRevealed: boolean
}

export type RatingReason =
  | 'first_independent_correct'
  | 'correct_after_hint'
  | 'correct_after_retry'
  | 'incorrect'
  | 'answer_revealed'

export interface RatingDecision {
  rating: WordCampRating
  ratingName: 'again' | 'hard' | 'good'
  reason: RatingReason
}

function assertRating(value: unknown, field: string): asserts value is WordCampRating {
  if (value !== WORD_CAMP_RATING.AGAIN && value !== WORD_CAMP_RATING.HARD && value !== WORD_CAMP_RATING.GOOD) {
    throw new RangeError(`${field}: expected 1 (Again), 2 (Hard) or 3 (Good); Easy is not enabled`)
  }
}

function assertAnswerAttempt(attempt: AnswerAttempt, field: string): void {
  if (typeof attempt !== 'object' || attempt === null) throw new TypeError(`${field}: expected an object`)
  assertBoolean(attempt.correct, `${field}.correct`)
  assertInteger(attempt.attemptNo, `${field}.attemptNo`, 1, MAX_QUESTION_ATTEMPTS)
  assertInteger(attempt.hintLevel, `${field}.hintLevel`, 0, MAX_HINT_LEVEL)
  assertBoolean(attempt.answerRevealed, `${field}.answerRevealed`)
}

/**
 * Map the final result of one question to an FSRS grade (§4.1).
 * Easy (4) is unreachable by design.
 */
export function rateAnswerAttempt(attempt: AnswerAttempt): RatingDecision {
  assertAnswerAttempt(attempt, 'answer attempt')

  if (attempt.answerRevealed) {
    // Showing the answer ends independent recall for this attempt.
    return { rating: WORD_CAMP_RATING.AGAIN, ratingName: RATING_NAMES[1], reason: 'answer_revealed' }
  }
  if (!attempt.correct) {
    return { rating: WORD_CAMP_RATING.AGAIN, ratingName: RATING_NAMES[1], reason: 'incorrect' }
  }
  // DECISION: a hinted retry reports the hint reason; both hint and retry map
  // to Hard, and the hint is the stronger evidence of partial recall.
  if (attempt.hintLevel > 0) {
    return { rating: WORD_CAMP_RATING.HARD, ratingName: RATING_NAMES[2], reason: 'correct_after_hint' }
  }
  if (attempt.attemptNo > 1) {
    return { rating: WORD_CAMP_RATING.HARD, ratingName: RATING_NAMES[2], reason: 'correct_after_retry' }
  }
  return { rating: WORD_CAMP_RATING.GOOD, ratingName: RATING_NAMES[3], reason: 'first_independent_correct' }
}

/** Retry is allowed while fewer than the maximum attempts have been used. */
export function canRetryAfterAttempt(attemptNo: number): boolean {
  assertInteger(attemptNo, 'attemptNo', 1, MAX_QUESTION_ATTEMPTS)
  return attemptNo < MAX_QUESTION_ATTEMPTS
}

export type WordCampQuestionType =
  | 'l1_recognize'
  | 'l2_en_to_zh'
  | 'l3_zh_to_en'
  | 'l4_listen'
  | 'l5_spelling'
  | 'boss'

const QUESTION_TYPES: readonly WordCampQuestionType[] = [
  'l1_recognize',
  'l2_en_to_zh',
  'l3_zh_to_en',
  'l4_listen',
  'l5_spelling',
  'boss',
]

function assertQuestionType(value: unknown, field: string): asserts value is WordCampQuestionType {
  if (!QUESTION_TYPES.includes(value as WordCampQuestionType)) {
    throw new RangeError(`${field}: expected one of ${QUESTION_TYPES.join(', ')}`)
  }
}

export interface SessionAnswerRecord extends AnswerAttempt {
  questionType: WordCampQuestionType
}

/**
 * Pick the single answer that may schedule the word (§4.1): the final attempt
 * of the spelling question, else the final attempt of L3 (Chinese → English),
 * else nothing (other question types never schedule). One word in one session
 * yields at most one rating.
 */
export function selectSchedulingAnswer(
  answers: readonly SessionAnswerRecord[],
): SessionAnswerRecord | null {
  if (!Array.isArray(answers)) throw new TypeError('session answers: expected an array')

  answers.forEach((answer, index) => {
    if (typeof answer !== 'object' || answer === null) {
      throw new TypeError(`session answers[${index}]: expected an object`)
    }
    assertQuestionType(answer.questionType, `session answers[${index}].questionType`)
    assertAnswerAttempt(answer, `session answers[${index}]`)
  })

  for (const questionType of ['l5_spelling', 'l3_zh_to_en'] as const) {
    for (let i = answers.length - 1; i >= 0; i -= 1) {
      if (answers[i].questionType === questionType) return answers[i]
    }
  }
  return null
}

// ── Study date (§4.1: Asia/Shanghai calendar day) ────────────────────────────

export const STUDY_TIME_ZONE = 'Asia/Shanghai'

const studyDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const STUDY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** YYYY-MM-DD study date derived from the Asia/Shanghai calendar day. */
export function shanghaiStudyDate(now: Date): string {
  assertValidDate(now, 'now')
  const parts = studyDateFormatter.formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Strict check for a real calendar date in YYYY-MM-DD form. */
export function isValidStudyDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = STUDY_DATE_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function assertStudyDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${field}: expected a string`)
  if (!isValidStudyDate(value)) throw new RangeError(`${field}: expected a valid YYYY-MM-DD calendar date`)
}

// ── Daily task completion (§4.1) ─────────────────────────────────────────────

export interface DailyTaskProgress {
  /** L1–L5 (or equivalent replacements) plus today's Boss passed. */
  newWordPartDone: boolean
  /** Every review word assigned for today was answered. */
  reviewPartDone: boolean
  /** 0 when the student has no due reviews today. */
  reviewWordsAssigned: number
}

/**
 * A daily task is done when the new-word part AND the review part are done;
 * with no due reviews, the new-word part alone counts (§4.1).
 */
export function isDailyTaskComplete(progress: DailyTaskProgress): boolean {
  if (typeof progress !== 'object' || progress === null) throw new TypeError('daily task progress: expected an object')
  assertBoolean(progress.newWordPartDone, 'daily task progress.newWordPartDone')
  assertBoolean(progress.reviewPartDone, 'daily task progress.reviewPartDone')
  assertInteger(progress.reviewWordsAssigned, 'daily task progress.reviewWordsAssigned', 0, Number.MAX_SAFE_INTEGER)

  if (!progress.newWordPartDone) return false
  return progress.reviewWordsAssigned === 0 || progress.reviewPartDone
}

// ── Mastery state (§4.1) ─────────────────────────────────────────────────────

export const MASTERY_STATE = {
  NOT_LEARNED: 'not_learned',
  LEARNING: 'learning',
  DUE: 'due',
  MASTERED: 'mastered',
} as const

export type MasteryState = (typeof MASTERY_STATE)[keyof typeof MASTERY_STATE]

export const DEFAULT_MASTERED_STABILITY_DAYS = 21

const FSRS_STATES: readonly FSRSState[] = ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING']

export interface WordProgressSnapshot {
  state: FSRSState
  stability: number
  dueAt: Date | null
  /** Most recent review rating; null when no review has been logged yet. */
  lastRating: WordCampRating | null
}

export interface MasteryOptions {
  /** Authoritative "now"; passed in so the rule stays pure. */
  now: Date
  /** Configurable stability threshold in days (spec start value: 21). */
  masteredStabilityDays?: number
}

/**
 * Derive the learner-facing mastery label from scheduling data (§4.1).
 *
 * Precedence (explicit, because several rows of the spec table can apply at
 * once):
 * 1. no progress record → not_learned
 * 2. REVIEW + stability ≥ threshold + last review not failed → mastered
 *    DECISION: mastery is a level, not a moment. A mastered word stays mastered
 *    while it comes due again — §4.1 requires mastered words to keep being
 *    scheduled, and the review queue is queried by `due_at` separately.
 * 3. NEW / LEARNING / RELEARNING → learning (the schedule is still (re)learning)
 * 4. REVIEW, due_at ≤ now, stability below threshold → due
 * 5. otherwise → learning (stability still low)
 */
export function deriveMasteryState(
  progress: WordProgressSnapshot | null | undefined,
  options: MasteryOptions,
): MasteryState {
  assertValidDate(options?.now, 'mastery options.now')
  const threshold = options.masteredStabilityDays ?? DEFAULT_MASTERED_STABILITY_DAYS
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0) {
    throw new RangeError('mastery options.masteredStabilityDays: expected a positive number')
  }

  if (progress === null || progress === undefined) return MASTERY_STATE.NOT_LEARNED
  if (typeof progress !== 'object') throw new TypeError('word progress: expected an object or null')

  if (!FSRS_STATES.includes(progress.state)) {
    throw new RangeError('word progress.state: expected NEW, LEARNING, REVIEW or RELEARNING')
  }
  if (typeof progress.stability !== 'number' || !Number.isFinite(progress.stability) || progress.stability < 0) {
    throw new RangeError('word progress.stability: expected a finite number >= 0')
  }
  if (progress.dueAt !== null) assertValidDate(progress.dueAt, 'word progress.dueAt')
  if (progress.lastRating !== null) assertRating(progress.lastRating, 'word progress.lastRating')

  const lastReviewFailed = progress.lastRating === WORD_CAMP_RATING.AGAIN
  const mastered =
    progress.state === 'REVIEW' &&
    progress.stability >= threshold &&
    progress.lastRating !== null &&
    !lastReviewFailed

  if (mastered) return MASTERY_STATE.MASTERED
  if (progress.state === 'NEW' || progress.state === 'LEARNING' || progress.state === 'RELEARNING') {
    return MASTERY_STATE.LEARNING
  }
  if (progress.dueAt !== null && progress.dueAt.getTime() <= options.now.getTime()) {
    return MASTERY_STATE.DUE
  }
  return MASTERY_STATE.LEARNING
}

// ── Levels (§5.2) ────────────────────────────────────────────────────────────

export interface LevelTierDefinition {
  level: number
  minXp: number
  title: string
}

/** Cumulative XP thresholds and titles (§5.2); start values pending calibration. */
export const LEVEL_TIERS: readonly LevelTierDefinition[] = [
  { level: 1, minXp: 0, title: '词汇新兵' },
  { level: 2, minXp: 100, title: '学习先锋' },
  { level: 3, minXp: 300, title: '词汇达人' },
  { level: 4, minXp: 600, title: '英语挑战者' },
  { level: 5, minXp: 1000, title: '单词高手' },
  { level: 6, minXp: 1600, title: '特训营精英' },
  { level: 7, minXp: 2400, title: '词汇指挥官' },
  { level: 8, minXp: 3400, title: '单词大师' },
  { level: 9, minXp: 4600, title: '英语王牌' },
  { level: 10, minXp: 6000, title: '词汇传奇' },
]

export interface LevelProgress {
  level: number
  title: string
  minXp: number
  nextLevelXp: number | null
  nextLevelTitle: string | null
  xpIntoLevel: number
  xpForNextLevel: number | null
}

/** Derive the level from lifetime XP (§5.2). Negative or fractional XP is rejected. */
export function levelForXp(totalXp: number): LevelProgress {
  if (typeof totalXp !== 'number' || !Number.isFinite(totalXp)) {
    throw new TypeError('totalXp: expected a finite number')
  }
  if (!Number.isInteger(totalXp)) throw new TypeError('totalXp: expected an integer')
  if (totalXp < 0) throw new RangeError('totalXp: must be >= 0')

  let current = LEVEL_TIERS[0]
  for (const tier of LEVEL_TIERS) {
    if (totalXp >= tier.minXp) current = tier
    else break
  }
  const next = LEVEL_TIERS.find((tier) => tier.level === current.level + 1) ?? null

  return {
    level: current.level,
    title: current.title,
    minXp: current.minXp,
    nextLevelXp: next ? next.minXp : null,
    nextLevelTitle: next ? next.title : null,
    xpIntoLevel: totalXp - current.minXp,
    xpForNextLevel: next ? next.minXp - current.minXp : null,
  }
}

// ── Level clear and stars (§4.1) ─────────────────────────────────────────────

export const DEFAULT_LEVEL_CLEAR_RATE = 0.7
export const BOSS_LEVEL_CLEAR_RATE = 0.8
export const TWO_STAR_FIRST_TRY_ACCURACY = 0.9

export interface LevelAttemptStats {
  questionCount: number
  /** Questions correct on the first attempt, with no hint. */
  firstTryCorrect: number
  /** Questions correct eventually, including hint/retry attempts. */
  eventuallyCorrect: number
  /** Teacher-configurable pass mark; 0.7 for levels, 0.8 for the Boss. */
  clearRate?: number
}

export interface LevelStars {
  cleared: boolean
  /** 0 = not cleared; 1 = cleared; 2 = 90% first-try; 3 = 100% first-try. */
  stars: 0 | 1 | 2 | 3
  firstTryAccuracy: number
  finalAccuracy: number
}

/**
 * Clear gate and stars (§4.1): the pass mark uses final accuracy (hints and
 * retries count toward clearing), while stars 2 and 3 use first-try accuracy
 * (90% / 100%). Inputs are counts, so the thresholds are exact.
 */
export function computeLevelStars(stats: LevelAttemptStats): LevelStars {
  if (typeof stats !== 'object' || stats === null) throw new TypeError('level stats: expected an object')
  assertInteger(stats.questionCount, 'level stats.questionCount', 1, Number.MAX_SAFE_INTEGER)
  assertInteger(stats.firstTryCorrect, 'level stats.firstTryCorrect', 0, stats.questionCount)
  assertInteger(stats.eventuallyCorrect, 'level stats.eventuallyCorrect', stats.firstTryCorrect, stats.questionCount)

  const clearRate = stats.clearRate ?? DEFAULT_LEVEL_CLEAR_RATE
  if (typeof clearRate !== 'number' || !Number.isFinite(clearRate) || clearRate <= 0 || clearRate > 1) {
    throw new RangeError('level stats.clearRate: expected a number in (0, 1]')
  }

  const firstTryAccuracy = stats.firstTryCorrect / stats.questionCount
  const finalAccuracy = stats.eventuallyCorrect / stats.questionCount
  const cleared = finalAccuracy >= clearRate
  const twoStar = firstTryAccuracy >= TWO_STAR_FIRST_TRY_ACCURACY
  const threeStar = stats.firstTryCorrect === stats.questionCount

  let stars: LevelStars['stars'] = 0
  if (cleared) {
    stars = 1
    if (twoStar) stars = 2
    if (threeStar) stars = 3
  }

  return { cleared, stars, firstTryAccuracy, finalAccuracy }
}

// ── Rewards (§5.1): canonical event keys and amounts ─────────────────────────

export type RewardType = 'word_learned' | 'review_ok' | 'boss_clear' | 'daily_done' | 'streak7'

export const REWARD_TYPES: readonly RewardType[] = [
  'word_learned',
  'review_ok',
  'boss_clear',
  'daily_done',
  'streak7',
]

export interface RewardAmount {
  xp: number
  coins: number
}

/** Default amounts from §5.1; teachers may override per settlement. */
export const DEFAULT_REWARD_RULES: Readonly<Record<RewardType, RewardAmount>> = {
  word_learned: { xp: 10, coins: 0 },
  review_ok: { xp: 5, coins: 0 },
  boss_clear: { xp: 20, coins: 10 },
  daily_done: { xp: 20, coins: 50 },
  streak7: { xp: 30, coins: 30 },
}

/** Default daily caps from §5.1. */
export const DEFAULT_DAILY_REWARD_CAPS: Readonly<RewardAmount> = { xp: 250, coins: 100 }

const SEGMENT_PATTERN = /^[^\s:|]+$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

function isRewardType(value: unknown): value is RewardType {
  return REWARD_TYPES.includes(value as RewardType)
}

function assertKeySegment(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field}: expected a string`)
  if (value.trim() === '') throw new RangeError(`${field}: must not be blank`)
  if (value !== value.trim()) throw new RangeError(`${field}: must not have leading or trailing whitespace`)
  if (!SEGMENT_PATTERN.test(value) || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new RangeError(`${field}: must not contain whitespace, ":", "|" or control characters`)
  }
  return value
}

function assertPositiveVersion(value: unknown, field: string): string {
  const text = assertKeySegment(value, field)
  if (!/^\d+$/.test(text)) throw new RangeError(`${field}: expected a positive integer`)
  const version = Number(text)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RangeError(`${field}: expected a positive integer`)
  }
  return text
}

function assertRewardAmount(value: unknown, field: string): RewardAmount {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${field}: expected an object`)
  const amount = value as Record<string, unknown>
  assertInteger(amount.xp, `${field}.xp`, 0, Number.MAX_SAFE_INTEGER)
  assertInteger(amount.coins, `${field}.coins`, 0, Number.MAX_SAFE_INTEGER)
  return { xp: amount.xp, coins: amount.coins }
}

export type RewardEventInput =
  | { rewardType: 'word_learned'; contextId: string; wordId: string }
  | { rewardType: 'review_ok'; contextId: string; wordId: string; cycleStartDate: string }
  | { rewardType: 'boss_clear'; assignmentId: string; assignmentVersion: number; bossId: string }
  | { rewardType: 'daily_done'; studyDate: string }
  | { rewardType: 'streak7'; streakStartDate: string }

/** Build the canonical event key exactly as specified in §5.1. */
export function rewardEventKey(event: RewardEventInput): string {
  if (typeof event !== 'object' || event === null) throw new TypeError('reward event: expected an object')

  switch (event.rewardType) {
    case 'word_learned':
      return `word_learned:${assertKeySegment(event.contextId, 'contextId')}:${assertKeySegment(event.wordId, 'wordId')}`
    case 'review_ok':
      return `review_ok:${assertKeySegment(event.contextId, 'contextId')}:${assertKeySegment(event.wordId, 'wordId')}:${requireStudyDate(event.cycleStartDate, 'cycleStartDate')}`
    case 'boss_clear': {
      assertInteger(event.assignmentVersion, 'assignmentVersion', 1, Number.MAX_SAFE_INTEGER)
      return `boss_clear:${assertKeySegment(event.assignmentId, 'assignmentId')}:${event.assignmentVersion}:${assertKeySegment(event.bossId, 'bossId')}`
    }
    case 'daily_done':
      return `daily_done:${requireStudyDate(event.studyDate, 'studyDate')}`
    case 'streak7':
      return `streak7:${requireStudyDate(event.streakStartDate, 'streakStartDate')}`
    default:
      throw new RangeError('reward event.rewardType: unknown reward type')
  }
}

function requireStudyDate(value: unknown, field: string): string {
  assertStudyDate(value, field)
  return value
}

interface ParsedRewardEventKey {
  rewardType: RewardType
  segments: string[]
}

const EVENT_KEY_SEGMENT_COUNTS: Record<RewardType, number> = {
  word_learned: 3,
  review_ok: 4,
  boss_clear: 4,
  daily_done: 2,
  streak7: 2,
}

function parseRewardEventKey(eventKey: unknown, field: string): ParsedRewardEventKey {
  if (typeof eventKey !== 'string') throw new TypeError(`${field}: expected a string`)
  const segments = eventKey.split(':')
  const rewardType = segments[0]
  if (!isRewardType(rewardType)) throw new RangeError(`${field}: unknown reward type`)

  const expected = EVENT_KEY_SEGMENT_COUNTS[rewardType]
  if (segments.length !== expected) {
    throw new RangeError(`${field}: expected ${expected} colon-separated segments for ${rewardType}`)
  }
  for (const segment of segments) {
    // Reuses the segment rules: non-blank, no whitespace/colon/pipe/controls.
    assertKeySegment(segment, `${field} segment`)
  }

  if (rewardType === 'review_ok') assertStudyDate(segments[3], `${field} cycle start date`)
  if (rewardType === 'daily_done') assertStudyDate(segments[1], `${field} study date`)
  if (rewardType === 'streak7') assertStudyDate(segments[1], `${field} streak start date`)
  if (rewardType === 'boss_clear') assertPositiveVersion(segments[2], `${field} assignment version`)

  return { rewardType, segments }
}

/**
 * Idempotency key for the ledger row. Mirrors the DB uniqueness of
 * `(user_id, event_key, reward_type)` while keeping students and reward types
 * apart when the same event key is replayed. This is a lookup key only; it
 * grants no idempotency by itself.
 */
export function rewardIdempotencyKey(userId: string, rewardType: RewardType, eventKey: string): string {
  const normalizedUserId = assertKeySegment(userId, 'userId')
  if (!isRewardType(rewardType)) throw new RangeError('rewardType: unknown reward type')
  const parsed = parseRewardEventKey(eventKey, 'eventKey')
  if (parsed.rewardType !== rewardType) {
    throw new RangeError(`eventKey: "${eventKey}" does not belong to reward type ${rewardType}`)
  }
  return `${normalizedUserId}|${rewardType}|${eventKey}`
}

// ── Rewards (§5.1): pure daily settlement over a supplied snapshot ───────────

export interface RewardCandidate {
  userId: string
  rewardType: RewardType
  eventKey: string
}

/** Ledger rows the caller has already read; used only for duplicate detection. */
export interface RecordedReward {
  userId: string
  rewardType: RewardType
  eventKey: string
}

/** Authoritative totals already earned by one student on the settled study date. */
export interface DailyRewardUsage {
  userId: string
  xpEarned: number
  coinsEarned: number
}

export type RewardRejectionReason = 'duplicate' | 'daily_cap' | 'no_reward'

export interface SettledReward {
  userId: string
  rewardType: RewardType
  eventKey: string
  xp: number
  coins: number
}

export interface RejectedReward {
  userId: string
  rewardType: RewardType
  eventKey: string
  reason: RewardRejectionReason
}

export interface SettleDailyRewardsInput {
  /** Asia/Shanghai study date the settlement belongs to. */
  studyDate: string
  candidates: readonly RewardCandidate[]
  recorded: readonly RecordedReward[]
  /** Required for every candidate user; nothing is assumed to be zero. */
  usage: readonly DailyRewardUsage[]
  /** Per-reward overrides; defaults to DEFAULT_REWARD_RULES. */
  rules?: Partial<Record<RewardType, RewardAmount>>
  /** Daily cap overrides; defaults to DEFAULT_DAILY_REWARD_CAPS. */
  caps?: Partial<RewardAmount>
  /**
   * What to do when a reward would cross a daily cap.
   * - 'clamp' (default): award whatever remains in each currency.
   * - 'reject': award nothing and leave the cap untouched.
   */
  capOverflow?: 'clamp' | 'reject'
}

export interface SettleDailyRewardsResult {
  studyDate: string
  awards: SettledReward[]
  rejected: RejectedReward[]
  /** Totals after applying the awards, in input order. */
  usageAfter: DailyRewardUsage[]
}

function mergedRules(overrides?: Partial<Record<RewardType, RewardAmount>>): Record<RewardType, RewardAmount> {
  const rules: Record<RewardType, RewardAmount> = {
    word_learned: { ...DEFAULT_REWARD_RULES.word_learned },
    review_ok: { ...DEFAULT_REWARD_RULES.review_ok },
    boss_clear: { ...DEFAULT_REWARD_RULES.boss_clear },
    daily_done: { ...DEFAULT_REWARD_RULES.daily_done },
    streak7: { ...DEFAULT_REWARD_RULES.streak7 },
  }
  if (overrides === undefined) return rules
  if (typeof overrides !== 'object' || overrides === null) throw new TypeError('rules: expected an object')

  for (const [rewardType, amount] of Object.entries(overrides)) {
    if (!isRewardType(rewardType)) throw new RangeError(`rules: unknown reward type ${rewardType}`)
    rules[rewardType] = assertRewardAmount(amount, `rules.${rewardType}`)
  }
  return rules
}

function mergedCaps(overrides?: Partial<RewardAmount>): RewardAmount {
  if (overrides === undefined) return { xp: DEFAULT_DAILY_REWARD_CAPS.xp, coins: DEFAULT_DAILY_REWARD_CAPS.coins }
  if (typeof overrides !== 'object' || overrides === null) throw new TypeError('caps: expected an object')
  return assertRewardAmount(
    {
      xp: overrides.xp ?? DEFAULT_DAILY_REWARD_CAPS.xp,
      coins: overrides.coins ?? DEFAULT_DAILY_REWARD_CAPS.coins,
    },
    'caps',
  )
}

/**
 * Compute one day's rewards for the students named in `candidates`.
 *
 * Pure: it dedupes against the `recorded` ledger snapshot it is given and caps
 * against the supplied `usage` totals, in candidate order. Calling it twice
 * with the same snapshot settles the same awards twice — settlement is made
 * idempotent by the database, not by this function (§5.1, §9).
 */
export function settleDailyRewards(input: SettleDailyRewardsInput): SettleDailyRewardsResult {
  if (typeof input !== 'object' || input === null) throw new TypeError('reward settlement input: expected an object')
  assertStudyDate(input.studyDate, 'studyDate')
  if (!Array.isArray(input.candidates)) throw new TypeError('candidates: expected an array')
  if (!Array.isArray(input.recorded)) throw new TypeError('recorded: expected an array')
  if (!Array.isArray(input.usage)) throw new TypeError('usage: expected an array')

  const rules = mergedRules(input.rules)
  const caps = mergedCaps(input.caps)
  const capOverflow = input.capOverflow ?? 'clamp'
  if (capOverflow !== 'clamp' && capOverflow !== 'reject') {
    throw new RangeError('capOverflow: expected "clamp" or "reject"')
  }

  const usageByUser = new Map<string, DailyRewardUsage>()
  for (const [index, entry] of input.usage.entries()) {
    if (typeof entry !== 'object' || entry === null) throw new TypeError(`usage[${index}]: expected an object`)
    const userId = assertKeySegment(entry.userId, `usage[${index}].userId`)
    assertInteger(entry.xpEarned, `usage[${index}].xpEarned`, 0, Number.MAX_SAFE_INTEGER)
    assertInteger(entry.coinsEarned, `usage[${index}].coinsEarned`, 0, Number.MAX_SAFE_INTEGER)
    if (usageByUser.has(userId)) throw new RangeError(`usage: duplicate entry for user ${userId}`)
    usageByUser.set(userId, {
      userId,
      xpEarned: entry.xpEarned,
      coinsEarned: entry.coinsEarned,
    })
  }

  // Ledger snapshot: already-settled keys are duplicates forever, across dates.
  const settledKeys = new Set<string>()
  for (const [index, entry] of input.recorded.entries()) {
    if (typeof entry !== 'object' || entry === null) throw new TypeError(`recorded[${index}]: expected an object`)
    const userId = assertKeySegment(entry.userId, `recorded[${index}].userId`)
    if (!isRewardType(entry.rewardType)) {
      throw new RangeError(`recorded[${index}].rewardType: unknown reward type`)
    }
    settledKeys.add(rewardIdempotencyKey(userId, entry.rewardType, entry.eventKey))
  }

  const awards: SettledReward[] = []
  const rejected: RejectedReward[] = []

  // Keep the declared element type after the Array.isArray guard above, which
  // would otherwise widen the array to `any[]`.
  const candidates: readonly RewardCandidate[] = input.candidates
  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate !== 'object' || candidate === null) {
      throw new TypeError(`candidates[${index}]: expected an object`)
    }
    const userId = assertKeySegment(candidate.userId, `candidates[${index}].userId`)
    if (!isRewardType(candidate.rewardType)) {
      throw new RangeError(`candidates[${index}].rewardType: unknown reward type`)
    }
    const rewardType = candidate.rewardType
    const idempotencyKey = rewardIdempotencyKey(userId, rewardType, candidate.eventKey)
    const parsed = parseRewardEventKey(candidate.eventKey, `candidates[${index}].eventKey`)

    if (parsed.rewardType === 'daily_done' && parsed.segments[1] !== input.studyDate) {
      throw new RangeError(
        `candidates[${index}].eventKey: daily_done date ${parsed.segments[1]} does not match studyDate ${input.studyDate}`,
      )
    }

    if (settledKeys.has(idempotencyKey)) {
      rejected.push({ userId, rewardType, eventKey: candidate.eventKey, reason: 'duplicate' })
      continue
    }

    const amount = rules[rewardType]
    if (amount.xp === 0 && amount.coins === 0) {
      // E.g. replaying an already-cleared level (§5.1): no ledger row to write.
      rejected.push({ userId, rewardType, eventKey: candidate.eventKey, reason: 'no_reward' })
      continue
    }

    const usage = usageByUser.get(userId)
    if (!usage) throw new RangeError(`usage: missing entry for user ${userId}`)

    const remainingXp = Math.max(0, caps.xp - usage.xpEarned)
    const remainingCoins = Math.max(0, caps.coins - usage.coinsEarned)
    const xp = Math.min(amount.xp, remainingXp)
    const coins = Math.min(amount.coins, remainingCoins)

    if (capOverflow === 'reject' && (xp < amount.xp || coins < amount.coins)) {
      rejected.push({ userId, rewardType, eventKey: candidate.eventKey, reason: 'daily_cap' })
      continue
    }
    if (xp === 0 && coins === 0) {
      // 'clamp' mode with nothing left in either currency.
      rejected.push({ userId, rewardType, eventKey: candidate.eventKey, reason: 'daily_cap' })
      continue
    }

    awards.push({ userId, rewardType, eventKey: candidate.eventKey, xp, coins })
    settledKeys.add(idempotencyKey)
    usage.xpEarned += xp
    usage.coinsEarned += coins
  }

  return {
    studyDate: input.studyDate,
    awards,
    rejected,
    usageAfter: Array.from(usageByUser.values()),
  }
}

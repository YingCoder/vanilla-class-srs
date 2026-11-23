/**
 * Pure rules for the daily task and level flow. No database, no HTTP, no clock.
 * FSRS grades, reward keys and star rules stay in shared/word-camp.ts.
 */

import {
  BOSS_LEVEL_CLEAR_RATE,
  DEFAULT_LEVEL_CLEAR_RATE,
  MAX_QUESTION_ATTEMPTS,
  computeLevelStars,
  isDailyTaskComplete,
  normalizeSpelling,
  type LevelAttemptStats,
  type LevelStars,
} from '@vanilla-srs/shared/word-camp'

export type LevelKind = 'L1' | 'L2' | 'L3' | 'L5' | 'BOSS' | 'REVIEW'
export type ObjectiveLevel = 'L2' | 'L3' | 'L5' | 'BOSS' | 'REVIEW'
export type QuestionKind = 'L2' | 'L3' | 'L5'
export type LevelViewKind = LevelKind | 'L4'
export type LevelViewState = 'NOT_STARTED' | 'IN_PROGRESS' | 'FAILED' | 'CLEARED' | 'SKIPPED'

export interface DailyTaskConfig {
  levels: LevelKind[]
  newWordsPerDay: number
  reviewsPerDay: number
  clearRate: number
  bossClearRate: number
  listening: 'equivalent'
}

export const DEFAULT_DAILY_TASK_CONFIG: DailyTaskConfig = {
  levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'],
  newWordsPerDay: 10,
  reviewsPerDay: 10,
  clearRate: DEFAULT_LEVEL_CLEAR_RATE,
  bossClearRate: BOSS_LEVEL_CLEAR_RATE,
  listening: 'equivalent',
}

const MIXED_QUESTION_KINDS: readonly QuestionKind[] = ['L2', 'L3', 'L5']
const REVIEW_QUESTION_KINDS: readonly QuestionKind[] = ['L3', 'L5']

export function questionKindForLevel(level: LevelKind, wordIndex: number): QuestionKind | null {
  switch (level) {
    case 'L2':
      return 'L2'
    case 'L3':
      return 'L3'
    case 'L5':
      return 'L5'
    case 'BOSS':
      return MIXED_QUESTION_KINDS[wordIndex % MIXED_QUESTION_KINDS.length]
    case 'REVIEW':
      return REVIEW_QUESTION_KINDS[wordIndex % REVIEW_QUESTION_KINDS.length]
    default:
      return null
  }
}

/** One scheduling point per task: L5 when present, else L3; reviews schedule at REVIEW. */
export function shouldScheduleLevel(level: LevelKind, config: DailyTaskConfig): boolean {
  if (level === 'REVIEW' || level === 'L5') return true
  if (level === 'L3') return !config.levels.includes('L5')
  return false
}

export interface QuestionAttemptProgress {
  attemptsUsed: number
  hintLevel: number
  firstTryCorrect: boolean
  eventuallyCorrect: boolean
  answerRevealed: boolean
}

export interface QuestionAttemptOutcome {
  attemptNo: number
  finished: boolean
  retryAllowed: boolean
  revealAnswer: boolean
  next: QuestionAttemptProgress
}

/**
 * Advance one question by one submission. A hinted first attempt still counts
 * as independent for FSRS (Hard), but not for the first-try star/reward stat.
 */
export function applyQuestionAttempt(
  progress: QuestionAttemptProgress,
  input: { correct: boolean },
): QuestionAttemptOutcome {
  if (progress.answerRevealed || progress.attemptsUsed >= MAX_QUESTION_ATTEMPTS) {
    throw new RangeError('question: already finished')
  }
  if (typeof input.correct !== 'boolean') throw new TypeError('question attempt.correct: expected a boolean')

  const attemptNo = progress.attemptsUsed + 1
  const firstTryCorrect =
    progress.firstTryCorrect || (attemptNo === 1 && progress.hintLevel === 0 && input.correct)
  const eventuallyCorrect = progress.eventuallyCorrect || input.correct
  const finished = input.correct || attemptNo >= MAX_QUESTION_ATTEMPTS
  const revealAnswer = !input.correct && attemptNo >= MAX_QUESTION_ATTEMPTS

  return {
    attemptNo,
    finished,
    retryAllowed: !finished,
    revealAnswer,
    next: {
      attemptsUsed: attemptNo,
      hintLevel: progress.hintLevel,
      firstTryCorrect,
      eventuallyCorrect,
      answerRevealed: progress.answerRevealed || revealAnswer,
    },
  }
}

export function summarizeQuestions(
  questions: readonly { firstTryCorrect: boolean; eventuallyCorrect: boolean }[],
): LevelAttemptStats {
  return {
    questionCount: questions.length,
    firstTryCorrect: questions.filter((question) => question.firstTryCorrect).length,
    eventuallyCorrect: questions.filter((question) => question.eventuallyCorrect).length,
  }
}

export function levelOutcome(level: ObjectiveLevel, stats: LevelAttemptStats): LevelStars {
  const firstTryAccuracy = stats.questionCount === 0 ? 0 : stats.firstTryCorrect / stats.questionCount
  const finalAccuracy = stats.questionCount === 0 ? 0 : stats.eventuallyCorrect / stats.questionCount
  if (level === 'REVIEW') {
    return { cleared: true, stars: 0, firstTryAccuracy, finalAccuracy }
  }
  return computeLevelStars({
    ...stats,
    clearRate: level === 'BOSS' ? BOSS_LEVEL_CLEAR_RATE : DEFAULT_LEVEL_CLEAR_RATE,
  })
}

export interface LevelProgressSnapshot {
  level: LevelKind
  state: LevelViewState
}

export function evaluateDailyTask(input: {
  newWordCount: number
  reviewWordCount: number
  levels: readonly LevelProgressSnapshot[]
}): { newWordPartDone: boolean; reviewPartDone: boolean; completed: boolean; hasWords: boolean } {
  const isCleared = (level: LevelKind) =>
    input.levels.some((snapshot) => snapshot.level === level && snapshot.state === 'CLEARED')
  const newWordLevels: LevelKind[] = ['L1', 'L2', 'L3', 'L5', 'BOSS']
  const newWordPartDone = input.newWordCount === 0 ? true : newWordLevels.every(isCleared)
  const reviewPartDone = input.reviewWordCount === 0 ? true : isCleared('REVIEW')
  const hasWords = input.newWordCount + input.reviewWordCount > 0
  return {
    newWordPartDone,
    reviewPartDone,
    hasWords,
    completed:
      hasWords &&
      isDailyTaskComplete({
        newWordPartDone,
        reviewPartDone,
        reviewWordsAssigned: input.reviewWordCount,
      }),
  }
}

/** "c_____" then "col___" for `colour`; used by the spelling hint endpoint. */
export function spellingHint(word: string, hintLevel: number): string {
  const characters = Array.from(word)
  if (characters.length === 0) return ''
  if (hintLevel <= 1) return `${characters[0]}${'_'.repeat(Math.max(0, characters.length - 1))}`
  const reveal = Math.max(1, Math.ceil(characters.length / 2))
  return characters.map((character, index) => (index < reveal ? character : '_')).join('')
}

function fnv1a(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

export function pickExcludedOption(
  correct: string,
  options: readonly string[],
  seed: string,
): string | null {
  const wrong = options.filter(
    (option) => normalizeSpelling(option) !== normalizeSpelling(correct),
  )
  if (wrong.length === 0) return null
  return wrong[fnv1a(seed) % wrong.length]
}

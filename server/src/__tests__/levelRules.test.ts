import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DAILY_TASK_CONFIG,
  applyQuestionAttempt,
  evaluateDailyTask,
  levelOutcome,
  pickExcludedOption,
  questionKindForLevel,
  shouldScheduleLevel,
  spellingHint,
  summarizeQuestions,
} from '../services/levelRules'

const freshQuestion = {
  attemptsUsed: 0,
  hintLevel: 0,
  firstTryCorrect: false,
  eventuallyCorrect: false,
  answerRevealed: false,
}

describe('questionKindForLevel', () => {
  it('fixes the question type for single-type levels', () => {
    expect(questionKindForLevel('L2', 0)).toBe('L2')
    expect(questionKindForLevel('L3', 5)).toBe('L3')
    expect(questionKindForLevel('L5', 9)).toBe('L5')
  })

  it('mixes types for Boss and keeps review scheduling-eligible', () => {
    expect(['L2', 'L3', 'L5']).toEqual(
      Array.from({ length: 3 }, (_, i) => questionKindForLevel('BOSS', i)),
    )
    expect(questionKindForLevel('REVIEW', 0)).toBe('L3')
    expect(questionKindForLevel('REVIEW', 1)).toBe('L5')
    expect(questionKindForLevel('REVIEW', 2)).toBe('L3')
  })

  it('returns null for the L1 preview', () => {
    expect(questionKindForLevel('L1', 0)).toBeNull()
  })
})

describe('shouldScheduleLevel', () => {
  it('schedules at L5 when present, otherwise L3', () => {
    expect(shouldScheduleLevel('L5', DEFAULT_DAILY_TASK_CONFIG)).toBe(true)
    expect(shouldScheduleLevel('L3', DEFAULT_DAILY_TASK_CONFIG)).toBe(false)
    const noL5 = { ...DEFAULT_DAILY_TASK_CONFIG, levels: ['L1', 'L2', 'L3', 'BOSS', 'REVIEW'] as any }
    expect(shouldScheduleLevel('L3', noL5)).toBe(true)
    expect(shouldScheduleLevel('REVIEW', noL5)).toBe(true)
    expect(shouldScheduleLevel('L2', noL5)).toBe(false)
  })
})

describe('applyQuestionAttempt', () => {
  it('counts a clean first attempt as first-try correct', () => {
    const outcome = applyQuestionAttempt(freshQuestion, { correct: true })
    expect(outcome).toMatchObject({
      attemptNo: 1,
      finished: true,
      retryAllowed: false,
      revealAnswer: false,
      next: { firstTryCorrect: true, eventuallyCorrect: true },
    })
  })

  it('does not count a hinted first attempt as first-try correct', () => {
    const outcome = applyQuestionAttempt({ ...freshQuestion, hintLevel: 1 }, { correct: true })
    expect(outcome.next.firstTryCorrect).toBe(false)
    expect(outcome.next.eventuallyCorrect).toBe(true)
  })

  it('allows two retries and reveals on the third failure', () => {
    const first = applyQuestionAttempt(freshQuestion, { correct: false })
    expect(first).toMatchObject({ attemptNo: 1, retryAllowed: true, revealAnswer: false })
    const second = applyQuestionAttempt(first.next, { correct: false })
    expect(second).toMatchObject({ attemptNo: 2, retryAllowed: true, revealAnswer: false })
    const third = applyQuestionAttempt(second.next, { correct: false })
    expect(third).toMatchObject({ attemptNo: 3, retryAllowed: false, revealAnswer: true })
    expect(third.next.answerRevealed).toBe(true)
    expect(third.next.eventuallyCorrect).toBe(false)
  })

  it('rejects a fourth attempt', () => {
    const third = applyQuestionAttempt(
      { ...freshQuestion, attemptsUsed: 2 },
      { correct: false },
    )
    expect(() => applyQuestionAttempt(third.next, { correct: false })).toThrow(RangeError)
  })
})

describe('summarizeQuestions and levelOutcome', () => {
  it('passes at 70% and awards stars from first-try accuracy', () => {
    const stats = summarizeQuestions([
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: false, eventuallyCorrect: true },
      { firstTryCorrect: false, eventuallyCorrect: false },
    ])
    expect(stats).toEqual({ questionCount: 4, firstTryCorrect: 2, eventuallyCorrect: 3 })
    expect(levelOutcome('L3', stats)).toMatchObject({ cleared: true, stars: 1 })
  })

  it('uses the 80% Boss gate', () => {
    const stats = summarizeQuestions([
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: true, eventuallyCorrect: true },
      { firstTryCorrect: false, eventuallyCorrect: true },
      { firstTryCorrect: false, eventuallyCorrect: false },
    ])
    expect(levelOutcome('BOSS', stats)).toMatchObject({ cleared: true, stars: 1 })
  })

  it('marks review as cleared without stars once answered', () => {
    const stats = summarizeQuestions([
      { firstTryCorrect: false, eventuallyCorrect: false },
      { firstTryCorrect: true, eventuallyCorrect: true },
    ])
    expect(levelOutcome('REVIEW', stats)).toMatchObject({ cleared: true, stars: 0 })
  })
})

describe('evaluateDailyTask', () => {
  const cleared = ['L1', 'L2', 'L3', 'L5', 'BOSS'].map((level) => ({
    level: level as any,
    state: 'CLEARED' as const,
  }))

  it('is complete only when both parts are done', () => {
    expect(evaluateDailyTask({ newWordCount: 10, reviewWordCount: 10, levels: cleared }).completed).toBe(false)
    expect(
      evaluateDailyTask({
        newWordCount: 10,
        reviewWordCount: 10,
        levels: [...cleared, { level: 'REVIEW', state: 'CLEARED' }],
      }).completed,
    ).toBe(true)
  })

  it('does not award an empty task', () => {
    expect(evaluateDailyTask({ newWordCount: 0, reviewWordCount: 0, levels: [] }).completed).toBe(false)
  })
})

describe('hints', () => {
  it('reveals the first letter then half of the word', () => {
    expect(spellingHint('colour', 1)).toBe('c_____')
    expect(spellingHint('colour', 2)).toBe('col___')
  })

  it('picks a deterministic wrong option', () => {
    const first = pickExcludedOption('颜色', ['颜色', '形状', '味道', '大小'], 'seed')
    const second = pickExcludedOption('颜色', ['颜色', '形状', '味道', '大小'], 'seed')
    expect(first).toBe(second)
    expect(first).not.toBe('颜色')
  })
})

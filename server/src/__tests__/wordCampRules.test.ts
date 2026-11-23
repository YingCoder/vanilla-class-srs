import { describe, it, expect } from 'vitest'
import type { RewardCandidate, SettleDailyRewardsInput } from '@vanilla-srs/shared/word-camp'
import {
  BOSS_LEVEL_CLEAR_RATE,
  DEFAULT_DAILY_REWARD_CAPS,
  DEFAULT_LEVEL_CLEAR_RATE,
  DEFAULT_MASTERED_STABILITY_DAYS,
  DEFAULT_REWARD_RULES,
  LEVEL_TIERS,
  MASTERY_STATE,
  MAX_HINT_LEVEL,
  MAX_QUESTION_ATTEMPTS,
  TWO_STAR_FIRST_TRY_ACCURACY,
  WORD_CAMP_RATING,
  canRetryAfterAttempt,
  computeLevelStars,
  deriveMasteryState,
  isDailyTaskComplete,
  isValidStudyDate,
  judgeSpelling,
  levelForXp,
  normalizeSpelling,
  rateAnswerAttempt,
  rewardEventKey,
  rewardIdempotencyKey,
  selectSchedulingAnswer,
  settleDailyRewards,
  shanghaiStudyDate,
} from '@vanilla-srs/shared/word-camp'

// ── Spelling: normalisation, variants, near-miss feedback (§4.1) ─────────────

describe('normalizeSpelling', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(normalizeSpelling('  Engine  ')).toBe('engine')
  })

  it('collapses internal whitespace so phrases compare consistently', () => {
    expect(normalizeSpelling('  Ice \t  Cream  ')).toBe('ice cream')
    expect(normalizeSpelling('ICE\nCREAM')).toBe('ice cream')
  })

  it('rejects non-string input', () => {
    expect(() => normalizeSpelling(42 as never)).toThrow(TypeError)
  })
})

describe('judgeSpelling', () => {
  const iceCream = { word: 'ice cream' }

  it('accepts differing case and spacing for a phrase', () => {
    const result = judgeSpelling('  ICE   Cream ', iceCream)
    expect(result).toEqual({
      normalizedAnswer: 'ice cream',
      correct: true,
      matchedForm: 'word',
      nearMiss: false,
    })
  })

  it('accepts a teacher-defined variant', () => {
    const result = judgeSpelling('COLOUR', { word: 'color', variants: ['colour'] })
    expect(result.correct).toBe(true)
    expect(result.matchedForm).toBe('variant')
    expect(result.nearMiss).toBe(false)
  })

  it('normalises variants and tolerates duplicates of the canonical word', () => {
    expect(judgeSpelling('color', { word: 'color', variants: [' Color ', 'color'] }).matchedForm).toBe('word')
    expect(judgeSpelling('colour', { word: 'color', variants: [' Colour '] }).matchedForm).toBe('variant')
  })

  it('rejects a missing letter instead of accepting it', () => {
    const result = judgeSpelling('clor', { word: 'color' })
    expect(result.correct).toBe(false)
    expect(result.matchedForm).toBeNull()
    expect(result.nearMiss).toBe(true)
  })

  it('rejects an extra letter, even a near-miss against a variant', () => {
    const result = judgeSpelling('colour', { word: 'color' })
    expect(result.correct).toBe(false)
    expect(result.nearMiss).toBe(true)

    const variantResult = judgeSpelling('colou', { word: 'color', variants: ['colour'] })
    expect(variantResult.correct).toBe(false)
    expect(variantResult.nearMiss).toBe(true)
  })

  it('treats exactly one substituted character as a near miss, two as ordinary wrong', () => {
    expect(judgeSpelling('cplor', { word: 'color' }).nearMiss).toBe(true)
    expect(judgeSpelling('kalor', { word: 'color' }).nearMiss).toBe(false)
  })

  it('does not treat a transposition as one character difference', () => {
    // "cloor" differs from "color" in two positions; it is not "almost right".
    expect(judgeSpelling('cloor', { word: 'color' }).nearMiss).toBe(false)
  })

  it('treats a missing space in a phrase as a near miss', () => {
    expect(judgeSpelling('icecream', iceCream).nearMiss).toBe(true)
  })

  it('never labels a blank answer as a near miss', () => {
    expect(judgeSpelling('', { word: 'a' })).toEqual({
      normalizedAnswer: '',
      correct: false,
      matchedForm: null,
      nearMiss: false,
    })
    expect(judgeSpelling('   ', { word: 'color' }).nearMiss).toBe(false)
  })

  it('rejects an unusable task definition', () => {
    expect(() => judgeSpelling('x', { word: '   ' })).toThrow(RangeError)
    expect(() => judgeSpelling('x', { word: 7 } as never)).toThrow(TypeError)
    expect(() => judgeSpelling('x', { word: 'a', variants: 'b' } as never)).toThrow(TypeError)
    expect(() => judgeSpelling('x', { word: 'a', variants: ['  '] })).toThrow(RangeError)
    expect(() => judgeSpelling('x', { word: 'a', variants: [1] } as never)).toThrow(TypeError)
  })

  it('rejects a non-string answer', () => {
    expect(() => judgeSpelling(null as never, { word: 'a' })).toThrow(TypeError)
  })
})

// ── FSRS rating mapping (§4.1) ───────────────────────────────────────────────

describe('rateAnswerAttempt', () => {
  const base = { correct: true, attemptNo: 1, hintLevel: 0, answerRevealed: false }

  it('maps a first independent correct answer to Good', () => {
    const decision = rateAnswerAttempt(base)
    expect(decision.rating).toBe(WORD_CAMP_RATING.GOOD)
    expect(decision.rating).toBe(3)
    expect(decision.ratingName).toBe('good')
    expect(decision.reason).toBe('first_independent_correct')
  })

  it('maps a hinted correct answer to Hard', () => {
    const decision = rateAnswerAttempt({ ...base, hintLevel: 1 })
    expect(decision.rating).toBe(WORD_CAMP_RATING.HARD)
    expect(decision.reason).toBe('correct_after_hint')
  })

  it('maps a retried correct answer to Hard', () => {
    const decision = rateAnswerAttempt({ ...base, attemptNo: 2 })
    expect(decision.rating).toBe(WORD_CAMP_RATING.HARD)
    expect(decision.reason).toBe('correct_after_retry')
  })

  it('reports the hint when an answer was both hinted and retried', () => {
    const decision = rateAnswerAttempt({ ...base, attemptNo: 2, hintLevel: MAX_HINT_LEVEL })
    expect(decision.rating).toBe(WORD_CAMP_RATING.HARD)
    expect(decision.reason).toBe('correct_after_hint')
  })

  it('maps several wrong attempts and a revealed answer to Again', () => {
    expect(rateAnswerAttempt({ ...base, correct: false, attemptNo: 3 })).toEqual({
      rating: WORD_CAMP_RATING.AGAIN,
      ratingName: 'again',
      reason: 'incorrect',
    })
    expect(rateAnswerAttempt({ ...base, answerRevealed: true, attemptNo: 3 })).toEqual({
      rating: WORD_CAMP_RATING.AGAIN,
      ratingName: 'again',
      reason: 'answer_revealed',
    })
  })

  it('never produces Easy, whatever the timing', () => {
    for (const attempt of [
      base,
      { ...base, hintLevel: 1 },
      { ...base, attemptNo: 3 },
      { ...base, correct: false },
      { ...base, answerRevealed: true },
    ]) {
      expect([1, 2, 3]).toContain(rateAnswerAttempt(attempt).rating)
    }
  })

  it('rejects out-of-range attempt and hint data', () => {
    expect(() => rateAnswerAttempt({ ...base, attemptNo: 0 })).toThrow(RangeError)
    expect(() => rateAnswerAttempt({ ...base, attemptNo: MAX_QUESTION_ATTEMPTS + 1 })).toThrow(RangeError)
    expect(() => rateAnswerAttempt({ ...base, hintLevel: MAX_HINT_LEVEL + 1 })).toThrow(RangeError)
    expect(() => rateAnswerAttempt({ ...base, correct: 'yes' } as never)).toThrow(TypeError)
    expect(() => rateAnswerAttempt(null as never)).toThrow(TypeError)
  })
})

describe('canRetryAfterAttempt', () => {
  it('allows two retries and stops at the third attempt', () => {
    expect(canRetryAfterAttempt(1)).toBe(true)
    expect(canRetryAfterAttempt(2)).toBe(true)
    expect(canRetryAfterAttempt(MAX_QUESTION_ATTEMPTS)).toBe(false)
  })

  it('rejects invalid attempt numbers', () => {
    expect(() => canRetryAfterAttempt(0)).toThrow(RangeError)
    expect(() => canRetryAfterAttempt(4)).toThrow(RangeError)
    expect(() => canRetryAfterAttempt(1.5)).toThrow(TypeError)
  })
})

describe('selectSchedulingAnswer', () => {
  const firstCorrect = { correct: true, attemptNo: 1, hintLevel: 0, answerRevealed: false }
  const l3 = { questionType: 'l3_zh_to_en' as const, ...firstCorrect }
  const l2 = { questionType: 'l2_en_to_zh' as const, ...firstCorrect }
  const spellingFirst = { questionType: 'l5_spelling' as const, ...firstCorrect, correct: false }
  const boss = { questionType: 'boss' as const, ...firstCorrect }

  it('prefers the final spelling attempt over any other question', () => {
    expect(selectSchedulingAnswer([l2, l3, spellingFirst])).toEqual(spellingFirst)
  })

  it('uses the last spelling attempt as the final recall result', () => {
    const last = { ...spellingFirst, attemptNo: 2 }
    expect(selectSchedulingAnswer([spellingFirst, last])).toEqual(last)
  })

  it('falls back to L3 when the word has no spelling question', () => {
    expect(selectSchedulingAnswer([l2, l3, boss])).toEqual(l3)
  })

  it('returns null when neither spelling nor L3 was asked', () => {
    expect(selectSchedulingAnswer([])).toBeNull()
    expect(selectSchedulingAnswer([l2, boss])).toBeNull()
  })

  it('rejects malformed session records', () => {
    expect(() => selectSchedulingAnswer('nope' as never)).toThrow(TypeError)
    expect(() => selectSchedulingAnswer([{ ...l3, questionType: 'unknown' } as never])).toThrow(RangeError)
    expect(() => selectSchedulingAnswer([{ ...l3, attemptNo: 0 }])).toThrow(RangeError)
  })
})

// ── Shanghai study date (§4.1) ───────────────────────────────────────────────

describe('shanghaiStudyDate', () => {
  it('rolls over at 16:00 UTC (midnight in Asia/Shanghai)', () => {
    expect(shanghaiStudyDate(new Date('2026-10-04T15:59:59Z'))).toBe('2026-10-04')
    expect(shanghaiStudyDate(new Date('2026-10-04T16:00:00Z'))).toBe('2026-10-05')
    expect(shanghaiStudyDate(new Date('2026-10-04T16:30:00Z'))).toBe('2026-10-05')
  })

  it('handles the year boundary in the study timezone', () => {
    expect(shanghaiStudyDate(new Date('2026-12-31T15:59:59Z'))).toBe('2026-12-31')
    expect(shanghaiStudyDate(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
  })

  it('rejects an invalid date value', () => {
    expect(() => shanghaiStudyDate(new Date('not a date'))).toThrow(TypeError)
    expect(() => shanghaiStudyDate('2026-10-04' as never)).toThrow(TypeError)
  })
})

describe('isValidStudyDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidStudyDate('2026-10-05')).toBe(true)
    expect(isValidStudyDate('2024-02-29')).toBe(true)
  })

  it('rejects malformed or impossible dates', () => {
    for (const value of ['2026-2-3', '2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '', '2026-10-05T00:00:00Z']) {
      expect(isValidStudyDate(value)).toBe(false)
    }
    expect(isValidStudyDate(20261005 as never)).toBe(false)
    expect(isValidStudyDate(null as never)).toBe(false)
  })
})

// ── Daily task completion (§4.1) ─────────────────────────────────────────────

describe('isDailyTaskComplete', () => {
  it('requires both parts when reviews were assigned', () => {
    expect(isDailyTaskComplete({ newWordPartDone: true, reviewPartDone: true, reviewWordsAssigned: 10 })).toBe(true)
    expect(isDailyTaskComplete({ newWordPartDone: true, reviewPartDone: false, reviewWordsAssigned: 10 })).toBe(false)
    expect(isDailyTaskComplete({ newWordPartDone: false, reviewPartDone: true, reviewWordsAssigned: 10 })).toBe(false)
  })

  it('needs only the new-word part when there are no due reviews', () => {
    expect(isDailyTaskComplete({ newWordPartDone: true, reviewPartDone: false, reviewWordsAssigned: 0 })).toBe(true)
    expect(isDailyTaskComplete({ newWordPartDone: false, reviewPartDone: false, reviewWordsAssigned: 0 })).toBe(false)
  })

  it('rejects invalid progress data', () => {
    expect(() =>
      isDailyTaskComplete({ newWordPartDone: true, reviewPartDone: true, reviewWordsAssigned: -1 }),
    ).toThrow(RangeError)
    expect(() =>
      isDailyTaskComplete({ newWordPartDone: true, reviewPartDone: true, reviewWordsAssigned: 1.5 }),
    ).toThrow(TypeError)
    expect(() => isDailyTaskComplete({ newWordPartDone: 'yes', reviewPartDone: true, reviewWordsAssigned: 0 } as never)).toThrow(TypeError)
    expect(() => isDailyTaskComplete(null as never)).toThrow(TypeError)
  })
})

// ── Mastery state (§4.1) ─────────────────────────────────────────────────────

describe('deriveMasteryState', () => {
  const NOW = new Date('2026-10-05T04:00:00Z')
  const past = new Date('2026-10-01T00:00:00Z')
  const future = new Date('2026-10-10T00:00:00Z')
  const review = (overrides: Record<string, unknown> = {}) => ({
    state: 'REVIEW' as const,
    stability: 25,
    dueAt: future,
    lastRating: WORD_CAMP_RATING.GOOD,
    ...overrides,
  })

  it('reports no learning record as not learned', () => {
    expect(deriveMasteryState(null, { now: NOW })).toBe(MASTERY_STATE.NOT_LEARNED)
    expect(deriveMasteryState(undefined, { now: NOW })).toBe(MASTERY_STATE.NOT_LEARNED)
  })

  it('treats a NEW card as learning even when its due time has passed', () => {
    expect(
      deriveMasteryState(
        { state: 'NEW', stability: 0, dueAt: past, lastRating: null },
        { now: NOW },
      ),
    ).toBe(MASTERY_STATE.LEARNING)
  })

  it('treats learning and relearning cards as learning', () => {
    expect(
      deriveMasteryState(
        { state: 'LEARNING', stability: 1.5, dueAt: past, lastRating: WORD_CAMP_RATING.GOOD },
        { now: NOW },
      ),
    ).toBe(MASTERY_STATE.LEARNING)
    expect(
      deriveMasteryState(
        { state: 'RELEARNING', stability: 2, dueAt: past, lastRating: WORD_CAMP_RATING.AGAIN },
        { now: NOW },
      ),
    ).toBe(MASTERY_STATE.LEARNING)
  })

  it('reports a due REVIEW card with low stability as due', () => {
    expect(deriveMasteryState(review({ stability: 10, dueAt: past }), { now: NOW })).toBe(MASTERY_STATE.DUE)
  })

  it('reports a REVIEW card with low stability that is not due yet as learning', () => {
    expect(deriveMasteryState(review({ stability: 10 }), { now: NOW })).toBe(MASTERY_STATE.LEARNING)
  })

  it('masters a REVIEW card at or above the default threshold after a successful review', () => {
    expect(deriveMasteryState(review({ stability: DEFAULT_MASTERED_STABILITY_DAYS }), { now: NOW })).toBe(
      MASTERY_STATE.MASTERED,
    )
    expect(
      deriveMasteryState(review({ stability: 25, lastRating: WORD_CAMP_RATING.HARD }), { now: NOW }),
    ).toBe(MASTERY_STATE.MASTERED)
  })

  it('keeps a mastered word mastered while it is due again', () => {
    // DECISION: the due queue is a separate due_at query; mastery is not lost on
    // the review date (§4.1: mastered words still get scheduled).
    expect(deriveMasteryState(review({ stability: 25, dueAt: past }), { now: NOW })).toBe(MASTERY_STATE.MASTERED)
  })

  it('does not master a word whose latest review failed or whose outcome is unknown', () => {
    expect(
      deriveMasteryState(review({ stability: 25, dueAt: past, lastRating: WORD_CAMP_RATING.AGAIN }), { now: NOW }),
    ).toBe(MASTERY_STATE.DUE)
    expect(
      deriveMasteryState(review({ stability: 25, lastRating: null }), { now: NOW }),
    ).toBe(MASTERY_STATE.LEARNING)
  })

  it('honours a configurable stability threshold', () => {
    expect(
      deriveMasteryState(review({ stability: 15 }), { now: NOW, masteredStabilityDays: 14 }),
    ).toBe(MASTERY_STATE.MASTERED)
    expect(
      deriveMasteryState(review({ stability: 15 }), { now: NOW, masteredStabilityDays: 20 }),
    ).toBe(MASTERY_STATE.LEARNING)
  })

  it('rejects invalid scheduling data instead of guessing', () => {
    expect(() => deriveMasteryState(review({ stability: -1 }), { now: NOW })).toThrow(RangeError)
    expect(() => deriveMasteryState(review({ stability: Infinity }), { now: NOW })).toThrow(RangeError)
    expect(() => deriveMasteryState(review({ dueAt: new Date('nope') }), { now: NOW })).toThrow(TypeError)
    expect(() => deriveMasteryState(review({ lastRating: 4 }), { now: NOW })).toThrow(RangeError)
    expect(() => deriveMasteryState(review({ state: 'UNKNOWN' as never }), { now: NOW })).toThrow(RangeError)
    expect(() => deriveMasteryState('nope' as never, { now: NOW })).toThrow(TypeError)
    expect(() => deriveMasteryState(null, { now: new Date('nope') })).toThrow(TypeError)
    expect(() => deriveMasteryState(null, { now: NOW, masteredStabilityDays: 0 })).toThrow(RangeError)
  })
})

// ── Levels (§5.2) ────────────────────────────────────────────────────────────

describe('levelForXp', () => {
  it('matches the published tier table', () => {
    expect(LEVEL_TIERS.map((tier) => tier.minXp)).toEqual([0, 100, 300, 600, 1000, 1600, 2400, 3400, 4600, 6000])
    expect(LEVEL_TIERS.map((tier) => tier.title)).toEqual([
      '词汇新兵', '学习先锋', '词汇达人', '英语挑战者', '单词高手',
      '特训营精英', '词汇指挥官', '单词大师', '英语王牌', '词汇传奇',
    ])
  })

  it('reports a level, title, progress within the level and the next threshold', () => {
    expect(levelForXp(0)).toEqual({
      level: 1,
      title: '词汇新兵',
      minXp: 0,
      nextLevelXp: 100,
      nextLevelTitle: '学习先锋',
      xpIntoLevel: 0,
      xpForNextLevel: 100,
    })
    expect(levelForXp(160)).toEqual({
      level: 2,
      title: '学习先锋',
      minXp: 100,
      nextLevelXp: 300,
      nextLevelTitle: '词汇达人',
      xpIntoLevel: 60,
      xpForNextLevel: 200,
    })
  })

  it('keeps the level exactly on each threshold', () => {
    expect(levelForXp(99).level).toBe(1)
    expect(levelForXp(100).level).toBe(2)
    expect(levelForXp(300).level).toBe(3)
    expect(levelForXp(5999).level).toBe(9)
    expect(levelForXp(6000).level).toBe(10)
  })

  it('stops at the maximum level with no next tier', () => {
    const max = levelForXp(6000)
    expect(max.nextLevelXp).toBeNull()
    expect(max.xpForNextLevel).toBeNull()
    expect(levelForXp(99999)).toEqual({ ...max, xpIntoLevel: 93999 })
  })

  it('rejects negative or non-integer XP', () => {
    expect(() => levelForXp(-1)).toThrow(RangeError)
    expect(() => levelForXp(1.5)).toThrow(TypeError)
    expect(() => levelForXp(Number.NaN)).toThrow(TypeError)
    expect(() => levelForXp('10' as never)).toThrow(TypeError)
  })
})

// ── Clear gate and stars (§4.1) ──────────────────────────────────────────────

describe('computeLevelStars', () => {
  it('awards three stars for a perfect first-try run', () => {
    const result = computeLevelStars({ questionCount: 10, firstTryCorrect: 10, eventuallyCorrect: 10 })
    expect(result).toEqual({ cleared: true, stars: 3, firstTryAccuracy: 1, finalAccuracy: 1 })
  })

  it('awards two stars at exactly 90% first-try accuracy', () => {
    expect(
      computeLevelStars({ questionCount: 10, firstTryCorrect: 9, eventuallyCorrect: 10 }),
    ).toEqual({
      cleared: true,
      stars: 2,
      firstTryAccuracy: 9 / 10,
      finalAccuracy: 1,
    })
  })

  it('awards one star when the level is cleared with retries', () => {
    expect(
      computeLevelStars({ questionCount: 10, firstTryCorrect: 8, eventuallyCorrect: 10 }),
    ).toEqual({
      cleared: true,
      stars: 1,
      firstTryAccuracy: 8 / 10,
      finalAccuracy: 1,
    })
  })

  it('clears at the default 70% final accuracy', () => {
    expect(computeLevelStars({ questionCount: 10, firstTryCorrect: 1, eventuallyCorrect: 7 }).cleared).toBe(true)
    expect(computeLevelStars({ questionCount: 10, firstTryCorrect: 1, eventuallyCorrect: 6 })).toEqual({
      cleared: false,
      stars: 0,
      firstTryAccuracy: 0.1,
      finalAccuracy: 0.6,
    })
  })

  it('uses 80% as the Boss pass mark', () => {
    expect(
      computeLevelStars({
        questionCount: 10,
        firstTryCorrect: 7,
        eventuallyCorrect: 8,
        clearRate: BOSS_LEVEL_CLEAR_RATE,
      }).cleared,
    ).toBe(true)
    expect(
      computeLevelStars({
        questionCount: 10,
        firstTryCorrect: 7,
        eventuallyCorrect: 7,
        clearRate: BOSS_LEVEL_CLEAR_RATE,
      }).cleared,
    ).toBe(false)
  })

  it('exposes the documented thresholds', () => {
    expect(DEFAULT_LEVEL_CLEAR_RATE).toBe(0.7)
    expect(TWO_STAR_FIRST_TRY_ACCURACY).toBe(0.9)
  })

  it('rejects impossible attempt counts and pass marks', () => {
    expect(() => computeLevelStars({ questionCount: 0, firstTryCorrect: 0, eventuallyCorrect: 0 })).toThrow(RangeError)
    expect(() => computeLevelStars({ questionCount: 10, firstTryCorrect: 11, eventuallyCorrect: 11 })).toThrow(RangeError)
    expect(() => computeLevelStars({ questionCount: 10, firstTryCorrect: 5, eventuallyCorrect: 4 })).toThrow(RangeError)
    expect(() => computeLevelStars({ questionCount: 1.5, firstTryCorrect: 1, eventuallyCorrect: 1 })).toThrow(TypeError)
    expect(() => computeLevelStars({ questionCount: 10, firstTryCorrect: 0, eventuallyCorrect: 0, clearRate: 0 })).toThrow(RangeError)
    expect(() => computeLevelStars({ questionCount: 10, firstTryCorrect: 0, eventuallyCorrect: 0, clearRate: 1.5 })).toThrow(RangeError)
    expect(() => computeLevelStars(null as never)).toThrow(TypeError)
  })
})

// ── Reward event keys (§5.1) ─────────────────────────────────────────────────

describe('rewardEventKey', () => {
  it('builds the canonical key for every reward type', () => {
    expect(rewardEventKey({ rewardType: 'word_learned', contextId: 'ctx-1', wordId: 'word-1' })).toBe(
      'word_learned:ctx-1:word-1',
    )
    expect(
      rewardEventKey({
        rewardType: 'review_ok',
        contextId: 'ctx-1',
        wordId: 'word-1',
        cycleStartDate: '2026-10-05',
      }),
    ).toBe('review_ok:ctx-1:word-1:2026-10-05')
    expect(
      rewardEventKey({ rewardType: 'boss_clear', assignmentId: 'assignment-1', assignmentVersion: 2, bossId: 'boss-1' }),
    ).toBe('boss_clear:assignment-1:2:boss-1')
    expect(rewardEventKey({ rewardType: 'daily_done', studyDate: '2026-10-05' })).toBe('daily_done:2026-10-05')
    expect(rewardEventKey({ rewardType: 'streak7', streakStartDate: '2026-10-05' })).toBe('streak7:2026-10-05')
  })

  it('rejects identifiers that would make the key ambiguous', () => {
    expect(() => rewardEventKey({ rewardType: 'word_learned', contextId: 'ctx:1', wordId: 'word-1' })).toThrow(RangeError)
    expect(() => rewardEventKey({ rewardType: 'word_learned', contextId: ' ctx-1', wordId: 'word-1' })).toThrow(RangeError)
    expect(() => rewardEventKey({ rewardType: 'word_learned', contextId: 'ctx|1', wordId: 'word-1' })).toThrow(RangeError)
    expect(() => rewardEventKey({ rewardType: 'word_learned', contextId: '', wordId: 'word-1' })).toThrow(RangeError)
    expect(() => rewardEventKey({ rewardType: 'word_learned', contextId: 7, wordId: 'word-1' } as never)).toThrow(TypeError)
    expect(() => rewardEventKey({ rewardType: 'boss_clear', assignmentId: 'a-1', assignmentVersion: 0, bossId: 'b' })).toThrow(RangeError)
    expect(() => rewardEventKey({ rewardType: 'boss_clear', assignmentId: 'a-1', assignmentVersion: 1.5, bossId: 'b' })).toThrow(TypeError)
    expect(() => rewardEventKey({ rewardType: 'daily_done', studyDate: '2026-02-30' })).toThrow(RangeError)
    expect(() => rewardEventKey({ rewardType: 'bogus', studyDate: '2026-10-05' } as never)).toThrow(RangeError)
    expect(() => rewardEventKey(null as never)).toThrow(TypeError)
  })
})

describe('rewardIdempotencyKey', () => {
  it('keeps the ledger identity of student + reward type + event key', () => {
    expect(rewardIdempotencyKey('u1', 'word_learned', 'word_learned:ctx-1:word-1')).toBe(
      'u1|word_learned|word_learned:ctx-1:word-1',
    )
  })

  it('distinguishes the same event for different students', () => {
    const a = rewardIdempotencyKey('u1', 'word_learned', 'word_learned:ctx-1:word-1')
    const b = rewardIdempotencyKey('u2', 'word_learned', 'word_learned:ctx-1:word-1')
    expect(a).not.toBe(b)
  })

  it('distinguishes reward types sharing a word', () => {
    const learned = rewardIdempotencyKey('u1', 'word_learned', 'word_learned:ctx-1:word-1')
    const reviewed = rewardIdempotencyKey('u1', 'review_ok', 'review_ok:ctx-1:word-1:2026-10-05')
    expect(learned).not.toBe(reviewed)
  })

  it('rejects mismatched event keys and unsafe identifiers', () => {
    expect(() => rewardIdempotencyKey('u1', 'review_ok', 'word_learned:ctx-1:word-1')).toThrow(RangeError)
    expect(() => rewardIdempotencyKey('u1', 'word_learned', 'word_learned:ctx-1')).toThrow(RangeError)
    expect(() => rewardIdempotencyKey('', 'word_learned', 'word_learned:ctx-1:word-1')).toThrow(RangeError)
    expect(() => rewardIdempotencyKey('u:1', 'word_learned', 'word_learned:ctx-1:word-1')).toThrow(RangeError)
    expect(() => rewardIdempotencyKey('u|1', 'word_learned', 'word_learned:ctx-1:word-1')).toThrow(RangeError)
    expect(() => rewardIdempotencyKey('u1', 'bogus' as never, 'word_learned:ctx-1:word-1')).toThrow(RangeError)
  })
})

// ── Reward settlement (§5.1) ─────────────────────────────────────────────────

const STUDY_DATE = '2026-10-05'

function usage(userId = 'u1', xpEarned = 0, coinsEarned = 0) {
  return { userId, xpEarned, coinsEarned }
}

function wordCandidates(count: number, userId = 'u1'): RewardCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    userId,
    rewardType: 'word_learned',
    eventKey: `word_learned:ctx-1:word-${index + 1}`,
  }))
}

function reviewCandidates(count: number, userId = 'u1'): RewardCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    userId,
    rewardType: 'review_ok',
    eventKey: `review_ok:ctx-1:word-${index + 1}:${STUDY_DATE}`,
  }))
}

function settle(overrides: Partial<SettleDailyRewardsInput> = {}) {
  return settleDailyRewards({
    studyDate: STUDY_DATE,
    candidates: [],
    recorded: [],
    usage: [usage()],
    ...overrides,
  })
}

describe('reward tables', () => {
  it('matches the published default amounts and caps', () => {
    expect(DEFAULT_REWARD_RULES).toEqual({
      word_learned: { xp: 10, coins: 0 },
      review_ok: { xp: 5, coins: 0 },
      boss_clear: { xp: 20, coins: 10 },
      daily_done: { xp: 20, coins: 50 },
      streak7: { xp: 30, coins: 30 },
    })
    expect(DEFAULT_DAILY_REWARD_CAPS).toEqual({ xp: 250, coins: 100 })
  })
})

describe('settleDailyRewards', () => {
  it('settles the maximum default daily task below the caps (190 XP / 60 coins)', () => {
    const candidates: RewardCandidate[] = [
      ...wordCandidates(10),
      ...reviewCandidates(10),
      { userId: 'u1', rewardType: 'boss_clear', eventKey: 'boss_clear:assignment-1:1:boss-1' },
      { userId: 'u1', rewardType: 'daily_done', eventKey: `daily_done:${STUDY_DATE}` },
    ]

    const result = settle({ candidates })

    expect(result.awards).toHaveLength(22)
    expect(result.rejected).toEqual([])
    expect(result.usageAfter).toEqual([usage('u1', 190, 60)])
  })

  it('settles each word / review / boss / daily reward only once within one batch', () => {
    const duplicate = wordCandidates(1)[0]
    const result = settle({ candidates: [duplicate, duplicate] })

    expect(result.awards).toEqual([
      { userId: 'u1', rewardType: 'word_learned', eventKey: 'word_learned:ctx-1:word-1', xp: 10, coins: 0 },
    ])
    expect(result.rejected).toEqual([
      { userId: 'u1', rewardType: 'word_learned', eventKey: 'word_learned:ctx-1:word-1', reason: 'duplicate' },
    ])
    expect(result.usageAfter).toEqual([usage('u1', 10, 0)])
  })

  it('treats an event already in the supplied ledger snapshot as a duplicate', () => {
    const candidate = wordCandidates(1)[0]
    const result = settle({
      candidates: [candidate],
      recorded: [{ userId: 'u1', rewardType: 'word_learned', eventKey: candidate.eventKey }],
    })

    expect(result.awards).toEqual([])
    expect(result.rejected).toEqual([
      { userId: 'u1', rewardType: 'word_learned', eventKey: candidate.eventKey, reason: 'duplicate' },
    ])
    expect(result.usageAfter).toEqual([usage('u1', 0, 0)])
  })

  it('settles the same event key independently for different students', () => {
    const eventKey = 'word_learned:ctx-1:word-1'
    const result = settle({
      candidates: [
        { userId: 'u1', rewardType: 'word_learned', eventKey },
        { userId: 'u2', rewardType: 'word_learned', eventKey },
      ],
      usage: [usage('u1'), usage('u2')],
    })

    expect(result.awards).toEqual([
      { userId: 'u1', rewardType: 'word_learned', eventKey, xp: 10, coins: 0 },
      { userId: 'u2', rewardType: 'word_learned', eventKey, xp: 10, coins: 0 },
    ])
    expect(result.usageAfter).toEqual([usage('u1', 10, 0), usage('u2', 10, 0)])
  })

  it('clamps at the daily cap by default and keeps the remainder unrewarded', () => {
    const result = settle({
      candidates: [...wordCandidates(1), ...reviewCandidates(1)],
      usage: [usage('u1', 240, 0)],
    })

    expect(result.awards).toEqual([
      { userId: 'u1', rewardType: 'word_learned', eventKey: 'word_learned:ctx-1:word-1', xp: 10, coins: 0 },
    ])
    expect(result.rejected).toEqual([
      {
        userId: 'u1',
        rewardType: 'review_ok',
        eventKey: `review_ok:ctx-1:word-1:${STUDY_DATE}`,
        reason: 'daily_cap',
      },
    ])
    expect(result.usageAfter).toEqual([usage('u1', 250, 0)])
  })

  it('clamps XP and coins independently', () => {
    const result = settle({
      candidates: [
        { userId: 'u1', rewardType: 'boss_clear', eventKey: 'boss_clear:assignment-1:1:boss-1' },
        { userId: 'u1', rewardType: 'daily_done', eventKey: `daily_done:${STUDY_DATE}` },
      ],
      usage: [usage('u1', 0, 100)],
    })

    expect(result.awards).toEqual([
      { userId: 'u1', rewardType: 'boss_clear', eventKey: 'boss_clear:assignment-1:1:boss-1', xp: 20, coins: 0 },
      { userId: 'u1', rewardType: 'daily_done', eventKey: `daily_done:${STUDY_DATE}`, xp: 20, coins: 0 },
    ])
    expect(result.usageAfter).toEqual([usage('u1', 40, 100)])
  })

  it('can reject a whole award that would cross a cap instead of clamping', () => {
    const result = settle({
      candidates: wordCandidates(1),
      usage: [usage('u1', 245, 0)],
      capOverflow: 'reject',
    })

    expect(result.awards).toEqual([])
    expect(result.rejected[0].reason).toBe('daily_cap')
    expect(result.usageAfter).toEqual([usage('u1', 245, 0)])
  })

  it('reports configured zero amounts as no_reward, not as a cap rejection', () => {
    const result = settle({
      candidates: wordCandidates(1),
      rules: { word_learned: { xp: 0, coins: 0 } },
    })

    expect(result.awards).toEqual([])
    expect(result.rejected[0].reason).toBe('no_reward')
    expect(result.usageAfter).toEqual([usage('u1', 0, 0)])
  })

  it('does not mutate the caller\'s usage snapshot or dedupe state', () => {
    const snapshot = [usage('u1', 0, 0)]
    settle({ candidates: wordCandidates(1), usage: snapshot })
    expect(snapshot).toEqual([usage('u1', 0, 0)])
  })

  it('is pure, so two calls with the same snapshot settle twice (DB owns idempotency)', () => {
    const input: SettleDailyRewardsInput = { studyDate: STUDY_DATE, candidates: wordCandidates(1), recorded: [], usage: [usage()] }
    const first = settleDailyRewards(input)
    const second = settleDailyRewards(input)

    expect(first.awards).toHaveLength(1)
    expect(second.awards).toHaveLength(1)
    expect(first.awards).toEqual(second.awards)
  })

  it('requires an explicit usage row for every student being settled', () => {
    expect(() => settle({ candidates: wordCandidates(1, 'u2') })).toThrow(RangeError)
    expect(() => settle({ candidates: wordCandidates(1), usage: [usage('u1'), usage('u1')] })).toThrow(RangeError)
    expect(() => settle({ candidates: wordCandidates(1), usage: [usage('u1', -1, 0)] })).toThrow(RangeError)
    expect(() => settle({ candidates: wordCandidates(1), usage: [usage('u1', 1.5, 0)] })).toThrow(TypeError)
  })

  it('rejects a daily_done key from another study date', () => {
    expect(() =>
      settle({
        candidates: [{ userId: 'u1', rewardType: 'daily_done', eventKey: 'daily_done:2026-10-04' }],
      }),
    ).toThrow(RangeError)
  })

  it('rejects malformed candidates and ledger rows', () => {
    expect(() => settle({ candidates: [{ userId: 'u1', rewardType: 'bogus' as never, eventKey: 'daily_done:2026-10-05' }] })).toThrow(RangeError)
    expect(() => settle({ candidates: [{ userId: 'u1', rewardType: 'word_learned', eventKey: 'word_learned:ctx-1' }] })).toThrow(RangeError)
    expect(() =>
      settle({ candidates: [{ userId: 'u1', rewardType: 'review_ok', eventKey: 'word_learned:ctx-1:word-1' }] }),
    ).toThrow(RangeError)
    expect(() => settle({ candidates: [{ userId: 'u1', rewardType: 'word_learned', eventKey: 'word_learned:ctx-1:word-1' }], studyDate: '2026-02-30' })).toThrow(RangeError)
    expect(() =>
      settle({
        recorded: [{ userId: 'u1', rewardType: 'review_ok', eventKey: 'word_learned:ctx-1:word-1' }],
      }),
    ).toThrow(RangeError)
    expect(() =>
      settle({ recorded: [{ userId: 'u1', rewardType: 'bogus' as never, eventKey: 'word_learned:ctx-1:word-1' }] }),
    ).toThrow(RangeError)
  })

  it('rejects invalid rules and caps', () => {
    expect(() => settle({ rules: { word_learned: { xp: -1, coins: 0 } } })).toThrow(RangeError)
    expect(() => settle({ rules: { word_learned: { xp: 1.5, coins: 0 } } })).toThrow(TypeError)
    expect(() => settle({ rules: { bogus: { xp: 1, coins: 0 } } as never })).toThrow(RangeError)
    expect(() => settle({ caps: { xp: -1 } })).toThrow(RangeError)
    expect(() => settle({ caps: { coins: 1.5 } })).toThrow(TypeError)
    expect(() => settle({ capOverflow: 'later' as never })).toThrow(RangeError)
  })

  it('returns an untouched usage snapshot when there are no candidates', () => {
    const result = settle({ usage: [usage('u1', 7, 3)] })
    expect(result.awards).toEqual([])
    expect(result.rejected).toEqual([])
    expect(result.usageAfter).toEqual([usage('u1', 7, 3)])
  })
})

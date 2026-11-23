/**
 * FSRS-5.0 scheduling algorithm.
 *
 * The formulas and default weights are aligned with the published FSRS-5.0
 * reference implementation (`ts-fsrs@4.7.0`, MIT). Golden vectors from that
 * implementation live in `server/src/__tests__/fsrs.reference.test.ts`.
 *
 * Due dates are exact timestamps (review time + interval), never local
 * midnight, so behaviour does not depend on the server's time zone.
 *
 * Server-side only — no client state modification.
 */

import { DEFAULT_W } from './constants'

export type FSRSState = 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING'

export interface FSRSCard {
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: FSRSState
  lastReview: Date | null
  due: Date
}

export interface FSRSResult {
  stability: number
  difficulty: number
  retrievability: number
  reps: number
  lapses: number
  state: FSRSState
  due: Date
  lastReview: Date
}

export interface FSRSParams {
  requestRetention: number
  maximumInterval: number
  w: number[]
  newCardsPerDay: number
}

// ── Constants ────────────────────────────────────────────────────────────────

const DECAY = -0.5
const FACTOR = 19 / 81
const S_MIN = 0.01
const S_MAX = 36500
const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000

// ── Core math helpers ────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Match the reference implementation's 8-decimal rounding. */
function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8
}

/** Retrievability R(t,S) = (1 + FACTOR * t / S)^DECAY */
function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0
  return round8(Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY))
}

/**
 * Interval in whole days for a target retention.
 * I(r,S) = S / FACTOR * (r^(1/DECAY) - 1); at r=0.9 it collapses to ~S.
 */
function intervalFromStability(stability: number, requestRetention: number, maximumInterval: number): number {
  const modifier = (Math.pow(requestRetention, 1 / DECAY) - 1) / FACTOR
  return clamp(Math.round(stability * modifier), 1, maximumInterval)
}

/** Whole UTC calendar days between two instants; 0 if the second is not later. */
function elapsedUtcDays(lastReview: Date | null, now: Date): number {
  if (!lastReview || now.getTime() <= lastReview.getTime()) return 0
  const from = Date.UTC(lastReview.getUTCFullYear(), lastReview.getUTCMonth(), lastReview.getUTCDate())
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(0, Math.floor((to - from) / MS_PER_DAY))
}

function addMinutes(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * MS_PER_MINUTE)
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * MS_PER_DAY)
}

// ── Initial stability / difficulty ───────────────────────────────────────────

/** S0(G) = w[G-1], for grade 1..4 */
function initialStability(w: number[], grade: number): number {
  return clamp(round8(w[grade - 1]), S_MIN, S_MAX)
}

/** D0(G) = w[4] - exp(w[5] * (G - 1)) + 1 */
function initialDifficulty(w: number[], grade: number): number {
  return clamp(round8(w[4] - Math.exp(w[5] * (grade - 1)) + 1), 1, 10)
}

// ── Difficulty update ────────────────────────────────────────────────────────

function linearDamping(delta: number, difficulty: number): number {
  return round8((delta * (10 - difficulty)) / 9)
}

/**
 * D' = D + linearDamping(-w[6] * (G - 3), D), then mean-reverted toward
 * D0(Easy) with weight w[7].
 */
function nextDifficulty(w: number[], difficulty: number, grade: number): number {
  const delta = -w[6] * (grade - 3)
  const damped = difficulty + linearDamping(delta, difficulty)
  const reverted = w[7] * initialDifficulty(w, 4) + (1 - w[7]) * damped
  return clamp(round8(reverted), 1, 10)
}

// ── Stability updates ────────────────────────────────────────────────────────

/**
 * Successful recall:
 * S' = S * (1 + exp(w8) * (11-D) * S^(-w9) * (exp(w10*(1-R)) - 1)
 *              * hardPenalty * easyBonus)
 */
function recallStability(w: number[], d: number, s: number, r: number, grade: number): number {
  const hardPenalty = grade === 2 ? w[15] : 1
  const easyBonus = grade === 4 ? w[16] : 1
  const growth =
    Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus
  return clamp(round8(s * (1 + growth)), S_MIN, S_MAX)
}

/** Lapse stability: w11 * D^(-w12) * ((S+1)^w13 - 1) * exp(w14*(1-R)) */
function lapseStability(w: number[], d: number, s: number, r: number): number {
  return clamp(
    round8(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r))),
    S_MIN,
    S_MAX,
  )
}

/** Short-term (same-learning-step) stability: S * exp(w17 * (G - 3 + w18)) */
function shortTermStability(w: number[], s: number, grade: number): number {
  return clamp(round8(s * Math.exp(w[17] * (grade - 3 + w[18]))), S_MIN, S_MAX)
}

// ── Main scheduler ───────────────────────────────────────────────────────────

/**
 * Schedule a card review. Returns the new FSRS state.
 *
 * @param card  Current card state (stability, difficulty, reps, lapses, state, lastReview, due)
 * @param grade 1=Again, 2=Hard, 3=Good, 4=Easy
 * @param params FSRS deck parameters
 * @param now   Review timestamp (default: now)
 */
export function schedule(
  card: FSRSCard,
  grade: number,
  params: FSRSParams,
  now: Date = new Date(),
): FSRSResult {
  const w = params.w.length === 19 ? params.w : [...DEFAULT_W]
  const { requestRetention, maximumInterval } = params

  const elapsedDays = elapsedUtcDays(card.lastReview, now)

  let s = card.stability
  let d = card.difficulty
  let reps = card.reps
  let lapses = card.lapses

  const r = card.state === 'NEW' || s <= 0 ? 0 : retrievability(elapsedDays, s)

  let newS: number
  let newD: number
  let newState: FSRSState
  let intervalDays = 0
  let intervalMinutes = 0

  if (card.state === 'NEW') {
    newS = initialStability(w, grade)
    newD = initialDifficulty(w, grade)
    reps = 1

    switch (grade) {
      case 1: // Again — 1 minute, still learning
        newState = 'LEARNING'
        intervalMinutes = 1
        break
      case 2: // Hard — 5 minutes, still learning
        newState = 'LEARNING'
        intervalMinutes = 5
        break
      case 3: // Good — 10 minutes, still learning
        newState = 'LEARNING'
        intervalMinutes = 10
        break
      default: // Easy graduates immediately
        newState = 'REVIEW'
        intervalDays = intervalFromStability(newS, requestRetention, maximumInterval)
        break
    }
  } else if (card.state === 'LEARNING' || card.state === 'RELEARNING') {
    newD = nextDifficulty(w, d, grade)
    newS = shortTermStability(w, s, grade)
    reps += 1

    if (grade === 1) {
      newState = card.state
      intervalMinutes = 5
    } else if (grade === 2) {
      newState = card.state
      intervalMinutes = 10
    } else if (grade === 3) {
      newState = 'REVIEW'
      intervalDays = intervalFromStability(newS, requestRetention, maximumInterval)
    } else {
      // Easy must be at least one day beyond the Good interval.
      const goodS = shortTermStability(w, s, 3)
      const goodInterval = intervalFromStability(goodS, requestRetention, maximumInterval)
      newState = 'REVIEW'
      intervalDays = Math.max(
        intervalFromStability(newS, requestRetention, maximumInterval),
        goodInterval + 1,
      )
    }
  } else {
    // REVIEW state
    newD = nextDifficulty(w, d, grade)
    reps += 1

    if (grade === 1) {
      lapses += 1
      newS = Math.min(s, lapseStability(w, d, s, r))
      newState = 'RELEARNING'
      intervalMinutes = 5
    } else {
      // Compute all three success intervals so Hard < Good < Easy stays true.
      const hardS = recallStability(w, d, s, r, 2)
      const goodS = recallStability(w, d, s, r, 3)
      const easyS = recallStability(w, d, s, r, 4)
      const hardInterval = intervalFromStability(hardS, requestRetention, maximumInterval)
      const goodInterval = Math.max(
        intervalFromStability(goodS, requestRetention, maximumInterval),
        hardInterval + 1,
      )
      const easyInterval = Math.max(
        intervalFromStability(easyS, requestRetention, maximumInterval),
        goodInterval + 1,
      )

      newState = 'REVIEW'
      if (grade === 2) {
        newS = hardS
        intervalDays = hardInterval
      } else if (grade === 3) {
        newS = goodS
        intervalDays = goodInterval
      } else {
        newS = easyS
        intervalDays = easyInterval
      }
    }
  }

  newS = clamp(newS, S_MIN, S_MAX)
  if (intervalDays > maximumInterval) intervalDays = maximumInterval

  const due = intervalMinutes > 0
    ? addMinutes(now, intervalMinutes)
    : intervalDays > 0
      ? addDays(now, intervalDays)
      : new Date(now)

  const newR = retrievability(intervalDays, newS)

  return {
    stability: newS,
    difficulty: newD,
    retrievability: newR,
    reps,
    lapses,
    state: newState,
    due,
    lastReview: now,
  }
}
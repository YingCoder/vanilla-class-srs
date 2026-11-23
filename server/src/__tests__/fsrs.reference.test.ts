/**
 * Golden vectors produced by the FSRS-5.0 reference implementation
 * `ts-fsrs@4.7.0` (`FSRSVersion = "v4.7.0 using FSRS-5.0"`, default_w,
 * enable_fuzz=false, enable_short_term=true, request_retention=0.9,
 * maximum_interval=36500), reviewed at 2024-06-01T12:00:00Z.
 *
 * Regenerate only with the same reference version/parameters; these numbers
 * are what make "FSRS-5 correct" an evidence-backed claim instead of a comment.
 */
import { describe, it, expect } from 'vitest'
import { schedule, FSRSCard, FSRSParams } from '@vanilla-srs/shared'

const params: FSRSParams = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: [],
  newCardsPerDay: 10,
}

const NOW = new Date('2024-06-01T12:00:00Z')

function newCard(): FSRSCard {
  return {
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 'NEW',
    lastReview: null,
    due: NOW,
  }
}

const REVIEW_CARD: FSRSCard = {
  stability: 10,
  difficulty: 5,
  reps: 5,
  lapses: 0,
  state: 'REVIEW',
  lastReview: new Date('2024-05-27T12:00:00Z'),
  due: NOW,
}

describe('FSRS-5 reference golden vectors', () => {
  it('NEW + Again', () => {
    const r = schedule(newCard(), 1, params, NOW)
    expect(r.stability).toBeCloseTo(0.40255, 6)
    expect(r.difficulty).toBeCloseTo(7.1949, 6)
    expect(r.state).toBe('LEARNING')
    expect(r.reps).toBe(1)
    expect(r.due.toISOString()).toBe('2024-06-01T12:01:00.000Z')
  })

  it('NEW + Hard', () => {
    const r = schedule(newCard(), 2, params, NOW)
    expect(r.stability).toBeCloseTo(1.18385, 6)
    expect(r.difficulty).toBeCloseTo(6.48830527, 6)
    expect(r.state).toBe('LEARNING')
    expect(r.due.toISOString()).toBe('2024-06-01T12:05:00.000Z')
  })

  it('NEW + Good', () => {
    const r = schedule(newCard(), 3, params, NOW)
    expect(r.stability).toBeCloseTo(3.173, 6)
    expect(r.difficulty).toBeCloseTo(5.28243442, 6)
    expect(r.state).toBe('LEARNING')
    expect(r.due.toISOString()).toBe('2024-06-01T12:10:00.000Z')
  })

  it('NEW + Easy graduates with the reference interval', () => {
    const r = schedule(newCard(), 4, params, NOW)
    expect(r.stability).toBeCloseTo(15.69105, 6)
    expect(r.difficulty).toBeCloseTo(3.22450159, 6)
    expect(r.state).toBe('REVIEW')
    expect(r.due.toISOString()).toBe('2024-06-17T12:00:00.000Z')
  })

  it('LEARNING after an Again + Good', () => {
    const learning = schedule(newCard(), 1, params, NOW)
    const card: FSRSCard = {
      ...newCard(),
      stability: learning.stability,
      difficulty: learning.difficulty,
      reps: learning.reps,
      state: learning.state,
      lastReview: NOW,
    }
    const r = schedule(card, 3, params, NOW)
    expect(r.stability).toBeCloseTo(0.5666983, 6)
    expect(r.difficulty).toBeCloseTo(7.17663617, 6)
    expect(r.state).toBe('REVIEW')
    expect(r.due.toISOString()).toBe('2024-06-02T12:00:00.000Z')
  })

  it('REVIEW + Again (lapse)', () => {
    const r = schedule(REVIEW_CARD, 1, params, NOW)
    expect(r.stability).toBeCloseTo(1.89847477, 6)
    expect(r.difficulty).toBeCloseTo(6.60703511, 6)
    expect(r.state).toBe('RELEARNING')
    expect(r.lapses).toBe(1)
    expect(r.reps).toBe(6)
    expect(r.due.toISOString()).toBe('2024-06-01T12:05:00.000Z')
  })

  it('REVIEW + Hard', () => {
    const r = schedule(REVIEW_CARD, 2, params, NOW)
    expect(r.stability).toBeCloseTo(12.79901979, 6)
    expect(r.difficulty).toBeCloseTo(5.7994339, 6)
    expect(r.state).toBe('REVIEW')
    expect(r.due.toISOString()).toBe('2024-06-14T12:00:00.000Z')
  })

  it('REVIEW + Good', () => {
    const r = schedule(REVIEW_CARD, 3, params, NOW)
    expect(r.stability).toBeCloseTo(22.09079822, 6)
    expect(r.difficulty).toBeCloseTo(4.99183271, 6)
    expect(r.state).toBe('REVIEW')
    expect(r.due.toISOString()).toBe('2024-06-23T12:00:00.000Z')
  })

  it('REVIEW + Easy', () => {
    const r = schedule(REVIEW_CARD, 4, params, NOW)
    expect(r.stability).toBeCloseTo(46.14906852, 6)
    expect(r.difficulty).toBeCloseTo(4.18423151, 6)
    expect(r.state).toBe('REVIEW')
    expect(r.due.toISOString()).toBe('2024-07-17T12:00:00.000Z')
  })
})
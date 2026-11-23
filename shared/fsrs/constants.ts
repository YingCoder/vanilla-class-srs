/**
 * FSRS-5.0 published default weights (19 values, w[0]..w[18]).
 * Must stay byte-for-byte identical to ts-fsrs 4.7.0 `default_w` so the golden
 * vector suite (server/src/__tests__/fsrs.reference.test.ts) stays valid.
 */
export const DEFAULT_W: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949,
  0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698,
  0.2315, 2.9898, 0.51655, 0.6621,
]

/** Default deck parameters */
export const DEFAULT_PARAMS = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: [] as number[],
  newCardsPerDay: 10,
}

/** FSRS grade values */
export const GRADE = {
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
} as const

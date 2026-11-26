import { describe, it, expect } from 'vitest'
import {
  buildEbbinghausSnapshot,
  mapFsrsToEbbinghausStage,
} from '@vanilla-srs/shared/ebbinghaus'
import { ZHONGKAO_23_DAYS, lookupZhongkaoWord } from '@vanilla-srs/shared/vocab'

describe('ebbinghaus & zhongkao23 shared helpers', () => {
  it('exposes all 23 days and 688 words with curated mnemonics', () => {
    expect(ZHONGKAO_23_DAYS).toHaveLength(23)
    const total = ZHONGKAO_23_DAYS.reduce((sum, d) => sum + d.words.length, 0)
    expect(total).toBe(688)

    const because = lookupZhongkaoWord('Because')
    expect(because).not.toBeNull()
    expect(because?.mnemonic?.hook).toBe('被烤死')
    expect(because?.day).toBe(1)
  })

  it('maps FSRS card state into Ebbinghaus stages and retrievability', () => {
    expect(mapFsrsToEbbinghausStage('NEW', 0, 0)).toBe(0)
    expect(mapFsrsToEbbinghausStage('REVIEW', 2.4, 3)).toBe(5)

    const now = new Date('2026-11-25T10:00:00Z')
    const snap = buildEbbinghausSnapshot({
      state: 'REVIEW',
      stability: 2.0,
      reps: 3,
      due: new Date('2026-11-26T10:00:00Z'),
      lastReview: new Date('2026-11-24T10:00:00Z'),
      now,
    })
    expect(snap.stage).toBe(5)
    expect(snap.retrievabilityPct).toBeGreaterThan(70)
    expect(snap.retrievabilityPct).toBeLessThanOrEqual(99)
    expect(snap.curvePoints).toHaveLength(8)
    expect(snap.gradeLabels).toHaveLength(4)
  })
})

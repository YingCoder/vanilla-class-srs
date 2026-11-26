import { describe, expect, it } from 'vitest'
import {
  HOME_BUILDINGS,
  homeBuildingState,
  isSugarCrystalRatio,
  preferHighestRetentionDueFirst,
  spiritAppearanceSeed,
  spiritFormFromStage,
  sugarCrystalsFromLearningXp,
  worldIslandForDay,
} from '@vanilla-srs/shared/world'
import { computeRetrievability } from '@vanilla-srs/shared/ebbinghaus'
import { DEFAULT_GAME_CONFIG, validateGameConfig } from '@vanilla-srs/shared/gamification'

const NOW = new Date('2026-11-25T12:00:00.000Z')

describe('world pure rules', () => {
  it('maps immutable bestStage to exactly the specified stable forms', () => {
    expect([-3, null, undefined, 0].map(spiritFormFromStage)).toEqual(['egg', 'egg', 'egg', 'egg'])
    expect([1, 2, 3, 4, 5, 6, 7, 8, 99].map(spiritFormFromStage)).toEqual([
      'hatchling', 'young', 'young', 'mature', 'mature', 'mature', 'radiant', 'radiant', 'radiant',
    ])
    expect(spiritFormFromStage(7)).toBe(spiritFormFromStage(7.9))
  })

  it('seeds a spirit by normalized word rather than request/card randomness', () => {
    expect(spiritAppearanceSeed('  AppLe ')).toBe(spiritAppearanceSeed('apple'))
    expect(spiritAppearanceSeed('apple')).not.toBe(spiritAppearanceSeed('ability'))
    for (const word of ['apple', 'ability', '香草']) expect(spiritAppearanceSeed(word)).toBeGreaterThanOrEqual(0)
  })

  it('maps four islands and rejects out-of-range camp days', () => {
    expect([1, 6, 7, 12, 13, 18, 19, 23].map((d) => worldIslandForDay(d)?.key)).toEqual([
      'strawberry', 'strawberry', 'vanilla', 'vanilla', 'cocoa', 'cocoa', 'star', 'star',
    ])
    expect([0, 24, 1.1, NaN].map(worldIslandForDay)).toEqual([null, null, null, null])
  })

  it('floors only lifetime income, excludes non-learning rewards and rejects invalid ledger values', () => {
    expect(sugarCrystalsFromLearningXp([
      { type: 'REVIEW_GRADE', xp: 5 }, { type: 'LEVEL_CLEAR', xp: 5 },
      { type: 'MNEMONIC_CREATE', xp: 100 }, { type: 'SQUAD_WEEKLY_GOAL', xp: 100 },
      { type: 'UNKNOWN_BONUS', xp: 100 }, { type: 'WEAK_RESTUDY', xp: 0 },
    ])).toBe(1)
    expect(sugarCrystalsFromLearningXp([
      { type: 'REVIEW_GRADE', xp: 1 }, { type: 'REVIEW_GRADE', xp: 0 },
      { type: 'RINGS_CLOSED', xp: 1 },
    ])).toBe(0)
    expect(sugarCrystalsFromLearningXp([
      { type: 'REVIEW_GRADE', xp: 10, sugarCrystalRatio: 0.1 },
      { type: 'REVIEW_GRADE', xp: 10, sugarCrystalRatio: 0.25 },
      { type: 'RINGS_CLOSED', xp: 5, sugarCrystalRatio: 0 },
    ])).toBe(3)
    expect(() => sugarCrystalsFromLearningXp([{ type: 'REVIEW_GRADE', xp: 0.5 }])).toThrow()
    expect(() => sugarCrystalsFromLearningXp([{ type: 'REVIEW_GRADE', xp: -1 }])).toThrow()
    expect(() => sugarCrystalsFromLearningXp([{ type: 'REVIEW_GRADE', xp: 1, sugarCrystalRatio: NaN }])).toThrow()
  })

  it('validates a finite four-decimal ratio with a 0.1 default', () => {
    expect(DEFAULT_GAME_CONFIG.sugarCrystalRatio).toBe(0.1)
    expect([0, 0.1, 0.0001, 1].every(isSugarCrystalRatio)).toBe(true)
    expect([-0.1, 1.1, NaN, Infinity, 0.00001, null, '0.1'].every((v) => !isSugarCrystalRatio(v))).toBe(true)
    expect(validateGameConfig({ sugarCrystalRatio: 0.2 })).toMatchObject({ ok: true })
    expect(validateGameConfig({ sugarCrystalRatio: NaN })).toMatchObject({ ok: false })
    expect(validateGameConfig({ sugarCrystalRatio: -1 })).toMatchObject({ ok: false })
    expect(validateGameConfig({ sugarCrystalRatio: 0.00001 })).toMatchObject({ ok: false })
  })

  it('treats free buildings as initial entitlements and charges paid levels once', () => {
    const campfire = HOME_BUILDINGS.find((b) => b.key === 'campfire')!
    expect(homeBuildingState(campfire, 0, 0)).toMatchObject({ level: 1, maxLevel: 1, nextCost: null, canBuild: false })
    const lighthouse = HOME_BUILDINGS.find((b) => b.key === 'lighthouse')!
    expect(homeBuildingState(lighthouse, 0, 79).canBuild).toBe(false)
    expect(homeBuildingState(lighthouse, 0, 80)).toMatchObject({ level: 0, nextCost: 80, canBuild: true })
    expect(homeBuildingState(lighthouse, 1, 119).canBuild).toBe(false)
    expect(homeBuildingState(lighthouse, 1, 120)).toMatchObject({ level: 1, nextCost: 120, canBuild: true })
    expect(homeBuildingState(lighthouse, 2, 999)).toMatchObject({ level: 2, nextCost: null, canBuild: false })
  })

  it('moves only the highest-retention due card to the front without changing FSRS state/order', () => {
    const now = new Date('2026-11-26T00:00:00.000Z')
    const cards = [
      { id: 'new', state: 'NEW', due: NOW, stability: 10, lastReview: null },
      { id: 'low', state: 'REVIEW', due: NOW, stability: 0.1, lastReview: new Date('2026-11-01T00:00:00Z') },
      { id: 'high', state: 'RELEARNING', due: NOW, stability: 20, lastReview: NOW },
      { id: 'upcoming', state: 'REVIEW', due: new Date('2026-11-30T00:00:00Z'), stability: 20, lastReview: NOW },
    ]
    const ranked = cards.map((c) => ({ id: c.id, r: computeRetrievability(c.stability, c.lastReview, now) }))
    expect(ranked[1].r).toBeLessThan(ranked[2].r)
    const before = structuredClone(cards)
    expect(preferHighestRetentionDueFirst(cards, now).map((c) => c.id)).toEqual(['high', 'new', 'low', 'upcoming'])
    expect(cards).toEqual(before)
    expect(preferHighestRetentionDueFirst([cards[3], cards[0]], now).map((c) => c.id)).toEqual(['upcoming', 'new'])
    const reordered = preferHighestRetentionDueFirst([cards[1], cards[2]], now)
    expect(reordered.map((c) => c.id)).toEqual(['high', 'low'])
  })
})

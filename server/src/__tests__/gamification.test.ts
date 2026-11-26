import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GAME_CONFIG,
  computeCampNodeStars,
  computeReviewDueSnapshot,
  isLateNightQuiet,
  levelFromXp,
  nextStreak,
  rarityFromStage,
  ringProgress,
  shanghaiDateString,
  titleForLevel,
  validateGameConfig,
  xpForGrade,
} from '@vanilla-srs/shared/gamification'

describe('shared/gamification', () => {
  it('computes grade XP with due check and 2-per-day anti-farm limit', () => {
    expect(xpForGrade(1, true, 1)).toBe(1)
    expect(xpForGrade(2, true, 1)).toBe(3)
    expect(xpForGrade(3, true, 1)).toBe(5)
    expect(xpForGrade(4, true, 1)).toBe(6)
    expect(xpForGrade(3, true, 2)).toBe(5)
    // 3rd time same day yields 0
    expect(xpForGrade(4, true, 3)).toBe(0)
    // Not due yields 0
    expect(xpForGrade(4, false, 1)).toBe(0)
  })

  it('computes level progression and titles (Lv1->Lv2=100, +50/step, 9200 XP -> Lv18)', () => {
    expect(levelFromXp(0)).toMatchObject({ level: 1, title: '香草学徒', xpIntoLevel: 0, xpForNextLevel: 100 })
    expect(levelFromXp(99).level).toBe(1)
    expect(levelFromXp(100)).toMatchObject({ level: 2, title: '香草学徒', xpIntoLevel: 0, xpForNextLevel: 150 })
    expect(levelFromXp(250)).toMatchObject({ level: 3, title: '香草学徒', xpForNextLevel: 200 })
    expect(levelFromXp(450)).toMatchObject({ level: 4, title: '糖霜新秀' })
    expect(titleForLevel(8)).toBe('焦糖达人')
    expect(titleForLevel(12)).toBe('可可大师')
    expect(titleForLevel(16)).toBe('奶昔王牌')
    expect(levelFromXp(9200)).toMatchObject({ level: 18, title: '奶昔王牌' })
  })

  it('maps Ebbinghaus stage to card rarity', () => {
    expect(rarityFromStage(null)).toBeNull()
    expect(rarityFromStage(-1)).toBeNull()
    expect(rarityFromStage(0)?.key).toBe('CANDY')
    expect(rarityFromStage(2)?.key).toBe('CANDY')
    expect(rarityFromStage(3)?.key).toBe('SILVER')
    expect(rarityFromStage(5)?.key).toBe('SILVER')
    expect(rarityFromStage(6)?.key).toBe('GOLD')
    expect(rarityFromStage(7)?.key).toBe('GOLD')
    expect(rarityFromStage(8)?.key).toBe('DIAMOND')
  })

  it('evaluates dual ring progress including zero-due auto closure', () => {
    expect(
      ringProgress({ reviewDue: 0, reviewDone: 0, levelsPassed: ['L1', 'L2', 'L3'] }),
    ).toMatchObject({
      reviewClosed: true,
      reviewRatio: 1,
      levelClosed: true,
      ringsClosed: true,
    })

    // L5 and BOSS are bonus, do not block ring closure; L1-L3 required
    expect(
      ringProgress({ reviewDue: 10, reviewDone: 10, levelsPassed: ['L1', 'L2', 'L3'] }).ringsClosed,
    ).toBe(true)

    expect(
      ringProgress({ reviewDue: 10, reviewDone: 9, levelsPassed: ['L1', 'L2', 'L3'] }).ringsClosed,
    ).toBe(false)
    expect(
      ringProgress({ reviewDue: 10, reviewDone: 10, levelsPassed: ['L1', 'L2'] }).ringsClosed,
    ).toBe(false)
  })

  it('applies backlog protection caps (50 normal, 20 after >=3 gap days)', () => {
    expect(computeReviewDueSnapshot(120, '2026-11-24', '2026-11-25')).toEqual({
      reviewDue: 50,
      backlogProtected: true,
      returnProtected: false,
    })
    expect(computeReviewDueSnapshot(120, '2026-11-22', '2026-11-25')).toEqual({
      reviewDue: 20,
      backlogProtected: true,
      returnProtected: true,
    })
  })

  it('handles 7-day freeze ticket award, 1-day skip protection, and reset preserving longestStreak', () => {
    let state = {
      streakDays: 6,
      longestStreak: 6,
      freezeTickets: 0,
      lastAchievedDate: '2026-11-06',
      streakCursorDate: '2026-11-06',
    }
    const day7 = nextStreak(state, true, '2026-11-07')
    expect(day7.streakDays).toBe(7)
    expect(day7.freezeTickets).toBe(1)
    expect(day7.ticketEarned).toBe(1)

    // Skip Nov 8, log in on Nov 9 before finishing -> ticket auto-consumed, streak kept at 7
    const day9Login = nextStreak(day7, false, '2026-11-09')
    expect(day9Login.streakDays).toBe(7)
    expect(day9Login.freezeTickets).toBe(0)
    expect(day9Login.ticketConsumed).toBe(1)

    // Achieve on Nov 9 -> advances to 8
    const day9Done = nextStreak(day9Login, true, '2026-11-09')
    expect(day9Done.streakDays).toBe(8)
    expect(day9Done.longestStreak).toBe(8)

    // Skip Nov 10 with 0 tickets -> streak resets to 0 on Nov 11, longestStreak kept
    const day11Reset = nextStreak(day9Done, false, '2026-11-11')
    expect(day11Reset.streakDays).toBe(0)
    expect(day11Reset.longestStreak).toBe(8)
    expect(day11Reset.streakReset).toBe(true)
  })

  it('uses Asia/Shanghai calendar date and late night quiet cutoff (22:30)', () => {
    // 2026-11-25 15:59 UTC = 23:59 Shanghai Nov 25
    expect(shanghaiDateString(new Date('2026-11-25T15:59:00Z'))).toBe('2026-11-25')
    // 2026-11-25 16:01 UTC = 00:01 Shanghai Nov 26
    expect(shanghaiDateString(new Date('2026-11-25T16:01:00Z'))).toBe('2026-11-26')

    // 14:29 UTC = 22:29 Shanghai (not quiet)
    expect(isLateNightQuiet(new Date('2026-11-25T14:29:00Z'))).toBe(false)
    // 14:30 UTC = 22:30 Shanghai (quiet)
    expect(isLateNightQuiet(new Date('2026-11-25T14:30:00Z'))).toBe(true)
  })

  it('computes 23-day camp star thresholds (24/30 and 23/28 for D23)', () => {
    expect(computeCampNodeStars({ l1To3Done: true, bossDone: false, stage4Count: 25, totalWords: 30 }).stars).toBe(1)
    expect(computeCampNodeStars({ l1To3Done: true, bossDone: true, stage4Count: 23, totalWords: 30 }).stars).toBe(2)
    expect(computeCampNodeStars({ l1To3Done: true, bossDone: true, stage4Count: 24, totalWords: 30 }).stars).toBe(3)
    expect(computeCampNodeStars({ l1To3Done: true, bossDone: true, stage4Count: 22, totalWords: 28 }).stars).toBe(2)
    expect(computeCampNodeStars({ l1To3Done: true, bossDone: true, stage4Count: 23, totalWords: 28 }).stars).toBe(3)
  })

  it('validates GameConfig bounds and rejects out-of-range overrides', () => {
    expect(validateGameConfig(DEFAULT_GAME_CONFIG).ok).toBe(true)
    expect(validateGameConfig({ dailyXpCap: 99999 }).ok).toBe(false)
    expect(validateGameConfig({ xpByGrade: { 1: 1, 2: 3, 3: 5, 4: 500 } }).ok).toBe(false)
    expect(validateGameConfig({ backlogCapNormal: 30, backlogCapReturn: 40 }).ok).toBe(false)
  })
})

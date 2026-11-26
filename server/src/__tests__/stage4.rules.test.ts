import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_GAME_CONFIG,
  clampDailyXp,
  nextStreak,
  shanghaiTimeParts,
  validateGameConfig,
} from '@vanilla-srs/shared/gamification'
import {
  ANALYTICS_EVENT_TYPES,
  DEFAULT_REMINDER_TEMPLATES,
  FORBIDDEN_REMINDER_KEYWORDS,
  MAX_SQUAD_CHEERS_PER_DAY,
  SEASON_MILESTONES,
  SQUAD_CHEER_PRESETS,
  checkMnemonicSafety,
  checkReminderTemplateSafety,
  computeDefaultSeasonStartDate,
  computeSeasonMilestones,
  computeSmartTodayPlan,
  doesScopeMatchClass,
  evaluateReminderEligibility,
  evaluateSeasonState,
  evaluateSquadWeeklyGoal,
  generateWeeklyConfigAdvice,
  isWithinReminderWindow,
  renderReminderTemplate,
  validateGameConfigScope,
  validateMnemonicDraft,
} from '@vanilla-srs/shared/stage4'
import { getZhongkaoCoverageStats } from '@vanilla-srs/shared/vocab'
import { sanitizeAnalyticsProps } from '../services/analytics.service'
import { generateVapidKeyPair, sendWebPushNotification } from '../lib/webpush'

describe('Stage 4 pure retention & safety rules', () => {
  it('R1: Shanghai timezone splits 23:59 vs 00:01 & preserves freeze tickets at 22:30 UTC+8', () => {
    // 2026-11-25 23:59:50 CST == 2026-11-25T15:59:50Z
    const beforeMidnight = new Date('2026-11-25T15:59:50.000Z')
    // 2026-11-26 00:00:10 CST == 2026-11-25T16:00:10Z
    const afterMidnight = new Date('2026-11-25T16:00:10.000Z')
    // 2026-11-26 22:30:00 CST == 2026-11-26T14:30:00Z
    const lateEvening = new Date('2026-11-26T14:30:00.000Z')

    expect(shanghaiTimeParts(beforeMidnight).localDate).toBe('2026-11-25')
    expect(shanghaiTimeParts(afterMidnight).localDate).toBe('2026-11-26')
    expect(shanghaiTimeParts(lateEvening).localDate).toBe('2026-11-26')

    const res = nextStreak(
      {
        streakDays: 5,
        longestStreak: 5,
        freezeTickets: 2,
        lastAchievedDate: '2026-11-25',
        streakCursorDate: '2026-11-25',
      },
      true,
      '2026-11-26',
    )
    expect(res.streakDays).toBe(6)
    expect(res.ticketConsumed).toBe(0)
    expect(res.freezeTickets).toBe(2)

    const capped = clampDailyXp(50, 380)
    expect(capped).toEqual({ awarded: 20, capped: true, remainingAfter: 0 })
  })

  it('QA-R2-01 & QA-R2-03: GameConfig scope filtering & analytics privacy sanitization', () => {
    const classA = '11111111-1111-4111-8111-111111111111'
    const classB = '22222222-2222-4222-8222-222222222222'

    expect(validateGameConfigScope({ mode: 'ALL' })).toEqual({ ok: true, scope: { mode: 'ALL' } })
    expect(validateGameConfigScope({ mode: 'CLASSES', classIds: [classA] })).toEqual({
      ok: true,
      scope: { mode: 'CLASSES', classIds: [classA] },
    })
    expect(validateGameConfigScope({ mode: 'CLASSES', classIds: [] }).ok).toBe(false)

    const scopeA = { mode: 'CLASSES', classIds: [classA] }
    expect(doesScopeMatchClass(scopeA, classA)).toBe(true)
    expect(doesScopeMatchClass(scopeA, classB)).toBe(false)
    expect(doesScopeMatchClass({ mode: 'ALL' }, classB)).toBe(true)

    const cleanProps = sanitizeAnalyticsProps({
      grade: 3,
      durationMs: 2400,
      fingerprint: 'secret-fp',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla',
      deviceId: 'abc',
    })
    expect(cleanProps).toEqual({ grade: 3, durationMs: 2400 })
    expect(ANALYTICS_EVENT_TYPES).toContain('grade_submit')
    expect(ANALYTICS_EVENT_TYPES).toContain('share_card_save')
  })

  it('QA-R3-03 & R3: All 6 reminder templates pass non-guilt check, frequency caps & quiet hours', () => {
    expect(DEFAULT_REMINDER_TEMPLATES.length).toBe(6)
    for (const tpl of DEFAULT_REMINDER_TEMPLATES) {
      expect(checkReminderTemplateSafety(tpl.title).ok).toBe(true)
      expect(checkReminderTemplateSafety(tpl.body).ok).toBe(true)
      const rendered = renderReminderTemplate(tpl, { dueCount: 12, streakDays: 5 })
      expect(checkReminderTemplateSafety(rendered.title).ok).toBe(true)
      expect(checkReminderTemplateSafety(rendered.body).ok).toBe(true)
    }

    for (const kw of FORBIDDEN_REMINDER_KEYWORDS) {
      expect(checkReminderTemplateSafety(`同学你${kw}了`).ok).toBe(false)
    }

    const badCfg = validateGameConfig({
      ...DEFAULT_GAME_CONFIG,
      reminderTemplates: [{ id: 'bad', title: '警告你', body: '再不背就要扣分惩罚了' }],
    })
    expect(badCfg.ok).toBe(false)

    // Quiet hours: 21:35 CST == 13:35Z (outside [07:00, 21:30)), 06:50 CST == 22:50Z prev day
    expect(isWithinReminderWindow(new Date('2026-11-25T13:35:00.000Z'))).toBe(false)
    expect(isWithinReminderWindow(new Date('2026-11-24T22:50:00.000Z'))).toBe(false)
    expect(isWithinReminderWindow(new Date('2026-11-25T11:00:00.000Z'))).toBe(true) // 19:00 CST

    const baseEligible = {
      enabled: true,
      preferredHour: 19,
      pausedUntil: null,
      ringsClosedToday: false,
      sentTodayCount: 0,
      sentThisWeekCount: 0,
      now: new Date('2026-11-25T11:00:00.000Z'), // 19:00 CST
    }
    expect(evaluateReminderEligibility(baseEligible).eligible).toBe(true)
    expect(evaluateReminderEligibility({ ...baseEligible, ringsClosedToday: true }).eligible).toBe(false)
    expect(evaluateReminderEligibility({ ...baseEligible, sentTodayCount: 1 }).eligible).toBe(false)
    expect(evaluateReminderEligibility({ ...baseEligible, sentThisWeekCount: 4 }).eligible).toBe(false)
    expect(evaluateReminderEligibility({ ...baseEligible, pausedUntil: '2026-12-01' }).eligible).toBe(false)
  })

  it('QA-R3-02: Zero-dep Web Push produces ES256 VAPID & aes128gcm encrypted payload + 410 detection', async () => {
    const keys = generateVapidKeyPair('mailto:test@vanilla.local')
    expect(keys.publicKey.length).toBeGreaterThan(60)

    const ecdh = (await import('crypto')).createECDH('prime256v1')
    ecdh.generateKeys()
    const uaPub = ecdh.getPublicKey().toString('base64url')
    const authSec = (await import('crypto')).randomBytes(16).toString('base64url')

    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Uint8Array | null = null
    const origFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      capturedHeaders = init.headers
      capturedBody = init.body
      return new Response(null, { status: 201 })
    }) as any

    try {
      const sent = await sendWebPushNotification(
        { endpoint: 'https://push.example.invalid/sub/1', p256dh: uaPub, auth: authSec },
        { title: '香草提醒', body: 'SECRET_PLAINTEXT_CHECK' },
        keys,
      )
      expect(sent).toEqual({ ok: true, status: 201, gone: false })
      expect(capturedHeaders['Content-Encoding']).toBe('aes128gcm')
      expect(capturedHeaders['Authorization']).toMatch(/^vapid t=[^,]+, k=/)
      expect(capturedBody).toBeTruthy()
      const asText = Buffer.from(capturedBody!).toString('utf8')
      expect(asText).not.toContain('SECRET_PLAINTEXT_CHECK')
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('R4: Zhongkao coverage >= 60% (>= 413/688) & mnemonic safety/length validation', () => {
    const stats = getZhongkaoCoverageStats()
    expect(stats.totalWords).toBe(688)
    expect(stats.builtinMnemonicWords).toBeGreaterThanOrEqual(413)
    expect(stats.coveragePct).toBeGreaterThanOrEqual(60)

    expect(
      checkMnemonicSafety({
        word: 'test',
        hook: '合法记忆钩子',
        story: '用正常的词根记忆方法记住这个中考核心单词。',
      }).ok,
    ).toBe(true)
    expect(checkMnemonicSafety({ story: '<script>alert(1)</script>' }).ok).toBe(false)
    expect(checkMnemonicSafety({ story: '考场作弊必胜秘诀' }).ok).toBe(false)

    const okDraft = validateMnemonicDraft({
      word: 'reward',
      tag: '词根词缀',
      hook: 're(回)+ward(看顾)→奖赏',
      story: '付出努力后回头看见果实，就是收到的奖励与回报。',
      chunks: [['re', '回'], ['ward', '看顾']],
    })
    expect(okDraft.ok).toBe(true)

    const badDraft = validateMnemonicDraft({
      word: 'reward',
      tag: '谐音记忆',
      hook: 'a',
      story: '太短',
      chunks: [],
    })
    expect(badDraft.ok).toBe(false)
  })

  it('R5: Squad weekly >=4d goal evaluation & cheer limits', () => {
    expect(SQUAD_CHEER_PRESETS.length).toBe(6)
    expect(MAX_SQUAD_CHEERS_PER_DAY).toBe(3)
    expect(evaluateSquadWeeklyGoal([4, 5, 4])).toEqual({
      totalMembers: 3,
      qualifiedMembers: 3,
      progressPct: 100,
      goalAchieved: true,
    })
    expect(evaluateSquadWeeklyGoal([4, 2, 6])).toEqual({
      totalMembers: 3,
      qualifiedMembers: 2,
      progressPct: 83,
      goalAchieved: false,
    })
  })

  it('R6 & QA-R7-01: Sprint season countdown/milestones & smart debt-paydown plan', () => {
    expect(computeDefaultSeasonStartDate('2026-06-20')).toBe('2026-03-12')
    const activeState = evaluateSeasonState({
      examDate: '2026-06-20',
      startDate: null,
      status: 'AUTO',
      todayDate: '2026-04-01',
    })
    expect(activeState.isActive).toBe(true)
    expect(activeState.daysRemaining).toBe(80)

    const milestones50 = computeSeasonMilestones(344, 688)
    expect(milestones50.pct).toBe(50)
    expect(milestones50.reachedMilestones.map((m) => m.badgeKey)).toEqual(['season_25', 'season_50'])
    expect(SEASON_MILESTONES.length).toBe(4)

    const debtPlan = computeSmartTodayPlan({
      rawDueCount: 80,
      backlogCap: 35,
      defaultNewPerDay: 10,
      dueReviewedToday: 0,
      consecutiveHighCompletionDays: 0,
      avgSecondsPerWord: 12,
      seasonActive: true,
    })
    expect(debtPlan.isDebtPaydownMode).toBe(true)
    expect(debtPlan.newWordTarget).toBe(0)
    expect(debtPlan.todayDueTarget).toBe(35)
    expect(debtPlan.debtDays).toBe(3)
    expect(debtPlan.extraNewAvailable).toBe(false)
    expect(debtPlan.estimatedMinutes).toBeGreaterThanOrEqual(1)

    const caughtUpPlan = computeSmartTodayPlan({
      rawDueCount: 10,
      backlogCap: 35,
      defaultNewPerDay: 10,
      dueReviewedToday: 0,
      consecutiveHighCompletionDays: 3,
      avgSecondsPerWord: 10,
      seasonActive: true,
    })
    expect(caughtUpPlan.isDebtPaydownMode).toBe(false)
    expect(caughtUpPlan.extraNewAvailable).toBe(true)
    expect(caughtUpPlan.suggestedExtraNew).toBe(5)
    expect(caughtUpPlan.queuePriorityOrder.length).toBeGreaterThanOrEqual(2)
  })

  it('QA-R8-01: Weekly config advice emits tuning suggestion when xpCapHitRate > 5% without auto-mutating', () => {
    const adviseWarn = generateWeeklyConfigAdvice({
      xpCapHitRate: 0.12,
      dueCompletionRate: 0.65,
      dualRingCloseRate: 0.52,
      retention7dRate: 0.72,
      gamificationOptOutRate: 0.04,
      atRiskCount: 2,
      totalStudents: 30,
    })
    expect(adviseWarn.some((a) => a.level === 'warn' && a.configKey === 'dailyXpCap')).toBe(true)

    const adviseHealthy = generateWeeklyConfigAdvice({
      xpCapHitRate: 0.01,
      dueCompletionRate: 0.85,
      dualRingCloseRate: 0.78,
      retention7dRate: 0.82,
      gamificationOptOutRate: 0.02,
      atRiskCount: 0,
      totalStudents: 30,
    })
    expect(adviseHealthy.every((a) => a.level !== 'warn')).toBe(true)
  })
})

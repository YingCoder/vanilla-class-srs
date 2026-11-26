/**
 * Stage 4 Real PostgreSQL Integration Suite (QA-R1 .. QA-R10).
 *
 * Opt-in against disposable localhost PostgreSQL DB `stage4_test` (or `SL_TEST_DATABASE_URL`):
 *   STAGE4_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/stage4_test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import type { Server } from 'http'
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { gradeCard } from '../services/review.service'
import { reconcileGamificationLedger } from '../services/reconcile.service'
import { dispatchDueReminders, markReminderOpened } from '../services/reminder.service'
import { evaluateSquadWeeklyGoal } from '@vanilla-srs/shared/stage4'

const dbUrl = process.env.STAGE4_TEST_DATABASE_URL
const parsedUrl = dbUrl ? new URL(dbUrl) : null
if (parsedUrl && (parsedUrl.hostname !== '127.0.0.1' || !['/stage4_test', '/sl_fresh'].includes(parsedUrl.pathname))) {
  throw new Error('Stage 4 integration tests require localhost /stage4_test or /sl_fresh')
}

describe.runIf(!!dbUrl)('Stage 4 end-to-end verification on real PostgreSQL', () => {
  let db: PrismaClient
  let server: Server
  let base: string

  const ids = Object.fromEntries(
    [
      'adminUser',
      'teacherAUser',
      'teacherBUser',
      's1User',
      's2User',
      's3User',
      'sCapUser',
      'teacherA',
      'teacherB',
      's1',
      's2',
      's3',
      'sCap',
      'dept',
      'sg',
      'classA',
      'classB',
      'enr1',
      'enr2',
      'enr3',
      'enrCap',
      'deck1',
      'deck2',
      'deck3',
      'deckCap',
      'cardSet',
    ].map((k) => [k, randomUUID()]),
  )

  const cards100: Array<{ id: string; word: string }> = []
  let adminCookie = ''
  let teacherACookie = ''
  let teacherBCookie = ''
  let s1Cookie = ''
  let s2Cookie = ''

  async function req(path: string, cookie = '', method = 'GET', body?: unknown) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
    return { status: res.status, json }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = dbUrl!
    process.env.JWT_SECRET = 'stage4-test-secret'
    process.env.JWT_REFRESH_SECRET = 'stage4-test-refresh'

    const [
      { default: prisma },
      { default: studentsRouter },
      { default: studentStage4Router },
      { default: studentGameRouter },
      { default: teachersRouter },
      { default: adminRouter },
      { createStaffGameRouter },
      { createStaffMnemonicRouter },
      { createStaffStage4Router },
      { manageReleasesRouter, publicReleasesRouter },
      { requireAuth, requireTeacher, requireAdmin, requirePasswordChanged },
      { signAccessToken, hashPassword },
    ] = await Promise.all([
      import('../lib/prisma'),
      import('../routes/students'),
      import('../routes/studentStage4'),
      import('../routes/studentGame'),
      import('../routes/teachers'),
      import('../routes/admin'),
      import('../routes/teacherGame'),
      import('../routes/mnemonics'),
      import('../routes/staffStage4'),
      import('../routes/releases'),
      import('../middleware/auth'),
      import('../services/auth.service'),
    ])
    db = prisma

    const pw = await hashPassword('Stage4-Test-Pass-2026!')
    for (const [k, name, role] of [
      ['adminUser', 'S4 Admin', 'ADMIN'],
      ['teacherAUser', 'S4 Teacher A', 'TEACHER'],
      ['teacherBUser', 'S4 Teacher B', 'TEACHER'],
      ['s1User', 'RealName Student One', 'STUDENT'],
      ['s2User', 'RealName Student Two', 'STUDENT'],
      ['s3User', 'RealName Student Three', 'STUDENT'],
      ['sCapUser', 'RealName Cap Tester', 'STUDENT'],
    ] as const) {
      await db.user.create({
        data: {
          id: ids[k],
          email: `${k}-${ids[k]}@stage4-test.invalid`,
          name,
          role,
          passwordHash: pw,
          mustChangePassword: false,
        },
      })
    }

    await db.department.create({ data: { id: ids.dept, name: 'S4 Dept', definitionL1Label: '中文' } })
    await db.subjectGrade.create({ data: { id: ids.sg, name: '初三英语', departmentId: ids.dept } })
    await db.teacher.createMany({
      data: [
        { id: ids.teacherA, userId: ids.teacherAUser },
        { id: ids.teacherB, userId: ids.teacherBUser },
      ],
    })
    await db.teacherSubjectGrade.createMany({
      data: [
        { teacherId: ids.teacherA, subjectGradeId: ids.sg },
        { teacherId: ids.teacherB, subjectGradeId: ids.sg },
      ],
    })

    await db.class.createMany({
      data: [
        { id: ids.classA, name: '实验班A', teacherId: ids.teacherA, subjectGradeId: ids.sg },
        { id: ids.classB, name: '对照班B', teacherId: ids.teacherB, subjectGradeId: ids.sg },
      ],
    })

    await db.student.createMany({
      data: [
        { id: ids.s1, userId: ids.s1User },
        { id: ids.s2, userId: ids.s2User },
        { id: ids.s3, userId: ids.s3User },
        { id: ids.sCap, userId: ids.sCapUser },
      ],
    })

    await db.enrollment.createMany({
      data: [
        { id: ids.enr1, studentId: ids.s1, classId: ids.classA },
        { id: ids.enr2, studentId: ids.s2, classId: ids.classA },
        { id: ids.enr3, studentId: ids.s3, classId: ids.classA },
        { id: ids.enrCap, studentId: ids.sCap, classId: ids.classB },
      ],
    })

    await db.deck.createMany({
      data: [
        { id: ids.deck1, enrollmentId: ids.enr1 },
        { id: ids.deck2, enrollmentId: ids.enr2 },
        { id: ids.deck3, enrollmentId: ids.enr3 },
        { id: ids.deckCap, enrollmentId: ids.enrCap },
      ],
    })

    await db.cardSet.create({
      data: { id: ids.cardSet, name: 'S4 Core Test Set', status: 'DEPARTMENTAL', subjectGradeId: ids.sg },
    })

    const vocabWords = ['ability', 'reward', 'accept', 'abroad', 'abandon', 'achieve', 'across', 'action', 'active', 'advice']
    for (let i = 0; i < 90; i++) {
      const id = randomUUID()
      const word = i < vocabWords.length ? vocabWords[i] : `s4word${String(i).padStart(2, '0')}`
      cards100.push({ id, word })
    }
    await db.card.createMany({
      data: cards100.map((c) => ({
        id: c.id,
        cardSetId: ids.cardSet,
        word: c.word,
        pos: 'n.',
        definitionL1: `释义 ${c.word}`,
        definitionL2: `def ${c.word}`,
      })),
    })

    // Give s1 85 REVIEW cards due in the past (supports QA-R7-01 debt paydown > 35 + QA-R1-02/04)
    const pastDue = new Date('2026-11-24T00:00:00Z')
    await db.cardInstance.createMany({
      data: cards100.slice(0, 85).map((c, idx) => ({
        deckId: ids.deck1,
        cardId: c.id,
        state: 'REVIEW',
        stability: c.word === 'ability' ? 35 : c.word === 'reward' ? 0.1 : 2.5,
        difficulty: 5,
        retrievability: 0.88,
        reps: c.word === 'ability' ? 6 : c.word === 'reward' ? 1 : 2,
        bestStage: c.word === 'ability' ? 5 : c.word === 'reward' ? 1 : 2,
        due: pastDue,
        lastReview: new Date('2026-11-20T00:00:00Z'),
      })),
    })

    // Give sCap 20 due REVIEW cards for QA-R1-03 concurrency cap test
    await db.cardInstance.createMany({
      data: cards100.slice(0, 20).map((c) => ({
        deckId: ids.deckCap,
        cardId: c.id,
        state: 'REVIEW',
        stability: 3.0,
        difficulty: 5,
        retrievability: 0.9,
        reps: 2,
        bestStage: 2,
        due: pastDue,
        lastReview: new Date('2026-11-20T00:00:00Z'),
      })),
    })

    const app = express()
    app.use(express.json(), cookieParser())
    app.use('/api/students/game', studentGameRouter)
    app.use('/api/students', studentsRouter)
    app.use('/api/students', studentStage4Router)
    app.use('/api/teachers/game', createStaffGameRouter('teacher'))
    app.use('/api/admin/game', createStaffGameRouter('admin'))
    app.use('/api/teachers/mnemonics', requireAuth, requireTeacher, requirePasswordChanged, createStaffMnemonicRouter())
    app.use('/api/admin/mnemonics', requireAuth, requireAdmin, requirePasswordChanged, createStaffMnemonicRouter())
    app.use('/api/teachers/releases', requireAuth, requireTeacher, requirePasswordChanged, manageReleasesRouter)
    app.use('/api/admin/releases', requireAuth, requireAdmin, requirePasswordChanged, manageReleasesRouter)
    app.use('/api/releases', publicReleasesRouter)
    app.use('/api/teachers', createStaffStage4Router('teacher'))
    app.use('/api/admin', createStaffStage4Router('admin'))
    app.use('/api/teachers', teachersRouter)
    app.use('/api/admin', adminRouter)
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(err)
      res.status(err?.status ?? 500).json({ error: err?.message ?? 'Internal server error' })
    })

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address() as any
    base = `http://127.0.0.1:${addr.port}`

    const ck = (sub: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT') =>
      `access_token=${signAccessToken({ sub, role, sv: 0 })}`
    adminCookie = ck(ids.adminUser, 'ADMIN')
    teacherACookie = ck(ids.teacherAUser, 'TEACHER')
    teacherBCookie = ck(ids.teacherBUser, 'TEACHER')
    s1Cookie = ck(ids.s1User, 'STUDENT')
    s2Cookie = ck(ids.s2User, 'STUDENT')
  }, 30000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (db) await db.$disconnect()
  })

  it('QA-R1-02 & QA-R1-04: 10 concurrent identical submissionIds award XP once & Shanghai cross-day splits cleanly', async () => {
    const s1Insts = await db.cardInstance.findMany({
      where: { deckId: ids.deck1 },
      include: { card: { select: { word: true } } },
      orderBy: { cardId: 'asc' },
    })
    const safeInsts = s1Insts.filter((x) => !['ability', 'reward', 'accept'].includes(x.card.word))
    const sess = await db.reviewSession.create({
      data: { deckId: ids.deck1, startedAt: new Date('2026-11-25T15:59:00Z'), cardsReviewed: 0 },
    })

    const tsBefore = new Date('2026-11-25T15:59:50Z') // 23:59:50 CST
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        gradeCard(db, ids.s1, sess.id, safeInsts[0].id, 3, 1200, tsBefore, 'dup-sub-1'),
      ),
    )
    const okCount = results.filter((r) => !('error' in r)).length
    expect(okCount).toBe(10)

    const geCount = await db.gameEvent.count({
      where: { studentId: ids.s1, type: 'REVIEW_GRADE', sourceId: 'dup-sub-1' },
    })
    expect(geCount).toBe(1)

    const revCount = await db.reviewEvent.count({
      where: { sessionId: sess.id, submissionId: 'dup-sub-1' },
    })
    expect(revCount).toBe(1)

    // Cross-day: 2026-11-25T16:00:10Z == 2026-11-26 00:00:10 CST
    const tsAfter = new Date('2026-11-25T16:00:10Z')
    await gradeCard(db, ids.s1, sess.id, safeInsts[1].id, 4, 900, tsAfter, 'after-mid-1')

    const day1 = await db.dailyGameState.findUnique({ where: { studentId_localDate: { studentId: ids.s1, localDate: '2026-11-25' } } })
    const day2 = await db.dailyGameState.findUnique({ where: { studentId_localDate: { studentId: ids.s1, localDate: '2026-11-26' } } })
    expect(day1?.xpEarned).toBe(5)
    expect(day2?.xpEarned).toBe(6)

    // 22:30 CST later same calendar day does not consume freeze tickets
    const freezeCount = await db.gameEvent.count({ where: { studentId: ids.s1, type: 'FREEZE_TICKET_USED' } })
    expect(freezeCount).toBe(0)
  })

  it('QA-R1-03 & QA-R1-06: concurrent grades never breach 400 XP cap & reconcile detects injected anomaly', async () => {
    const capDate = '2026-11-25'
    const ts = new Date('2026-11-25T10:00:00Z')
    await db.studentGameProfile.upsert({
      where: { studentId: ids.sCap },
      create: { studentId: ids.sCap, nickname: 'CapTester', totalXp: 390, level: 5 },
      update: { totalXp: 390 },
    })
    await db.gameEvent.create({
      data: {
        studentId: ids.sCap,
        type: 'LEVEL_PASS',
        sourceId: 'seed-cap-pre',
        xp: 390,
        localDate: capDate,
        createdAt: ts,
      },
    })
    await db.dailyGameState.create({
      data: {
        studentId: ids.sCap,
        localDate: capDate,
        xpEarned: 390,
        reviewDue: 20,
        reviewDone: 0,
      },
    })

    const insts = await db.cardInstance.findMany({ where: { deckId: ids.deckCap } })
    const sess = await db.reviewSession.create({
      data: { deckId: ids.deckCap, startedAt: ts, cardsReviewed: 0 },
    })

    await Promise.all(
      insts.slice(0, 10).map((inst, i) =>
        gradeCard(db, ids.sCap, sess.id, inst.id, 4, 800, ts, `cap-sub-${i}`),
      ),
    )

    const dailyAfter = await db.dailyGameState.findUniqueOrThrow({
      where: { studentId_localDate: { studentId: ids.sCap, localDate: capDate } },
    })
    const profileAfter = await db.studentGameProfile.findUniqueOrThrow({ where: { studentId: ids.sCap } })
    expect(dailyAfter.xpEarned).toBeLessThanOrEqual(400)
    expect(dailyAfter.xpEarned).toBe(400)
    expect(profileAfter.totalXp).toBe(400)

    const cleanReport = await reconcileGamificationLedger(db)
    expect(cleanReport.ok).toBe(true)

    // Inject negative XP event & verify reconcile catches it, then clean up
    const badEv = await db.gameEvent.create({
      data: {
        studentId: ids.sCap,
        type: 'REVIEW_GRADE',
        sourceId: 'injected-neg',
        xp: -10,
        localDate: capDate,
      },
    })
    const dirtyReport = await reconcileGamificationLedger(db)
    expect(dirtyReport.ok).toBe(false)
    expect(dirtyReport.discrepancies.some((d) => d.kind === 'NEGATIVE_GAME_EVENT')).toBe(true)
    await db.gameEvent.delete({ where: { id: badEv.id } })
    expect((await reconcileGamificationLedger(db)).ok).toBe(true)
  })

  it('QA-R2-01, QA-R2-02 & QA-R2-03: analytics dedup, Teacher=Admin metrics parity, class-scoped config & rollback', async () => {
    const cid = `ev-${randomUUID()}`
    const evRes = await req('/students/analytics/events', s1Cookie, 'POST', {
      events: [
        { clientEventId: cid, type: 'grade_submit', enrollmentId: ids.enr1, props: { durationMs: 3200, fingerprint: 'bad-fp', ip: '9.9.9.9' } },
        { clientEventId: cid, type: 'grade_submit', enrollmentId: ids.enr1, props: { durationMs: 3200 } },
        { clientEventId: cid, type: 'grade_submit', enrollmentId: ids.enr1, props: { durationMs: 3200 } },
      ],
    })
    expect(evRes.status).toBe(201)
    expect(evRes.json.accepted).toBe(1)

    const storedEv = await db.analyticsEvent.findUniqueOrThrow({
      where: { studentId_clientEventId: { studentId: ids.s1, clientEventId: cid } },
    })
    expect((storedEv.props as any)?.fingerprint).toBeUndefined()
    expect((storedEv.props as any)?.ip).toBeUndefined()

    // Teacher B cannot view Teacher A's class
    const forbidden = await req(`/teachers/game/effect?classId=${ids.classA}`, teacherBCookie)
    expect(forbidden.status).toBe(403)

    // Teacher A === Admin parity
    const tEff = await req(`/teachers/game/effect?classId=${ids.classA}&weeks=4`, teacherACookie)
    const aEff = await req(`/admin/game/effect?classId=${ids.classA}&weeks=4`, adminCookie)
    expect(tEff.status).toBe(200)
    expect(aEff.status).toBe(200)
    expect(tEff.json).toEqual(aEff.json)

    // Out-of-bounds GAME_CONFIG rejected with 400
    const badCfg = await req('/admin/releases', adminCookie, 'POST', {
      version: '2.9.9-bad',
      packVersion: '2026.11',
      title: 'Out of bounds',
      notes: 'Should fail',
      pushMode: 'SILENT',
      payloadType: 'GAME_CONFIG',
      configPayload: { dailyXpCap: 5000 },
    })
    expect(badCfg.status).toBe(400)

    // Scoped GAME_CONFIG applies ONLY to classA, leaving classB untouched
    const scopedRel = await req('/admin/releases', adminCookie, 'POST', {
      version: '2.5.1-ab',
      packVersion: '2026.11',
      title: 'Class A AB Test',
      notes: 'Boost grade3 XP for Class A only',
      pushMode: 'SILENT',
      payloadType: 'GAME_CONFIG',
      scope: { mode: 'CLASSES', classIds: [ids.classA] },
      configPayload: { xpByGrade: { 1: 1, 2: 3, 3: 9, 4: 8 } },
    })
    expect(scopedRel.status).toBe(201)

    const { getEffectiveGameConfig } = await import('../services/gameConfig.service')
    const cfgA = await getEffectiveGameConfig(db, ids.classA)
    const cfgB = await getEffectiveGameConfig(db, ids.classB)
    expect(cfgA.config.xpByGrade[3]).toBe(9)
    expect(cfgB.config.xpByGrade[3]).toBe(5)

    // Rollback restores Class A to default 5 XP
    const rb = await req(`/admin/releases/${scopedRel.json.id}/rollback`, adminCookie, 'PATCH', {})
    expect(rb.status).toBe(200)
    const cfgAAfter = await getEffectiveGameConfig(db, ids.classA)
    expect(cfgAAfter.config.xpByGrade[3]).toBe(5)
  })

  it('QA-R3-01: reminder dispatch enforces frequency caps, ring-closed skip & 3 unopened 7d auto-pause', async () => {
    const pushSpy = async () => ({ ok: true, status: 201, gone: false })
    await db.pushSubscription.create({
      data: {
        studentId: ids.s2,
        endpoint: `https://push.invalid/${ids.s2}`,
        p256dh: 'B'.repeat(40),
        auth: 'A'.repeat(16),
      },
    })
    await db.reminderPref.create({
      data: { studentId: ids.s2, enabled: true, hour: 19 },
    })

    // Seed 3 consecutive unopened prior reminders in past weeks
    const nowWed = new Date('2026-11-25T11:00:00Z') // 19:00 CST Wed
    for (const d of ['2026-11-02', '2026-11-09', '2026-11-16']) {
      await db.reminderLog.create({
        data: {
          studentId: ids.s2,
          templateId: 't1',
          channel: 'WEB_PUSH',
          localDate: d,
          weekStart: d,
          sentAt: new Date(`${d}T11:00:00Z`),
          openedAt: null,
        },
      })
    }

    const pausedSummary = await dispatchDueReminders(db, nowWed, pushSpy, { studentIds: [ids.s2] })
    expect(pausedSummary.autoPausedCount).toBe(1)
    expect(pausedSummary.sentCount).toBe(0)

    const prefPaused = await db.reminderPref.findUniqueOrThrow({ where: { studentId: ids.s2 } })
    expect(prefPaused.pausedUntil).toBeTruthy()

    // Simulate opening the latest reminder -> unpauses
    const latestLog = await db.reminderLog.findFirstOrThrow({
      where: { studentId: ids.s2 },
      orderBy: { sentAt: 'desc' },
    })
    await markReminderOpened(db, ids.s2, latestLog.id, nowWed)
    const prefResumed = await db.reminderPref.findUniqueOrThrow({ where: { studentId: ids.s2 } })
    expect(prefResumed.pausedUntil).toBeNull()

    // Now dispatch sends max 1/day
    const s1Res = await dispatchDueReminders(db, nowWed, pushSpy, { studentIds: [ids.s2] })
    expect(s1Res.sentCount).toBe(1)
    const s2Res = await dispatchDueReminders(db, nowWed, pushSpy, { studentIds: [ids.s2] })
    expect(s2Res.sentCount).toBe(0)
  })

  it('QA-R4-01, QA-R4-02 & QA-R4-03: mnemonic CSV import, gated co-creation + daily 1 XP cap, patch & rollback', async () => {
    const csv = [
      'word,campDay,tag,hook,story,chunks,trap,example',
      'accept,2,词根词缀,ac加cept拿→接受,"老师朝你走过来手里拿着奖状，你伸手接下就是「接受 accept」。","ac|去;cept|拿","accept vs receive 主观接受 vs 客观收到","She happily accepted the prize."',
      'missinghook,2,谐音记忆,,太短缺少钩子,a|b,,',
      'unsafe,2,谐音记忆,正常钩子测试,"这里包含禁止词考场作弊必胜不能通过校验","un|不;safe|安全",,',
    ].join('\n')

    const impRes = await req('/teachers/mnemonics/import', teacherACookie, 'POST', { csvText: csv })
    expect(impRes.status).toBe(200)
    expect(impRes.json.importedCount).toBe(1)
    expect(impRes.json.failedCount).toBe(2)

    // Gated student co-creation off initially -> 403
    const deniedGate = await req('/students/mnemonics', s1Cookie, 'POST', {
      enrollmentId: ids.enr1,
      word: 'ability',
      tag: '词根词缀',
      hook: 'able能+ity→能力',
      story: '能把事情做出来靠的就是 ability 实力与能力。',
      chunks: [['ab', '能'], ['ility', '能力']],
    })
    expect(deniedGate.status).toBe(403)

    // Turn co-create ON for classA
    const setRes = await req('/teachers/game/settings', teacherACookie, 'PUT', {
      classId: ids.classA,
      mnemonicCoCreateOpen: true,
    })
    expect(setRes.status).toBe(200)

    // Stage < 4 card ('reward' has stage 1 on s1) -> 403
    const deniedStage = await req('/students/mnemonics', s1Cookie, 'POST', {
      enrollmentId: ids.enr1,
      word: 'reward',
      tag: '词根词缀',
      hook: 're回ward看→奖赏',
      story: '付出努力后回头看收获，就是收到的奖励。',
      chunks: [['re', '回'], ['ward', '看']],
    })
    expect(deniedStage.status).toBe(403)

    // Stage >= 4 card ('ability' has reps:6, stability:35 -> stage 8 >= 4!) -> 201 PENDING
    const sub1 = await req('/students/mnemonics', s1Cookie, 'POST', {
      enrollmentId: ids.enr1,
      word: 'ability',
      tag: '词根词缀',
      hook: 'able能+ity→能力',
      story: '只靠勤奋打底才能攒出超强的 ability 实战能力！',
      chunks: [['ab', '能'], ['ility', '性质']],
    })
    expect(sub1.status).toBe(201)

    // Second submission -> test reject (0 XP) + another approve same day (daily 1 XP reward cap!)
    const subRej = await req('/students/mnemonics', s1Cookie, 'POST', {
      enrollmentId: ids.enr1,
      word: 'ability',
      tag: '谐音记忆',
      hook: '第二版测试驳回',
      story: '这是一个用于测试驳回零奖励的学生共创口诀条目。',
      chunks: [['a', '一'], ['bility', '能力']],
    })
    expect(subRej.status).toBe(201)

    const rejRes = await req(`/teachers/mnemonics/${subRej.json.id}/review`, teacherACookie, 'POST', {
      decision: 'REJECT',
      reviewNote: '测试驳回',
    })
    expect(rejRes.status).toBe(200)
    expect(rejRes.json.reward).toBeNull()

    const app1 = await req(`/teachers/mnemonics/${sub1.json.id}/review`, teacherACookie, 'POST', {
      decision: 'APPROVE',
    })
    expect(app1.status).toBe(200)
    expect(app1.json.reward.totalAwardedXp).toBeGreaterThan(0)

    // Same-day 2nd student co-creation approval gives 0 extra XP
    const sub2 = await req('/students/mnemonics', s1Cookie, 'POST', {
      enrollmentId: ids.enr1,
      word: 'ability',
      tag: '画面联想',
      hook: '第三版同日不再领奖',
      story: '同一个学生在同一天再次通过审核不再重复发放每日奖励。',
      chunks: [['ab', '离开'], ['ility', '性质']],
    })
    const app2 = await req(`/teachers/mnemonics/${sub2.json.id}/review`, teacherACookie, 'POST', {
      decision: 'APPROVE',
    })
    expect(app2.json.reward).toBeNull()

    // Publish MNEMONIC_PATCH (promotes imported DRAFT 'accept') -> appears in /releases/vocab-pack, then rollback
    const pub = await req('/teachers/mnemonics/publish', teacherACookie, 'POST', {
      version: '2.5.4-patch',
      title: 'S4 口诀补丁',
      notes: '发布 accept 口诀',
      pushMode: 'BANNER',
      promoteDrafts: true,
    })
    expect(pub.status).toBe(201)

    const vp1 = await req('/releases/vocab-pack', s1Cookie)
    expect(vp1.status).toBe(200)
    const words1 = (vp1.json.days ?? []).flatMap((d: any) => d.words ?? [])
    const accept1 = words1.find((w: any) => w.word === 'accept')
    const ability1 = words1.find((w: any) => w.word === 'ability')
    expect(accept1?.mnemonic?.hook).toContain('接受')
    // Student alternative hides real name!
    const abAlts = ability1?.studentAlternatives ?? []
    expect(abAlts.length).toBeGreaterThan(0)
    expect(JSON.stringify(abAlts)).not.toContain('RealName Student One')

    await req(`/admin/releases/${pub.json.release.id}/rollback`, adminCookie, 'PATCH', {})
    const vp2 = await req('/releases/vocab-pack', s1Cookie)
    expect(vp2.json.activePatchVersions ?? []).not.toContain('2.5.4-patch')
  })

  it('QA-R5-01, QA-R6-01, QA-R7-01, QA-R8-01 & R10: Squads, Season+SmartPlan (FSRS untouched), WeeklyReport & VocabPack', async () => {
    // Enable squads on classA
    await req(`/teachers/classes/${ids.classA}/squads`, teacherACookie, 'PUT', { squadEnabled: true })
    const createdSq = await req('/students/squad/join', s1Cookie, 'POST', { enrollmentId: ids.enr1, name: '并肩一队' })
    expect(createdSq.status).toBe(201)
    const squadId = createdSq.json.mySquad.id

    const joinedSq = await req('/students/squad/join', s2Cookie, 'POST', { enrollmentId: ids.enr2, squadId })
    expect(joinedSq.status).toBe(201)
    expect(joinedSq.json.mySquad.members).toHaveLength(2)
    // Privacy: real names not leaked to student squad response
    expect(JSON.stringify(joinedSq.json)).not.toContain('RealName Student One')

    // Max 3 cheers/day -> 4th returns 429
    for (let i = 0; i < 3; i++) {
      const ch = await req('/students/squad/cheer', s1Cookie, 'POST', { enrollmentId: ids.enr1, presetKey: 'keep_going' })
      expect(ch.status).toBe(201)
    }
    const ch4 = await req('/students/squad/cheer', s1Cookie, 'POST', { enrollmentId: ids.enr1, presetKey: 'keep_going' })
    expect(ch4.status).toBe(429)
    expect(evaluateSquadWeeklyGoal([4, 4]).goalAchieved).toBe(true)

    // Snapshot FSRS due dates before Season & Smart Plan
    const fsrsBefore = await db.cardInstance.findMany({
      where: { deckId: ids.deck1 },
      orderBy: { id: 'asc' },
      select: { id: true, due: true, stability: true, difficulty: true },
    })

    // Configure Season examDate = 60 days ahead -> auto start = examDate - 100d -> active!
    const futureExam = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)
    const seasonPut = await req(`/teachers/classes/${ids.classA}/season`, teacherACookie, 'PUT', {
      name: '冲刺60天',
      examDate: futureExam,
      status: 'AUTO',
    })
    expect(seasonPut.status).toBe(200)

    const seasonGet = await req(`/students/season?enrollmentId=${ids.enr1}`, s1Cookie)
    expect(seasonGet.status).toBe(200)
    expect(seasonGet.json.isActive).toBe(true)

    // R7 Smart Today Plan: s1 has 85 due cards -> Debt paydown mode with newWordTarget=0!
    const planGet = await req(`/students/plan/today?enrollmentId=${ids.enr1}`, s1Cookie)
    expect(planGet.status).toBe(200)
    expect(planGet.json.isDebtPaydownMode).toBe(true)
    expect(planGet.json.newWordTarget).toBe(0)
    expect(planGet.json.debtDays).toBeGreaterThanOrEqual(2)

    // Start review -> FSRS fields of unreviewed cards remain completely intact!
    const startRev = await req('/students/review/start', s1Cookie, 'POST', { enrollmentId: ids.enr1 })
    expect(startRev.status).toBe(201)
    const fsrsAfter = await db.cardInstance.findMany({
      where: { deckId: ids.deck1 },
      orderBy: { id: 'asc' },
      select: { id: true, due: true, stability: true, difficulty: true },
    })
    expect(fsrsAfter.map((x) => ({ ...x, due: x.due.toISOString() }))).toEqual(
      fsrsBefore.map((x) => ({ ...x, due: x.due.toISOString() })),
    )

    // R8 Weekly Report role protection + teacher/admin parity
    const studentDenied = await req(`/teachers/reports/weekly?classId=${ids.classA}`, s1Cookie)
    expect(studentDenied.status).toBe(403)
    const repT = await req(`/teachers/reports/weekly?classId=${ids.classA}`, teacherACookie)
    const repA = await req(`/admin/reports/weekly?classId=${ids.classA}`, adminCookie)
    expect(repT.status).toBe(200)
    expect(repT.json.report.payload.metrics).toEqual(repA.json.report.payload.metrics)

    // R10 Custom Vocab Pack
    const pkRes = await req('/teachers/vocab-packs', teacherACookie, 'POST', {
      name: '七年级上专项50词',
      items: [
        { day: 1, word: 'ability', meaning: '能力（复用FSRS阶段）' },
        { day: 1, word: 'resilience', ipa: '/rɪˈzɪliəns/', meaning: 'n. 韧性' },
      ],
    })
    expect(pkRes.status).toBe(201)
    const pkCards = await req(`/students/vocab-packs/${pkRes.json.id}/cards?enrollmentId=${ids.enr1}&day=1`, s1Cookie)
    expect(pkCards.status).toBe(200)
    expect(pkCards.json.cards.find((c: any) => c.word === 'ability').bestStage).toBe(8)
  })
})

/**
 * Opt-in world-home PostgreSQL/API integration against the disposable database.
 * Run migrations first with the same DATABASE_URL, then STAGE4_TEST_DATABASE_URL=... vitest run ...
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'crypto'
import type { Server } from 'http'
import type { PrismaClient } from '@prisma/client'
import { startSession } from '../services/review.service'
import { buildStudentHome } from '../services/home.service'
import type { HomeResponse } from '@vanilla-srs/shared/world'

const dbUrl = process.env.STAGE4_TEST_DATABASE_URL
const parsedUrl = dbUrl ? new URL(dbUrl) : null
if (parsedUrl && (parsedUrl.hostname !== '127.0.0.1' || parsedUrl.pathname !== '/stage4_test')) {
  throw new Error('World integration only permits localhost disposable stage4_test')
}

describe.runIf(Boolean(dbUrl))('world home real PostgreSQL and authenticated HTTP', () => {
  let db: PrismaClient
  let server: Server
  let base: string
  let studentCookie = ''
  let otherCookie = ''
  const id = { student: randomUUID(), other: randomUUID(), enrA: randomUUID(), enrB: randomUUID(), otherEnr: randomUUID(), deckA: randomUUID(), deckB: randomUUID() }
  let requestCount = 0
  const nextKey = () => randomUUID()
  const request = async (path: string, options?: { cookie?: string; method?: string; body?: unknown; key?: string }) => {
    const response = await fetch(`${base}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        ...(options?.cookie ? { Cookie: options.cookie } : {}),
        ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.key ? { 'Idempotency-Key': options.key } : {}),
      },
      ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    })
    const text = await response.text()
    let body: any
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    return { status: response.status, body }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = dbUrl!
    process.env.JWT_SECRET = '{{SECRET_mrj8z6q8}}'
    process.env.JWT_REFRESH_SECRET = '{{SECRET_kwy52jg3}}'
    const [{ default: prisma }, { default: router }, { signAccessToken }] = await Promise.all([
      import('../lib/prisma'), import('../routes/studentGame'), import('../services/auth.service'),
    ])
    db = prisma
    await db.$transaction(async (tx) => {
      await tx.analyticsEvent.deleteMany()
      await tx.studentHomeBuilding.deleteMany()
      await tx.gameEvent.deleteMany()
      await tx.dailyGameState.deleteMany()
      await tx.studentGameProfile.deleteMany()
      await tx.cardInstance.deleteMany()
      await tx.card.deleteMany()
      await tx.cardSet.deleteMany()
      await tx.deck.deleteMany()
      await tx.enrollment.deleteMany()
      await tx.class.deleteMany()
      await tx.teacherSubjectGrade.deleteMany()
      await tx.teacher.deleteMany()
      await tx.student.deleteMany()
      await tx.user.deleteMany()
    })
    const deptId = randomUUID()
    const sgId = randomUUID()
    await db.department.create({ data: { id: deptId, name: 'World Test Dept' } })
    await db.subjectGrade.create({ data: { id: sgId, name: 'World Test Grade', departmentId: deptId } })
    const teacherUser = await db.user.create({ data: { id: randomUUID(), name: 'World Teacher', role: 'TEACHER', passwordHash: 'unused' } })
    const teacher = await db.teacher.create({ data: { userId: teacherUser.id } })
    await db.teacherSubjectGrade.create({ data: { teacherId: teacher.id, subjectGradeId: sgId } })
    const [classA, classB] = await Promise.all([
      db.class.create({ data: { name: 'World A', teacherId: teacher.id, subjectGradeId: sgId } }),
      db.class.create({ data: { name: 'World B', teacherId: teacher.id, subjectGradeId: sgId } }),
    ])
    const user = await db.user.create({ data: { id: randomUUID(), name: 'World Student', role: 'STUDENT', passwordHash: 'unused' } })
    const otherUser = await db.user.create({ data: { id: randomUUID(), name: 'Other Student', role: 'STUDENT', passwordHash: 'unused' } })
    await db.student.create({ data: { id: id.student, userId: user.id } })
    await db.student.create({ data: { id: id.other, userId: otherUser.id } })
    await db.enrollment.createMany({ data: [
      { id: id.enrA, studentId: id.student, classId: classA.id },
      { id: id.enrB, studentId: id.student, classId: classB.id },
      { id: id.otherEnr, studentId: id.other, classId: classA.id },
    ] })
    await db.deck.createMany({ data: [
      { id: id.deckA, enrollmentId: id.enrA }, { id: id.deckB, enrollmentId: id.enrB },
      { enrollmentId: id.otherEnr },
    ] })
    const set = await db.cardSet.create({ data: { name: 'World Words', teacherId: teacher.id } })
    const specs = [
      { word: 'bright', stability: 20, bestStage: 7, due: '2026-11-26T10:00:00Z', last: '2026-11-26T00:00:00Z' },
      { word: 'fading', stability: 0.1, bestStage: 1, due: '2026-11-01T00:00:00Z', last: '2026-11-01T00:00:00Z' },
      { word: 'steady', stability: 3, bestStage: 5, due: '2026-11-26T15:00:00Z', last: '2026-11-26T00:00:00Z' },
      { word: 'upcoming', stability: 20, bestStage: 2, due: '2026-11-30T00:00:00Z', last: '2026-11-26T00:00:00Z' },
    ]
    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index]
      const card = await db.card.create({ data: { cardSetId: set.id, word: spec.word, definitionL1: `meaning ${spec.word}` } })
      await db.cardInstance.create({ data: {
        deckId: id.deckA, cardId: card.id, state: 'REVIEW', stability: spec.stability, reps: 4,
        bestStage: spec.bestStage, due: new Date(spec.due), lastReview: new Date(spec.last),
      } })
    }
    const app = express()
    app.use('/api/students/game', express.json(), cookieParser(), router)
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(error)
      res.status(500).json({ error: error.message })
    })
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()) })
    const address = server.address()
    if (typeof address === 'string' || !address) throw new Error('No test server address')
    base = `http://127.0.0.1:${address.port}/api/students/game`
    const sign = (userId: string) => `access_token=${signAccessToken({ sub: userId, role: 'STUDENT', sv: 0 })}`
    studentCookie = sign(user.id)
    otherCookie = sign(otherUser.id)
  }, 30_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (db) await db.$disconnect()
  })

  beforeEach(async () => {
    await db.studentHomeBuilding.deleteMany({ where: { studentId: { in: [id.student, id.other] } } })
    await db.gameEvent.deleteMany({ where: { studentId: { in: [id.student, id.other] } } })
    await db.reviewSession.deleteMany({ where: { deckId: id.deckA } })
  })

  const home = async (enrollmentId = id.enrA) => {
    const response = await request(`/home?enrollmentId=${enrollmentId}`, { cookie: studentCookie })
    expect(response.status).toBe(200)
    return response.body as HomeResponse
  }

  it('validates ownership/input and exposes zero XP/free buildings without a claim', async () => {
    expect((await request(`/home?enrollmentId=${id.enrA}`)).status).toBe(401)
    expect((await request(`/home?enrollmentId=${id.enrA}`, { cookie: otherCookie })).status).toBe(404)
    expect((await request(`/home?enrollmentId=${id.otherEnr}`, { cookie: studentCookie })).status).toBe(404)
    expect((await request('/home?enrollmentId=bad', { cookie: studentCookie })).status).toBe(400)
    const initial = await home()
    expect(initial.sugarCrystals).toEqual({ balance: 0, totalEarned: 0, totalSpent: 0, ratio: 0.1, ratioPolicy: 'EVENT_SNAPSHOT' })
    expect(initial.buildings.filter((b) => ['campfire', 'hatchery'].includes(b.key)).map((b) => b.level)).toEqual([1, 1])
    expect(initial.tomorrowForecast).toBeNull()
    expect(initial.dueCount).toBe(1)
    expect(initial.spirits.map((s) => s.form)).toEqual(['radiant', 'mature', 'young'])
    expect(initial.spirits[0].appearanceSeed).toBe(initial.spirits[0].appearanceSeed)
    expect(initial.spirits.every((s) => s.retention >= 0 && s.retention <= 1)).toBe(true)
    expect(initial.campMap.days).toHaveLength(23)
    expect(initial.campMap.days.map((d) => d.day)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1))
    expect(initial.estimatedMinutes).toBeGreaterThan(0)
    expect(await db.studentHomeBuilding.count()).toBe(0)
    expect(await db.gameEvent.count()).toBe(0)
    const rejected = await request('/home/build', { cookie: studentCookie, method: 'POST', body: { enrollmentId: id.enrA, buildingKey: 'campfire' }, key: nextKey() })
    expect(rejected).toMatchObject({ status: 409, body: { code: 'BUILDING_MAX_LEVEL' } })
    expect(await request('/home/build', { cookie: studentCookie, method: 'POST', body: { enrollmentId: id.enrA, buildingKey: 'lighthouse' } })).toMatchObject({ status: 400 })
  })

  it('aggregates one student wallet across classes, excluding social/creator/0XP income', async () => {
    await db.gameEvent.createMany({ data: [
      { studentId: id.student, type: 'REVIEW_GRADE', sourceId: 'five', xp: 5, localDate: '2026-11-26' },
      { studentId: id.student, type: 'LEVEL_CLEAR', sourceId: 'other-class', xp: 5, localDate: '2026-11-26' },
      { studentId: id.student, type: 'RINGS_CLOSED', sourceId: 'one', xp: 1, localDate: '2026-11-26' },
      { studentId: id.student, type: 'WEAK_RESTUDY', sourceId: 'zero', xp: 0, localDate: '2026-11-26' },
      { studentId: id.student, type: 'MNEMONIC_CREATE', sourceId: 'excluded', xp: 1000, localDate: '2026-11-26' },
      { studentId: id.student, type: 'SQUAD_WEEKLY_GOAL', sourceId: 'excluded', xp: 1000, localDate: '2026-11-26' },
    ] })
    expect((await home()).sugarCrystals.totalEarned).toBe(1)
    expect((await home(id.enrB)).sugarCrystals.totalEarned).toBe(1)
    const insufficient = await request('/home/build', { cookie: studentCookie, method: 'POST', body: { enrollmentId: id.enrA, buildingKey: 'lighthouse' }, key: nextKey() })
    expect(insufficient).toMatchObject({ status: 409, body: { code: 'INSUFFICIENT_SUGAR_CRYSTALS' } })
    expect(await db.studentHomeBuilding.count()).toBe(0)
  })

  it('snapshots each event ratio, repeats builds safely and unlocks bounded Shanghai forecasts', async () => {
    await db.gameEvent.createMany({ data: [
      { studentId: id.student, type: 'REVIEW_GRADE', sourceId: 'historic', xp: 1000, sugarCrystalRatio: 0.1, localDate: '2026-11-26' },
      { studentId: id.student, type: 'RINGS_CLOSED', sourceId: 'future', xp: 5, sugarCrystalRatio: 0.2, localDate: '2026-11-26' },
    ] })
    const current = await home()
    expect(current.sugarCrystals).toMatchObject({ balance: 101, totalEarned: 101, totalSpent: 0 })
    const key = nextKey()
    const build = () => request('/home/build', { cookie: studentCookie, method: 'POST', body: { enrollmentId: id.enrA, buildingKey: 'lighthouse' }, key })
    const responses = await Promise.all([build(), build(), build()])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201])
    const created = responses.filter((response) => !response.body.replayed)
    expect(created).toHaveLength(1)
    expect(created[0].body).toMatchObject({ level: 1, spent: 80, replayed: false })
    expect(responses.filter((response) => response.body.replayed).every((response) => response.body.spent === 0)).toBe(true)
    const after = await home()
    expect(after.sugarCrystals).toMatchObject({ balance: 21, totalEarned: 101, totalSpent: 80 })
    expect(after.buildings.find((b) => b.key === 'lighthouse')).toMatchObject({ level: 1, nextCost: 120, canBuild: false })
    expect(after.tomorrowForecast).not.toBeNull()
    expect(after.tomorrowForecast!.total).toBe(0)
    expect(after.tomorrowForecast!.slots.reduce((sum, s) => sum + s.count, 0)).toBe(0)
    expect(after.tomorrowForecast!.slots.every((s) => s.startHour >= 0 && s.endHour <= 24)).toBe(true)
    expect((await home(id.enrB)).sugarCrystals).toMatchObject({ balance: 21, totalSpent: 80 })
    expect((await home(id.enrB)).tomorrowForecast!.total).toBe(0)
    const reused = await request('/home/build', { cookie: studentCookie, method: 'POST', body: { enrollmentId: id.enrB, buildingKey: 'album_tower' }, key })
    expect(reused).toMatchObject({ status: 409, body: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    const crossClassReplay = await request('/home/build', { cookie: studentCookie, method: 'POST', body: { enrollmentId: id.enrB, buildingKey: 'lighthouse' }, key })
    expect(crossClassReplay).toMatchObject({ status: 200, body: { level: 1, spent: 0, replayed: true } })
  })

  it('locks balance and next level atomically under different-key concurrent upgrades', async () => {
    await db.gameEvent.createMany({ data: [
      { studentId: id.student, type: 'LEVEL_CLEAR', sourceId: 'upgrade-one', xp: 1000, sugarCrystalRatio: 0.1, localDate: '2026-11-26' },
      { studentId: id.student, type: 'LEVEL_CLEAR', sourceId: 'upgrade-two', xp: 1000, sugarCrystalRatio: 0.1, localDate: '2026-11-26' },
    ] })
    expect((await home()).sugarCrystals.balance).toBe(200)
    await buildStudentHome(db, id.student, id.enrA, 'lighthouse', nextKey())
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => buildStudentHome(db, id.student, id.enrA, 'lighthouse', nextKey())))
    const fulfilled = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    expect(results.map((result) => result.status === 'rejected' ? result.reason.message : result.value.level)).toContain(2)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(7)
    expect(await db.studentHomeBuilding.count({ where: { studentId: id.student, buildingKey: 'lighthouse' } })).toBe(2)
    const max = await home()
    expect(max.sugarCrystals.balance).toBe(0)
    expect(max.sugarCrystals.totalSpent).toBe(200)
    expect(max.buildings.find((b) => b.key === 'lighthouse')).toMatchObject({ level: 2, nextCost: null, canBuild: false })
  })

  it('selects the easiest due card only for new queues, never rewriting a resumed queue', async () => {
    const before = await db.cardInstance.findMany({ where: { deckId: id.deckA }, select: { id: true, due: true, stability: true, lastReview: true } })
    const first = await startSession(db, id.student, id.enrA, new Date('2026-11-26T12:00:00Z'), { bypassNewCardCap: true })
    if ('error' in first) throw new Error(first.error)
    const due = first.cards.filter((card) => card.state !== 'NEW' && card.due <= new Date('2026-11-26T12:00:00Z'))
    expect(due.map((card) => card.word)).toContain('bright')
    expect(first.cards[0].word).toBe('bright')
    expect(first.cards[0].bestStage).toBe(7)
    expect(first.cards[0].lastReview).toEqual(new Date('2026-11-26T00:00:00Z'))
    const stored = await db.reviewSession.findUniqueOrThrow({ where: { id: first.sessionId } })
    expect((stored.queue as string[])[0]).toBe(first.cards[0].instanceId)
    // Swap what would now be the best due candidate. The persisted continuation must not reorder.
    const bright = before.find((card) => card.id === first.cards[0].instanceId)!
    await db.cardInstance.update({ where: { id: first.cards[1].instanceId }, data: { stability: 100, lastReview: new Date('2026-11-26T11:59:59Z') } })
    await db.cardInstance.update({ where: { id: bright.id }, data: { stability: 0.1, lastReview: new Date('2026-11-01T00:00:00Z') } })
    const resumed = await startSession(db, id.student, id.enrA, new Date('2026-11-26T12:10:00Z'))
    if ('error' in resumed) throw new Error(resumed.error)
    expect(resumed.resumed).toBe(true)
    expect(resumed.cards.map((card) => card.instanceId)).toEqual(first.cards.map((card) => card.instanceId))
    const after = await db.cardInstance.findUniqueOrThrow({ where: { id: bright.id }, select: { due: true } })
    expect(after.due).toEqual(before.find((card) => card.id === bright.id)!.due)
    await db.reviewSession.delete({ where: { id: first.sessionId } })
    expect(requestCount).toBe(0)
  })
})

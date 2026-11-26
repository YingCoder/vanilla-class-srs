/**
 * Stage 4 Student APIs mounted under `/api/students`:
 *  - R2:  POST /analytics/events
 *  - R3:  GET /push/vapid-key, POST/DELETE /push/subscribe, GET/PUT /reminder-pref, GET /reminders/banner, POST /reminders/:id/open
 *  - R4:  POST /mnemonics
 *  - R5:  GET /squad, POST /squad/join, POST /squad/cheer
 *  - R6:  GET /season
 *  - R7:  GET /plan/today
 *  - R10: GET /vocab-packs, GET /vocab-packs/:packId/cards
 */

import { Request, Response } from 'express'
import { z } from 'zod'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { requireAuth, requirePasswordChanged, requireStudent } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { getVapidKeys } from '../lib/webpush'
import { ingestAnalyticsEvents } from '../services/analytics.service'
import { getStudentWorldContent } from '../services/worldContent.service'
import {
  getInAppReminderBanner,
  getReminderPref,
  markReminderOpened,
  subscribePush,
  unsubscribePush,
  updateReminderPref,
} from '../services/reminder.service'
import { submitStudentMnemonic } from '../services/mnemonic.service'
import {
  getStudentSquadView,
  joinOrCreateStudentSquad,
  sendSquadCheer,
} from '../services/squad.service'
import { getSmartTodayPlan, getStudentSeasonStatus } from '../services/seasonPlan.service'
import {
  getVocabPackCardsForStudent,
  listAvailableVocabPacks,
} from '../services/vocabPack.service'

const router = asyncRouter()
router.use(requireAuth, requireStudent, requirePasswordChanged)

async function getStudent(userId: string) {
  return prisma.student.findUnique({ where: { userId } })
}

function handleErr(err: any, res: Response): boolean {
  if (typeof err?.status === 'number') {
    res.status(err.status).json({ error: err.message })
    return true
  }
  return false
}

// GET /api/students/world-content?enrollmentId= — private, enrollment-scoped content.
router.get('/world-content', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store')
  const query = z.object({ enrollmentId: z.string().uuid() }).safeParse(req.query)
  if (!query.success) { res.status(400).json({ error: 'Valid enrollmentId query param required' }); return }
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  try {
    res.json(await getStudentWorldContent(prisma, student.id, query.data.enrollmentId))
  } catch (err) {
    if (handleErr(err, res)) return
    throw err
  }
})

// ── R2 Analytics ─────────────────────────────────────────────────────────────

const AnalyticsBatchSchema = z.object({
  clientVersion: z.string().trim().max(40).optional(),
  events: z
    .array(
      z.object({
        clientEventId: z.string().trim().min(1).max(120),
        type: z.string().trim().min(1).max(50),
        classId: z.string().uuid().optional(),
        enrollmentId: z.string().uuid().optional(),
        props: z.record(z.unknown()).optional(),
        occurredAt: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
})

router.post('/analytics/events', validate(AnalyticsBatchSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const result = await ingestAnalyticsEvents(
    prisma,
    student.id,
    req.body.events,
    req.body.clientVersion ?? req.header('X-Client-Version'),
  )
  res.status(201).json(result)
})

// ── R3 Reminders & Web Push ──────────────────────────────────────────────────

router.get('/push/vapid-key', (_req: Request, res: Response) => {
  const keys = getVapidKeys()
  res.json({ publicKey: keys.publicKey })
})

const SubscribePushSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(10).max(300),
    auth: z.string().min(6).max(100),
  }),
})

router.post('/push/subscribe', validate(SubscribePushSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const record = await subscribePush(prisma, student.id, {
    endpoint: req.body.endpoint,
    p256dh: req.body.keys.p256dh,
    auth: req.body.keys.auth,
    userAgent: req.header('User-Agent'),
  })
  res.status(201).json({ ok: true, id: record.id })
})

router.delete('/push/subscribe', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : undefined
  const out = await unsubscribePush(prisma, student.id, endpoint)
  res.json(out)
})

router.get('/reminder-pref', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const pref = await getReminderPref(prisma, student.id)
  res.json(pref)
})

const ReminderPrefSchema = z.object({
  enabled: z.boolean().optional(),
  hour: z.number().int().min(7).max(21).optional(),
  resume: z.boolean().optional(),
})

router.put('/reminder-pref', validate(ReminderPrefSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const updated = await updateReminderPref(prisma, student.id, req.body)
  res.json(updated)
})

router.get('/reminders/banner', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }
  const banner = await getInAppReminderBanner(prisma, student.id, enrollmentId)
  res.json(banner)
})

router.post('/reminders/:id/open', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const out = await markReminderOpened(prisma, student.id, req.params.id as string)
  res.json(out)
})

// ── R4 Student Co-Creation Mnemonic ──────────────────────────────────────────

const StudentMnemonicSchema = z.object({
  enrollmentId: z.string().uuid(),
  word: z.string().trim().min(1).max(64),
  tag: z.string().trim().min(1).max(24),
  hook: z.string().trim().min(1).max(40),
  story: z.string().trim().min(1).max(240),
  chunks: z.array(z.tuple([z.string(), z.string()])).min(1).max(6),
  trap: z.string().trim().max(160).nullable().optional(),
  example: z.string().trim().max(240).nullable().optional(),
})

router.post('/mnemonics', validate(StudentMnemonicSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  try {
    const created = await submitStudentMnemonic(prisma, student.id, req.body)
    res.status(201).json(created)
  } catch (err) {
    if (handleErr(err, res)) return
    throw err
  }
})

// ── R5 Learning Squads ───────────────────────────────────────────────────────

router.get('/squad', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }
  const view = await getStudentSquadView(prisma, student.id, enrollmentId)
  if (!view) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.json(view)
})

const JoinSquadSchema = z.object({
  enrollmentId: z.string().uuid(),
  squadId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(30).optional(),
})

router.post('/squad/join', validate(JoinSquadSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  try {
    const view = await joinOrCreateStudentSquad(prisma, student.id, req.body.enrollmentId, {
      squadId: req.body.squadId,
      name: req.body.name,
    })
    res.status(201).json(view)
  } catch (err) {
    if (handleErr(err, res)) return
    throw err
  }
})

const SquadCheerSchema = z.object({
  enrollmentId: z.string().uuid(),
  presetKey: z.string().trim().min(1).max(40),
})

router.post('/squad/cheer', validate(SquadCheerSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  try {
    const cheer = await sendSquadCheer(prisma, student.id, req.body.enrollmentId, req.body.presetKey)
    res.status(201).json(cheer)
  } catch (err) {
    if (handleErr(err, res)) return
    throw err
  }
})

// ── R6 Sprint Season & R7 Smart Today Plan ───────────────────────────────────

router.get('/season', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }
  const status = await getStudentSeasonStatus(prisma, student.id, enrollmentId)
  if (!status) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.json(status)
})

router.get('/plan/today', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }
  const plan = await getSmartTodayPlan(prisma, student.id, enrollmentId)
  if (!plan) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.json(plan)
})

// ── R10 Multi-Vocab Packs ────────────────────────────────────────────────────

router.get('/vocab-packs', async (_req: Request, res: Response) => {
  const packs = await listAvailableVocabPacks(prisma)
  res.json(packs)
})

router.get('/vocab-packs/:packId/cards', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }
  const day = req.query.day ? Number(req.query.day) : 1
  const data = await getVocabPackCardsForStudent(prisma, student.id, enrollmentId, req.params.packId as string, day)
  if (!data) { res.status(404).json({ error: 'VocabPack or enrollment not found' }); return }
  res.json(data)
})

export default router

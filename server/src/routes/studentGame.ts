/**
 * Student Stage 3 gamification endpoints mounted under /api/students/game.
 */

import { Request, Response } from 'express'
import { z } from 'zod'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { requireAuth, requireStudent, requirePasswordChanged } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { shanghaiDateString, AVATAR_OPTIONS, AVATAR_FRAME_OPTIONS, CARD_SKIN_OPTIONS } from '@vanilla-srs/shared/gamification'
import { getEffectiveGameConfig } from '../services/gameConfig.service'
import {
  getActiveEnrollmentForStudent,
  getCampMap,
  getCardAlbum,
  getClassLeaderboard,
  getStudentBadges,
  getStudentGameSummary,
  getWeakBossPool,
  markCheerRead,
  recordGameRewardEventInTx,
  updateStudentGameProfile,
} from '../services/gamification.service'
import { closeSession, startRestudy } from '../services/review.service'
import { HOME_BUILDING_KEYS, type HomeErrorResponse } from '@vanilla-srs/shared/world'
import { buildStudentHome, getStudentHome, HomeError } from '../services/home.service'

const router = asyncRouter()
router.use(requireAuth, requireStudent, requirePasswordChanged)

async function getStudent(userId: string) {
  return prisma.student.findUnique({ where: { userId } })
}

// GET /api/students/game/summary?enrollmentId=
router.get('/summary', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const summary = await getStudentGameSummary(prisma, student.id, enrollmentId)
  if (!summary) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.setHeader('Cache-Control', 'no-store')
  res.json(summary)
})

const EnrollmentQuerySchema = z.object({ enrollmentId: z.string().uuid() })

// GET /api/students/game/home?enrollmentId=
router.get('/home', async (req: Request, res: Response) => {
  const parsed = EnrollmentQuerySchema.safeParse(req.query)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() }); return }
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  try {
    const home = await getStudentHome(prisma, student.id, parsed.data.enrollmentId)
    res.setHeader('Cache-Control', 'no-store')
    res.json(home)
  } catch (error) {
    if (error instanceof HomeError) { res.status(error.status).json({ error: error.message, code: error.code } satisfies HomeErrorResponse); return }
    throw error
  }
})

const HomeBuildSchema = z.object({
  enrollmentId: z.string().uuid(),
  buildingKey: z.enum(HOME_BUILDING_KEYS),
}).strict()

// POST /api/students/game/home/build; Idempotency-Key is a UUID reused on retries.
router.post('/home/build', validate(HomeBuildSchema), async (req: Request, res: Response) => {
  const requestId = req.header('Idempotency-Key')
  if (!requestId || !z.string().uuid().safeParse(requestId).success) {
    res.status(400).json({ error: 'Idempotency-Key UUID header required' })
    return
  }
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  try {
    const result = await buildStudentHome(prisma, student.id, req.body.enrollmentId, req.body.buildingKey, requestId)
    res.setHeader('Cache-Control', 'no-store')
    res.status(result.replayed ? 200 : 201).json(result)
  } catch (error) {
    if (error instanceof HomeError) { res.status(error.status).json({ error: error.message, code: error.code } satisfies HomeErrorResponse); return }
    throw error
  }
})

const ProfilePatchSchema = z.object({
  nickname: z.string().trim().min(1).max(20).optional(),
  avatarKey: z.enum(AVATAR_OPTIONS.map((a) => a.key) as [string, ...string[]]).optional(),
  avatarFrame: z.enum(AVATAR_FRAME_OPTIONS.map((f) => f.key) as [string, ...string[]]).optional(),
  cardSkin: z.enum(CARD_SKIN_OPTIONS.map((s) => s.key) as [string, ...string[]]).optional(),
  soundEnabled: z.boolean().optional(),
  fontScale: z.enum(['normal', 'large', 'xlarge']).optional(),
  reduceMotion: z.boolean().optional(),
  lowSpecMode: z.boolean().optional(),
})

// PATCH /api/students/game/profile
router.patch('/profile', validate(ProfilePatchSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const updated = await updateStudentGameProfile(prisma, student.id, req.body)
  res.json(updated)
})

// GET /api/students/game/map?enrollmentId=
router.get('/map', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const map = await getCampMap(prisma, student.id, enrollmentId)
  if (!map) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.json(map)
})

// GET /api/students/game/cards?enrollmentId=&day=
router.get('/cards', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const rawDay = req.query.day ? Number(req.query.day) : 1
  const day = Number.isInteger(rawDay) && rawDay >= 1 && rawDay <= 23 ? rawDay : 1
  const album = await getCardAlbum(prisma, student.id, enrollmentId, day)
  if (!album) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.json(album)
})

// GET /api/students/game/badges?enrollmentId=
router.get('/badges', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const badges = await getStudentBadges(prisma, student.id, enrollmentId)
  if (!badges) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.json(badges)
})

// GET /api/students/game/leaderboard?enrollmentId=
router.get('/leaderboard', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const board = await getClassLeaderboard(prisma, student.id, enrollmentId)
  if (!board) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.json(board)
})

// GET /api/students/game/weak-boss?enrollmentId=
router.get('/weak-boss', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const pool = await getWeakBossPool(prisma, student.id, enrollmentId)
  if (!pool) { res.status(404).json({ error: 'Enrollment not found' }); return }
  res.json(pool)
})

const WeakBossStartSchema = z.object({
  enrollmentId: z.string().uuid(),
})

// POST /api/students/game/weak-boss/start
router.post('/weak-boss/start', validate(WeakBossStartSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const pool = await getWeakBossPool(prisma, student.id, req.body.enrollmentId)
  if (!pool) { res.status(404).json({ error: 'Enrollment not found' }); return }
  if (!pool.available) {
    res.status(409).json({ error: '当前没有近7天待攻克的弱词，表现超棒！' })
    return
  }

  const session = await startRestudy(
    prisma,
    student.id,
    req.body.enrollmentId,
    pool.words.map((w) => w.instanceId),
  )
  if ('error' in session) { res.status(session.status).json({ error: session.error }); return }
  res.status(201).json({
    ...session,
    bossMaxHp: session.cards.length,
  })
})

const WeakBossFinishSchema = z.object({
  enrollmentId: z.string().uuid(),
  sessionId: z.string().uuid(),
})

// POST /api/students/game/weak-boss/finish
router.post('/weak-boss/finish', validate(WeakBossFinishSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const enrollment = await getActiveEnrollmentForStudent(prisma, student.id, req.body.enrollmentId)
  if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return }

  const session = await prisma.reviewSession.findUnique({
    where: { id: req.body.sessionId },
    include: { events: true },
  })
  if (!session || session.deckId !== enrollment.deck!.id) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  const hasVictory = session.events.some((ev) => ev.grade >= 2)
  if (!hasVictory) {
    res.status(409).json({ error: '还没有击败弱词 Boss 的答题记录' })
    return
  }

  const now = new Date()
  if (!session.endedAt) {
    await closeSession(prisma, session.id, now)
  }

  const { config, configVersion } = await getEffectiveGameConfig(prisma, enrollment.classId)
  const localDate = shanghaiDateString(now)
  const reward = await prisma.$transaction(async (tx) => {
    const resReward = await recordGameRewardEventInTx({
      tx: tx as unknown as typeof prisma,
      studentId: student.id,
      enrollmentId: enrollment.id,
      deckId: enrollment.deck!.id,
      classId: enrollment.classId,
      type: 'WEAK_BOSS_WIN',
      sourceId: localDate,
      baseXp: config.weakBossXp,
      localDate,
      now,
      config,
      configVersion,
      markWeakBossDone: true,
      meta: { sessionId: session.id },
    })
    return resReward
  })

  const remainingWeak = await getWeakBossPool(prisma, student.id, enrollment.id, now)
  res.json({
    ok: true,
    reward,
    remainingWeakCount: remainingWeak?.wordCount ?? 0,
  })
})

// POST /api/students/game/cheers/:id/read
router.post('/cheers/:id/read', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const result = await markCheerRead(prisma, student.id, req.params.id as string)
  res.json(result)
})

export default router

/**
 * Teacher & Admin gamification management endpoints (/api/teachers/game & /api/admin/game).
 */

import { Request, Response } from 'express'
import { z } from 'zod'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { requireAuth, requireAdmin, requireTeacher, requirePasswordChanged } from '../middleware/auth'
import { validate } from '../middleware/validate'
import {
  ClassForbiddenError,
  ClassNotFoundError,
  getTeacherGameOverview,
  listManagedClassesForGame,
  sendTeacherCheer,
  updateClassGameSettings,
} from '../services/teacherGame.service'
import { getClassEffectMetrics } from '../services/analytics.service'

function handleServiceError(err: unknown, res: Response): boolean {
  if (err instanceof ClassForbiddenError || err instanceof ClassNotFoundError) {
    res.status(err.status).json({ error: err.message })
    return true
  }
  if (typeof (err as any)?.status === 'number') {
    res.status((err as any).status).json({ error: (err as Error).message })
    return true
  }
  return false
}

const SettingsSchema = z.object({
  classId: z.string().uuid(),
  leaderboardOpen: z.boolean().optional(),
  weeklyTargetCards: z.number().int().min(10).max(50000).optional(),
  challengeTitle: z.string().trim().min(1).max(60).optional(),
  mnemonicCoCreateOpen: z.boolean().optional(),
  squadEnabled: z.boolean().optional(),
  activePackId: z.string().max(120).nullable().optional(),
})

const CheerSchema = z.object({
  classId: z.string().uuid(),
  studentId: z.string().uuid().nullable().optional(),
  presetKey: z.string().trim().min(1).max(40),
})

export function createStaffGameRouter(mode: 'teacher' | 'admin') {
  const router = asyncRouter()
  if (mode === 'admin') {
    router.use(requireAuth, requireAdmin, requirePasswordChanged)
  } else {
    router.use(requireAuth, requireTeacher, requirePasswordChanged)
  }

  // GET /classes — classes managed by this teacher (or all active classes for admin)
  router.get('/classes', async (req: Request, res: Response) => {
    const classes = await listManagedClassesForGame(prisma, req.user!.sub, req.user!.role)
    res.json(classes)
  })

  // GET /overview?classId=
  router.get('/overview', async (req: Request, res: Response) => {
    const classId = req.query.classId as string | undefined
    if (!classId) { res.status(400).json({ error: 'classId query param required' }); return }

    try {
      const overview = await getTeacherGameOverview(prisma, req.user!.sub, req.user!.role, classId)
      res.json(overview)
    } catch (err) {
      if (handleServiceError(err, res)) return
      throw err
    }
  })

  // GET /effect?classId=&weeks= (R2 Effect Dashboard)
  router.get('/effect', async (req: Request, res: Response) => {
    const classId = req.query.classId as string | undefined
    if (!classId) { res.status(400).json({ error: 'classId query param required' }); return }
    const weeks = req.query.weeks ? Number(req.query.weeks) : 8
    try {
      const data = await getClassEffectMetrics(prisma, req.user!.sub, req.user!.role, classId, weeks)
      res.json(data)
    } catch (err) {
      if (handleServiceError(err, res)) return
      throw err
    }
  })

  // PUT /settings
  router.put('/settings', validate(SettingsSchema), async (req: Request, res: Response) => {
    try {
      const updated = await updateClassGameSettings(prisma, req.user!.sub, req.user!.role, req.body)
      res.json(updated)
    } catch (err) {
      if (handleServiceError(err, res)) return
      throw err
    }
  })

  // POST /cheer
  router.post('/cheer', validate(CheerSchema), async (req: Request, res: Response) => {
    try {
      const cheer = await sendTeacherCheer(prisma, req.user!.sub, req.user!.role, req.body)
      res.status(201).json(cheer)
    } catch (err) {
      if (handleServiceError(err, res)) return
      throw err
    }
  })

  return router
}

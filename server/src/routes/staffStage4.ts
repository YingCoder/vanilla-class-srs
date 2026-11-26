/**
 * Stage 4 Teacher & Admin Parity Routes:
 *  - GET/PUT /classes/:id/squads   (R5)
 *  - GET/PUT /classes/:id/season   (R6)
 *  - GET     /reports/weekly       (R8)
 *  - GET/POST /vocab-packs         (R10)
 */

import { Request, Response } from 'express'
import { z } from 'zod'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { requireAdmin, requireAuth, requirePasswordChanged, requireTeacher } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { ClassForbiddenError, ClassNotFoundError } from '../services/teacherGame.service'
import { listClassSquadsForStaff, updateClassSquadsForStaff } from '../services/squad.service'
import { getClassSeasonConfig, upsertClassSeasonConfig } from '../services/seasonPlan.service'
import { getTeacherWeeklyReport } from '../services/weeklyReport.service'
import { createCustomVocabPack, listAvailableVocabPacks } from '../services/vocabPack.service'

function handleErr(err: unknown, res: Response): boolean {
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

const SquadsPutSchema = z.object({
  squadEnabled: z.boolean().optional(),
  squads: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(30),
        studentIds: z.array(z.string().uuid()),
      }),
    )
    .optional(),
})

const SeasonPutSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['AUTO', 'ACTIVE', 'PAUSED', 'ENDED']).optional(),
})

const CreateVocabPackSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(60).optional(),
  description: z.string().trim().max(240).optional(),
  items: z
    .array(
      z.object({
        day: z.number().int().min(1).max(60).optional(),
        word: z.string().trim().min(1).max(64),
        ipa: z.string().trim().max(64).optional(),
        meaning: z.string().trim().min(1).max(160),
      }),
    )
    .min(1)
    .max(3000),
})

export function createStaffStage4Router(mode: 'teacher' | 'admin') {
  const router = asyncRouter()
  if (mode === 'admin') {
    router.use(requireAuth, requireAdmin, requirePasswordChanged)
  } else {
    router.use(requireAuth, requireTeacher, requirePasswordChanged)
  }

  // R5 Squads
  router.get('/classes/:id/squads', async (req: Request, res: Response) => {
    try {
      const data = await listClassSquadsForStaff(prisma, req.user!.sub, req.user!.role, req.params.id as string)
      res.json(data)
    } catch (err) {
      if (handleErr(err, res)) return
      throw err
    }
  })

  router.put('/classes/:id/squads', validate(SquadsPutSchema), async (req: Request, res: Response) => {
    try {
      const data = await updateClassSquadsForStaff(
        prisma,
        req.user!.sub,
        req.user!.role,
        req.params.id as string,
        req.body,
      )
      res.json(data)
    } catch (err) {
      if (handleErr(err, res)) return
      throw err
    }
  })

  // R6 Sprint Season
  router.get('/classes/:id/season', async (req: Request, res: Response) => {
    try {
      const data = await getClassSeasonConfig(prisma, req.user!.sub, req.user!.role, req.params.id as string)
      res.json(data)
    } catch (err) {
      if (handleErr(err, res)) return
      throw err
    }
  })

  router.put('/classes/:id/season', validate(SeasonPutSchema), async (req: Request, res: Response) => {
    try {
      const data = await upsertClassSeasonConfig(
        prisma,
        req.user!.sub,
        req.user!.role,
        req.params.id as string,
        req.body,
      )
      res.json(data)
    } catch (err) {
      if (handleErr(err, res)) return
      throw err
    }
  })

  // R8 Weekly Report
  router.get('/reports/weekly', async (req: Request, res: Response) => {
    const classId = req.query.classId as string | undefined
    if (!classId) { res.status(400).json({ error: 'classId query param required' }); return }
    const week = typeof req.query.week === 'string' ? req.query.week : undefined
    try {
      const data = await getTeacherWeeklyReport(prisma, req.user!.sub, req.user!.role, classId, week)
      res.json(data)
    } catch (err) {
      if (handleErr(err, res)) return
      throw err
    }
  })

  // R10 Multi-Vocab Packs
  router.get('/vocab-packs', async (_req: Request, res: Response) => {
    const packs = await listAvailableVocabPacks(prisma)
    res.json(packs)
  })

  router.post('/vocab-packs', validate(CreateVocabPackSchema), async (req: Request, res: Response) => {
    try {
      const pack = await createCustomVocabPack(prisma, req.user!.sub, req.body)
      res.status(201).json(pack)
    } catch (err) {
      if (handleErr(err, res)) return
      throw err
    }
  })

  return router
}

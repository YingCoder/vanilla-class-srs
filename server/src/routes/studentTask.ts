import { Request, Response } from 'express'
import { z } from 'zod'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { requireAuth, requireStudent, requirePasswordChanged } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { getOrCreateDailyTask } from '../services/dailyTask.service'
import { startLevel, getLevelSession } from '../services/levelSession.service'
import {
  completeLevel,
  requestLevelHint,
  submitLevelAnswer,
} from '../services/levelAttempt.service'

const router = asyncRouter()
router.use(requireAuth, requireStudent, requirePasswordChanged)

async function getStudent(userId: string) {
  return prisma.student.findUnique({ where: { userId } })
}

const p = (req: Request, key: string) => req.params[key] as string

const LevelEnum = z.enum(['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'])

// GET /api/students/task/today?enrollmentId=
router.get('/task/today', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }
  const enrollmentId = req.query.enrollmentId as string | undefined
  if (!enrollmentId) { res.status(400).json({ error: 'enrollmentId query param required' }); return }

  const task = await getOrCreateDailyTask(prisma, student.id, enrollmentId)
  if ('error' in task) { res.status(task.status).json({ error: task.error }); return }
  res.json(task)
})

const StartLevelSchema = z.object({
  taskId: z.string().uuid(),
  level: LevelEnum,
})

// POST /api/students/levels/start
router.post('/levels/start', validate(StartLevelSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const view = await startLevel(prisma, student.id, req.body.taskId, req.body.level)
  if ('error' in view) { res.status(view.status).json({ error: view.error }); return }
  res.status(201).json(view)
})

// GET /api/students/levels/:id
router.get('/levels/:id', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const view = await getLevelSession(prisma, student.id, p(req, 'id'))
  if ('error' in view) { res.status(view.status).json({ error: view.error }); return }
  res.json(view)
})

const AnswerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string().min(1).max(200),
  submissionId: z.string().min(1).max(100),
  responseMs: z.number().int().positive().optional(),
})

// POST /api/students/levels/:id/answer
router.post('/levels/:id/answer', validate(AnswerSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await submitLevelAnswer(prisma, student.id, p(req, 'id'), req.body)
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.json(result)
})

const HintSchema = z.object({ questionId: z.string().uuid() })

// POST /api/students/levels/:id/hint
router.post('/levels/:id/hint', validate(HintSchema), async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await requestLevelHint(prisma, student.id, p(req, 'id'), req.body.questionId)
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.json(result)
})

// POST /api/students/levels/:id/complete
router.post('/levels/:id/complete', async (req: Request, res: Response) => {
  const student = await getStudent(req.user!.sub)
  if (!student) { res.status(403).json({ error: 'No student profile found' }); return }

  const result = await completeLevel(prisma, student.id, p(req, 'id'))
  if ('error' in result) { res.status(result.status).json({ error: result.error }); return }
  res.json(result)
})

export default router

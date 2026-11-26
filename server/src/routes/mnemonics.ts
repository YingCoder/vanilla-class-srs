/**
 * R4 Mnemonic Scale-Up Routes:
 *  - Mounted on `/api/teachers/mnemonics` (requireTeacher)
 *  - Mounted on `/api/admin/mnemonics` (requireAdmin — Admin/Teacher parity!)
 */

import { Request, Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { validate } from '../middleware/validate'
import {
  getMnemonicWorkbench,
  importMnemonicsBatch,
  publishMnemonicPatch,
  reviewMnemonicEntry,
  saveTeacherMnemonic,
} from '../services/mnemonic.service'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

const UpsertMnemonicSchema = z.object({
  word: z.string().trim().min(1).max(64),
  campDay: z.number().int().min(1).max(23).nullable().optional(),
  tag: z.string().trim().min(1).max(24),
  hook: z.string().trim().min(1).max(40),
  story: z.string().trim().min(1).max(240),
  chunks: z.array(z.tuple([z.string(), z.string()])).min(1).max(6),
  trap: z.string().trim().max(160).nullable().optional(),
  example: z.string().trim().max(240).nullable().optional(),
  status: z.enum(['DRAFT', 'APPROVED']).optional(),
})

const ReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reviewNote: z.string().trim().max(200).optional(),
})

const PublishSchema = z.object({
  version: z.string().trim().min(1).max(40),
  packVersion: z.string().trim().max(60).optional(),
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().min(1).max(500),
  pushMode: z.enum(['BANNER', 'FORCE_RELOAD', 'SILENT']).optional(),
  entryIds: z.array(z.string().uuid()).optional(),
  promoteDrafts: z.boolean().optional(),
})

export function createStaffMnemonicRouter() {
  const router = asyncRouter()

  // GET / — workbench list, filter & coverage stats
  router.get('/', async (req: Request, res: Response) => {
    const dayRaw = req.query.day ? Number(req.query.day) : undefined
    const day = dayRaw && Number.isInteger(dayRaw) && dayRaw >= 1 && dayRaw <= 23 ? dayRaw : undefined
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const search = typeof req.query.search === 'string' ? req.query.search : undefined

    const data = await getMnemonicWorkbench(prisma, { day, status, search })
    res.json(data)
  })

  // GET /template.csv — downloadable CSV template (UTF-8 BOM)
  router.get('/template.csv', (_req: Request, res: Response) => {
    const csv =
      '\uFEFFword,campDay,tag,hook,story,chunks,trap,example\n' +
      'reward,23,词根词缀,re(回)+ward(看顾)→奖赏,"付出努力后回头看收获，就是老师发给你的「报酬、奖赏」。","re|回馈;ward|照看","reward sb for sth 为某事奖赏某人","Closing both rings brings a 30 XP reward."\n'
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="mnemonic-import-template.csv"')
    res.send(csv)
  })

  // POST / — create or update teacher/admin mnemonic entry
  router.post('/', validate(UpsertMnemonicSchema), async (req: Request, res: Response) => {
    try {
      const saved = await saveTeacherMnemonic(prisma, req.user!.sub, req.user!.role, req.body)
      res.status(201).json(saved)
    } catch (err: any) {
      if (typeof err?.status === 'number') {
        res.status(err.status).json({ error: err.message })
        return
      }
      throw err
    }
  })

  // POST /import — batch import CSV file or JSON array
  router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
    if (req.file) {
      const report = await importMnemonicsBatch(prisma, req.user!.sub, req.user!.role, {
        csvBuffer: req.file.buffer,
      })
      res.json(report)
      return
    }
    if (req.body?.csvText && typeof req.body.csvText === 'string') {
      const report = await importMnemonicsBatch(prisma, req.user!.sub, req.user!.role, {
        csvBuffer: Buffer.from(req.body.csvText, 'utf8'),
      })
      res.json(report)
      return
    }
    if (Array.isArray(req.body?.rows)) {
      const report = await importMnemonicsBatch(prisma, req.user!.sub, req.user!.role, {
        rows: req.body.rows,
      })
      res.json(report)
      return
    }
    res.status(400).json({ error: '请上传 CSV 文件或提供 rows / csvText 数据' })
  })

  // POST /:id/review — approve or reject mnemonic entry (incl. student co-creation)
  router.post('/:id/review', validate(ReviewSchema), async (req: Request, res: Response) => {
    try {
      const result = await reviewMnemonicEntry(
        prisma,
        req.user!.sub,
        req.params.id as string,
        req.body.decision,
        req.body.reviewNote,
      )
      res.json(result)
    } catch (err: any) {
      if (typeof err?.status === 'number') {
        res.status(err.status).json({ error: err.message })
        return
      }
      throw err
    }
  })

  // POST /publish — bundle & publish MNEMONIC_PATCH release
  router.post('/publish', validate(PublishSchema), async (req: Request, res: Response) => {
    try {
      const result = await publishMnemonicPatch(prisma, req.user!.sub, req.user!.role, req.body)
      res.status(201).json(result)
    } catch (err: any) {
      if (typeof err?.status === 'number') {
        res.status(err.status).json({ error: err.message })
        return
      }
      throw err
    }
  })

  return router
}

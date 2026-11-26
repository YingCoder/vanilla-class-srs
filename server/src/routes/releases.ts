/**
 * /api/releases         — public client hot-update check & Zhongkao vocab pack metadata
 * /api/admin/releases   — admin release management (mounted with requireAdmin)
 * /api/teachers/releases — teacher release management (Admin/Teacher parity)
 */

import { Request, Response } from 'express'
import { z } from 'zod'
import { asyncRouter } from '../lib/asyncRouter'
import prisma from '../lib/prisma'
import { validate } from '../middleware/validate'
import {
  DEFAULT_BASELINE_RELEASE,
  getLatestPublicRelease,
  listReleases,
  publishRelease,
  rollbackRelease,
} from '../services/release.service'
import { getEffectiveGameConfig } from '../services/gameConfig.service'
import { getRuntimeMnemonicOverlays } from '../services/mnemonicOverlay.service'
import { GAME_CONFIG_BOUNDS, validateGameConfig } from '@vanilla-srs/shared/gamification'
import { validateGameConfigScope } from '@vanilla-srs/shared/stage4'
import { ZHONGKAO_23_DAYS } from '@vanilla-srs/shared/vocab'
import { parseWorldContentJson } from '@vanilla-srs/shared/world-content'
import { authorizeWorldContentScope, getEffectiveWorldContent } from '../services/worldContent.service'
import { verifyClassManagerAccess } from '../services/teacherGame.service'

const PublishSchema = z.object({
  version: z.string().trim().min(1).max(40),
  packVersion: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().min(1).max(500),
  pushMode: z.enum(['BANNER', 'FORCE_RELOAD', 'SILENT']).default('BANNER'),
  payloadType: z.enum(['APP_UI', 'VOCAB_PACK', 'MNEMONIC_PATCH', 'GAME_CONFIG', 'WORLD_CONTENT']).default('VOCAB_PACK'),
  configPayload: z.record(z.unknown()).optional(),
  scope: z
    .object({
      mode: z.enum(['ALL', 'CLASSES']),
      classIds: z.array(z.string().uuid()).optional(),
    })
    .optional(),
})

export const publicReleasesRouter = asyncRouter()

// GET /api/releases/latest
publicReleasesRouter.get('/latest', async (req: Request, res: Response) => {
  const latest = await getLatestPublicRelease(prisma)
  const clientVersion = req.header('X-Client-Version') ?? null
  const needsUpdate = Boolean(clientVersion && clientVersion !== latest.version)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Latest-App-Version', latest.version)
  res.json({
    latest,
    clientVersion,
    needsUpdate,
  })
})

// GET /api/releases/vocab-pack
publicReleasesRouter.get('/vocab-pack', async (_req: Request, res: Response) => {
  const [latest, overlays] = await Promise.all([
    getLatestPublicRelease(prisma),
    getRuntimeMnemonicOverlays(prisma),
  ])
  const days = ZHONGKAO_23_DAYS.map((day) => ({
    day: day.day,
    words: day.words.map((w) => {
      const k = w.word.trim().toLowerCase()
      return {
        ...w,
        mnemonic: overlays.teacherPatches.get(k) ?? w.mnemonic ?? null,
        studentAlternatives: overlays.studentAlternatives.get(k) ?? [],
      }
    }),
  }))
  const totalWords = days.reduce((acc, day) => acc + day.words.length, 0)
  const mnemonicCount = days.reduce(
    (acc, day) => acc + day.words.filter((w) => Boolean(w.mnemonic)).length,
    0,
  )
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    packVersion: latest.packVersion,
    version: latest.version,
    activePatchVersions: overlays.activePatchVersions,
    daysCount: days.length,
    totalWords,
    mnemonicCount,
    days,
  })
})

export const manageReleasesRouter = asyncRouter()

// GET / — scoped history. Teachers cannot enumerate global/other-class world content.
manageReleasesRouter.get('/', async (req: Request, res: Response) => {
  const allReleases = await listReleases(prisma)
  let releases = allReleases
  if (req.user!.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUnique({ where: { userId: req.user!.sub } })
    const managed = teacher ? await prisma.class.findMany({ where: { teacherId: teacher.id, archivedAt: null }, select: { id: true } }) : []
    const ids = new Set(managed.map((cls) => cls.id))
    releases = allReleases.filter((release) => {
      if (release.payloadType !== 'WORLD_CONTENT') return true
      const scope = release.scope as any
      return release.publisherRole === 'TEACHER' && scope?.mode === 'CLASSES'
        && Array.isArray(scope.classIds) && scope.classIds.every((id: string) => ids.has(id))
    })
  }
  const publicLatest = await getLatestPublicRelease(prisma)
  res.json({ releases, latest: publicLatest })
})

// Read-only full content for an authorized preview; ALL uses the fixed baseline.
manageReleasesRouter.get('/world-content', async (req: Request, res: Response) => {
  const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined
  if (classId) await verifyClassManagerAccess(prisma, req.user!.sub, req.user!.role, classId)
  else if (req.user!.role !== 'ADMIN') {
    res.status(403).json({ error: '教师预览全局内容必须选择自己的班级' }); return
  }
  const effective = await getEffectiveWorldContent(prisma, classId ?? '__preview_builtin__')
  res.setHeader('Cache-Control', 'private, no-store')
  res.json(effective)
})

// GET /api/admin|teachers/releases/game-config?classId= — current effective GameConfig & bounds
manageReleasesRouter.get('/game-config', async (req: Request, res: Response) => {
  const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined
  const effective = await getEffectiveGameConfig(prisma, classId)
  res.json({ ...effective, bounds: GAME_CONFIG_BOUNDS })
})

// POST / — publish new hot-update release
manageReleasesRouter.post('/', validate(PublishSchema), async (req: Request, res: Response) => {
  const user = req.user!
  if (req.body.payloadType === 'GAME_CONFIG' && user.role !== 'ADMIN') {
    res.status(403).json({ error: '只有管理员可发布全局游戏化参数热更新' })
    return
  }

  let validatedConfigPayload: unknown = undefined
  let validatedScope: unknown = undefined
  if (req.body.payloadType === 'GAME_CONFIG') {
    const check = validateGameConfig(req.body.configPayload ?? {})
    if (!check.ok) {
      res.status(400).json({ error: `参数超出允许范围：${check.errors.join('；')}`, details: check.errors })
      return
    }
    const scopeCheck = validateGameConfigScope(req.body.scope)
    if (!scopeCheck.ok) {
      res.status(400).json({ error: scopeCheck.error })
      return
    }
    validatedConfigPayload = check.config
  } else if (req.body.payloadType === 'WORLD_CONTENT') {
    validatedScope = await authorizeWorldContentScope(prisma, user.sub, user.role, req.body.scope)
    // Route-level check is intentionally repeated by publishRelease for direct callers.
    const check = parseWorldContentJson(JSON.stringify(req.body.configPayload ?? {}))
    if (!check.ok) { res.status(400).json({ error: `世界内容包校验失败：${check.errors.join('；')}`, details: check.errors }); return }
    validatedConfigPayload = check.content
  }

  const profile = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { name: true, username: true },
  })
  const created = await publishRelease(prisma, {
    ...req.body,
    configPayload: validatedConfigPayload,
    scope: validatedScope,
    publishedBy: profile?.name ?? profile?.username ?? user.sub,
    publisherRole: user.role,
  })
  res.status(201).json(created)
})

// PATCH /:id/rollback — deactivate release and revert to previous active version
manageReleasesRouter.patch('/:id/rollback', async (req: Request, res: Response) => {
  const id = req.params.id as string
  const existing = await prisma.appRelease.findUnique({ where: { id } }).catch(() => null)
  if (existing?.payloadType === 'GAME_CONFIG' && req.user!.role !== 'ADMIN') {
    res.status(403).json({ error: '只有管理员可撤回游戏化参数热更新' })
    return
  }
  if (existing?.payloadType === 'WORLD_CONTENT') {
    await authorizeWorldContentScope(prisma, req.user!.sub, req.user!.role, existing.scope)
  }
  const result = await rollbackRelease(prisma, id)
  if (!result.rolledBack) {
    res.status(404).json({ error: 'Release not found' })
    return
  }
  const latest = existing?.payloadType === 'WORLD_CONTENT' || existing?.payloadType === 'GAME_CONFIG'
    ? DEFAULT_BASELINE_RELEASE
    : await getLatestPublicRelease(prisma)
  res.json({ rolledBack: result.rolledBack, latest })
})

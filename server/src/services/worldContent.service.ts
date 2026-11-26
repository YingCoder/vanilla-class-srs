import type { PrismaClient, Role } from '@prisma/client'
import {
  DEFAULT_WORLD_CONTENT,
  validateWorldContent,
  type WorldContentPack,
} from '@vanilla-srs/shared/world-content'
import type { GameConfigScope } from '@vanilla-srs/shared/stage4'

export interface EffectiveWorldContent {
  contentVersion: string
  releaseId: string | null
  source: 'builtin' | 'release'
  content: WorldContentPack
}

export class WorldContentError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Fail closed for malformed persisted scopes; never interpret corrupt JSON as ALL. */
export function worldContentScope(scope: unknown): GameConfigScope | null {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return null
  const raw = scope as Record<string, unknown>
  if (raw.mode === 'ALL') return Object.keys(raw).length === 1 ? { mode: 'ALL' } : null
  const ids = raw.classIds
  if (raw.mode !== 'CLASSES' || Object.keys(raw).length !== 2 || !Array.isArray(ids)
    || ids.length === 0 || ids.some((id) => typeof id !== 'string' || !id.trim() || id !== id.trim())) return null
  return { mode: 'CLASSES', classIds: [...new Set(ids)] }
}

/** Shared by publishing and rollback: teachers can only affect their own active classes. */
export async function authorizeWorldContentScope(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  input: unknown,
): Promise<GameConfigScope> {
  const scope = worldContentScope(input)
  if (!scope) throw new WorldContentError(400, '世界内容包必须指定合法的 ALL 或 CLASSES 范围')
  if (role !== 'ADMIN' && role !== 'TEACHER') throw new WorldContentError(403, '无权管理世界内容包')
  if (scope.mode === 'ALL') {
    if (role !== 'ADMIN') throw new WorldContentError(403, '教师只能向自己管理的班级发布或撤回世界内容包')
  } else {
    const { verifyClassManagerAccess } = await import('./teacherGame.service')
    for (const classId of scope.classIds) {
      const cls = await verifyClassManagerAccess(prisma, userId, role, classId)
      if (!cls || cls.archivedAt) throw new WorldContentError(404, '班级不存在')
    }
  }
  return scope
}

export async function getEffectiveWorldContent(prisma: PrismaClient, classId: string): Promise<EffectiveWorldContent> {
  const fallback = (): EffectiveWorldContent => ({
    contentVersion: 'builtin-world-v1', releaseId: null, source: 'builtin',
    content: JSON.parse(JSON.stringify(DEFAULT_WORLD_CONTENT)) as WorldContentPack,
  })
  try {
    // Filter before any limit so a busy unrelated class cannot hide this class's previous valid release.
    const releases = await prisma.appRelease.findMany({
      where: {
        payloadType: 'WORLD_CONTENT', isActive: true,
        OR: [
          { scope: { equals: { mode: 'ALL' } } },
          { AND: [
            { scope: { path: ['mode'], equals: 'CLASSES' } },
            { scope: { path: ['classIds'], array_contains: [classId] } },
          ] },
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, version: true, configPayload: true, scope: true },
    })
    for (const release of releases) {
      const scope = worldContentScope(release.scope)
      if (!scope || (scope.mode === 'CLASSES' && !scope.classIds.includes(classId))) continue
      const check = validateWorldContent(release.configPayload)
      if (check.ok) return { contentVersion: release.version, releaseId: release.id, source: 'release', content: check.content }
    }
  } catch {
    // Includes deployments awaiting the enum migration; authentication is checked outside this fallback.
  }
  return fallback()
}

export async function getStudentWorldContent(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
): Promise<EffectiveWorldContent> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, studentId, archivedAt: null, class: { archivedAt: null } },
    select: { classId: true },
  })
  if (!enrollment) throw new WorldContentError(404, 'Enrollment not found')
  return getEffectiveWorldContent(prisma, enrollment.classId)
}

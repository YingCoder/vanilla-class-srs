/**
 * Hot-update release management & client version checks.
 *
 * Supports Teacher/Admin parity for publishing app UI, vocab pack, or
 * 邪修记忆 patch pushes, plus safe rollback to prior active releases.
 */

import type {
  PrismaClient,
  ReleasePayloadType,
  ReleasePushMode,
} from '@prisma/client'
import { validateWorldContent } from '@vanilla-srs/shared/world-content'
import { WorldContentError, worldContentScope } from './worldContent.service'

export interface AppReleaseRecord {
  id: string
  version: string
  packVersion: string
  title: string
  notes: string
  pushMode: ReleasePushMode
  payloadType: ReleasePayloadType
  configPayload?: unknown
  scope?: unknown
  isActive: boolean
  publishedBy: string
  publisherRole: string
  publishedAt: Date | string
}

export const DEFAULT_BASELINE_RELEASE: AppReleaseRecord = {
  id: 'baseline-v2.4.0',
  version: 'v2.4.0',
  packVersion: 'Pack-23D-688',
  title: '香草单词营 · 23天中考高频词首发包',
  notes: '包含23天688高频词与136条手工邪修口诀，支持艾宾浩斯8阶复习与iOS免签名主屏安装。',
  pushMode: 'SILENT',
  payloadType: 'VOCAB_PACK',
  isActive: true,
  publishedBy: 'system',
  publisherRole: 'SYSTEM',
  publishedAt: '2026-11-25T00:00:00.000Z',
}

export interface PublishReleaseInput {
  version: string
  packVersion: string
  title: string
  notes: string
  pushMode: ReleasePushMode
  payloadType: ReleasePayloadType
  configPayload?: unknown
  scope?: unknown
  publishedBy: string
  publisherRole: string
}

export async function getLatestActiveRelease(
  prisma: PrismaClient,
): Promise<AppReleaseRecord> {
  try {
    const latest = await prisma.appRelease.findFirst({
      where: { isActive: true },
      orderBy: { publishedAt: 'desc' },
    })
    return latest ?? DEFAULT_BASELINE_RELEASE
  } catch {
    return DEFAULT_BASELINE_RELEASE
  }
}

/** Public hot-update metadata must not reveal any scoped config or story release. */
export async function getLatestPublicRelease(prisma: PrismaClient): Promise<AppReleaseRecord> {
  try {
    const latest = await prisma.appRelease.findFirst({
      where: { isActive: true, payloadType: { in: ['APP_UI', 'VOCAB_PACK', 'MNEMONIC_PATCH'] } },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true, version: true, packVersion: true, title: true, notes: true,
        pushMode: true, payloadType: true, isActive: true, publishedBy: true,
        publisherRole: true, publishedAt: true,
      },
    })
    return latest ?? DEFAULT_BASELINE_RELEASE
  } catch {
    return DEFAULT_BASELINE_RELEASE
  }
}

export async function listReleases(
  prisma: PrismaClient,
): Promise<AppReleaseRecord[]> {
  try {
    const rows = await prisma.appRelease.findMany({
      orderBy: { publishedAt: 'desc' },
      take: 30,
    })
    return rows.length > 0 ? rows : [DEFAULT_BASELINE_RELEASE]
  } catch {
    return [DEFAULT_BASELINE_RELEASE]
  }
}

export async function publishRelease(
  prisma: PrismaClient,
  input: PublishReleaseInput,
): Promise<AppReleaseRecord> {
  if (input.payloadType === 'WORLD_CONTENT') {
    const check = validateWorldContent(input.configPayload)
    if (!check.ok) throw new WorldContentError(400, check.errors.join('；'))
    if (!worldContentScope(input.scope)) throw new WorldContentError(400, '世界内容包缺少有效发布范围')
    input = { ...input, configPayload: check.content }
  }
  return prisma.appRelease.create({
    data: {
      version: input.version.trim(),
      packVersion: input.packVersion.trim(),
      title: input.title.trim(),
      notes: input.notes.trim(),
      pushMode: input.pushMode,
      payloadType: input.payloadType,
      ...(input.configPayload !== undefined ? { configPayload: input.configPayload as any } : {}),
      ...(input.scope !== undefined ? { scope: input.scope as any } : {}),
      isActive: true,
      publishedBy: input.publishedBy,
      publisherRole: input.publisherRole,
    },
  })
}

export async function rollbackRelease(
  prisma: PrismaClient,
  id: string,
): Promise<{ rolledBack: AppReleaseRecord | null; latest: AppReleaseRecord }> {
  const existing = await prisma.appRelease.findUnique({ where: { id } })
  if (!existing) {
    const latest = await getLatestActiveRelease(prisma)
    return { rolledBack: null, latest }
  }
  const rolledBack = await prisma.appRelease.update({
    where: { id },
    data: { isActive: false },
  })
  const latest = await getLatestActiveRelease(prisma)
  return { rolledBack, latest }
}

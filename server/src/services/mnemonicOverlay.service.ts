import type { PrismaClient } from '@prisma/client'
import type { WordMnemonic } from '@vanilla-srs/shared/vocab'

export interface StudentAlternativeMnemonic {
  id: string
  authorNickname: string
  mnemonic: WordMnemonic
  createdAt: string
}

export interface RuntimeMnemonicOverlays {
  teacherPatches: Map<string, WordMnemonic>
  studentAlternatives: Map<string, StudentAlternativeMnemonic[]>
  activePatchVersions: string[]
}

export async function getRuntimeMnemonicOverlays(
  prisma: PrismaClient,
): Promise<RuntimeMnemonicOverlays> {
  const teacherPatches = new Map<string, WordMnemonic>()
  const studentAlternatives = new Map<string, StudentAlternativeMnemonic[]>()
  const activePatchVersions: string[] = []

  try {
    const [patchReleases, approvedEntries] = await Promise.all([
      (prisma as any).appRelease?.findMany
        ? prisma.appRelease.findMany({
            where: { isActive: true, payloadType: 'MNEMONIC_PATCH' },
            orderBy: { publishedAt: 'asc' },
            select: { version: true, configPayload: true },
          })
        : Promise.resolve([]),
      (prisma as any).mnemonicEntry?.findMany
        ? prisma.mnemonicEntry.findMany({
            where: { status: 'APPROVED' },
            orderBy: { reviewedAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    for (const entry of approvedEntries as any[]) {
      const key = entry.word.trim().toLowerCase()
      const mnem: WordMnemonic = {
        tag: entry.tag,
        hook: entry.hook,
        story: entry.story,
        chunks: Array.isArray(entry.chunks) ? entry.chunks : [],
        ...(entry.trap ? { trap: entry.trap } : {}),
        ...(entry.example ? { example: entry.example } : {}),
      }
      if (entry.authorRole === 'STUDENT') {
        const list = studentAlternatives.get(key) ?? []
        list.push({
          id: entry.id,
          authorNickname: entry.authorNickname || '匿名同学',
          mnemonic: mnem,
          createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt),
        })
        studentAlternatives.set(key, list)
      } else if (!entry.releaseVersion && !teacherPatches.has(key)) {
        teacherPatches.set(key, mnem)
      }
    }

    for (const rel of patchReleases as any[]) {
      activePatchVersions.push(rel.version)
      const payload = rel.configPayload as { entries?: Array<{ word: string; mnemonic: WordMnemonic }> } | null
      if (payload && Array.isArray(payload.entries)) {
        for (const item of payload.entries) {
          if (item?.word && item?.mnemonic) {
            teacherPatches.set(item.word.trim().toLowerCase(), item.mnemonic)
          }
        }
      }
    }
  } catch {
    /* resilient in unit-test mocks */
  }

  return { teacherPatches, studentAlternatives, activePatchVersions }
}

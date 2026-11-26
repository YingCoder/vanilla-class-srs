import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_BASELINE_RELEASE,
  getLatestActiveRelease,
  listReleases,
  publishRelease,
  rollbackRelease,
} from '../services/release.service'

describe('release.service', () => {
  it('falls back to baseline v2.4.0 when table is empty', async () => {
    const prisma = {
      appRelease: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as any
    const latest = await getLatestActiveRelease(prisma)
    expect(latest.version).toBe('v2.4.0')
    expect(latest.packVersion).toBe('Pack-23D-688')
  })

  it('publishes a trimmed release and rolls it back cleanly', async () => {
    const createdRow = {
      ...DEFAULT_BASELINE_RELEASE,
      id: 'rel-2',
      version: 'v2.4.1',
      packVersion: 'Pack-23D-r2',
      title: '补充邪修补丁',
      notes: '更新 Day4 口诀',
      pushMode: 'BANNER',
      payloadType: 'MNEMONIC_PATCH',
      isActive: true,
    }
    const prisma = {
      appRelease: {
        create: vi.fn().mockResolvedValue(createdRow),
        findUnique: vi.fn().mockResolvedValue(createdRow),
        update: vi.fn().mockResolvedValue({ ...createdRow, isActive: false }),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([createdRow]),
      },
    } as any

    const published = await publishRelease(prisma, {
      version: ' v2.4.1 ',
      packVersion: ' Pack-23D-r2 ',
      title: ' 补充邪修补丁 ',
      notes: ' 更新 Day4 口诀 ',
      pushMode: 'BANNER',
      payloadType: 'MNEMONIC_PATCH',
      publishedBy: 'teacher1',
      publisherRole: 'TEACHER',
    })
    expect(published.version).toBe('v2.4.1')
    expect(prisma.appRelease.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 'v2.4.1',
          packVersion: 'Pack-23D-r2',
          isActive: true,
        }),
      }),
    )

    const list = await listReleases(prisma)
    expect(list).toHaveLength(1)

    const rolled = await rollbackRelease(prisma, 'rel-2')
    expect(rolled.rolledBack?.isActive).toBe(false)
    expect(rolled.latest.version).toBe('v2.4.0')
  })
})

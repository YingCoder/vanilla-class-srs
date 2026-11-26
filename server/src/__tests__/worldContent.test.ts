import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORLD_CONTENT,
  getWorldIsland,
  parseWorldContentJson,
  validateWorldContent,
} from '@vanilla-srs/shared/world-content'
import {
  authorizeWorldContentScope,
  getEffectiveWorldContent,
  getStudentWorldContent,
} from '../services/worldContent.service'
import { ingestAnalyticsEvents } from '../services/analytics.service'
import { publishRelease, getLatestPublicRelease } from '../services/release.service'


vi.mock('../services/teacherGame.service', () => ({
  verifyClassManagerAccess: vi.fn().mockImplementation(async (_prisma, userId, role, classId) => {
    if (role === 'ADMIN') return { id: classId, archivedAt: null }
    if (classId !== 'mine') { const error: any = new Error('无权操作该班级'); error.status = 403; throw error }
    return { id: classId, archivedAt: null }
  }),
}))

describe('world content schema', () => {
  it('ships exactly 23 stations, 4 bosses and fixed island boundaries', () => {
    const check = validateWorldContent(DEFAULT_WORLD_CONTENT)
    expect(check).toMatchObject({ ok: true })
    expect(DEFAULT_WORLD_CONTENT.stories.map((s) => s.day)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1))
    expect(DEFAULT_WORLD_CONTENT.bosses.map((s) => s.day)).toEqual([6, 12, 18, 23])
    expect(DEFAULT_WORLD_CONTENT.islands.map((i) => [i.name, i.startDay, i.endDay])).toEqual([
      ['草莓海岸', 1, 6], ['香草森林', 7, 12], ['可可山脉', 13, 18], ['星糖云海', 19, 23],
    ])
    for (const story of [...DEFAULT_WORLD_CONTENT.stories, ...DEFAULT_WORLD_CONTENT.bosses]) {
      expect(story.lines.length).toBeGreaterThanOrEqual(2)
      expect(story.lines.length).toBeLessThanOrEqual(3)
      for (const line of [...story.lines, story.tomorrow]) expect([...line].length).toBeLessThanOrEqual(20)
    }
    expect(getWorldIsland(0)).toBeUndefined()
    expect(getWorldIsland(24)).toBeUndefined()
    expect(getWorldIsland(12)?.id).toBe('vanilla')
  })

  it.each([
    ['奖励参数', (input: any) => { input.rewards = { xp: 999 } }],
    ['修改岛屿边界', (input: any) => { input.islands[0].endDay = 7 }],
    ['重复或错序天数', (input: any) => { input.stories[1].day = 1 }],
    ['缺失剧情', (input: any) => { input.stories.pop() }],
    ['HTML', (input: any) => { input.stories[0].title = '<img src=x onerror=alert(1)>' }],
    ['脚本链接', (input: any) => { input.stories[0].lines[0] = 'javascript:alert(1)' }],
    ['CSS 样式', (input: any) => { input.islands[0].theme = 'background:red' }],
    ['外部链接', (input: any) => { input.stories[0].tomorrow = 'https://example.com' }],
    ['超长句', (input: any) => { input.stories[0].lines[0] = '雾'.repeat(21) }],
    ['一句话以上', (input: any) => { input.stories[0].lines[0] = '艾斯来了。他又来了。' }],
    ['原型对象', (input: any) => { input.stories[0] = Object.create({ day: 1 }) }],
    ['额外剧情字段', (input: any) => { input.stories[0].html = 'text' }],
  ])('rejects %s', (_label, mutate) => {
    const input = clone()
    mutate(input)
    expect(validateWorldContent(input).ok).toBe(false)
  })

  it('rejects malformed JSON and accepts a deep copy of the complete pack', () => {
    expect(parseWorldContentJson('{nope').ok).toBe(false)
    const check = parseWorldContentJson(JSON.stringify(DEFAULT_WORLD_CONTENT))
    expect(check.ok).toBe(true)
    if (check.ok) {
      check.content.stories[0].title = '安全的新标题'
      expect(DEFAULT_WORLD_CONTENT.stories[0].title).toBe('会打嗝的蛋')
    }
  })
})

describe('world content enrollment scope and fallback', () => {
  it('checks ownership before selecting a scoped release', async () => {
    const prisma: any = {
      enrollment: { findFirst: vi.fn().mockResolvedValue(null) },
      appRelease: { findMany: vi.fn() },
    }
    await expect(getStudentWorldContent(prisma, 'student-1', 'enr-other')).rejects.toMatchObject({ status: 404 })
    expect(prisma.appRelease.findMany).not.toHaveBeenCalled()
  })

  it('filters by class, selects ALL or matching CLASSES and ignores invalid payloads', async () => {
    const owned = clone()
    owned.stories[0].title = '实验班的新标题'
    const all = clone()
    all.stories[0].title = '全校的新标题'
    const prisma: any = {
      appRelease: { findMany: vi.fn().mockResolvedValue([
        { id: 'other-class', version: 'other', scope: { mode: 'CLASSES', classIds: ['class-other'] }, configPayload: clone() },
        { id: 'invalid', version: 'invalid', scope: { mode: 'ALL' }, configPayload: { schemaVersion: 1 } },
        { id: 'owned', version: 'v-owned', scope: { mode: 'CLASSES', classIds: ['class-1'] }, configPayload: owned },
        { id: 'all', version: 'v-all', scope: { mode: 'ALL' }, configPayload: all },
      ]) },
    }
    const result = await getEffectiveWorldContent(prisma, 'class-1')
    expect(result).toMatchObject({ source: 'release', releaseId: 'owned', contentVersion: 'v-owned' })
    expect(result.content.stories[0].title).toBe('实验班的新标题')
    const where = prisma.appRelease.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ isActive: true, payloadType: 'WORLD_CONTENT' })
    expect(JSON.stringify(where.OR)).toContain('class-1')
  })

  it('falls back completely for no release, malformed scope, or unavailable DB', async () => {
    for (const findMany of [
      vi.fn().mockResolvedValue([]),
      vi.fn().mockResolvedValue([{ id: 'unsafe', version: 'v', scope: { mode: 'ALL', extra: true }, configPayload: clone() }]),
      vi.fn().mockRejectedValue(new Error('enum migration not applied')),
    ]) {
      const result = await getEffectiveWorldContent({ appRelease: { findMany } } as any, 'class-1')
      expect(result).toMatchObject({ source: 'builtin', releaseId: null, content: DEFAULT_WORLD_CONTENT })
    }
  })

  it('teacher can only target own active classes; admin can use ALL', async () => {
    const prisma: any = {
      class: { findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(
        where.id === 'mine' ? { id: 'mine', archivedAt: null, teacherId: 'teacher-1' } : { id: where.id, archivedAt: null, teacherId: 'teacher-2' },
      )) },
      teacher: { findUnique: vi.fn().mockResolvedValue({ id: 'teacher-1' }) },
    }
    await expect(authorizeWorldContentScope(prisma, 'user-1', 'TEACHER', { mode: 'CLASSES', classIds: ['mine'] })).resolves.toEqual({ mode: 'CLASSES', classIds: ['mine'] })
    await expect(authorizeWorldContentScope(prisma, 'user-1', 'TEACHER', { mode: 'CLASSES', classIds: ['other'] })).rejects.toMatchObject({ status: 403 })
    await expect(authorizeWorldContentScope(prisma, 'user-1', 'TEACHER', { mode: 'ALL' })).rejects.toMatchObject({ status: 403 })
    await expect(authorizeWorldContentScope(prisma, 'admin-1', 'ADMIN', { mode: 'ALL' })).resolves.toEqual({ mode: 'ALL' })
    await expect(authorizeWorldContentScope(prisma, 'admin-1', 'ADMIN', { mode: 'CLASSES' })).rejects.toMatchObject({ status: 400 })
  })

  it('validates direct service publishing, not only the HTTP layer', async () => {
    const create = vi.fn()
    const base = { version: 'v1', packVersion: 'World-v1', title: '故事', notes: '文本', pushMode: 'SILENT' as const, payloadType: 'WORLD_CONTENT' as const, publishedBy: 'teacher', publisherRole: 'TEACHER', scope: { mode: 'CLASSES' as const, classIds: ['mine'] } }
    await expect(publishRelease({ appRelease: { create } } as any, { ...base, configPayload: { schemaVersion: 1 } })).rejects.toMatchObject({ status: 400 })
    await publishRelease({ appRelease: { create } } as any, { ...base, configPayload: clone() })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payloadType: 'WORLD_CONTENT' }) }))
  })
})


const clone = () => JSON.parse(JSON.stringify(DEFAULT_WORLD_CONTENT))

describe('public release privacy', () => {
  it('never returns scoped configuration or world payload to anonymous clients', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    await getLatestPublicRelease({ appRelease: { findFirst } } as any)
    const query = findFirst.mock.calls[0][0]
    expect(query.where.payloadType).toEqual({ in: ['APP_UI', 'VOCAB_PACK', 'MNEMONIC_PATCH'] })
    expect(query.select.configPayload).toBeUndefined()
    expect(query.select.scope).toBeUndefined()
  })
})
describe('world analytics', () => {
  it('accepts all nine authenticated events and preserves enrollment ownership', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 9 })
    const prisma: any = {
      enrollment: { findMany: vi.fn().mockResolvedValue([{ id: 'enr-1', classId: 'class-1' }]) },
      analyticsEvent: { createMany },
    }
    const types = ['world_home_open', 'world_wake_start', 'world_first_word', 'world_onboarding_complete', 'world_spirit_wake', 'world_story_view', 'world_story_skip', 'world_build', 'world_secret_open']
    const result = await ingestAnalyticsEvents(prisma, 'student-1', types.map((type, i) => ({ clientEventId: `event-${i}`, type, enrollmentId: 'enr-1', props: { day: 1 } })))
    expect(result.accepted).toBe(9)
    expect(createMany.mock.calls[0][0].data.map((e: any) => e.type)).toEqual(types)
    expect(createMany.mock.calls[0][0].data.every((e: any) => e.classId === 'class-1' && e.studentId === 'student-1')).toBe(true)
  })
})

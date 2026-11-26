/**
 * R4 Mnemonic Scale-Up Service:
 *  - Coverage panel across 688 Zhongkao words (D1–D23)
 *  - Teacher/Admin workbench create/edit
 *  - CSV (UTF-8/BOM/GBK) & JSON batch import with per-row validation report
 *  - Student co-creation (class opt-in, stage >= 4 gate, sensitive filter, nickname only)
 *  - Teacher/Admin review (approve awards "邪修创作者" badge + max 1 XP reward/day)
 *  - Package & publish as `MNEMONIC_PATCH` AppRelease (supports rollback!)
 */

import { randomUUID } from 'crypto'
import type { PrismaClient, ReleasePushMode, Role } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { mapFsrsToEbbinghausStage } from '@vanilla-srs/shared/ebbinghaus'
import { shanghaiDateString } from '@vanilla-srs/shared/gamification'
import { validateMnemonicDraft } from '@vanilla-srs/shared/stage4'
import {
  ZHONGKAO_23_DAYS,
  getZhongkaoCoverageStats,
  lookupZhongkaoWord,
  type WordMnemonic,
} from '@vanilla-srs/shared/vocab'
import { decodeCsvBuffer } from '../lib/csv'
import { getEffectiveGameConfig } from './gameConfig.service'
import {
  defaultNicknameForStudent,
  recordGameRewardEventInTx,
  type RewardFeedback,
} from './gamification.service'
import {
  getRuntimeMnemonicOverlays,
  type RuntimeMnemonicOverlays,
  type StudentAlternativeMnemonic,
} from './mnemonicOverlay.service'

export { getRuntimeMnemonicOverlays, type RuntimeMnemonicOverlays, type StudentAlternativeMnemonic }

export async function getMnemonicWorkbench(
  prisma: PrismaClient,
  filters: {
    day?: number
    status?: string
    search?: string
  } = {},
) {
  const [overlays, allEntries] = await Promise.all([
    getRuntimeMnemonicOverlays(prisma),
    prisma.mnemonicEntry.findMany({ orderBy: { updatedAt: 'desc' } }),
  ])

  const entryByWord = new Map<string, any[]>()
  for (const e of allEntries) {
    const k = e.word.trim().toLowerCase()
    const list = entryByWord.get(k) ?? []
    list.push(e)
    entryByWord.set(k, list)
  }

  let totalWords = 0
  let totalCovered = 0
  let totalPending = 0
  let totalDraft = 0

  const byDay = ZHONGKAO_23_DAYS.map((dayItem) => {
    let covered = 0
    let pending = 0
    let draft = 0
    for (const w of dayItem.words) {
      const k = w.word.trim().toLowerCase()
      const entries = entryByWord.get(k) ?? []
      const hasApprovedOrPatched =
        Boolean(w.mnemonic) ||
        overlays.teacherPatches.has(k) ||
        entries.some((e) => e.status === 'APPROVED' && e.authorRole !== 'STUDENT')
      if (hasApprovedOrPatched) covered += 1
      if (entries.some((e) => e.status === 'PENDING')) pending += 1
      if (entries.some((e) => e.status === 'DRAFT')) draft += 1
    }
    totalWords += dayItem.words.length
    totalCovered += covered
    totalPending += pending
    totalDraft += draft

    return {
      day: dayItem.day,
      totalWords: dayItem.words.length,
      coveredCount: covered,
      missingCount: dayItem.words.length - covered,
      pendingReviewCount: pending,
      draftCount: draft,
    }
  })

  const searchQ = filters.search?.trim().toLowerCase() ?? ''
  const targetDays = filters.day ? ZHONGKAO_23_DAYS.filter((d) => d.day === filters.day) : ZHONGKAO_23_DAYS

  const words = targetDays.flatMap((d) =>
    d.words
      .map((w) => {
        const k = w.word.trim().toLowerCase()
        const entries = entryByWord.get(k) ?? []
        const latestStaffEntry = entries.find((e) => e.authorRole !== 'STUDENT') ?? null
        const patched = overlays.teacherPatches.get(k) ?? null
        const effectiveMnemonic = patched ?? w.mnemonic ?? null
        const effectiveStatus = patched || w.mnemonic
          ? (latestStaffEntry?.status ?? 'BUILTIN')
          : (latestStaffEntry?.status ?? 'MISSING')

        return {
          word: w.word,
          day: d.day,
          ipa: w.ipa,
          meaning: w.meaning,
          hasBuiltin: Boolean(w.mnemonic),
          effectiveMnemonic,
          effectiveStatus,
          latestStaffEntry,
          studentEntries: entries.filter((e) => e.authorRole === 'STUDENT'),
        }
      })
      .filter((item) => {
        if (searchQ && !item.word.toLowerCase().includes(searchQ) && !item.meaning.includes(searchQ)) {
          return false
        }
        if (filters.status && filters.status !== 'ALL') {
          if (filters.status === 'MISSING') return !item.effectiveMnemonic && item.effectiveStatus === 'MISSING'
          if (filters.status === 'PENDING') return item.studentEntries.some((s) => s.status === 'PENDING')
          if (filters.status === 'DRAFT') return item.latestStaffEntry?.status === 'DRAFT'
          if (filters.status === 'APPROVED') return Boolean(item.effectiveMnemonic)
        }
        return true
      }),
  )

  const pendingQueue = allEntries.filter((e) => e.status === 'PENDING')
  const draftQueue = allEntries.filter((e) => e.status === 'DRAFT')
  const staticStats = getZhongkaoCoverageStats()

  return {
    coverage: {
      totalWords: staticStats.totalWords,
      coveredCount: totalCovered,
      missingCount: totalWords - totalCovered,
      coveragePct: Math.round((totalCovered / Math.max(1, totalWords)) * 1000) / 10,
      targetCount: Math.ceil(totalWords * 0.6),
      targetPct: 60,
      pendingReviewCount: totalPending,
      draftCount: totalDraft,
      byDay,
    },
    words: words.slice(0, 120),
    pendingQueue,
    draftQueue,
    activePatchVersions: overlays.activePatchVersions,
  }
}

export async function saveTeacherMnemonic(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  input: {
    word: string
    campDay?: number | null
    tag: string
    hook: string
    story: string
    chunks: Array<[string, string]>
    trap?: string | null
    example?: string | null
    status?: 'DRAFT' | 'APPROVED'
  },
) {
  const checked = validateMnemonicDraft(input)
  if (!checked.ok) {
    const err: any = new Error(checked.errors.join('；'))
    err.status = 400
    throw err
  }
  const canonicalWord = checked.data.word.toLowerCase()
  const zk = lookupZhongkaoWord(canonicalWord)
  const campDay = checked.data.campDay ?? zk?.day ?? null

  const existing = await prisma.mnemonicEntry.findFirst({
    where: { word: canonicalWord, authorRole: { in: ['TEACHER', 'ADMIN'] }, status: { in: ['DRAFT', 'APPROVED'] } },
    orderBy: { updatedAt: 'desc' },
  })

  const status = input.status ?? 'APPROVED'
  if (existing) {
    return prisma.mnemonicEntry.update({
      where: { id: existing.id },
      data: {
        campDay,
        tag: checked.data.tag,
        hook: checked.data.hook,
        story: checked.data.story,
        chunks: checked.data.chunks as any,
        trap: checked.data.trap,
        example: checked.data.example,
        status,
        reviewerId: status === 'APPROVED' ? userId : existing.reviewerId,
        reviewedAt: status === 'APPROVED' ? new Date() : existing.reviewedAt,
      },
    })
  }

  return prisma.mnemonicEntry.create({
    data: {
      word: canonicalWord,
      campDay,
      source: 'TEACHER',
      status,
      authorId: userId,
      authorRole: role,
      reviewerId: status === 'APPROVED' ? userId : null,
      reviewedAt: status === 'APPROVED' ? new Date() : null,
      tag: checked.data.tag,
      hook: checked.data.hook,
      story: checked.data.story,
      chunks: checked.data.chunks as any,
      trap: checked.data.trap,
      example: checked.data.example,
    },
  })
}

const MNEMONIC_CSV_ALIASES: Record<string, string> = {
  word: 'word',
  单词: 'word',
  campday: 'campDay',
  day: 'campDay',
  天数: 'campDay',
  tag: 'tag',
  流派: 'tag',
  流派标签: 'tag',
  hook: 'hook',
  记忆钩子: 'hook',
  钩子: 'hook',
  story: 'story',
  记忆故事: 'story',
  口诀: 'story',
  chunks: 'chunks',
  拆解: 'chunks',
  字母块拆解: 'chunks',
  trap: 'trap',
  避坑: 'trap',
  考场防坑: 'trap',
  example: 'example',
  例句: 'example',
}

function parseChunksField(raw: unknown): Array<[string, string]> {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is [string, string] => Array.isArray(x) && x.length >= 2)
      .map(([a, b]) => [String(a), String(b)])
  }
  if (typeof raw !== 'string' || !raw.trim()) return []
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parseChunksField(parsed)
    } catch {
      /* fallback to delimiter parsing */
    }
  }
  return trimmed
    .split(/[;；]/)
    .map((part) => part.split(/[:|→]/).map((s) => s.trim()))
    .filter((pair) => pair.length >= 2 && pair[0] && pair[1])
    .map(([a, b]) => [a, b] as [string, string])
}

export async function importMnemonicsBatch(
  prisma: PrismaClient,
  userId: string,
  role: Role,
  input: { csvBuffer?: Buffer; rows?: Array<Record<string, unknown>> },
) {
  let rawRows: Array<Record<string, unknown>> = []
  if (input.csvBuffer) {
    const { text } = decodeCsvBuffer(input.csvBuffer)
    rawRows = parse(text, {
      columns: (headers: string[]) =>
        headers.map((h) => MNEMONIC_CSV_ALIASES[h.trim().toLowerCase()] ?? h.trim()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Array<Record<string, unknown>>
  } else if (Array.isArray(input.rows)) {
    rawRows = input.rows
  }

  const batchId = randomUUID()
  const existingDbEntries = await prisma.mnemonicEntry.findMany({
    where: { authorRole: { in: ['TEACHER', 'ADMIN'] }, status: { in: ['DRAFT', 'APPROVED'] } },
    select: { word: true },
  })
  const existingWords = new Set(existingDbEntries.map((e) => e.word.trim().toLowerCase()))
  const seenInBatch = new Set<string>()

  const errors: Array<{ row: number; word: string; reason: string }> = []
  const validPayloads: Array<{
    word: string
    campDay: number | null
    tag: string
    hook: string
    story: string
    chunks: Array<[string, string]>
    trap: string | null
    example: string | null
  }> = []

  for (let idx = 0; idx < rawRows.length; idx++) {
    const r = rawRows[idx] ?? {}
    const rowNum = idx + 1
    const rawWord = typeof r.word === 'string' ? r.word.trim() : ''
    const canonical = rawWord.toLowerCase()

    if (canonical && seenInBatch.has(canonical)) {
      errors.push({ row: rowNum, word: rawWord, reason: '重复词：同一导入批次中重复出现' })
      continue
    }
    if (canonical && existingWords.has(canonical)) {
      errors.push({ row: rowNum, word: rawWord, reason: '重复词：词库草稿或已审核条目中已存在该词' })
      continue
    }

    const dayVal =
      r.campDay !== undefined && r.campDay !== null && String(r.campDay).trim() !== ''
        ? Number(r.campDay)
        : undefined
    const checked = validateMnemonicDraft({
      word: rawWord,
      campDay: dayVal,
      tag: typeof r.tag === 'string' ? r.tag : '',
      hook: typeof r.hook === 'string' ? r.hook : '',
      story: typeof r.story === 'string' ? r.story : '',
      chunks: parseChunksField(r.chunks),
      trap: typeof r.trap === 'string' ? r.trap : undefined,
      example: typeof r.example === 'string' ? r.example : undefined,
    })

    if (!checked.ok) {
      errors.push({ row: rowNum, word: rawWord || '(空)', reason: checked.errors.join('；') })
      continue
    }

    seenInBatch.add(canonical)
    const zk = lookupZhongkaoWord(canonical)
    validPayloads.push({
      word: canonical,
      campDay: checked.data.campDay ?? zk?.day ?? null,
      tag: checked.data.tag,
      hook: checked.data.hook,
      story: checked.data.story,
      chunks: checked.data.chunks,
      trap: checked.data.trap ?? null,
      example: checked.data.example ?? null,
    })
  }

  // Valid rows enter DRAFT independently without aborting batch on invalid rows
  if (validPayloads.length > 0) {
    await prisma.mnemonicEntry.createMany({
      data: validPayloads.map((p) => ({
        word: p.word,
        campDay: p.campDay,
        source: 'IMPORT',
        status: 'DRAFT',
        authorId: userId,
        authorRole: role,
        batchId,
        tag: p.tag,
        hook: p.hook,
        story: p.story,
        chunks: p.chunks as any,
        trap: p.trap,
        example: p.example,
      })),
    })
  }

  return {
    batchId,
    totalRows: rawRows.length,
    importedCount: validPayloads.length,
    failedCount: errors.length,
    errors,
  }
}

export async function submitStudentMnemonic(
  prisma: PrismaClient,
  studentId: string,
  input: {
    enrollmentId: string
    word: string
    tag: string
    hook: string
    story: string
    chunks: Array<[string, string]>
    trap?: string | null
    example?: string | null
  },
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: input.enrollmentId },
    include: {
      deck: true,
      class: { include: { gameSetting: true } },
      student: { include: { gameProfile: true } },
    },
  })
  if (!enrollment || enrollment.studentId !== studentId || enrollment.archivedAt || !enrollment.deck) {
    const err: any = new Error('Enrollment not found')
    err.status = 404
    throw err
  }
  if (!enrollment.class.gameSetting?.mnemonicCoCreateOpen) {
    const err: any = new Error('本班暂未开启学生邪修口诀共创')
    err.status = 403
    throw err
  }

  const checked = validateMnemonicDraft(input)
  if (!checked.ok) {
    const err: any = new Error(checked.errors.join('；'))
    err.status = 400
    throw err
  }
  const canonicalWord = checked.data.word.toLowerCase()

  // Student may only submit mnemonics for words reached stage >= 4 in their deck
  const matchingInstances = await prisma.cardInstance.findMany({
    where: {
      deckId: enrollment.deck.id,
      card: { word: { equals: canonicalWord, mode: 'insensitive' } },
    },
    select: { id: true, state: true, stability: true, reps: true, bestStage: true },
  })

  const maxStage = matchingInstances.reduce((best, inst) => {
    const current =
      inst.state === 'NEW' && inst.reps <= 0
        ? 0
        : mapFsrsToEbbinghausStage(inst.state as any, inst.stability, inst.reps)
    return Math.max(best, current, inst.bestStage ?? 0)
  }, 0)

  if (matchingInstances.length === 0 || maxStage < 4) {
    const err: any = new Error('仅支持对已到达艾斯第 4 阶及以上的单词提交共创口诀')
    err.status = 403
    throw err
  }

  const zk = lookupZhongkaoWord(canonicalWord)
  const nickname = enrollment.student.gameProfile?.nickname || defaultNicknameForStudent(studentId)

  return prisma.mnemonicEntry.create({
    data: {
      word: canonicalWord,
      campDay: zk?.day ?? null,
      source: 'STUDENT',
      status: 'PENDING',
      authorId: studentId,
      authorRole: 'STUDENT',
      authorNickname: nickname,
      tag: checked.data.tag,
      hook: checked.data.hook,
      story: checked.data.story,
      chunks: checked.data.chunks as any,
      trap: checked.data.trap,
      example: checked.data.example,
    },
  })
}

export async function reviewMnemonicEntry(
  prisma: PrismaClient,
  reviewerUserId: string,
  entryId: string,
  decision: 'APPROVE' | 'REJECT',
  reviewNote?: string,
  now: Date = new Date(),
): Promise<{ entry: any; reward: RewardFeedback | null }> {
  const entry = await prisma.mnemonicEntry.findUnique({ where: { id: entryId } })
  if (!entry) {
    const err: any = new Error('口诀记录不存在')
    err.status = 404
    throw err
  }

  if (decision === 'REJECT') {
    const updated = await prisma.mnemonicEntry.update({
      where: { id: entryId },
      data: {
        status: 'REJECTED',
        reviewerId: reviewerUserId,
        reviewNote: reviewNote?.trim() || null,
        reviewedAt: now,
      },
    })
    return { entry: updated, reward: null }
  }

  const localDate = shanghaiDateString(now)
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.mnemonicEntry.update({
      where: { id: entryId },
      data: {
        status: 'APPROVED',
        reviewerId: reviewerUserId,
        reviewNote: reviewNote?.trim() || null,
        reviewedAt: now,
      },
    })

    let reward: RewardFeedback | null = null
    if (updated.authorRole === 'STUDENT' && updated.authorId) {
      const enrollment = await tx.enrollment.findFirst({
        where: { studentId: updated.authorId, archivedAt: null },
        include: { deck: true },
        orderBy: { joinedAt: 'desc' },
      })
      if (enrollment?.deck) {
        const { config, configVersion } = await getEffectiveGameConfig(tx as unknown as PrismaClient, enrollment.classId)
        const alreadyRewardedToday = await tx.gameEvent.findUnique({
          where: {
            studentId_type_sourceId: {
              studentId: updated.authorId,
              type: 'MNEMONIC_CREATE',
              sourceId: localDate,
            },
          },
        })
        if (!alreadyRewardedToday) {
          reward = await recordGameRewardEventInTx({
            tx: tx as unknown as PrismaClient,
            studentId: updated.authorId,
            enrollmentId: enrollment.id,
            deckId: enrollment.deck.id,
            classId: enrollment.classId,
            type: 'MNEMONIC_CREATE',
            sourceId: localDate,
            baseXp: config.mnemonicCreatorXp,
            localDate,
            now,
            config,
            configVersion,
            meta: { mnemonicEntryId: updated.id, word: updated.word },
          })
        } else {
          // Still ensure badge is awarded idempotently even if second approval same day earns 0 XP
          try {
            await tx.studentBadge.create({
              data: { studentId: updated.authorId, badgeKey: 'mnemonic_creator', earnedAt: now },
            })
          } catch (err: any) {
            if (err?.code !== 'P2002') throw err
          }
        }
      }
    }

    return { entry: updated, reward }
  })

  return result
}

export async function publishMnemonicPatch(
  prisma: PrismaClient,
  publisherUserId: string,
  publisherRole: Role,
  input: {
    version: string
    packVersion?: string
    title: string
    notes: string
    pushMode?: ReleasePushMode
    entryIds?: string[]
    promoteDrafts?: boolean
  },
) {
  let entries: any[]
  if (input.entryIds && input.entryIds.length > 0) {
    entries = await prisma.mnemonicEntry.findMany({
      where: {
        id: { in: input.entryIds },
        authorRole: { in: ['TEACHER', 'ADMIN'] },
      },
    })
  } else {
    const allowedStatuses = input.promoteDrafts ? ['APPROVED', 'DRAFT'] : ['APPROVED']
    entries = await prisma.mnemonicEntry.findMany({
      where: {
        authorRole: { in: ['TEACHER', 'ADMIN'] },
        status: { in: allowedStatuses },
      },
      orderBy: { updatedAt: 'desc' },
    })
  }

  if (entries.length === 0) {
    const err: any = new Error('没有可打包发布的教师/导入邪修口诀，请先审核或保存条目')
    err.status = 400
    throw err
  }

  const version = input.version.trim()
  const packVersion = (input.packVersion || `Pack-23D-${version}`).trim()
  const patchPayload = {
    entries: entries.map((e) => ({
      id: e.id,
      word: e.word,
      campDay: e.campDay,
      mnemonic: {
        tag: e.tag,
        hook: e.hook,
        story: e.story,
        chunks: Array.isArray(e.chunks) ? e.chunks : [],
        ...(e.trap ? { trap: e.trap } : {}),
        ...(e.example ? { example: e.example } : {}),
      },
    })),
  }

  const user = await prisma.user.findUnique({
    where: { id: publisherUserId },
    select: { name: true, username: true },
  })

  const release = await prisma.$transaction(async (tx) => {
    await tx.mnemonicEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: {
        status: 'APPROVED',
        releaseVersion: version,
        reviewerId: publisherUserId,
        reviewedAt: new Date(),
      },
    })

    return tx.appRelease.create({
      data: {
        version,
        packVersion,
        title: input.title.trim(),
        notes: input.notes.trim(),
        pushMode: input.pushMode ?? 'BANNER',
        payloadType: 'MNEMONIC_PATCH',
        configPayload: patchPayload as any,
        isActive: true,
        publishedBy: user?.name ?? user?.username ?? publisherUserId,
        publisherRole,
      },
    })
  })

  return { release, publishedCount: entries.length }
}

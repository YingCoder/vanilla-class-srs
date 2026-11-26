/**
 * R10 Multi-Vocab Pack Service.
 *
 * Abstracts the 688-word Zhongkao library structure so additional vocabulary
 * packs (e.g. Grade 7/8/9, Vocational Exam, Theme Packs) can reuse the same
 * Card Album, Ebbinghaus 8-stage mapping, and Camp Map progress view.
 */

import type { PrismaClient } from '@prisma/client'
import { mapFsrsToEbbinghausStage } from '@vanilla-srs/shared/ebbinghaus'
import { rarityFromStage } from '@vanilla-srs/shared/gamification'
import { ZHONGKAO_23_DAYS, getZhongkaoCoverageStats } from '@vanilla-srs/shared/vocab'
import { getActiveEnrollmentForStudent } from './gamification.service'

export const BUILTIN_ZHONGKAO_PACK_ID = 'builtin-zhongkao-23d'

export async function listAvailableVocabPacks(prisma: PrismaClient) {
  const zkStats = getZhongkaoCoverageStats()
  const customPacks = (prisma as any).vocabPack?.findMany
    ? await prisma.vocabPack.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { items: true } } },
      })
    : []

  return [
    {
      id: BUILTIN_ZHONGKAO_PACK_ID,
      slug: 'zhongkao-23d-688',
      name: '23天中考英语高频词（默认 688 词）',
      description: '内置 23 天 688 高频词 + 邪修口诀与音标',
      daysCount: ZHONGKAO_23_DAYS.length,
      totalWords: zkStats.totalWords,
      isBuiltin: true,
    },
    ...customPacks.map((p: any) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      daysCount: p.daysCount,
      totalWords: p._count.items,
      isBuiltin: p.isBuiltin,
    })),
  ]
}

export async function createCustomVocabPack(
  prisma: PrismaClient,
  userId: string,
  input: {
    name: string
    slug?: string
    description?: string
    items: Array<{ day?: number; word: string; ipa?: string; meaning: string; mnemonic?: unknown }>
  },
) {
  const cleanName = input.name.trim()
  const slug =
    input.slug?.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-') ||
    `pack-${Date.now().toString(36)}`

  const deduped = new Map<string, { day: number; word: string; ipa: string | null; meaning: string; mnemonic: any; sortOrder: number }>()
  input.items.forEach((item, idx) => {
    const word = item.word?.trim()
    const meaning = item.meaning?.trim()
    if (!word || !meaning) return
    const key = word.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, {
        day: Math.max(1, Math.min(60, Number(item.day) || Math.floor(idx / 30) + 1)),
        word,
        ipa: item.ipa?.trim() || null,
        meaning,
        mnemonic: item.mnemonic ?? null,
        sortOrder: idx,
      })
    }
  })

  if (deduped.size === 0) {
    const err: any = new Error('词包内至少需要 1 个有效词条（word + meaning）')
    err.status = 400
    throw err
  }

  const maxDay = Math.max(...Array.from(deduped.values()).map((i) => i.day))

  return prisma.vocabPack.create({
    data: {
      slug,
      name: cleanName,
      description: input.description?.trim() || null,
      daysCount: maxDay,
      isBuiltin: false,
      createdBy: userId,
      items: {
        create: Array.from(deduped.values()),
      },
    },
    include: { _count: { select: { items: true } } },
  })
}

export async function getVocabPackCardsForStudent(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  packId: string,
  dayParam?: number,
) {
  const enrollment = await getActiveEnrollmentForStudent(prisma, studentId, enrollmentId)
  if (!enrollment) return null

  const pack = await prisma.vocabPack.findUnique({
    where: { id: packId },
    include: { items: { orderBy: [{ day: 'asc' }, { sortOrder: 'asc' }] } },
  })
  if (!pack || !pack.isActive) return null

  const instances = await prisma.cardInstance.findMany({
    where: { deckId: enrollment.deck!.id },
    include: { card: { select: { word: true } } },
  })

  const wordMap = new Map<string, { bestStage: number | null; currentStage: number }>()
  for (const inst of instances) {
    const key = inst.card.word.trim().toLowerCase()
    const cur =
      inst.state === 'NEW' && inst.reps <= 0
        ? -1
        : mapFsrsToEbbinghausStage(inst.state as any, inst.stability, inst.reps)
    const best =
      inst.bestStage !== null && inst.bestStage !== undefined
        ? Math.max(inst.bestStage, cur >= 0 ? cur : inst.bestStage)
        : cur >= 0
          ? cur
          : null
    const prev = wordMap.get(key)
    if (!prev || (best ?? -1) > (prev.bestStage ?? -1)) {
      wordMap.set(key, { bestStage: best, currentStage: Math.max(0, cur) })
    }
  }

  let collectedCount = 0
  let diamondCount = 0
  let goldCount = 0
  let silverCount = 0
  let candyCount = 0

  for (const item of pack.items) {
    const entry = wordMap.get(item.word.trim().toLowerCase())
    const rarity = rarityFromStage(entry?.bestStage)
    if (rarity) {
      collectedCount += 1
      if (rarity.key === 'DIAMOND') diamondCount += 1
      else if (rarity.key === 'GOLD') goldCount += 1
      else if (rarity.key === 'SILVER') silverCount += 1
      else candyCount += 1
    }
  }

  const targetDay = dayParam && dayParam >= 1 && dayParam <= pack.daysCount ? dayParam : 1
  const cards = pack.items
    .filter((i) => i.day === targetDay)
    .map((item) => {
      const entry = wordMap.get(item.word.trim().toLowerCase())
      const bestStage = entry?.bestStage ?? null
      const rarity = rarityFromStage(bestStage)
      return {
        word: item.word,
        ipa: item.ipa ?? '',
        meaning: item.meaning,
        mnemonic: item.mnemonic ?? null,
        collected: rarity !== null,
        bestStage,
        currentStage: entry?.currentStage ?? 0,
        rarity,
      }
    })

  return {
    pack: { id: pack.id, name: pack.name, daysCount: pack.daysCount },
    summary: {
      totalWords: pack.items.length,
      collectedCount,
      candyCount,
      silverCount,
      goldCount,
      diamondCount,
    },
    day: targetDay,
    cards,
  }
}

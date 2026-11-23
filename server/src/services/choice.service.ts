/**
 * Chinese-to-word recognition (认词) as a four-option objective question.
 *
 * The server builds the option set and grades the submitted definition; the
 * client never receives which option is correct before submitting. Options are
 * drawn from the student's own deck first, then from other cards as fallback so
 * a small deck still produces a usable four-option screen.
 */

import type { PrismaClient } from '@prisma/client'
import { gradeCard, type GradeResult } from './review.service'
import { normalizeSpelling } from './spelling.service'

const FALLBACK_MEANINGS = ['形状', '味道', '大小', '重量', '方向', '声音', '时间', '地点']

/** Stable 32-bit FNV-1a hash, used only for deterministic option shuffling. */
function hash(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

export interface ChoiceQuestion {
  prompt: string
  pos: string | null
  options: string[]
}

export interface ChoiceAnswerResult {
  correct: boolean
  expected: string
  grade: GradeResult
}

/**
 * Deduplicate candidates, keep `correct` in the set, and shuffle
 * deterministically so refreshing the same question does not reorder options.
 */
export function buildChoiceOptions(correct: string, candidates: string[], seed: string): string[] {
  const correctLabel = correct.trim()
  const seen = new Set([normalizeSpelling(correctLabel)])
  const distractors: string[] = []

  for (const candidate of candidates) {
    const label = candidate.trim()
    const key = normalizeSpelling(label)
    if (!label || seen.has(key)) continue
    seen.add(key)
    distractors.push(label)
  }

  const chosen = distractors
    .map((label) => ({ label, rank: hash(`${seed}:${label}`) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((item) => item.label)

  while (chosen.length < 3) {
    const filler = FALLBACK_MEANINGS.find((meaning) => !seen.has(normalizeSpelling(meaning)))
    if (!filler) break
    seen.add(normalizeSpelling(filler))
    chosen.push(filler)
  }

  return [correctLabel, ...chosen]
    .map((label) => ({ label, rank: hash(`${seed}:${label}:shuffle`) }))
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.label)
}

interface LoadedQuestion {
  instance: {
    id: string
    cardId: string
    card: {
      word: string
      pos: string | null
      definitionL1: string | null
      definitionL2: string | null
    }
  }
  question: ChoiceQuestion
}

async function loadQuestion(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  instanceId: string,
): Promise<LoadedQuestion | { error: string; status: number }> {
  const session = await prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: { deck: { include: { enrollment: true } } },
  })
  if (!session || session.endedAt || session.deck.enrollment.studentId !== studentId) {
    return { error: 'Session not found or already closed', status: 404 as const }
  }

  const instance = await prisma.cardInstance.findUnique({
    where: { id: instanceId },
    include: { card: true },
  })
  if (!instance || instance.deckId !== session.deckId) {
    return { error: 'Card instance not found', status: 404 as const }
  }

  const correct = (instance.card.definitionL1 || instance.card.definitionL2 || '').trim()
  if (!correct) {
    return { error: 'This card has no definition to use as a question', status: 409 as const }
  }

  const deckCandidates = await prisma.cardInstance.findMany({
    where: { deckId: session.deckId, id: { not: instanceId } },
    take: 30,
    select: { card: { select: { definitionL1: true, definitionL2: true } } },
  })

  let candidates = deckCandidates
    .map((row) => row.card.definitionL1 || row.card.definitionL2 || '')
    .filter(Boolean)

  if (candidates.length < 3) {
    const globalCandidates = await prisma.card.findMany({
      where: { id: { not: instance.cardId } },
      take: 30,
      select: { definitionL1: true, definitionL2: true },
    })
    candidates = candidates.concat(
      globalCandidates.map((card) => card.definitionL1 || card.definitionL2 || '').filter(Boolean),
    )
  }

  return {
    instance,
    question: {
      prompt: instance.card.word,
      pos: instance.card.pos,
      options: buildChoiceOptions(correct, candidates, instanceId),
    } satisfies ChoiceQuestion,
  }
}

export async function getChoiceQuestion(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  instanceId: string,
): Promise<ChoiceQuestion | { error: string; status: number }> {
  const loaded = await loadQuestion(prisma, studentId, sessionId, instanceId)
  if ('error' in loaded) return loaded
  return loaded.question
}

export async function answerChoice(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  instanceId: string,
  answer: string,
  responseTimeMs: number | undefined,
  now: Date = new Date(),
): Promise<ChoiceAnswerResult | { error: string; status: number }> {
  const loaded = await loadQuestion(prisma, studentId, sessionId, instanceId)
  if ('error' in loaded) return loaded

  const expected = (loaded.instance.card.definitionL1 || loaded.instance.card.definitionL2 || '').trim()
  const correct = normalizeSpelling(answer) === normalizeSpelling(expected)
  const grade = await gradeCard(
    prisma,
    studentId,
    sessionId,
    instanceId,
    correct ? 3 : 1,
    responseTimeMs,
    now,
  )
  if ('error' in grade) return grade

  return { correct, expected, grade }
}
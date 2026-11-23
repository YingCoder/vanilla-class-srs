/**
 * Server-side spelling grading.
 *
 * The client only sends what the student typed; the server owns the expected
 * answer and the FSRS grade. This is the first objective question type and is
 * deliberately independent of the self-rated Again/Hard/Good/Easy buttons.
 */

import type { PrismaClient } from '@prisma/client'
import { gradeCard, type GradeResult } from './review.service'

/** Trim, ignore case and collapse internal whitespace ("ice  cream" → "ice cream"). */
export function normalizeSpelling(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Classic Levenshtein distance, capped for short vocabulary words. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]
      previous[j] = Math.min(
        previous[j] + 1, // deletion
        previous[j - 1] + 1, // insertion
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      )
      diagonal = above
    }
  }
  return previous[b.length]
}

export type SpellingVerdict = 'correct' | 'close' | 'wrong'

/**
 * Accept the headword and every teacher-configured variant. "Close" means one
 * edit away from an accepted form; it is still wrong for grading/rewards, but
 * gives the student a retry-friendly message instead of a red cross.
 */
export function judgeSpelling(answer: string, word: string, variants: string[] = []): SpellingVerdict {
  const typed = normalizeSpelling(answer)
  if (typed === '') return 'wrong'
  const accepted = [word, ...variants].map(normalizeSpelling).filter(Boolean)
  if (accepted.includes(typed)) return 'correct'
  if (accepted.some((candidate) => editDistance(typed, candidate) === 1)) return 'close'
  return 'wrong'
}

export interface SpellingAnswerResult {
  correct: boolean
  verdict: SpellingVerdict
  expected: string
  accepted: string[]
  grade: GradeResult
}

export async function answerSpelling(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  instanceId: string,
  answer: string,
  responseTimeMs: number | undefined,
  now: Date = new Date(),
): Promise<SpellingAnswerResult | { error: string; status: number }> {
  const session = await prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: { deck: { include: { enrollment: true } } },
  })
  if (!session || session.endedAt || session.deck.enrollment.studentId !== studentId) {
    return { error: 'Session not found or already closed', status: 404 }
  }

  const instance = await prisma.cardInstance.findUnique({
    where: { id: instanceId },
    include: { card: true },
  })
  if (!instance || instance.deckId !== session.deckId) {
    return { error: 'Card instance not found', status: 404 }
  }

  const verdict = judgeSpelling(answer, instance.card.word, instance.card.variants)
  const grade = await gradeCard(
    prisma,
    studentId,
    sessionId,
    instanceId,
    verdict === 'correct' ? 3 : 1,
    responseTimeMs,
    now,
  )
  if ('error' in grade) return grade

  return {
    correct: verdict === 'correct',
    verdict,
    expected: instance.card.word,
    accepted: [instance.card.word, ...instance.card.variants],
    grade,
  }
}
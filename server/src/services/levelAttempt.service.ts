/**
 * Level answer submission: server-authoritative judging, (sessionId,
 * submissionId) idempotency, per-question retry state machine and hints.
 * FSRS scheduling and level completion live at the bottom of this module.
 */

import type { PrismaClient } from '@prisma/client'
import { judgeSpelling, normalizeSpelling } from './spelling.service'
import {
  applyQuestionAttempt,
  pickExcludedOption,
  spellingHint,
  type QuestionAttemptProgress,
} from './levelRules'

export interface AnswerInput {
  questionId: string
  answer: string
  submissionId: string
  responseMs?: number
}

export interface AnswerResult {
  submissionId: string
  questionId: string
  correct: boolean
  verdict: 'correct' | 'close' | 'wrong'
  attemptNo: number
  firstAttempt: boolean
  retryAllowed: boolean
  revealAnswer: string | null
  feedback: string
  questionFinished: boolean
  progress: { completed: number; total: number }
  replayed?: boolean
}

export function judgeQuestionAnswer(
  question: { questionType: 'L2' | 'L3' | 'L5'; correctAnswer: string; acceptedAnswers: string[] },
  answer: string,
): { correct: boolean; verdict: 'correct' | 'close' | 'wrong' } {
  if (question.questionType === 'L5') {
    const verdict = judgeSpelling(answer, question.correctAnswer, question.acceptedAnswers)
    return { correct: verdict === 'correct', verdict }
  }
  const correct = normalizeSpelling(answer) === normalizeSpelling(question.correctAnswer)
  return { correct, verdict: correct ? 'correct' : 'wrong' }
}

function feedbackFor(verdict: 'correct' | 'close' | 'wrong', reveal: string | null) {
  if (verdict === 'correct') return '答对了！'
  if (verdict === 'close') return '很接近了，再试一次'
  if (reveal) return `正确答案是：${reveal}`
  return '再想想，还有机会'
}

async function loadSessionQuestion(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  questionId: string,
) {
  const question = await prisma.levelQuestion.findUnique({
    where: { id: questionId },
    include: { session: { include: { task: { include: { enrollment: true } } } } },
  })
  if (
    !question ||
    question.sessionId !== sessionId ||
    question.session.task.enrollment.studentId !== studentId
  ) {
    return null
  }
  return question
}

function progressOf(question: any): QuestionAttemptProgress {
  return {
    attemptsUsed: question.attemptsUsed,
    hintLevel: question.hintLevel,
    firstTryCorrect: question.firstTryCorrect,
    eventuallyCorrect: question.eventuallyCorrect,
    answerRevealed: question.answerRevealed,
  }
}

function replayResult(stored: any, question: any): AnswerResult {
  return {
    submissionId: stored.submissionId ?? '',
    questionId: stored.questionId ?? question.id,
    correct: stored.correct,
    verdict: stored.correct ? 'correct' : 'wrong',
    attemptNo: stored.attemptNo,
    firstAttempt: stored.attemptNo === 1,
    retryAllowed: !question.answerRevealed && question.attemptsUsed < 3,
    revealAnswer: question.answerRevealed ? question.correctAnswer : null,
    feedback: stored.correct
      ? '答对了！'
      : question.answerRevealed
        ? `正确答案是：${question.correctAnswer}`
        : '再想想，还有机会',
    questionFinished: question.answeredAt !== null,
    progress: { completed: question.session.questionCount, total: question.session.questionCount },
    replayed: true,
  }
}

export async function submitLevelAnswer(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  input: AnswerInput,
  now: Date = new Date(),
): Promise<AnswerResult | { error: string; status: number }> {
  const question = await loadSessionQuestion(prisma, studentId, sessionId, input.questionId)
  if (!question) return { error: 'Question not found', status: 404 }
  if (question.session.state !== 'IN_PROGRESS') return { error: 'Session already finished', status: 409 }

  const existing = await prisma.levelAnswer.findUnique({
    where: { sessionId_submissionId: { sessionId, submissionId: input.submissionId } },
  })
  if (existing) return replayResult(existing, question)

  if (question.answeredAt !== null || question.answerRevealed || question.attemptsUsed >= 3) {
    return { error: 'Question already finished', status: 409 }
  }

  const judgement = judgeQuestionAnswer(question as any, input.answer)

  try {
    return await prisma.$transaction(async (tx) => {
      const latest = await tx.levelQuestion.findUnique({
        where: { id: question.id },
        include: { session: true },
      })
      if (!latest || latest.answeredAt !== null) return { error: 'Question already finished', status: 409 as const }

      const outcome = applyQuestionAttempt(progressOf(latest), { correct: judgement.correct })
      const updated = await tx.levelQuestion.updateMany({
        where: { id: latest.id, attemptsUsed: latest.attemptsUsed, answerRevealed: false },
        data: {
          ...outcome.next,
          answeredAt: outcome.finished ? now : null,
        },
      })
      if (updated.count === 0) return { error: 'Question changed, retry', status: 409 as const }

      await tx.levelAnswer.create({
        data: {
          sessionId,
          questionId: latest.id,
          submissionId: input.submissionId,
          answer: input.answer,
          correct: judgement.correct,
          attemptNo: outcome.attemptNo,
          hintLevel: latest.hintLevel,
          responseMs: input.responseMs ?? null,
          submittedAt: now,
        },
      })
      await tx.levelSession.update({
        where: { id: sessionId },
        data: { sessionVersion: { increment: 1 } },
      })

      const answered = await tx.levelQuestion.count({
        where: { sessionId, answeredAt: { not: null } },
      })

      return {
        submissionId: input.submissionId,
        questionId: latest.id,
        correct: judgement.correct,
        verdict: judgement.verdict,
        attemptNo: outcome.attemptNo,
        firstAttempt: outcome.attemptNo === 1,
        retryAllowed: outcome.retryAllowed,
        revealAnswer: outcome.revealAnswer ? latest.correctAnswer : null,
        feedback: feedbackFor(judgement.verdict, outcome.revealAnswer ? latest.correctAnswer : null),
        questionFinished: outcome.finished,
        progress: { completed: answered, total: latest.session.questionCount },
      }
    })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const stored = await prisma.levelAnswer.findUnique({
        where: { sessionId_submissionId: { sessionId, submissionId: input.submissionId } },
      })
      if (stored) return replayResult(stored, question)
    }
    throw error
  }
}

export interface HintResult {
  questionId: string
  hintLevel: number
  hint: string | null
  excludedOption: string | null
}

export async function requestLevelHint(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
  questionId: string,
): Promise<HintResult | { error: string; status: number }> {
  const question = await loadSessionQuestion(prisma, studentId, sessionId, questionId)
  if (!question) return { error: 'Question not found', status: 404 }
  if (question.session.state !== 'IN_PROGRESS') return { error: 'Session already finished', status: 409 }
  if (question.answeredAt !== null) return { error: 'Question already finished', status: 409 }

  const nextLevel = Math.min(2, question.hintLevel + 1)
  const hint = question.questionType === 'L5' ? spellingHint(question.correctAnswer, nextLevel) : null
  const excludedOption =
    question.questionType === 'L5'
      ? null
      : pickExcludedOption(
          question.correctAnswer,
          Array.isArray(question.options) ? (question.options as string[]) : [],
          `${question.id}:${nextLevel}`,
        )

  if (nextLevel !== question.hintLevel) {
    await prisma.levelQuestion.update({
      where: { id: question.id },
      data: { hintLevel: nextLevel },
    })
  }
  return { questionId: question.id, hintLevel: nextLevel, hint, excludedOption }
}

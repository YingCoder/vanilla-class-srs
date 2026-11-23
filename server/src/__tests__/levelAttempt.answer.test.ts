import { describe, it, expect, vi } from 'vitest'
import {
  judgeQuestionAnswer,
  requestLevelHint,
  submitLevelAnswer,
} from '../services/levelAttempt.service'

const NOW = new Date('2026-11-23T02:00:00Z')

function question(overrides: any = {}) {
  return {
    id: 'q1',
    sessionId: 'session-1',
    taskWordId: 'word-1',
    questionType: 'L5',
    prompt: 'zh-apple',
    pos: null,
    options: null,
    correctAnswer: 'apple',
    acceptedAnswers: ['apple', 'appel'],
    sortOrder: 0,
    attemptsUsed: 0,
    hintLevel: 0,
    firstTryCorrect: false,
    eventuallyCorrect: false,
    answerRevealed: false,
    answeredAt: null,
    session: {
      id: 'session-1',
      state: 'IN_PROGRESS',
      questionCount: 1,
      task: { enrollment: { studentId: 'student-1' } },
    },
    ...overrides,
  }
}

function makePrisma(q = question()) {
  const prisma: any = {
    levelAnswer: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'answer-1' }),
    },
    levelQuestion: {
      findUnique: vi.fn().mockResolvedValue(q),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(1),
    },
    levelSession: {
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  }
  return prisma
}

describe('judgeQuestionAnswer', () => {
  it('accepts spelling variants and reports near misses', () => {
    expect(judgeQuestionAnswer(question() as any, 'APPLE').correct).toBe(true)
    expect(judgeQuestionAnswer(question() as any, 'aple')).toMatchObject({ correct: false, verdict: 'close' })
    expect(judgeQuestionAnswer(question() as any, 'banana')).toMatchObject({ correct: false, verdict: 'wrong' })
  })

  it('compares choice answers by normalized text', () => {
    const choice = question({ questionType: 'L2', correctAnswer: '颜色', acceptedAnswers: ['颜色'] })
    expect(judgeQuestionAnswer(choice as any, ' 颜色 ').correct).toBe(true)
  })
})

describe('submitLevelAnswer', () => {
  it('records a first-try correct attempt and finishes the question', async () => {
    const prisma = makePrisma()
    const result = await submitLevelAnswer(
      prisma,
      'student-1',
      'session-1',
      { questionId: 'q1', answer: 'apple', submissionId: 'sub-1', responseMs: 3200 },
      NOW,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result).toMatchObject({
      correct: true,
      attemptNo: 1,
      retryAllowed: false,
      revealAnswer: null,
      questionFinished: true,
    })
    expect(prisma.levelQuestion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'q1', attemptsUsed: 0 }),
        data: expect.objectContaining({ attemptsUsed: 1, firstTryCorrect: true, eventuallyCorrect: true }),
      }),
    )
  })

  it('allows two retries and reveals the answer on the third failure', async () => {
    const prisma = makePrisma(question({ attemptsUsed: 2 }))
    const result = await submitLevelAnswer(
      prisma,
      'student-1',
      'session-1',
      { questionId: 'q1', answer: 'banana', submissionId: 'sub-3' },
      NOW,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result).toMatchObject({
      correct: false,
      attemptNo: 3,
      retryAllowed: false,
      revealAnswer: 'apple',
      questionFinished: true,
    })
    expect(prisma.levelQuestion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ answerRevealed: true }) }),
    )
  })

  it('returns the stored result for a repeated submission id', async () => {
    const prisma = makePrisma()
    prisma.levelAnswer.findUnique.mockResolvedValue({
      id: 'answer-old', correct: true, attemptNo: 1, hintLevel: 0,
    })
    const result = await submitLevelAnswer(
      prisma,
      'student-1',
      'session-1',
      { questionId: 'q1', answer: 'apple', submissionId: 'sub-1' },
      NOW,
    )
    if ('error' in result) throw new Error(result.error)
    expect(result).toMatchObject({ correct: true, attemptNo: 1, replayed: true })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a question that already finished', async () => {
    const prisma = makePrisma(question({ attemptsUsed: 3, answerRevealed: true, eventuallyCorrect: true }))
    const result = await submitLevelAnswer(
      prisma,
      'student-1',
      'session-1',
      { questionId: 'q1', answer: 'apple', submissionId: 'sub-4' },
      NOW,
    )
    expect(result).toMatchObject({ status: 409 })
  })
})

describe('requestLevelHint', () => {
  it('reveals the first letter then half the word and records the hint level', async () => {
    const prisma = makePrisma()
    const first = await requestLevelHint(prisma, 'student-1', 'session-1', 'q1')
    if ('error' in first) throw new Error(first.error)
    expect(first).toMatchObject({ hintLevel: 1, hint: 'a____' })

    prisma.levelQuestion.findUnique.mockResolvedValue(question({ hintLevel: 1 }))
    const second = await requestLevelHint(prisma, 'student-1', 'session-1', 'q1')
    if ('error' in second) throw new Error(second.error)
    expect(second).toMatchObject({ hintLevel: 2, hint: 'app__' })
    expect(prisma.levelQuestion.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { hintLevel: 2 },
    })
  })

  it('excludes one wrong option for a choice question', async () => {
    const prisma = makePrisma(question({
      questionType: 'L2', correctAnswer: '颜色', acceptedAnswers: ['颜色'],
      options: ['颜色', '形状', '味道', '大小'],
    }))
    const hint = await requestLevelHint(prisma, 'student-1', 'session-1', 'q1')
    if ('error' in hint) throw new Error(hint.error)
    expect(hint.excludedOption).not.toBe('颜色')
    expect(hint.hintLevel).toBe(1)
  })
})

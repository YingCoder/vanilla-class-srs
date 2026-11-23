import { describe, it, expect, vi } from 'vitest'
import { startLevel, getLevelSession } from '../services/levelSession.service'

function taskWord(id: string, word: string, kind: 'NEW' | 'REVIEW') {
  return {
    id,
    taskId: 'task-1',
    cardInstanceId: `inst-${id}`,
    cardId: `card-${id}`,
    kind,
    sortOrder: Number(id.replace(/\D/g, '')) || 0,
    word,
    pos: 'n.',
    definitionL2: `en-${word}`,
    definitionL1: `zh-${word}`,
    variants: [],
    exampleSentence: null,
    scheduledAt: null,
  }
}

const words = [
  taskWord('w1', 'apple', 'NEW'),
  taskWord('w2', 'banana', 'NEW'),
  taskWord('w3', 'cat', 'NEW'),
  taskWord('w4', 'dog', 'NEW'),
  taskWord('r1', 'egg', 'REVIEW'),
]

function makePrisma() {
  const task = {
    id: 'task-1',
    enrollmentId: 'enrollment-1',
    studyDate: '2026-11-23',
    status: 'ACTIVE',
    version: 1,
    newWordTarget: 10,
    reviewTarget: 10,
    config: { levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'] },
    completedAt: null,
    words,
    sessions: [],
    enrollment: { studentId: 'student-1', student: { userId: 'user-1' }, deck: { id: 'deck-1', fsrsParams: {} } },
  }
  const prisma: any = {
    dailyStudyTask: { findUnique: vi.fn().mockResolvedValue(task) },
    levelSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: 'session-1',
        taskId: data.taskId,
        level: data.level,
        attemptNo: data.attemptNo,
        state: 'IN_PROGRESS',
        sessionVersion: 0,
        questionCount: data.questionCount,
        stars: 0,
        cleared: null,
        endedAt: null,
        questions: (data.questions?.create ?? []).map((question: any, index: number) => ({
          ...question,
          id: `q${index + 1}`,
          attemptsUsed: 0,
          hintLevel: 0,
          firstTryCorrect: false,
          eventuallyCorrect: false,
          answerRevealed: false,
          answeredAt: null,
        })),
        task,
      })),
    },
    levelQuestion: { findMany: vi.fn().mockResolvedValue([]) },
  }
  return prisma
}

describe('startLevel', () => {
  it('creates one L5 question per new word and hides the answer', async () => {
    const prisma = makePrisma()
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L5')
    if ('error' in view) throw new Error(view.error)

    expect(view.questions).toHaveLength(4)
    expect(view.questions[0]).toMatchObject({ questionType: 'L5', prompt: 'zh-apple' })
    expect(view.questions[0]).not.toHaveProperty('correctAnswer')
    expect(view.questions[0]).not.toHaveProperty('acceptedAnswers')
    expect(prisma.levelSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          level: 'L5',
          attemptNo: 1,
          questions: { create: expect.arrayContaining([expect.objectContaining({ sortOrder: 0 })]) },
        }),
      }),
    )
  })

  it('returns an in-progress session instead of creating another', async () => {
    const prisma = makePrisma()
    const task = await prisma.dailyStudyTask.findUnique()
    const openSession = {
      id: 'open-session',
      taskId: 'task-1',
      level: 'L5',
      attemptNo: 1,
      state: 'IN_PROGRESS',
      sessionVersion: 3,
      questionCount: 4,
      stars: 0,
      cleared: null,
      endedAt: null,
      questions: [],
      task: { ...task, words },
    }
    prisma.dailyStudyTask.findUnique.mockResolvedValue({ ...task, sessions: [openSession] })
    prisma.levelSession.findUnique.mockResolvedValue(openSession)
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L5')
    if ('error' in view) throw new Error(view.error)
    expect(view.sessionId).toBe('open-session')
    expect(prisma.levelSession.create).not.toHaveBeenCalled()
  })

  it('returns the L1 preview without questions', async () => {
    const prisma = makePrisma()
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L1')
    if ('error' in view) throw new Error(view.error)
    expect(view.questions).toHaveLength(0)
    expect(view.words).toHaveLength(4)
  })

  it('does not start L4 (audio is a recorded fallback)', async () => {
    const prisma = makePrisma()
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L4' as any)
    expect(view).toMatchObject({ status: 409 })
  })

  it('rejects a task owned by another student', async () => {
    const prisma = makePrisma()
    const task = await prisma.dailyStudyTask.findUnique()
    prisma.dailyStudyTask.findUnique.mockResolvedValue({
      ...task,
      enrollment: { ...task.enrollment, studentId: 'someone-else' },
    })
    const view = await startLevel(prisma, 'student-1', 'task-1', 'L5')
    expect(view).toEqual({ error: 'Task not found', status: 404 })
  })
})

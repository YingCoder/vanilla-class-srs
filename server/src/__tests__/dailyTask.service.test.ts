import { describe, it, expect, vi } from 'vitest'
import { getOrCreateDailyTask } from '../services/dailyTask.service'

const NOW = new Date('2026-11-23T02:00:00Z') // Shanghai 10:00

function instance(id: string, word: string, state: string, due = NOW) {
  return {
    id,
    cardId: `card-${id}`,
    state,
    due,
    createdAt: NOW,
    definitionL1: null,
    exampleSentence: null,
    card: {
      id: `card-${id}`,
      word,
      pos: 'n.',
      definitionL2: `en-${word}`,
      definitionL1: `zh-${word}`,
      variants: [],
      exampleSentence: `example ${word}`,
      cardSet: { isPersonal: false, assignments: [{ priority: 1 }] },
    },
  }
}

function makePrisma(existing: any = null) {
  const createdTask = {
    id: 'task-1',
    enrollmentId: 'enrollment-1',
    studyDate: '2026-11-23',
    status: 'ACTIVE',
    version: 1,
    newWordTarget: 2,
    reviewTarget: 2,
    config: { levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'], newWordsPerDay: 2, reviewsPerDay: 2 },
    createdAt: NOW,
    completedAt: null,
    words: [
      { kind: 'NEW', word: 'apple' },
      { kind: 'NEW', word: 'banana' },
      { kind: 'REVIEW', word: 'cat' },
    ],
    sessions: [],
  }
  return {
    enrollment: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-1',
        classId: 'class-1',
        archivedAt: null,
        deck: { id: 'deck-1', fsrsParams: { newCardsPerDay: 10 } },
        student: { userId: 'user-1' },
      }),
    },
    dailyStudyTask: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue(createdTask),
    },
    cardInstance: {
      findMany: vi.fn().mockImplementation(async ({ where }) => {
        if (where.state === 'NEW') return [instance('n1', 'apple', 'NEW'), instance('n2', 'banana', 'NEW')]
        return [instance('r1', 'cat', 'REVIEW')]
      }),
    },
  }
}

describe('getOrCreateDailyTask', () => {
  it('creates one task with frozen word snapshots', async () => {
    const prisma = makePrisma()
    const task = await getOrCreateDailyTask(prisma as any, 'student-1', 'enrollment-1', NOW)
    if ('error' in task) throw new Error(task.error)

    expect(task).toMatchObject({
      taskId: 'task-1',
      studyDate: '2026-11-23',
      newWordCount: 2,
      reviewWordCount: 1,
      status: 'ACTIVE',
    })
    expect(prisma.dailyStudyTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          words: {
            create: expect.arrayContaining([
              expect.objectContaining({ kind: 'NEW', word: 'apple', definitionL1: 'zh-apple' }),
              expect.objectContaining({ kind: 'REVIEW', word: 'cat' }),
            ]),
          },
        }),
      }),
    )
  })

  it('returns the existing task without creating another', async () => {
    const existing = {
      id: 'task-existing',
      enrollmentId: 'enrollment-1',
      studyDate: '2026-11-23',
      status: 'ACTIVE',
      version: 1,
      newWordTarget: 2,
      reviewTarget: 2,
      config: { levels: ['L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW'] },
      createdAt: NOW,
      completedAt: null,
      words: [{ kind: 'NEW', word: 'apple' }],
      sessions: [],
    }
    const prisma = makePrisma(existing)
    const task = await getOrCreateDailyTask(prisma as any, 'student-1', 'enrollment-1', NOW)
    if ('error' in task) throw new Error(task.error)
    expect(task.taskId).toBe('task-existing')
    expect(prisma.dailyStudyTask.create).not.toHaveBeenCalled()
  })

  it('rejects an enrollment that does not belong to the student', async () => {
    const prisma = makePrisma()
    prisma.enrollment.findUnique.mockResolvedValue({
      ...(await prisma.enrollment.findUnique()),
      studentId: 'someone-else',
    })
    const task = await getOrCreateDailyTask(prisma as any, 'student-1', 'enrollment-1', NOW)
    expect(task).toEqual({ error: 'Enrollment not found', status: 404 })
  })
})

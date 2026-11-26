/**
 * Level sessions: frozen questions per attempt, resume of in-progress sessions,
 * and no answer leakage — `correctAnswer`/`acceptedAnswers` never leave the
 * server before the question is revealed.
 */

import type { PrismaClient } from '@prisma/client'
import { lookupZhongkaoWord, type WordMnemonic } from '@vanilla-srs/shared/vocab'
import { buildChoiceOptions } from './choice.service'
import {
  questionKindForLevel,
  type LevelKind,
} from './levelRules'

const FALLBACK_ZH = ['形状', '味道', '大小', '重量', '方向', '声音', '时间', '地点']
const FALLBACK_EN = ['apple', 'water', 'book', 'time', 'people']

const sessionInclude = {
  task: {
    include: {
      enrollment: { include: { student: true, deck: true } },
      words: { orderBy: { sortOrder: 'asc' as const } },
      sessions: true,
    },
  },
  questions: { orderBy: { sortOrder: 'asc' as const } },
}

export interface PublicQuestion {
  id: string
  questionType: 'L2' | 'L3' | 'L5'
  prompt: string
  pos: string | null
  options: string[] | null
  sortOrder: number
  attemptsUsed: number
  hintLevel: number
  answerRevealed: boolean
  eventuallyCorrect: boolean
  answeredAt: Date | null
}

export interface LevelSessionView {
  sessionId: string
  taskId: string
  level: LevelKind
  attemptNo: number
  state: 'IN_PROGRESS' | 'COMPLETED'
  sessionVersion: number
  questionCount: number
  answeredCount: number
  stars: number
  cleared: boolean | null
  alreadyCleared: boolean
  words: {
    taskWordId: string
    word: string
    pos: string | null
    ipa: string | null
    definitionL1: string | null
    definitionL2: string | null
    exampleSentence: string | null
    mnemonic: WordMnemonic | null
  }[] | null
  questions: PublicQuestion[]
}

function publicQuestion(question: any): PublicQuestion {
  return {
    id: question.id,
    questionType: question.questionType,
    prompt: question.prompt,
    pos: question.pos,
    options: Array.isArray(question.options) ? (question.options as string[]) : null,
    sortOrder: question.sortOrder,
    attemptsUsed: question.attemptsUsed,
    hintLevel: question.hintLevel,
    answerRevealed: question.answerRevealed,
    eventuallyCorrect: question.eventuallyCorrect,
    answeredAt: question.answeredAt,
  }
}

function viewOf(session: any, alreadyCleared = false): LevelSessionView {
  const isL1 = session.level === 'L1'
  return {
    sessionId: session.id,
    taskId: session.taskId,
    level: session.level,
    attemptNo: session.attemptNo,
    state: session.state,
    sessionVersion: session.sessionVersion,
    questionCount: session.questionCount,
    answeredCount: session.questions.filter((question: any) => question.answeredAt).length,
    stars: session.stars,
    cleared: session.cleared,
    alreadyCleared,
    words: isL1
      ? session.task.words
          .filter((word: any) => word.kind === 'NEW')
          .map((word: any) => {
            const zhongkao = lookupZhongkaoWord(word.word)
            return {
              taskWordId: word.id,
              word: word.word,
              pos: word.pos,
              ipa: word.ipa ?? zhongkao?.ipa ?? null,
              definitionL1: word.definitionL1,
              definitionL2: word.definitionL2,
              exampleSentence: word.exampleSentence,
              mnemonic: (word.mnemonic as WordMnemonic | null | undefined) ?? zhongkao?.mnemonic ?? null,
            }
          })
      : null,
    questions: session.questions.map(publicQuestion),
  }
}

function buildQuestionData(
  task: any,
  level: LevelKind,
  attemptNo: number,
  word: any,
  wordIndex: number,
) {
  const kind = questionKindForLevel(level, wordIndex)
  if (!kind) return null
  const peers = task.words.map((peer: any) => ({
    word: peer.word,
    meaning: peer.definitionL1 ?? peer.definitionL2 ?? '',
  }))
  if (kind === 'L5') {
    return {
      taskWordId: word.id,
      questionType: 'L5',
      prompt: word.definitionL1 ?? word.definitionL2 ?? word.word,
      pos: word.pos,
      options: null,
      correctAnswer: word.word,
      acceptedAnswers: [word.word, ...(word.variants ?? [])],
      sortOrder: wordIndex,
    }
  }
  if (kind === 'L2') {
    const correct = word.definitionL1 ?? word.definitionL2 ?? ''
    const candidates = peers.filter((peer: any) => peer.word !== word.word).map((peer: any) => peer.meaning)
    return {
      taskWordId: word.id,
      questionType: 'L2',
      prompt: word.word,
      pos: word.pos,
      options: buildChoiceOptions(correct, [...candidates, ...FALLBACK_ZH], `${task.id}:${level}:${attemptNo}:${wordIndex}`),
      correctAnswer: correct,
      acceptedAnswers: [correct],
      sortOrder: wordIndex,
    }
  }
  const correct = word.word
  const candidates = peers.filter((peer: any) => peer.word !== word.word).map((peer: any) => peer.word)
  return {
    taskWordId: word.id,
    questionType: 'L3',
    prompt: word.definitionL1 ?? word.definitionL2 ?? word.word,
    pos: word.pos,
    options: buildChoiceOptions(correct, [...candidates, ...FALLBACK_EN], `${task.id}:${level}:${attemptNo}:${wordIndex}`),
    correctAnswer: correct,
    acceptedAnswers: [correct],
    sortOrder: wordIndex,
  }
}

export async function startLevel(
  prisma: PrismaClient,
  studentId: string,
  taskId: string,
  level: LevelKind,
  now: Date = new Date(),
): Promise<LevelSessionView | { error: string; status: number }> {
  void now
  if (level === ('L4' as LevelKind)) {
    return { error: 'L4 uses the listening-equivalent fallback', status: 409 }
  }
  const task = await prisma.dailyStudyTask.findUnique({
    where: { id: taskId },
    include: {
      enrollment: { include: { student: true, deck: true } },
      words: { orderBy: { sortOrder: 'asc' } },
      sessions: { orderBy: [{ level: 'asc' }, { attemptNo: 'desc' }] },
    },
  })
  if (!task || task.enrollment.studentId !== studentId) {
    return { error: 'Task not found', status: 404 }
  }

  const latest = task.sessions.find((session) => session.level === level) ?? null

  // Read-only path: a completed task still lets the student look back at a
  // cleared level (the completion summary links here).
  if (task.status !== 'ACTIVE') {
    if (latest?.state === 'COMPLETED' && latest.cleared) {
      const loaded = await prisma.levelSession.findUnique({
        where: { id: latest.id },
        include: sessionInclude,
      })
      return viewOf(loaded, true)
    }
    return { error: 'Task is not active', status: 409 }
  }

  const words = task.words.filter((word) => word.kind === (level === 'REVIEW' ? 'REVIEW' : 'NEW'))
  if (words.length === 0) return { error: 'No words for this level', status: 409 }

  if (latest?.state === 'IN_PROGRESS') {
    const loaded = await prisma.levelSession.findUnique({
      where: { id: latest.id },
      include: sessionInclude,
    })
    return viewOf(loaded)
  }
  if (latest?.state === 'COMPLETED' && latest.cleared) {
    const loaded = await prisma.levelSession.findUnique({
      where: { id: latest.id },
      include: sessionInclude,
    })
    return viewOf(loaded, true)
  }

  const attemptNo = (latest?.attemptNo ?? 0) + 1
  const questionData =
    level === 'L1'
      ? []
      : words
          .map((word, index) => buildQuestionData(task, level, attemptNo, word, index))
          .filter((question): question is NonNullable<typeof question> => question !== null)

  const created = await prisma.levelSession.create({
    data: {
      taskId,
      level,
      attemptNo,
      questionCount: questionData.length,
      questions: questionData.length > 0 ? { create: questionData as any } : undefined,
    },
    include: sessionInclude,
  })
  return viewOf(created)
}

export async function getLevelSession(
  prisma: PrismaClient,
  studentId: string,
  sessionId: string,
): Promise<LevelSessionView | { error: string; status: number }> {
  const session = await prisma.levelSession.findUnique({
    where: { id: sessionId },
    include: sessionInclude,
  })
  if (!session || session.task.enrollment.studentId !== studentId) {
    return { error: 'Session not found', status: 404 }
  }
  return viewOf(session)
}

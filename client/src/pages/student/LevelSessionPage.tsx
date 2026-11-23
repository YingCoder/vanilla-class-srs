import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'

interface PublicQuestion {
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
  answeredAt: string | null
}

interface PreviewWord {
  taskWordId: string
  word: string
  pos: string | null
  definitionL1: string | null
  definitionL2: string | null
  exampleSentence: string | null
}

interface LevelSessionView {
  sessionId: string
  taskId: string
  level: 'L1' | 'L2' | 'L3' | 'L5' | 'BOSS' | 'REVIEW'
  attemptNo: number
  state: 'IN_PROGRESS' | 'COMPLETED'
  questionCount: number
  answeredCount: number
  stars: number
  cleared: boolean | null
  alreadyCleared: boolean
  words: PreviewWord[] | null
  questions: PublicQuestion[]
}

interface AnswerResult {
  correct: boolean
  verdict: 'correct' | 'close' | 'wrong'
  attemptNo: number
  retryAllowed: boolean
  revealAnswer: string | null
  feedback: string
  questionFinished: boolean
  replayed?: boolean
}

interface HintResult {
  questionId: string
  hintLevel: number
  hint: string | null
  excludedOption: string | null
}

interface CompletionResult {
  cleared: boolean
  stars: number
  stats: {
    questionCount: number
    firstTryCorrect: number
    eventuallyCorrect: number
    firstTryAccuracy: number
    finalAccuracy: number
  }
  scheduledWords: number
  rewards: { xp: number; coins: number }
  weakWords: { taskWordId: string; word: string }[]
  task: { progress: { completed: boolean } }
  /** True when showing a stored, already-completed session (no live settle). */
  readOnly?: boolean
}

const LEVEL_LABEL: Record<LevelSessionView['level'], string> = {
  L1: '认识新词',
  L2: '英译中选择',
  L3: '中译英选择',
  L5: '拼写挑战',
  BOSS: 'Boss 关卡',
  REVIEW: '复习关卡',
}

const QUESTION_HINT: Record<PublicQuestion['questionType'], string> = {
  L2: '选择正确的中文释义',
  L3: '选择正确的英文单词',
  L5: '根据释义拼写单词',
}

function starsText(stars: number): string {
  if (stars <= 0) return '☆☆☆'
  return '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars))
}

type Phase = 'loading' | 'play' | 'completing' | 'summary' | 'error'

export default function LevelSessionPage() {
  const { id } = useParams<{ id: string }>()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [session, setSession] = useState<LevelSessionView | null>(null)
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<AnswerResult | null>(null)
  const [excludedOption, setExcludedOption] = useState<string | null>(null)
  const [spellingHint, setSpellingHint] = useState<string | null>(null)
  const [hintBusy, setHintBusy] = useState(false)
  const [result, setResult] = useState<CompletionResult | null>(null)
  const answerRef = useRef<HTMLInputElement>(null)
  const startedAtRef = useRef(0)
  const submittingRef = useRef(false)
  const loadedIdRef = useRef('')

  useEffect(() => {
    if (!id || loadedIdRef.current === id) return
    loadedIdRef.current = id
    api.get<LevelSessionView>(`/students/levels/${id}`)
      .then((view) => {
        setSession(view)
        // A finished session is read-only: jump straight to the summary-style view.
        if (view.state === 'COMPLETED') {
          setResult({
            cleared: view.cleared === true,
            stars: view.stars,
            stats: {
              questionCount: view.questionCount,
              firstTryCorrect: view.questions.filter((q) => q.eventuallyCorrect).length,
              eventuallyCorrect: view.questions.filter((q) => q.eventuallyCorrect).length,
              firstTryAccuracy: 0,
              finalAccuracy: 0,
            },
            scheduledWords: 0,
            rewards: { xp: 0, coins: 0 },
            weakWords: view.questions
              .filter((q) => !q.eventuallyCorrect)
              .map((q) => ({ taskWordId: q.id, word: q.prompt })),
            task: { progress: { completed: false } },
            readOnly: true,
          })
          setPhase('summary')
          return
        }
        // Resume at the first unfinished question.
        const firstOpen = view.questions.findIndex((question) => question.answeredAt === null)
        setIndex(firstOpen === -1 ? Math.max(0, view.questions.length - 1) : firstOpen)
        setPhase('play')
        startedAtRef.current = Date.now()
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '关卡加载失败')
        setPhase('error')
      })
  }, [id])

  const question = session?.questions[index] ?? null
  const isChoice = question !== null && question.questionType !== 'L5'
  const lastQuestion = session !== null && index >= session.questions.length - 1
  const questionLocked = feedback !== null && !feedback.retryAllowed

  const goNext = useCallback(() => {
    if (!session) return
    const nextIndex = session.questions.findIndex((item, position) => position > index && item.answeredAt === null)
    if (nextIndex !== -1) {
      setIndex(nextIndex)
      setAnswer('')
      setFeedback(null)
      setExcludedOption(null)
      setSpellingHint(null)
      startedAtRef.current = Date.now()
      return
    }
    // Everything is answered — settle the level.
    setPhase('completing')
    api.post<CompletionResult>(`/students/levels/${session.sessionId}/complete`)
      .then((completion) => {
        setResult(completion)
        setPhase('summary')
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '结算失败，请重试')
        setPhase('error')
      })
  }, [index, session])

  const submit = useCallback(async (value: string) => {
    if (!session || !question || submittingRef.current || questionLocked) return
    const trimmed = value.trim()
    if (!trimmed) return
    submittingRef.current = true
    setError('')
    try {
      const outcome = await api.post<AnswerResult>(`/students/levels/${session.sessionId}/answer`, {
        questionId: question.id,
        answer: trimmed,
        submissionId: `${session.sessionId}:${question.id}:${question.attemptsUsed + 1}`,
        responseMs: Math.max(1, Date.now() - startedAtRef.current),
      })
      setFeedback(outcome)
      // Keep the local session in sync with the server's question state.
      setSession((current) => {
        if (!current) return current
        const questions = current.questions.map((item) =>
          item.id === question.id
            ? {
                ...item,
                attemptsUsed: outcome.attemptNo,
                answeredAt: outcome.questionFinished ? new Date().toISOString() : item.answeredAt,
                eventuallyCorrect: item.eventuallyCorrect || outcome.correct,
                answerRevealed: item.answerRevealed || outcome.revealAnswer !== null,
              }
            : item,
        )
        return {
          ...current,
          questions,
          answeredCount: questions.filter((item) => item.answeredAt !== null).length,
        }
      })
      if (outcome.questionFinished && !lastQuestion) {
        // Wrong-and-finished still moves on; correct answers move on too.
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请重试')
    } finally {
      submittingRef.current = false
    }
  }, [session, question, questionLocked, lastQuestion])

  const requestHint = async () => {
    if (!session || !question || hintBusy || feedback !== null) return
    setHintBusy(true)
    try {
      const hint = await api.post<HintResult>(`/students/levels/${session.sessionId}/hint`, {
        questionId: question.id,
      })
      if (hint.excludedOption) setExcludedOption(hint.excludedOption)
      if (hint.hint) setSpellingHint(hint.hint)
      setSession((current) => {
        if (!current) return current
        return {
          ...current,
          questions: current.questions.map((item) =>
            item.id === question.id ? { ...item, hintLevel: hint.hintLevel } : item,
          ),
        }
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提示获取失败')
    } finally {
      setHintBusy(false)
    }
  }

  useEffect(() => {
    if (phase === 'play' && question && question.questionType === 'L5' && !questionLocked) {
      answerRef.current?.focus()
    }
  }, [phase, question, questionLocked])

  if (phase === 'loading' || !session) {
    if (phase === 'error') {
      return (
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>
          <Link className="btn btn-secondary" to="/student/task">返回今日任务</Link>
        </div>
      )
    }
    return <div className="loading-center"><div className="spinner" /></div>
  }

  if (phase === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>
        <Link className="btn btn-secondary" to="/student/task">返回今日任务</Link>
      </div>
    )
  }

  if (phase === 'completing') {
    return <div className="loading-center"><div className="spinner" /></div>
  }

  if (phase === 'summary' && result) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>{result.cleared ? '🎉' : '💪'}</div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, marginBottom: 4 }}>
          {LEVEL_LABEL[session.level]} · {result.cleared ? '通关！' : '未通关'}
          {result.readOnly && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginLeft: 8 }}>（已完成，回顾）</span>}
        </h1>
        <div style={{ fontSize: 'var(--text-2xl)', color: 'var(--color-warning)', marginBottom: 12 }}>
          {starsText(result.stars)}
        </div>
        <div className="card" style={{ textAlign: 'left', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span>首次答对</span>
            <strong>{result.stats.firstTryCorrect} / {result.stats.questionCount}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span>最终答对</span>
            <strong>{result.stats.eventuallyCorrect} / {result.stats.questionCount}</strong>
          </div>
          {result.scheduledWords > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>已安排复习</span>
              <strong>{result.scheduledWords} 个单词</strong>
            </div>
          )}
          {(result.rewards.xp > 0 || result.rewards.coins > 0) && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>本次奖励</span>
              <strong>+{result.rewards.xp} XP · +{result.rewards.coins} 金币</strong>
            </div>
          )}
        </div>
        {result.weakWords.length > 0 && (
          <div className="alert alert-warning" style={{ textAlign: 'left', marginBottom: 16 }}>
            还需巩固：{result.weakWords.map((word) => word.word).join('、')}
          </div>
        )}
        {result.task.progress.completed && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>🎉 今日任务全部完成！</div>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link className="btn btn-primary" to="/student/task">返回今日任务</Link>
          <Link className="btn btn-secondary" to="/student/rewards">查看成长</Link>
        </div>
      </div>
    )
  }

  // L1 preview: no questions, just read through the new words.
  if (session.level === 'L1') {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Link to="/student/task" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← 返回今日任务</Link>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>L1 · 认识新词</span>
        </div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, marginBottom: 4 }}>先认识一下今天的新词</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 20 }}>读完之后点击底部按钮完成本关。</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {(session.words ?? []).map((word, position) => (
            <div key={word.taskWordId} className="card">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>{position + 1}.</span>
                <span style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>{word.word}</span>
                {word.pos && <span style={{ color: 'var(--color-text-muted)' }}>{word.pos}</span>}
              </div>
              <div style={{ marginTop: 6 }}>{word.definitionL1 ?? word.definitionL2 ?? ''}</div>
              {word.definitionL1 && word.definitionL2 && (
                <div style={{ marginTop: 2, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{word.definitionL2}</div>
              )}
              {word.exampleSentence && (
                <div style={{ marginTop: 6, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                  {word.exampleSentence}
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
        <button
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
          onClick={() => {
            setPhase('completing')
            api.post<CompletionResult>(`/students/levels/${session.sessionId}/complete`)
              .then((completion) => { setResult(completion); setPhase('summary') })
              .catch((err) => {
                setError(err instanceof ApiError ? err.message : '结算失败，请重试')
                setPhase('play')
              })
          }}
        >
          我读完了 ✓
        </button>
      </div>
    )
  }

  if (!question) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
        <div className="alert alert-info" style={{ marginBottom: 16 }}>本关没有题目。</div>
        <Link className="btn btn-secondary" to="/student/task">返回今日任务</Link>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Link to="/student/task" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← 返回今日任务</Link>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {session.level} · {LEVEL_LABEL[session.level]} · {index + 1} / {session.questions.length}
        </span>
      </div>

      <div className="card" style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          {QUESTION_HINT[question.questionType]}
        </div>
        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, wordBreak: 'break-word' }}>{question.prompt}</div>
        {question.pos && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 4 }}>{question.pos}</div>
        )}
      </div>

      {isChoice && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(question.options ?? []).map((option) => {
            const excluded = excludedOption === option
            const revealed = feedback?.revealAnswer === option
            return (
              <button
                key={option}
                className="btn btn-secondary"
                style={{
                  width: '100%',
                  minHeight: 52,
                  justifyContent: 'flex-start',
                  fontSize: 'var(--text-base)',
                  opacity: excluded ? 0.4 : 1,
                  textDecoration: excluded ? 'line-through' : undefined,
                  background: revealed ? 'var(--color-success-bg, #D5F5E3)' : undefined,
                }}
                disabled={excluded || questionLocked}
                onClick={() => void submit(option)}
              >
                {option}
                {excluded && <span style={{ marginLeft: 8, fontSize: 'var(--text-sm)' }}>（已排除）</span>}
              </button>
            )
          })}
        </div>
      )}

      {!isChoice && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (questionLocked) {
              goNext()
              return
            }
            void submit(answer)
          }}
        >
          {spellingHint && (
            <div style={{ textAlign: 'center', fontSize: 'var(--text-2xl)', fontFamily: 'monospace', letterSpacing: 4, marginBottom: 12, color: 'var(--color-accent)' }}>
              {spellingHint}
            </div>
          )}
          <input
            ref={answerRef}
            className="input"
            style={{ width: '100%', minHeight: 52, fontSize: 'var(--text-lg)', textAlign: 'center', marginBottom: 12 }}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="输入单词拼写"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            disabled={questionLocked}
          />
          {!questionLocked && (
            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!answer.trim()}>
              提交
            </button>
          )}
        </form>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <button
          className="btn btn-secondary btn-sm"
          disabled={hintBusy || questionLocked || feedback !== null || question.hintLevel >= 2}
          onClick={() => void requestHint()}
        >
          {hintBusy ? '提示中…' : question.hintLevel >= 2 ? '提示已用完' : `💡 提示（剩 ${2 - question.hintLevel} 次）`}
        </button>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          第 {question.attemptsUsed + (feedback ? 0 : 1)} / 3 次尝试
        </span>
      </div>

      {error && <div className="alert alert-danger" style={{ marginTop: 12 }}>{error}</div>}

      {feedback && (
        <div style={{ marginTop: 16 }}>
          <div
            className={`alert ${feedback.correct ? 'alert-success' : feedback.verdict === 'close' ? 'alert-warning' : 'alert-danger'}`}
            style={{ marginBottom: 12 }}
          >
            {feedback.feedback}
            {feedback.retryAllowed && <span style={{ marginLeft: 8 }}>还可以再试 {3 - feedback.attemptNo} 次。</span>}
          </div>
          {!feedback.retryAllowed && (
            <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={goNext}>
              {lastQuestion ? '查看结算' : '下一题'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

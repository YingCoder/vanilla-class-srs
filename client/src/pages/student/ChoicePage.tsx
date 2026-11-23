import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useEnrollment } from '../../utils/enrollment'

interface SessionCard {
  instanceId: string
  word: string
}

interface StartResponse {
  sessionId: string
  cards: SessionCard[]
  emptyReason?: 'capped' | 'exhausted'
}

interface ChoiceQuestion {
  prompt: string
  pos: string | null
  options: string[]
}

interface ChoiceAnswer {
  correct: boolean
  expected: string
}

type Phase = 'loading' | 'quiz' | 'feedback' | 'done' | 'error'

export default function ChoicePage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [cards, setCards] = useState<SessionCard[]>([])
  const [index, setIndex] = useState(0)
  const [question, setQuestion] = useState<ChoiceQuestion | null>(null)
  const [questionLoading, setQuestionLoading] = useState(false)
  const [selected, setSelected] = useState('')
  const [feedback, setFeedback] = useState<ChoiceAnswer | null>(null)
  const [correctCount, setCorrectCount] = useState(0)
  const [emptyReason, setEmptyReason] = useState<StartResponse['emptyReason']>()
  const startedRef = useRef(false)
  const startedAtRef = useRef(0)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    api.post<StartResponse>('/students/review/start', { enrollmentId: active.enrollmentId })
      .then((data) => {
        setSessionId(data.sessionId)
        setCards(data.cards)
        setEmptyReason(data.emptyReason)
        setPhase(data.cards.length > 0 ? 'quiz' : 'done')
        startedAtRef.current = Date.now()
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '无法开始认词练习')
        setPhase('error')
      })
  }, [active])

  useEffect(() => {
    if (phase !== 'quiz' || !sessionId || !cards[index]) return
    let cancelled = false
    setQuestionLoading(true)
    setQuestion(null)
    api.get<ChoiceQuestion>(`/students/review/choice?sessionId=${sessionId}&instanceId=${cards[index].instanceId}`)
      .then((data) => {
        if (cancelled) return
        setQuestion(data)
        startedAtRef.current = Date.now()
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : '题目加载失败')
        setPhase('error')
      })
      .finally(() => {
        if (!cancelled) setQuestionLoading(false)
      })
    return () => { cancelled = true }
  }, [phase, sessionId, index, cards])

  const finish = useCallback(async () => {
    setPhase('done')
    if (!sessionId) return
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      await api.post('/students/review/finish', { sessionId, tz })
    } catch {
      // Answers are already scheduled; a failed settle must not trap the student.
    }
  }, [sessionId])

  const choose = async (option: string) => {
    if (submittingRef.current || phase !== 'quiz') return
    submittingRef.current = true
    setSelected(option)
    try {
      const result = await api.post<ChoiceAnswer>('/students/review/choice-answer', {
        sessionId,
        instanceId: cards[index].instanceId,
        answer: option,
        responseTimeMs: Math.max(1, Date.now() - startedAtRef.current),
      })
      setFeedback(result)
      if (result.correct) setCorrectCount((count) => count + 1)
      setPhase('feedback')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请重试')
    } finally {
      submittingRef.current = false
    }
  }

  const next = () => {
    if (index + 1 >= cards.length) { void finish(); return }
    setIndex((value) => value + 1)
    setSelected('')
    setFeedback(null)
    setPhase('quiz')
    startedAtRef.current = Date.now()
  }

  if (!active) { navigate('/student'); return null }

  if (phase === 'loading' || (phase === 'quiz' && questionLoading)) {
    return <div className="loading-center"><div className="spinner" /></div>
  }

  if (phase === 'error') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>
        <button className="btn btn-secondary" onClick={() => navigate('/student/review')}>返回复习</button>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 12 }}>认词练习结束</h1>
        {cards.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 20 }}>
            {emptyReason === 'capped' ? '今天的任务已完成，明天再来。' : '当前没有可练习的单词。'}
          </p>
        ) : (
          <p style={{ marginBottom: 20 }}>
            本次认词 <strong>{correctCount}</strong> / {cards.length} 个正确。
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link className="btn btn-primary" to="/student/review">返回复习</Link>
          <Link className="btn btn-secondary" to="/student/rewards">查看成长</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Link to="/student/review" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← 返回复习</Link>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{index + 1} / {cards.length}</span>
      </div>

      <div className="card" style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          选择正确的中文释义
        </div>
        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>{question?.prompt ?? cards[index]?.word}</div>
        {question?.pos && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 4 }}>{question.pos}</div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(question?.options ?? []).map((option) => {
          const isSelected = selected === option
          const isCorrect = feedback?.expected === option
          const background = phase === 'feedback'
            ? isCorrect
              ? 'var(--color-success-bg, #e8f7ee)'
              : isSelected
                ? 'var(--color-danger-bg, #fdecec)'
                : undefined
            : undefined
          return (
            <button
              key={option}
              className="btn btn-secondary"
              style={{
                width: '100%',
                minHeight: 52,
                justifyContent: 'flex-start',
                fontSize: 'var(--text-base)',
                background,
                borderColor: phase === 'feedback' && (isCorrect || isSelected) ? undefined : undefined,
              }}
              disabled={phase === 'feedback'}
              onClick={() => void choose(option)}
            >
              {option}
            </button>
          )
        })}
      </div>

      {error && <div className="alert alert-danger" style={{ marginTop: 12 }}>{error}</div>}

      {phase === 'feedback' && feedback && (
        <div style={{ marginTop: 16 }}>
          <div className={`alert ${feedback.correct ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: 12 }}>
            {feedback.correct ? '✓ 选对了' : <>这次选错了，正确释义：<strong>{feedback.expected}</strong></>}
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={next}>
            {index + 1 >= cards.length ? '完成练习' : '下一个'}
          </button>
        </div>
      )}
    </div>
  )
}
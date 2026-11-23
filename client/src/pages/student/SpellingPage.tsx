import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useEnrollment } from '../../utils/enrollment'

interface SessionCard {
  instanceId: string
  word: string
  pos: string | null
  definitionL2: string | null
  definitionL1: string | null
}

interface StartResponse {
  sessionId: string
  cards: SessionCard[]
  emptyReason?: 'capped' | 'exhausted'
}

interface AnswerResponse {
  correct: boolean
  verdict: 'correct' | 'close' | 'wrong'
  expected: string
  accepted: string[]
}

type Phase = 'loading' | 'quiz' | 'feedback' | 'done' | 'error'

export default function SpellingPage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [cards, setCards] = useState<SessionCard[]>([])
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<AnswerResponse | null>(null)
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
        setError(err instanceof ApiError ? err.message : '无法开始拼写练习')
        setPhase('error')
      })
  }, [active])

  const finish = useCallback(async () => {
    setPhase('done')
    if (!sessionId) return
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      await api.post('/students/review/finish', { sessionId, tz })
    } catch {
      // The answers are already scheduled; a failed settle must not trap the student.
    }
  }, [sessionId])

  const submit = async () => {
    if (submittingRef.current || !answer.trim() || phase !== 'quiz') return
    submittingRef.current = true
    try {
      const result = await api.post<AnswerResponse>('/students/review/answer', {
        sessionId,
        instanceId: cards[index].instanceId,
        answer,
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
    setAnswer('')
    setFeedback(null)
    setPhase('quiz')
    startedAtRef.current = Date.now()
  }

  if (!active) { navigate('/student'); return null }

  if (phase === 'loading') {
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
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 12 }}>拼写练习结束</h1>
        {cards.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 20 }}>
            {emptyReason === 'capped' ? '今天的任务已完成，明天再来。' : '当前没有可练习的单词。'}
          </p>
        ) : (
          <p style={{ marginBottom: 20 }}>
            本次拼写 <strong>{correctCount}</strong> / {cards.length} 个正确。
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link className="btn btn-primary" to="/student/review">返回复习</Link>
          <Link className="btn btn-secondary" to="/student/rewards">查看成长</Link>
        </div>
      </div>
    )
  }

  const card = cards[index]
  const prompt = card.definitionL1 || card.definitionL2 || '（这个词还没有释义）'
  const progress = `${index + 1} / ${cards.length}`

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Link to="/student/review" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← 返回复习</Link>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{progress}</span>
      </div>

      <div className="card" style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          根据中文写出英文单词
        </div>
        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 6 }}>{prompt}</div>
        {card.pos && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{card.pos}</div>}
      </div>

      {phase === 'quiz' && (
        <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <input
            className="form-input"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="在这里输入英文单词"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            style={{ fontSize: 20, textAlign: 'center', marginBottom: 12 }}
          />
          {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
          <button className="btn btn-primary btn-lg" type="submit" style={{ width: '100%' }} disabled={!answer.trim()}>
            提交
          </button>
        </form>
      )}

      {phase === 'feedback' && feedback && (
        <div>
          <div
            className={`alert ${feedback.correct ? 'alert-success' : 'alert-danger'}`}
            style={{ marginBottom: 12, fontSize: 'var(--text-base)' }}
          >
            {feedback.verdict === 'correct' && '✓ 拼写正确'}
            {feedback.verdict === 'close' && '很接近了，但还差一个字母。'}
            {feedback.verdict === 'wrong' && '这次没写对，记住正确拼写。'}
            {!feedback.correct && (
              <div style={{ marginTop: 8 }}>
                正确拼写：<strong style={{ fontFamily: 'monospace' }}>{feedback.expected}</strong>
              </div>
            )}
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={next}>
            {index + 1 >= cards.length ? '完成练习' : '下一个'}
          </button>
        </div>
      )}
    </div>
  )
}
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../utils/api'
import { useEnrollment } from '../../utils/enrollment'
import { speakWord } from '../../utils/audio'
import MnemonicCardBlock from '../../components/MnemonicCardBlock'

interface ReviewCard {
  instanceId: string
  word: string
  ipa: string | null
  definitionL1: string | null
  definitionL2: string | null
}

interface SpellingRes {
  correct: boolean
  verdict: 'correct' | 'close' | 'wrong'
  expected: string
}

export default function SpellingPage() {
  const { active } = useEnrollment()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [idx, setIdx] = useState(0)
  const [typed, setTyped] = useState('')
  const [res, setRes] = useState<SpellingRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    api
      .post<{ sessionId: string; cards: ReviewCard[] }>('/students/review/start', {
        enrollmentId: active.enrollmentId,
      })
      .then((d) => {
        if (cancelled) return
        setSessionId(d.sessionId)
        setCards(d.cards)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [active])

  const card = cards[idx] ?? null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionId || !card || !typed.trim() || submitting) return
    setSubmitting(true)
    try {
      const r = await api.post<SpellingRes>('/students/review/answer', {
        sessionId,
        instanceId: card.instanceId,
        answer: typed.trim(),
      })
      setRes(r)
    } finally {
      setSubmitting(false)
    }
  }

  const next = () => {
    setRes(null)
    setTyped('')
    if (idx + 1 < cards.length) setIdx((i) => i + 1)
    else {
      if (sessionId) void api.post('/students/review/finish', { sessionId }).catch(() => undefined)
      setCards([])
    }
  }

  if (!active) return <Link to="/student" className="camp-btn camp-btn-berry">请先选班</Link>
  if (loading) return <div className="camp-hero-card"><p>正在载入拼写词单...</p></div>
  if (!card) {
    return (
      <div className="camp-hero-card" style={{ justifyContent: 'center', gap: 12 }}>
        <h2>拼写特训结束</h2>
        <Link to="/student/task" className="camp-btn camp-btn-mint">返回特训</Link>
      </div>
    )
  }

  return (
    <article className="camp-hero-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="badge badge-blue">拼写特训 {idx + 1}/{cards.length}</span>
        <button type="button" className="candy-pill" onClick={() => speakWord(card.word)}>🔊 听发音拼写</button>
      </div>

      <div>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 700 }}>
          根据中文释义写出英文单词{card.ipa ? ` · ${card.ipa}` : ''}
        </div>
        <h1 className="camp-word-title" style={{ fontSize: 28, marginTop: 4 }}>
          {card.definitionL1 || card.definitionL2}
        </h1>
      </div>

      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', gap: 8 }}>
        <input
          className="form-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="点击输入英文单词..."
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          disabled={Boolean(res)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="camp-btn camp-btn-berry" disabled={submitting || Boolean(res)}>
          核对
        </button>
      </form>

      {res && (
        <>
          <div className={`alert ${res.correct ? 'alert-success' : 'alert-warning'}`}>
            {res.correct
              ? `拼写全对：${res.expected}`
              : res.verdict === 'close'
                ? `很接近了！标准拼写是：${res.expected}`
                : `正确拼写是：${res.expected}`}
          </div>
          {!res.correct && <MnemonicCardBlock word={res.expected} rescueTitle="拆词防忘" compact />}
          <button type="button" className="camp-btn camp-btn-mint" onClick={next}>下一题</button>
        </>
      )}
    </article>
  )
}

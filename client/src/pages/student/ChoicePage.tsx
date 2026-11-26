import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../utils/api'
import { useEnrollment } from '../../utils/enrollment'
import { speakWord } from '../../utils/audio'
import MnemonicCardBlock from '../../components/MnemonicCardBlock'

interface ReviewCard {
  instanceId: string
  word: string
  pos: string | null
  ipa: string | null
}

interface ChoiceQuestion {
  prompt: string
  pos: string | null
  options: string[]
}

interface ChoiceResult {
  correct: boolean
  expected: string
}

export default function ChoicePage() {
  const { active } = useEnrollment()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [idx, setIdx] = useState(0)
  const [question, setQuestion] = useState<ChoiceQuestion | null>(null)
  const [result, setResult] = useState<ChoiceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [answering, setAnswering] = useState(false)

  const loadQuestion = useCallback(async (sid: string, card: ReviewCard) => {
    setQuestion(null)
    setResult(null)
    try {
      const q = await api.get<ChoiceQuestion>(
        `/students/review/choice?sessionId=${sid}&instanceId=${card.instanceId}`,
      )
      setQuestion(q)
    } catch {
      setQuestion(null)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    api
      .post<{ sessionId: string; cards: ReviewCard[] }>('/students/review/start', {
        enrollmentId: active.enrollmentId,
      })
      .then((res) => {
        if (cancelled) return
        setSessionId(res.sessionId)
        setCards(res.cards)
        setIdx(0)
        if (res.cards[0]) void loadQuestion(res.sessionId, res.cards[0])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [active, loadQuestion])

  const card = cards[idx] ?? null

  const pickOption = async (opt: string) => {
    if (!sessionId || !card || answering || result) return
    setAnswering(true)
    try {
      const res = await api.post<ChoiceResult>('/students/review/choice-answer', {
        sessionId,
        instanceId: card.instanceId,
        answer: opt,
      })
      setResult(res)
    } finally {
      setAnswering(false)
    }
  }

  const goNext = () => {
    if (!sessionId) return
    if (idx + 1 < cards.length) {
      const next = idx + 1
      setIdx(next)
      void loadQuestion(sessionId, cards[next])
    } else {
      void api.post('/students/review/finish', { sessionId }).catch(() => undefined)
      setCards([])
    }
  }

  if (!active) return <Link to="/student" className="camp-btn camp-btn-berry">请先选班</Link>
  if (loading) return <div className="camp-hero-card"><p>正在准备四选一题组...</p></div>
  if (!card || !question) {
    return (
      <div className="camp-hero-card" style={{ justifyContent: 'center', gap: 12 }}>
        <h2>本轮四选一完成</h2>
        <Link to="/student/task" className="camp-btn camp-btn-mint">返回特训</Link>
      </div>
    )
  }

  return (
    <article className="camp-hero-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="badge badge-blue">极速选义 {idx + 1}/{cards.length}</span>
        <button type="button" className="candy-pill" onClick={() => speakWord(card.word)}>🔊 读音</button>
      </div>

      <div>
        <h1 className="camp-word-title">{question.prompt}</h1>
        {card.ipa && <div className="camp-ipa">{card.ipa}</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {question.options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={answering || Boolean(result)}
            className={`camp-btn ${result ? (opt === result.expected ? 'camp-btn-mint' : '') : ''}`}
            style={{ justifyContent: 'flex-start', textAlign: 'left' }}
            onClick={() => void pickOption(opt)}
          >
            {opt}
          </button>
        ))}
      </div>

      {result && (
        <>
          <div className={`alert ${result.correct ? 'alert-success' : 'alert-warning'}`}>
            {result.correct ? '答对啦！记忆稳固 +1' : `正确释义：${result.expected}（再看邪修记一次）`}
          </div>
          {!result.correct && <MnemonicCardBlock word={card.word} rescueTitle="邪修急救" compact />}
          <button type="button" className="camp-btn camp-btn-berry" onClick={goNext}>下一题</button>
        </>
      )}
    </article>
  )
}

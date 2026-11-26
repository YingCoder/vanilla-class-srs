import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { WordMnemonic } from '@vanilla-srs/shared/vocab'
import { api } from '../../utils/api'
import { playSfx, speakWord } from '../../utils/audio'
import { useGame, type RewardFeedback } from '../../components/GameContext'
import MnemonicCardBlock from '../../components/MnemonicCardBlock'
import ShareCardModal from '../../components/ShareCardModal'

interface PublicQuestion {
  id: string
  questionType: 'L2' | 'L3' | 'L5'
  prompt: string
  pos: string | null
  options: string[] | null
  sortOrder: number
  attemptsUsed: number
  answerRevealed: boolean
  eventuallyCorrect: boolean
  answeredAt: string | null
}

interface LevelSessionView {
  sessionId: string
  level: string
  state: 'IN_PROGRESS' | 'COMPLETED'
  questionCount: number
  answeredCount: number
  stars: number
  cleared: boolean | null
  words: Array<{
    taskWordId: string
    word: string
    pos: string | null
    ipa?: string | null
    definitionL1: string | null
    definitionL2: string | null
    exampleSentence: string | null
    mnemonic?: WordMnemonic | null
  }> | null
  questions: PublicQuestion[]
}

interface AnswerResponse {
  correct: boolean
  verdict: 'correct' | 'close' | 'wrong'
  revealAnswer: string | null
  feedback: string
  questionFinished: boolean
}

interface CompleteResponse {
  cleared: boolean
  stars: number
  weakWords?: Array<{ taskWordId: string; word: string }>
  gameReward?: RewardFeedback
  tomorrowDueCount?: number
  upgradedCards?: Array<{ word: string; fromRarity: string | null; toRarity: string }>
}

export default function LevelSessionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { summary, applyRewardFeedback } = useGame()
  const [session, setSession] = useState<LevelSessionView | null>(null)
  const [qIdx, setQIdx] = useState(0)
  const [l1Idx, setL1Idx] = useState(0)
  const [spellText, setSpellText] = useState('')
  const [feedback, setFeedback] = useState<AnswerResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [completionInfo, setCompletionInfo] = useState<CompleteResponse | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Day is carried from the adventure map so the world wrapper stays on the
  // selected island; server grading and FSRS remain unchanged.

  const loadSession = useCallback(async () => {
    if (!id) return
    try {
      const data = await api.get<LevelSessionView>(`/students/levels/${id}`)
      setSession(data)
      const nextUnanswered = data.questions.findIndex((q) => !q.answeredAt)
      setQIdx(nextUnanswered >= 0 ? nextUnanswered : 0)
    } catch (err: any) {
      setError(err.message || '加载关卡失败')
    }
  }, [id])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const submitAnswer = async (q: PublicQuestion, answer: string) => {
    if (!id || !answer.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const submissionId = `${q.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const res = await api.post<AnswerResponse>(`/students/levels/${id}/answer`, {
        questionId: q.id,
        answer: answer.trim(),
        submissionId,
      })
      setFeedback(res)
      if (res.correct) {
        playSfx('xp')
        window.setTimeout(() => {
          setFeedback(null)
          setSpellText('')
          if (session && qIdx + 1 < session.questions.length) {
            setQIdx((i) => i + 1)
          } else {
            void handleComplete()
          }
        }, 700)
      } else {
        playSfx('wrong')
      }
    } catch (err: any) {
      setError(err.message || '提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleComplete = async () => {
    if (!id || submitting) return
    setSubmitting(true)
    try {
      const res = await api.post<CompleteResponse>(`/students/levels/${id}/complete`, {})
      setCompletionInfo(res)
      if (res.gameReward) {
        applyRewardFeedback(res.gameReward)
      }
      await loadSession()
    } catch (err: any) {
      setError(err.message || '结算失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !session) {
    return (
      <div className="camp-hero-card">
        <div className="alert alert-danger">{error}</div>
        <button type="button" className="camp-btn camp-btn-ghost" onClick={() => navigate('/student/task')}>返回特训</button>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="camp-hero-card" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <p style={{ fontWeight: 800 }}>加载关卡中...</p>
      </div>
    )
  }

  if (session.state === 'COMPLETED' || completionInfo) {
    const reward = completionInfo?.gameReward
    const weakWords = completionInfo?.weakWords ?? []
    const tomorrowN = completionInfo?.tomorrowDueCount ?? summary?.tomorrowDueCount ?? 0

    return (
      <>
        <div className="camp-hero-card" style={{ justifyContent: 'center', gap: 10 }}>
          <span className="badge badge-green">关卡结算 · {session.level}</span>
          <h1 className="camp-word-title" style={{ fontSize: 28 }}>
            {session.cleared ? `据点灯亮起 ${'★'.repeat(session.stars)}` : '雾还没散，可以稍后再来。'}
          </h1>
          <div className="world-end-banner">今天到这里也有完整收获，回营地看看吧。</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {reward
              ? `本次获得 +${reward.totalAwardedXp} XP · 今日 ${reward.dailyXp}/${reward.dailyCap} XP`
              : '已完成本关挑战'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, textAlign: 'center' }}>
            <div className="camp-def-box" style={{ padding: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>双环状态</div>
              <strong style={{ fontSize: 13 }}>{summary?.today.rings.ringsClosed ? '✅ 已合拢' : '进行中'}</strong>
            </div>
            <div className="camp-def-box" style={{ padding: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>连续天数</div>
              <strong style={{ fontSize: 13 }}>🔥 {summary?.profile.streakDays ?? 0} 天</strong>
            </div>
            <div className="camp-def-box" style={{ padding: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>明日到期</div>
              <strong style={{ fontSize: 13 }}>{tomorrowN} 张</strong>
            </div>
          </div>

          {(completionInfo?.upgradedCards?.length ?? 0) > 0 && (
            <div className="camp-def-box" style={{ fontSize: 12, padding: 8 }}>
              <strong>今日升级卡牌：</strong>
              {completionInfo!.upgradedCards!.slice(0, 4).map((c) => `${c.word}→${c.toRarity}`).join(' · ')}
            </div>
          )}

          {weakWords.length > 0 && (
            <Link to="/student/review?mode=weak-boss" className="camp-btn camp-btn-sticky">
              ⚔️ 去会雾兽（{weakWords.length} 词）
            </Link>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button type="button" className="camp-btn camp-btn-berry" onClick={() => setShareOpen(true)}>
              战报分享卡
            </button>
            <button type="button" className="camp-btn camp-btn-mint" onClick={() => navigate('/student/task')}>
              回营地，今天到这里
            </button>
          </div>
        </div>
        <ShareCardModal open={shareOpen} onClose={() => setShareOpen(false)} />
      </>
    )
  }

  // L1 Study Cards Mode
  if (session.level === 'L1' && session.words) {
    const word = session.words[l1Idx]
    if (!word) {
      return (
        <div className="camp-hero-card">
          <h2>今日暂无新词</h2>
          <button type="button" className="camp-btn camp-btn-mint" onClick={() => void handleComplete()}>完成 L1</button>
        </div>
      )
    }
    return (
      <>
        <article className="camp-hero-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="badge badge-blue">L1 邂逅 · {l1Idx + 1}/{session.words.length}</span>
            <button type="button" className="candy-pill" onClick={() => speakWord(word.word)}>🔊 读音</button>
          </div>
          <div>
            <h1 className="camp-word-title">{word.word}</h1>
            {word.ipa && <div className="camp-ipa">{word.ipa}</div>}
          </div>
          <div className="camp-def-box">
            <div className="camp-def-zh">{word.definitionL1 || word.definitionL2}</div>
            {word.exampleSentence && <div className="camp-def-en">{word.exampleSentence}</div>}
          </div>
          <MnemonicCardBlock word={word.word} mnemonic={word.mnemonic} compact />
        </article>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          <button
            type="button"
            className="camp-btn camp-btn-ghost"
            disabled={l1Idx === 0}
            onClick={() => setL1Idx((i) => Math.max(0, i - 1))}
          >
            上一词
          </button>
          {l1Idx + 1 < session.words.length ? (
            <button type="button" className="camp-btn camp-btn-mint" onClick={() => setL1Idx((i) => i + 1)}>
              记住了，下一词
            </button>
          ) : (
            <button type="button" className="camp-btn camp-btn-berry" disabled={submitting} onClick={() => void handleComplete()}>
              新词浏览完成，点亮 L1！
            </button>
          )}
        </div>
      </>
    )
  }

  const q = session.questions[qIdx]
  if (!q) {
    return (
      <div className="camp-hero-card">
        <button type="button" className="camp-btn camp-btn-mint" onClick={() => void handleComplete()}>结算关卡</button>
      </div>
    )
  }

  const rescueWord = q.questionType === 'L2' ? q.prompt : (feedback?.revealAnswer ?? null)

  return (
    <article className="camp-hero-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="badge badge-blue">{session.level} 第 {qIdx + 1}/{session.questions.length} 题</span>
        {q.questionType === 'L2' && (
          <button type="button" className="candy-pill" onClick={() => speakWord(q.prompt)}>🔊 听词</button>
        )}
      </div>

      <div>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 700 }}>
          {q.questionType === 'L5' ? '念出正确拼写，解开封印' : q.questionType === 'L2' ? '辨认它的意思' : '辨认它的名字'}
        </div>
        <h1 className="camp-word-title" style={{ marginTop: 4 }}>{q.prompt}</h1>
      </div>

      {q.questionType === 'L5' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            value={spellText}
            onChange={(e) => setSpellText(e.target.value)}
            placeholder="输入英文拼写..."
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Enter') void submitAnswer(q, spellText) }}
          />
          <button type="button" className="camp-btn camp-btn-berry" disabled={submitting} onClick={() => void submitAnswer(q, spellText)}>
            核对
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(q.options ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={submitting || Boolean(feedback?.questionFinished)}
              className="camp-btn"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => void submitAnswer(q, opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {feedback && (
        <div className={`alert ${feedback.correct ? 'alert-success' : 'alert-warning'}`}>
          <strong>{feedback.feedback}</strong>
        </div>
      )}

      {feedback && !feedback.correct && rescueWord && (
        <MnemonicCardBlock word={rescueWord} rescueTitle="词灵秘语" compact />
      )}

      {feedback?.questionFinished && !feedback.correct && (
        <button
          type="button"
          className="camp-btn camp-btn-mint"
          onClick={() => {
            setFeedback(null)
            setSpellText('')
            if (qIdx + 1 < session.questions.length) setQIdx((i) => i + 1)
            else void handleComplete()
          }}
        >
          {qIdx + 1 < session.questions.length ? '继续下一题' : '完成结算'}
        </button>
      )}
    </article>
  )
}

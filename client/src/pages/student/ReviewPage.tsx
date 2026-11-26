import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { FSRSState } from '@vanilla-srs/shared/fsrs'
import { buildEbbinghausSnapshot } from '@vanilla-srs/shared/ebbinghaus'
import type { WordMnemonic } from '@vanilla-srs/shared/vocab'
import { api } from '../../utils/api'
import { trackAnalyticsEvent } from '../../utils/analytics'
import { useEnrollment } from '../../utils/enrollment'
import { playSfx, speakWord } from '../../utils/audio'
import { useGame, type RewardFeedback } from '../../components/GameContext'
import EbbinghausStrip from '../../components/EbbinghausStrip'
import MnemonicCardBlock from '../../components/MnemonicCardBlock'
import ShareCardModal from '../../components/ShareCardModal'
import WordSpirit from '../../components/WordSpirit'

interface SessionCard {
  instanceId: string
  cardId: string
  word: string
  pos: string | null
  ipa: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null
  mnemonic: WordMnemonic | null
  state: FSRSState
  due: string
  stability: number
  difficulty: number
  lapses: number
  reps: number
  bestStage?: number | null
  lastReview?: string | null
}

interface StartResponse {
  sessionId: string
  cards: SessionCard[]
  emptyReason?: 'capped' | 'exhausted'
  resumed?: boolean
  bossMaxHp?: number
}

interface GradeResponse {
  requeue?: boolean
  upgradedCard?: { word: string; fromRarity: string | null; toRarity: string } | null
  reward?: RewardFeedback
}

interface FinishResponse {
  tomorrowDueCount?: number
  restudyReward?: RewardFeedback | null
}

export default function ReviewPage() {
  const { active } = useEnrollment()
  const { summary, applyRewardFeedback, refreshSummary } = useGame()
  const [searchParams] = useSearchParams()
  const isWeakBossMode = searchParams.get('mode') === 'weak-boss'
  const bypassFromQuery = searchParams.get('bypass') === '1'

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [weakRescueOpen] = useState(() => searchParams.get('rescue') === '1')
  const [cards, setCards] = useState<SessionCard[]>([])
  const [idx, setIdx] = useState(0)
  const [bossHp, setBossHp] = useState(0)
  const [bossMaxHp, setBossMaxHp] = useState(0)
  const [showMeaning, setShowMeaning] = useState(false)
  const [showSticky, setShowSticky] = useState(false)
  const [fogGrade, setFogGrade] = useState<1 | 2 | 3 | 4 | null>(null)
  const [awaitingNext, setAwaitingNext] = useState(false)
  const advancingRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState(false)
  const [emptyReason, setEmptyReason] = useState<'capped' | 'exhausted' | null>(null)
  const [finished, setFinished] = useState(false)
  const [isWeakRestudy, setIsWeakRestudy] = useState(false)
  const [weakIds, setWeakIds] = useState<string[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('wordcamp:weak-rescue') || '[]') as string[] } catch { return [] }
  })
  const [reviewedCount, setReviewedCount] = useState(0)
  const [againCount, setAgainCount] = useState(0)
  const [xpEarned, setXpEarned] = useState(0)
  const [upgradedCards, setUpgradedCards] = useState<Array<{ word: string; fromRarity: string | null; toRarity: string }>>([])
  const [earnedBadges, setEarnedBadges] = useState<Array<{ key: string; name: string; icon: string }>>([])
  const [tomorrowDueCount, setTomorrowDueCount] = useState<number | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const swipeX = useRef(0)
  const turnSeq = useRef(1)
  const currentSubmissionId = useRef<string | null>(null)
  const cardShownAtRef = useRef<number>(Date.now())

  const resetRoundStats = () => {
    setReviewedCount(0)
    setAgainCount(0)
    setWeakIds([])
    setXpEarned(0)
    setUpgradedCards([])
    setEarnedBadges([])
    setTomorrowDueCount(null)
    currentSubmissionId.current = null
    setFogGrade(null)
    setAwaitingNext(false)
    setShowMeaning(false)
    setShowSticky(false)
    setIsWeakRestudy(false)
  }

  const startReview = useCallback(async (bypassNewCardCap = false) => {
    if (!active) return
    setLoading(true)
    setError(null)
    setFinished(false)
    setIsWeakRestudy(false)
    resetRoundStats()

    try {
      if (isWeakBossMode) {
        const res = await api.post<StartResponse>('/students/game/weak-boss/start', {
          enrollmentId: active.enrollmentId,
        })
        trackAnalyticsEvent(
          'boss_start',
          { sessionId: res.sessionId, cardCount: res.cards.length },
          { enrollmentId: active.enrollmentId },
        )
        setSessionId(res.sessionId)
        setCards(res.cards)
        setIdx(0)
        setBossMaxHp(res.bossMaxHp ?? res.cards.length)
        setBossHp(res.bossMaxHp ?? res.cards.length)
        setEmptyReason(res.cards.length === 0 ? 'exhausted' : null)
      } else {
        const effectiveBypass = bypassNewCardCap || bypassFromQuery
        const res = await api.post<StartResponse>('/students/review/start', {
          enrollmentId: active.enrollmentId,
          bypassNewCardCap: effectiveBypass,
        })
        trackAnalyticsEvent(
          'review_start',
          {
            sessionId: res.sessionId,
            cardCount: res.cards.length,
            bypassNewCardCap: effectiveBypass,
            resumed: Boolean(res.resumed),
          },
          { enrollmentId: active.enrollmentId },
        )
        setSessionId(res.sessionId)
        setCards(res.cards)
        setIdx(0)
        setEmptyReason(res.cards.length === 0 ? (res.emptyReason ?? 'exhausted') : null)
      }
    } catch (err: any) {
      setError(err.message || '无法开启艾斯复习队列')
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [active, isWeakBossMode, bypassFromQuery])

  useEffect(() => {
    void startReview(false)
  }, [startReview])

  const card = cards[idx] ?? null

  useEffect(() => {
    if (sessionId && card) {
      currentSubmissionId.current = `${sessionId}:${card.instanceId}:${turnSeq.current++}`
      cardShownAtRef.current = Date.now()
    }
  }, [sessionId, card?.instanceId, idx])

  const handleGrade = async (grade: 1 | 2 | 3 | 4) => {
    if (!sessionId || !card || grading || awaitingNext || advancingRef.current) return
    advancingRef.current = true
    setGrading(true)
    setError(null)
    const submissionId = currentSubmissionId.current ?? `${sessionId}:${card.instanceId}:${turnSeq.current}`
    currentSubmissionId.current = submissionId
    const durationMs = Math.max(0, Math.min(300000, Date.now() - cardShownAtRef.current))

    try {
      const res = await api.post<GradeResponse>('/students/review/grade', {
        sessionId,
        instanceId: card.instanceId,
        grade,
        submissionId,
        durationMs,
      })
      trackAnalyticsEvent(
        'grade_submit',
        {
          sessionId,
          instanceId: card.instanceId,
          grade,
          durationMs,
          isWeakBoss: isWeakBossMode,
        },
        { enrollmentId: active?.enrollmentId },
      )

      setReviewedCount((n) => n + 1)
      if (grade === 1) {
        setAgainCount((n) => n + 1)
        setWeakIds((prev) => {
          const next = prev.includes(card.instanceId) ? prev : [...prev, card.instanceId]
          try { sessionStorage.setItem('wordcamp:weak-rescue', JSON.stringify(next)) } catch { /* retry list is optional */ }
          return next
        })
        setShowMeaning(true)
        setShowSticky(false)
        playSfx('wrong')
      } else {
        playSfx('xp')
      }
      setFogGrade(grade)
      trackAnalyticsEvent('world_spirit_wake', { grade, result: grade === 1 ? 'mist_stays' : grade === 2 ? 'mist_thins' : 'mist_clears' }, { enrollmentId: active?.enrollmentId })
      setAwaitingNext(true)

      // Authoritative server XP only (never optimistic before server confirms!)
      if (res.reward) {
        applyRewardFeedback(res.reward)
        setXpEarned((x) => x + res.reward!.totalAwardedXp)
        if (res.reward.newBadges.length > 0) {
          setEarnedBadges((prev) => [...prev, ...res.reward!.newBadges])
        }
      }
      if (res.upgradedCard) {
        setUpgradedCards((prev) => [...prev, res.upgradedCard!])
      }

      if (isWeakBossMode) {
        // Advancement is deferred to the explicit 继续 button (nextAfterWake) so
        // the fog feedback is actually seen. Only the HP bar moves here.
        if (grade !== 1) setBossHp((hp) => Math.max(0, hp - 1))
        return
      }

      // Normal review: stay on this card until the student taps 继续.
    } catch (err: any) {
      setError(err.message || '提交记忆反馈失败，请重试（断网不会计入经验）')
    } finally {
      setGrading(false)
      advancingRef.current = false
    }
  }

  const finishRound = async () => {
    if (!sessionId) return
    if (isWeakBossMode) {
      const bossFinish = await api.post<{ reward?: RewardFeedback }>('/students/game/weak-boss/finish', { enrollmentId: active!.enrollmentId, sessionId })
      if (bossFinish.reward) {
        applyRewardFeedback(bossFinish.reward)
        setXpEarned((x) => x + bossFinish.reward!.totalAwardedXp)
      }
    } else {
      const fin = await api.post<FinishResponse>('/students/review/finish', { sessionId, isWeakRestudy }).catch(() => null)
    if (fin?.restudyReward) {
      applyRewardFeedback(fin.restudyReward)
      setXpEarned((x) => x + fin.restudyReward!.totalAwardedXp)
    }
      if (fin?.tomorrowDueCount !== undefined) setTomorrowDueCount(fin.tomorrowDueCount)
    }
    setFinished(true)
    void refreshSummary()
  }

  function nextAfterWake() {
    if (grading || !card) return
    const grade = fogGrade
    setAwaitingNext(false)
    setFogGrade(null)
    if (isWeakBossMode) {
      if (grade === 1) {
        // Wrong in Weak Boss: no HP deduction, the word comes back at the tail.
        setCards((prev) => [...prev, card])
        setIdx((i) => i + 1)
        currentSubmissionId.current = null
        return
      }
      const nextHp = bossHp
      if (idx + 1 < cards.length && nextHp > 0) {
        setIdx((i) => i + 1)
        currentSubmissionId.current = null
      } else void finishRound().catch((err) => setError(err.message || '结算失败，请重试'))
      return
    }
    if (idx + 1 < cards.length) {
      setIdx((i) => i + 1)
      currentSubmissionId.current = null
    } else void finishRound().catch((err) => setError(err.message || '结算失败，请重试'))
  }

  const handleRestudyWeak = async () => {
    if (!active || weakIds.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<StartResponse>('/students/review/restudy', {
        enrollmentId: active.enrollmentId,
        instanceIds: weakIds,
      })
      setSessionId(res.sessionId)
      setCards(res.cards)
      setIdx(0)
      setFinished(false)
      setIsWeakRestudy(true)
      resetRoundStats()
      try { sessionStorage.removeItem('wordcamp:weak-rescue') } catch { /* no storage */ }
    } catch (err: any) {
      setError(err.message || '重练弱词失败')
    } finally {
      setLoading(false)
    }
  }

  if (!active) {
    return (
      <div className="camp-hero-card">
        <h2 style={{ fontSize: 20 }}>请先选择一个班级</h2>
        <Link to="/student" className="camp-btn camp-btn-berry">前往选班</Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="camp-hero-card" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <p style={{ fontWeight: 800 }}>
          {isWeakBossMode ? '正在召唤近 7 天弱词 Boss...' : '正在匹配艾宾浩斯到期词单...'}
        </p>
      </div>
    )
  }

  if (finished) {
    const allAgain = reviewedCount > 0 && againCount === reviewedCount
    const tomorrowN = tomorrowDueCount ?? summary?.tomorrowDueCount ?? 0

    return (
      <>
        <div className="camp-hero-card" style={{ justifyContent: 'center', gap: 10 }}>
          <div>
            <span className="badge badge-green">
              {isWeakBossMode ? '⚔️ 雾兽已被唤醒' : isWeakRestudy ? '秘语重练完成' : '本轮驱雾完成'}
            </span>
            <h1 className="camp-word-title" style={{ marginTop: 6, fontSize: 26 }}>
              {allAgain ? '词灵们在等你再叫一次名字' : `你唤醒了 ${reviewedCount} 只词灵`}
            </h1>
            <div className="world-end-banner">{summary?.lateNightQuiet ? '🌙 晚安，今天到此为止。' : '今天到此为止。回营地看看你的收获吧。'}</div>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 4, fontSize: 13 }}>
              {allAgain
                ? '今天已经认真面对难词了，去营地休息一下吧。'
                : `本轮实得 +${xpEarned} XP · 今日累计 ${summary?.today.xpEarned ?? xpEarned}/${summary?.today.dailyCap ?? 400} XP`}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, textAlign: 'center' }}>
            <div className="camp-def-box" style={{ padding: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>今日双环</div>
              <strong style={{ fontSize: 14 }}>{summary?.today.rings.ringsClosed ? '✅ 已合拢' : '进行中'}</strong>
            </div>
            <div className="camp-def-box" style={{ padding: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>连续天数</div>
              <strong style={{ fontSize: 14 }}>🔥 {summary?.profile.streakDays ?? 0} 天</strong>
            </div>
            <div className="camp-def-box" style={{ padding: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>明日到期</div>
              <strong style={{ fontSize: 14 }}>{tomorrowN} 张</strong>
            </div>
          </div>

          {upgradedCards.length > 0 && (
            <div className="camp-def-box" style={{ padding: 8, fontSize: 12 }}>
              <strong>卡牌升阶：</strong>
              {upgradedCards.slice(0, 4).map((c) => `${c.word}（${c.toRarity}）`).join(' · ')}
            </div>
          )}

          {earnedBadges.length > 0 && (
            <div className="alert alert-success" style={{ marginBottom: 0, padding: '8px 10px', fontSize: 13 }}>
              🏅 新获徽章：{earnedBadges.map((b) => `${b.icon} ${b.name}`).join('、')}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {weakRescueOpen && weakIds.length > 0 && !isWeakBossMode && <button type="button" className="camp-btn camp-btn-sticky" onClick={() => void handleRestudyWeak()}>用秘语重练 {weakIds.length} 词（可选）</button>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <Link to="/student/adventure" className="camp-btn camp-btn-mint">去看探险地图</Link>
              <button type="button" className="camp-btn camp-btn-berry" onClick={() => setShareOpen(true)}>
                生成战报卡
              </button>
            </div>
            <Link to="/student/task" className="camp-btn camp-btn-ghost">回营地，今天到这里</Link>
          </div>
        </div>
        <ShareCardModal open={shareOpen} onClose={() => setShareOpen(false)} />
      </>
    )
  }

  if (!card) {
    return (
      <div className="camp-hero-card" style={{ justifyContent: 'center', gap: 12 }}>
        {error && <div className="alert alert-danger" style={{ marginBottom: 0 }}>{error}</div>}
        <h2 style={{ fontSize: 22 }}>
          {isWeakBossMode
            ? '当前没有近 7 天待攻克的弱词'
            : emptyReason === 'capped'
              ? '今日额定新词与到期词已完成'
              : '当前词库暂未分配待学单词'}
        </h2>
        <p style={{ color: 'var(--color-text-muted)' }}>
          {isWeakBossMode
            ? '你的近期词卡都很稳固，去「探险」地图认识下一只词灵吧！'
            : emptyReason === 'capped'
              ? '如果还想趁热多背一组，可以点击下方加练。'
              : '请先在「23天词库」或班级词集中添加词条。'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!isWeakBossMode && emptyReason === 'capped' && (
            <button type="button" className="camp-btn camp-btn-berry" onClick={() => void startReview(true)}>
              突破上限继续背一组
            </button>
          )}
          <Link to="/student/task" className="camp-btn camp-btn-sticky">返回特训</Link>
        </div>
      </div>
    )
  }

  const ebSnap = buildEbbinghausSnapshot({
    state: card.state,
    stability: card.stability,
    reps: card.reps,
    due: card.due,
    lastReview: card.lastReview,
  })

  return (
    <>
      {isWeakBossMode ? (
        <div className="eb-candy-strip">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800 }}>
              <span>⚔️ 雾兽讨伐战</span>
              <span>剩余血量 {bossHp}/{bossMaxHp}</span>
            </div>
            <div className="progress-bar" style={{ height: 8, marginTop: 4 }}>
              <div
                className="progress-fill"
                style={{
                  width: `${bossMaxHp > 0 ? Math.round((bossHp / bossMaxHp) * 100) : 0}%`,
                  background: 'var(--color-danger)',
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <EbbinghausStrip snapshot={ebSnap} labelPrefix={`第 ${idx + 1}/${cards.length} 词`} />
      )}

      {error && <div className="alert alert-danger" style={{ marginBottom: 0 }}>{error}</div>}

      <div className="review-spirit-stage">
        <WordSpirit word={card.word} bestStage={card.bestStage ?? 0} retention={ebSnap.retrievabilityPct / 100} mist={ebSnap.urgency !== 'SOLID'} size={110} celebrate={fogGrade !== null && fogGrade >= 3} />
        {fogGrade && <div className={`review-fog-effect grade-${fogGrade}`} aria-hidden="true" />}
      </div>

      <article
        className={`camp-hero-card skin-${summary?.profile.cardSkin ?? 'classic'}`}
        onTouchStart={(e) => { swipeX.current = e.changedTouches[0].clientX }}
        onTouchEnd={(e) => {
          if (awaitingNext || grading) return
          const dx = e.changedTouches[0].clientX - swipeX.current
          if (dx < -55 && idx + 1 < cards.length) setIdx((i) => i + 1)
          if (dx > 55 && idx > 0) setIdx((i) => i - 1)
        }}
      >
        <button
          type="button"
          className="camp-sticky-corner"
          onClick={() => {
            setShowSticky((s) => !s)
            if (!showSticky) trackAnalyticsEvent('world_secret_open', { word: card.word }, { enrollmentId: active?.enrollmentId })
          }}
        >
          {showSticky ? '收起秘语' : '秘语小纸条'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="badge badge-blue">{card.pos || '高频词'}</span>
            <button
              type="button"
              className="candy-pill"
              style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}
              onClick={() => setShowMeaning((v) => !v)}
            >
              {showMeaning ? '遮住释义自测' : '显示中文释义'}
            </button>
          </div>
          <button type="button" className="candy-pill" style={{ minHeight: 34 }} onClick={() => speakWord(card.word)}>
            🔊 读音
          </button>
        </div>

        <div>
          <h1 className="camp-word-title">{card.word}</h1>
          {card.ipa && <div className="camp-ipa">{card.ipa}</div>}
        </div>

        <div
          className="camp-def-box"
          onClick={() => setShowMeaning(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowMeaning(true) }}
        >
          {showMeaning ? (
            <>
              <div className="camp-def-zh">{card.definitionL1 || card.definitionL2 || '点击查看释义'}</div>
              {card.exampleSentence && <div className="camp-def-en">{card.exampleSentence}</div>}
            </>
          ) : (
            <div className="camp-def-zh" style={{ color: 'var(--color-sky)' }}>想一想中文意思，轻点揭晓释义</div>
          )}
        </div>

        {showSticky && (
          <MnemonicCardBlock word={card.word} mnemonic={card.mnemonic} compact />
        )}
      </article>

      {awaitingNext && fogGrade ? <>
        <div className="world-end-banner" role="status">{fogGrade === 1 ? '雾还在。再听一遍，它也会认得你。' : fogGrade === 2 ? '雾散了一半，名字更清楚了。' : fogGrade === 3 ? '雾散尽了，词灵醒来了！' : '雾散尽并闪光，你叫出了它的名字！'}</div>
        <button type="button" className="camp-btn camp-btn-berry review-next-button" onClick={nextAfterWake} disabled={grading}>{grading ? '正在保存…' : '继续'}</button>
      </> : <div className="camp-arcade-bar" aria-label="驱雾反馈，同时记录艾宾浩斯评分">
        {ebSnap.gradeLabels.map((g) => (
          <button
            key={g.grade}
            type="button"
            disabled={grading}
            className={`camp-eb-btn g${g.grade}`}
            onClick={() => void handleGrade(g.grade)}
            aria-label={`${g.title}，${g.grade === 1 ? '雾未散' : g.grade === 2 ? '散一半' : g.grade === 3 ? '散尽' : '散尽并闪光'}，下次约${g.hint}`}
          >
            <span>{g.title}</span>
            <span className="eb-sub">{g.grade === 1 ? '雾未散' : g.grade === 2 ? '散一半' : g.grade === 3 ? '散尽' : '闪光'} · {g.hint}</span>
          </button>
        ))}
      </div>}
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
    </>
  )
}

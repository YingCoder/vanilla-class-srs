import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useEnrollment } from '../../utils/enrollment'
import { useApi } from '../../hooks/useApi'
import { Modal } from '../../components/Modal'
import StudyCardFront from '../../components/StudyCardFront'

interface TodayProgress {
  studyDate: string
  dueNow: number
  newAvailable: number
  reviewsDue: number
  todayNewCards: number
  todayReviews: number
  todayDistinctCards: number
  targets: { newCards: number; reviews: number }
  xpToday: number
  coinsToday: number
}

interface SessionCard {
  instanceId: string
  cardId: string
  word: string
  pos: string | null
  definitionL2: string | null
  definitionL1: string | null
  exampleSentence: string | null
  state: string
}

interface SessionResponse {
  sessionId: string
  cards: SessionCard[]
  totalCards: number
  emptyReason?: 'capped' | 'exhausted'
}

type StudyFocus =
  | null
  | { mode: 'all' }
  | { mode: 'assigned'; cardSetIds: string[]; cardSetNames: string[] }

interface WeeklyGoal {
  sessionsRequired: number
  minCardsPerSession: number
  periodDays: number
  sessionsCompleted: number
  daysRemaining: number
  cardSetFocus: StudyFocus
  justFinishedSessionCounted?: boolean | null
}

interface StatsSummary {
  weeklyGoal: WeeklyGoal | null
  deckCardSets: { id: string; name: string }[]
  personalCardSet: { id: string; cardCount: number } | null
}

type Phase = 'idle' | 'loading' | 'reviewing' | 'done'

const GRADE_LABELS: Record<number, string> = {
  1: '不记得',
  2: '差点忘了',
  3: '记得',
  4: '很简单',
}
const GRADE_COLORS: Record<number, string> = {
  1: 'var(--color-danger)',
  2: 'var(--color-warning)',
  3: 'var(--color-accent-alt)',
  4: 'var(--color-info)',
}

// Each grade swipes off in its own diagonal direction (~30°), with "Again"/"Easy" thrown
// harder & faster than "Hard"/"Good" — approved in demos/anim-demo/next-card-final-2.html.
const SWIPE_DIRECTION: Record<number, { sx: 1 | -1; sy: 1 | -1; intense: boolean }> = {
  1: { sx: -1, sy: 1, intense: true },   // Again: left-down
  2: { sx: -1, sy: -1, intense: false }, // Hard: left-up
  3: { sx: 1, sy: -1, intense: false },  // Good: right-up
  4: { sx: 1, sy: 1, intense: true },    // Easy: right-down
}

const CONFETTI_COLORS = ['#E8698A', '#6BAF92', '#5B9BD5', '#D4900A', '#C45C3A']

const ENCOURAGEMENT: Record<'great' | 'good' | 'rough', string[]> = {
  great: ['太棒了！🎯', '表现出色！🌟', '状态火热！🔥', '完美一轮！💎', '专注力惊人！🧠✨'],
  good: ['稳步前进。👍', '有进步！📈', '越来越接近了。🚀', '继续加油！💪', '一点点在变好！🌱'],
  rough: ['别灰心，你可以的。🌤️', '练习就是进步。📚', '每一次复习都算数。✅', '坚持下去，你能行。💛', '明天又是新的一天。🌅'],
}

function accuracyTier(accuracyRate: number | null): 'great' | 'good' | 'rough' {
  if (accuracyRate === null) return 'good'
  if (accuracyRate >= 0.9) return 'great'
  if (accuracyRate >= 0.7) return 'good'
  return 'rough'
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

export default function ReviewPage() {
  const location = useLocation()
  const { active } = useEnrollment()
  // Clicking Study again starts fresh, even when already on this route.
  return <ReviewSessionPage key={`${location.key}:${active?.enrollmentId ?? ''}`} />
}

function ReviewSessionPage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('idle')
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [flipAnimClass, setFlipAnimClass] = useState('')
  const [flipStyle, setFlipStyle] = useState<{ '--tilt'?: string; '--drift'?: string; '--dur'?: string }>({})
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startTime, setStartTime] = useState<number>(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [sessionResult, setSessionResult] = useState<{
    cardsReviewed: number
    accuracyRate: number | null
    weeklyGoal: WeeklyGoal | null
    newPersonalBestDay: boolean
    todayCardsTotal: number
    currentStreak: number
    rewards?: { xp: number; coins: number }
  } | null>(null)
  const [headline, setHeadline] = useState('')
  const [confirmFinish, setConfirmFinish] = useState(false)
  // Cards graded < 3 this session, for "Keep Studying" re-drill
  const [weakCards, setWeakCards] = useState<SessionCard[]>([])
  // Drives the grade-direction swipe-out / next-card-in animation
  const [cardAnim, setCardAnim] = useState<{ exitStyle: CSSProperties; exitMs: number } | null>(null)
  const [cardEntering, setCardEntering] = useState(false)
  const [showGradeInfo, setShowGradeInfo] = useState(false)
  // Set when a review-start attempt comes back with zero cards, so we can offer the right
  // next step (study more new words / review ahead of schedule) instead of a dead end.
  const [emptyReason, setEmptyReason] = useState<'capped' | 'exhausted' | null>(null)
  // Set when finishSession fails right after the last card is graded — the card is
  // already swiped away with nothing left to review, so rather than leave the student
  // staring at a stale card with no grade buttons, show an explicit retry affordance.
  const [finishPending, setFinishPending] = useState<{ sessionId: string; reviewed: number } | null>(null)
  const [finishing, setFinishing] = useState(false)
  const finishStageRef = useRef<HTMLDivElement>(null)
  // Synchronous double-submit guard for gradeCard — `grading` state alone isn't
  // enough, since disabled={grading} on the button doesn't take effect in the
  // DOM until the next render, leaving a window where a fast double-tap can
  // fire gradeCard twice for the same card before React re-renders.
  const gradingRef = useRef(false)
  // On short/landscape viewports, the flip card + progress bar + 4 stacked grade
  // buttons can exceed the visible viewport height, pushing the buttons below the
  // fold with no visual cue that the page scrolls. Scrolling them into view the
  // moment they appear means a student never has to discover that on their own.
  const gradeButtonsRef = useRef<HTMLDivElement>(null)

  // Drives the Study Focus dropdown. '' = All CardSets, '__homework__' = the
  // homework-assigned CardSet(s) as a group (may be more than one), or a
  // single CardSet id. Keep the choice across sessions and summary refreshes;
  // navigating to Study again remounts this page and restores the default.
  const [selectedFocus, setSelectedFocus] = useState<string>('')
  const focusInitialized = useRef(false)
  const { data: summary, reload: reloadSummary } = useApi<StatsSummary>(
    () => active
      ? api.get<StatsSummary>(`/students/stats/summary?enrollmentId=${active.enrollmentId}`)
      : Promise.resolve({ weeklyGoal: null, deckCardSets: [], personalCardSet: null }),
    [active?.enrollmentId],
  )
  const { data: today, reload: reloadToday } = useApi<TodayProgress | null>(
    () => active
      ? api.get<TodayProgress>(`/students/today?enrollmentId=${active.enrollmentId}`)
      : Promise.resolve(null),
    [active?.enrollmentId],
  )

  useEffect(() => {
    if (!summary || focusInitialized.current) return
    focusInitialized.current = true
    const focus = summary.weeklyGoal?.cardSetFocus
    setSelectedFocus(focus?.mode === 'assigned' ? '__homework__' : '')
  }, [summary])

  // Ensure the grade buttons are actually visible the moment they appear, in case
  // the flip card + progress bar have already filled the viewport (short screens,
  // landscape phones) — the page does scroll, but nothing else signals that.
  useEffect(() => {
    if (flipped) {
      gradeButtonsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [flipped])

  if (!active) { navigate('/student'); return null }

  const flipCard = () => {
    if (flipped) return
    const mag = rand(0, 5)
    const tilt = Math.random() > 0.5 ? mag : -mag
    const drift = rand(-4, 4)
    setFlipStyle({ '--tilt': `${tilt.toFixed(2)}deg`, '--drift': `${drift.toFixed(1)}px`, '--dur': '0.42s' })
    setFlipAnimClass('review-pop-flip-fwd')
    setFlipped(true)
    setTimeout(() => setFlipAnimClass(''), 420)
  }

  const startSession = async (options: { bypassNewCardCap?: boolean; reviewAhead?: boolean } = {}) => {
    setPhase('loading')
    setError(null)
    setEmptyReason(null)
    setWeakCards([])
    const focus = summary?.weeklyGoal?.cardSetFocus
    const cardSetIds =
      selectedFocus === '__homework__' && focus?.mode === 'assigned' ? focus.cardSetIds
      : selectedFocus && selectedFocus !== '__homework__' ? [selectedFocus]
      : undefined
    try {
      const data = await api.post<SessionResponse>('/students/review/start', {
        enrollmentId: active.enrollmentId,
        cardSetIds,
        ...options,
      })
      if (data.cards.length === 0) {
        // Nothing to study — surface a modal offering the right next step rather than a dead end.
        setEmptyReason(data.emptyReason ?? 'exhausted')
        setPhase('idle')
        return
      }
      setSession(data)
      setCardIndex(0)
      setFlipped(false)
      setCompletedCount(0)
      setSessionResult(null)
      setStartTime(Date.now())
      setPhase('reviewing')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to start session')
      setPhase('idle')
    }
  }

  const keepStudying = async () => {
    if (weakCards.length === 0 || !active) return
    setPhase('loading')
    setError(null)
    try {
      const data = await api.post<SessionResponse>('/students/review/restudy', {
        enrollmentId: active.enrollmentId,
        instanceIds: weakCards.map((c) => c.instanceId),
      })
      setSession(data)
      setCardIndex(0)
      setFlipped(false)
      setCompletedCount(0)
      setSessionResult(null)
      setWeakCards([])
      setStartTime(Date.now())
      setPhase('reviewing')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to start restudy session')
      setPhase('done')
    }
  }

  const gradeCard = async (grade: number) => {
    if (!session || gradingRef.current) return
    gradingRef.current = true
    setGrading(true)
    const responseTimeMs = Date.now() - startTime

    // Swipe the card off in its grade's direction — approved in
    // demos/anim-demo/next-card-final-2.html. Fires immediately as feedback,
    // independent of how long the grade API call takes.
    const dir = SWIPE_DIRECTION[grade]
    const angleDeg = rand(26, 34)
    const radians = (angleDeg * Math.PI) / 180
    const distPct = dir.intense ? rand(135, 165) : rand(95, 120)
    const exitMs = (dir.intense ? rand(0.2, 0.26) : rand(0.3, 0.38)) * 1000
    const rotDeg = dir.intense ? rand(10, 18) : rand(3, 8)
    const dx = dir.sx * Math.cos(radians) * distPct
    const dy = dir.sy * Math.sin(radians) * distPct * 0.6
    const rotSigned = dir.sx * rotDeg
    setCardAnim({
      exitStyle: {
        transform: `translate(${dx.toFixed(1)}%, ${dy.toFixed(1)}%) rotate(${rotSigned.toFixed(1)}deg)`,
        opacity: 0,
        transition: `transform ${exitMs}ms ease, opacity ${exitMs}ms ease`,
      },
      exitMs,
    })

    try {
      const result = await api.post<{ requeue: boolean }>('/students/review/grade', {
        sessionId: session.sessionId,
        instanceId: session.cards[cardIndex].instanceId,
        grade,
        responseTimeMs,
      })

      const newCompleted = completedCount + 1

      // Track weak cards (grade < 3) for "Keep Studying" — deduplicated by instanceId
      if (grade < 3) {
        const card = session.cards[cardIndex]
        setWeakCards((prev) =>
          prev.some((c) => c.instanceId === card.instanceId) ? prev : [...prev, card]
        )
      }

      // Build the new cards array synchronously so all derived values use the same snapshot
      const newCards = result.requeue
        ? [...session.cards, session.cards[cardIndex]]
        : session.cards

      const nextIndex = cardIndex + 1
      const isLastCard = nextIndex >= newCards.length

      // Let the swipe-out finish playing before swapping in the next card (or finishing).
      setTimeout(async () => {
        setCardAnim(null)
        if (isLastCard) {
          await finishSession(session.sessionId, newCompleted)
        } else {
          if (result.requeue) {
            setSession({ ...session, cards: newCards })
          }
          setCardIndex(nextIndex)
          setFlipped(false)
          setFlipAnimClass('')
          setFlipStyle({})
          setStartTime(Date.now())
          setCompletedCount(newCompleted)
          setCardEntering(true)
          setTimeout(() => setCardEntering(false), 300)
        }
      }, exitMs)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to grade card')
      setCardAnim(null)
    } finally {
      gradingRef.current = false
      setGrading(false)
    }
  }

  const finishSession = useCallback(async (sessionId: string, reviewed?: number) => {
    setFinishing(true)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const result = await api.post<{
        cardsReviewed: number
        accuracyRate: number | null
        weeklyGoal: WeeklyGoal | null
        newPersonalBestDay: boolean
        todayCardsTotal: number
        currentStreak: number
        rewards?: { xp: number; coins: number }
      }>('/students/review/finish', { sessionId, tz })
      setSessionResult(result)
      void reloadToday()
      setHeadline(pickRandom(ENCOURAGEMENT[accuracyTier(result.accuracyRate)]))
      setPhase('done')
      setFinishPending(null)
      reloadSummary()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to finish session')
      setFinishPending({ sessionId, reviewed: reviewed ?? 0 })
    } finally {
      setFinishing(false)
    }
  }, [reloadSummary])

  const handleFinishEarly = () => setConfirmFinish(true)

  const currentCard = session?.cards[cardIndex]

  // Confetti that falls and settles on the ground (piles up, doesn't fade away) —
  // approved in demos/anim-demo/finish-final-2.html.
  useEffect(() => {
    if (phase !== 'done') return
    const stage = finishStageRef.current
    if (!stage) return
    stage.querySelectorAll('.review-confetti-piece').forEach((el) => el.remove())
    const stageHeight = stage.clientHeight || 320
    const groundY = stageHeight - 14
    const pieces: HTMLDivElement[] = []
    for (let i = 0; i < 55; i++) {
      const piece = document.createElement('div')
      piece.className = 'review-confetti-piece'
      const startX = Math.random() * 100
      const restX = Math.max(2, Math.min(98, startX + (Math.random() - 0.5) * 8))
      const size = 7 + Math.random() * 4
      const isCircle = Math.random() > 0.5
      piece.style.width = `${size}px`
      piece.style.height = `${isCircle ? size : size * 1.7}px`
      piece.style.borderRadius = isCircle ? '50%' : '2px'
      piece.style.background = pickRandom(CONFETTI_COLORS)
      piece.style.left = `${startX}%`
      piece.style.top = '-10px'
      const fallDur = 0.9 + Math.random() * 0.6
      const delay = Math.random() * 0.35
      const finalRot = Math.round((Math.random() - 0.5) * 100)
      piece.style.transition = `top ${fallDur}s cubic-bezier(0.3,0.6,0.7,1) ${delay}s, left ${fallDur}s ease ${delay}s, transform ${fallDur}s ease ${delay}s`
      stage.appendChild(piece)
      pieces.push(piece)
      requestAnimationFrame(() => {
        piece.style.top = `${groundY - size}px`
        piece.style.left = `${restX}%`
        piece.style.transform = `rotate(${finalRot}deg)`
      })
    }
    return () => { pieces.forEach((p) => p.remove()) }
  }, [phase, completedCount])

  const focusSelector = summary && (
    <div className="form-group" style={{ marginBottom: 16 }}>
      <label className="form-label" htmlFor="study-focus">学习范围</label>
      <select id="study-focus" className="form-select" value={selectedFocus} onChange={(e) => setSelectedFocus(e.target.value)}>
        <option value="">全部词集</option>
        {summary.personalCardSet && (
          <option value={summary.personalCardSet.id}>
            我添加的词（{summary.personalCardSet.cardCount}）
          </option>
        )}
        {summary.weeklyGoal?.cardSetFocus?.mode === 'assigned' && (
          <option value="__homework__">
            作业：{summary.weeklyGoal.cardSetFocus.cardSetNames.join('、')}
          </option>
        )}
        {summary.deckCardSets.map((cs) => (
          <option key={cs.id} value={cs.id}>{cs.name}</option>
        ))}
      </select>
    </div>
  )

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      {showGradeInfo && (
        <Modal title="评分说明" onClose={() => setShowGradeInfo(false)}>
          <p style={{ marginBottom: 12 }}>
            复习时你的选择会告诉系统你对这个词的熟悉程度，系统据此决定下次什么时候再让你看到它。
            如实选择（即使不认识）反而学得更快，因为系统能把时间集中在你真正需要练的词上。
          </p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li><strong>不记得</strong> —— 很快会再次出现，通常就在本轮里。</li>
            <li><strong>差点忘了</strong> —— 会比平常更早出现，因为还不稳固。</li>
            <li><strong>记得</strong> —— 按正常间隔出现，间隔会逐渐拉长。</li>
            <li><strong>很简单</strong> —— 间隔会更长，因为你已经掌握了。</li>
          </ul>
        </Modal>
      )}

      {/* Idle */}
      {phase === 'idle' && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <img src="/Vanilla-deck.png" alt="" style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 16 }} />
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 12 }}>今日学习</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 20, fontSize: 'var(--text-base)' }}>
            班级：<strong>{active.className}</strong>
          </p>
          {today && (
            <div style={{
              maxWidth: 360,
              margin: '0 auto 24px',
              padding: '12px 16px',
              borderRadius: 12,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              fontSize: 'var(--text-sm)',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                今日新词 {today.todayNewCards}/{today.targets.newCards}
                {' · '}复习 {today.todayReviews}/{today.targets.reviews}
              </div>
              <div style={{ color: 'var(--color-text-muted)' }}>
                当前待复习 {today.reviewsDue} 张，新词待学 {today.newAvailable} 张
                {today.xpToday > 0 && <> · 今日 +{today.xpToday} XP</>}
              </div>
            </div>
          )}
          {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
          <button className="btn btn-primary btn-lg" onClick={() => startSession()}>开始复习</button>

          <div style={{ maxWidth: 320, margin: '24px auto 0', textAlign: 'left' }}>
            {focusSelector}

            {summary?.weeklyGoal && (
              <>
                <p style={{ fontSize: 'var(--text-base)', textAlign: 'center' }}>
                  <strong>
                    {summary.weeklyGoal.sessionsCompleted >= summary.weeklyGoal.sessionsRequired ? '🎉 ' : ''}
                    本周已完成 {summary.weeklyGoal.sessionsCompleted} / {summary.weeklyGoal.sessionsRequired} 次作业
                  </strong>
                  {'，每次至少 '}{summary.weeklyGoal.minCardsPerSession} 张卡。
                </p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
                  每次作业至少 {Math.max(10, summary.weeklyGoal.minCardsPerSession)} 次复习。
                  {' '}如果到期的卡不够，会在学习范围内补充即将到期的词；
                  {' '}如果不同的卡不够，会有词重复出现。
                </p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
                  作业请分不同天完成，间隔至少 12 小时。
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {phase === 'loading' && <div className="loading-center"><div className="spinner" /></div>}

      {/* Nothing to study right now — offer the right next step instead of a dead end */}
      {phase === 'idle' && emptyReason && (
        <Modal title={emptyReason === 'capped' ? '今天的任务已完成' : '还没有单词'} onClose={() => setEmptyReason(null)}>
          {emptyReason === 'capped' ? (
            <p style={{ marginBottom: 16 }}>
              到期的复习都完成了，今天的新词也已达到上限。还想多学几个吗？
            </p>
          ) : (
            <p style={{ marginBottom: 16 }}>
              当前学习范围里没有单词。换个范围，或先添加一些单词。
            </p>
          )}
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setEmptyReason(null)}>{emptyReason === 'capped' ? '稍后再说' : '关闭'}</button>
            {emptyReason === 'capped' ? (
              <button className="btn btn-primary" onClick={() => startSession({ bypassNewCardCap: true })}>
                再学几个新词
              </button>
            ) : null}
          </div>
        </Modal>
      )}

      {/* Reviewing */}
      {phase === 'reviewing' && currentCard && (
        <div>
          {/* Progress */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            <span>{cardIndex + 1} / {session!.cards.length}</span>
            {finishPending ? null : confirmFinish ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>结束本轮？</span>
                <button className="btn btn-danger btn-sm" disabled={grading} onClick={async () => { await finishSession(session!.sessionId); setConfirmFinish(false) }}>结束</button>
                <button className="btn btn-secondary btn-sm" disabled={grading} onClick={() => setConfirmFinish(false)}>取消</button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={handleFinishEarly}>提前结束</button>
            )}
          </div>
          <div className="progress-bar" style={{ marginBottom: 24 }}>
            <div className="progress-fill" style={{ width: `${((cardIndex + 1) / session!.cards.length) * 100}%` }} />
          </div>

          {finishPending ? (
            /* The last card was already graded and swiped away — nothing left to
               review — but submitting the finished session failed (e.g. a dropped
               connection). Show an explicit retry instead of leaving the student
               staring at the stale, already-swiped card with no grade buttons. */
            <div className="review-flip-outer" style={{ height: 260 }}>
              <div
                className="review-flip-face"
                style={{
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12,
                  padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 32px)', textAlign: 'center',
                  height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)', gap: 16,
                }}
              >
                <p style={{ fontSize: 'var(--text-base)' }}>
                  所有单词都复习完了，但结果没有保存成功——请检查网络后重试。
                </p>
                <button
                  className="btn btn-primary"
                  disabled={finishing}
                  onClick={() => finishSession(finishPending.sessionId, finishPending.reviewed)}
                >
                  {finishing ? '正在重试…' : '重试'}
                </button>
              </div>
            </div>
          ) : (
          <>
          {/* Card — 3D pop-flip with a slight random tilt/drift on each flip (demos/anim-demo/flip-final.html),
              swiped off in a grade-specific diagonal direction when graded (demos/anim-demo/next-card-final-2.html) */}
          <div
            className="review-flip-outer"
            style={{ height: 260, ...(cardAnim ? cardAnim.exitStyle : {}) }}
          >
            <div
              className={`review-flip-inner ${flipAnimClass} ${!flipAnimClass && flipped ? 'is-flipped-still' : ''} ${cardEntering ? 'review-card-enter' : ''}`}
              style={{ height: '100%', ...flipStyle }}
              onClick={flipCard}
            >
              {/* Front */}
              <StudyCardFront word={currentCard.word} pos={currentCard.pos} flipped={flipped} />

              {/* Back */}
              <div
                className="review-flip-face back"
                style={{
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12,
                  padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 32px)', textAlign: 'center',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'var(--shadow-sm)', overflowY: 'auto',
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 400, marginBottom: 16, lineHeight: 1.25, wordBreak: 'break-word' }}>{currentCard.word}</div>
                {currentCard.definitionL2 && (
                  <p style={{ fontSize: 'var(--text-lg)', marginBottom: 8 }}>{currentCard.definitionL2}</p>
                )}
                {currentCard.definitionL1 && (
                  <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginBottom: 8 }}>{currentCard.definitionL1}</p>
                )}
                {currentCard.exampleSentence && (
                  <p style={{ fontSize: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--color-text-muted)', marginTop: 12 }}>
                    "{currentCard.exampleSentence}"
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Grade buttons — vertically stacked, full width */}
          {flipped && (
            <div ref={gradeButtonsRef}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>How well do you know this?</span>
                <button
                  type="button"
                  onClick={() => setShowGradeInfo(true)}
                  aria-label="More information about these options"
                  style={{
                    width: 16, height: 16, borderRadius: '50%', border: 'none', padding: 0,
                    background: 'var(--color-info)', color: 'var(--color-vanilla)',
                    fontSize: 10, fontWeight: 700, lineHeight: '16px', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ?
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {[1, 2, 3, 4].map((g) => (
                  <button
                    key={g}
                    className="btn"
                    style={{
                      background: GRADE_COLORS[g],
                      color: 'var(--color-vanilla)',
                      fontSize: 'var(--text-base)',
                      padding: '14px 16px',
                      width: '100%',
                      justifyContent: 'center',
                    }}
                    disabled={grading}
                    onClick={() => gradeCard(g)}
                  >
                    {GRADE_LABELS[g]}
                  </button>
                ))}
              </div>
            </div>
          )}
          </>
          )}

          {error && <div className="alert alert-danger" style={{ marginTop: 16 }}>{error}</div>}
        </div>
      )}

      {/* Done — confetti settles on the ground + drawn checkmark + big glowing stat numbers +
          randomly-picked encouragement headline, approved in demos/anim-demo/finish-final-2.html.
          Personal-best ribbon / streak line below. */}
      {phase === 'done' && (
        <div ref={finishStageRef} className="review-finish-stage" style={{ minHeight: 320, padding: '32px 16px' }}>
          <svg className="review-check-svg" viewBox="0 0 80 80" key={`check-${completedCount}`}>
            <circle className="review-check-circle draw" cx="40" cy="40" r="32" />
            <path className="review-check-mark draw" d="M24 41 L35 52 L57 28" />
          </svg>
          <h2 className="review-reward-title">{headline}</h2>
          {sessionResult && (
            <div className="review-big-stats">
              <div>
                <span
                  key={`stat-a-${completedCount}`}
                  className="review-big-stat-value review-shake-glow-settle"
                  style={{ '--glow-color': pickRandom(CONFETTI_COLORS) } as CSSProperties}
                >
                  {sessionResult.cardsReviewed}
                </span>
                <div className="review-big-stat-label">本轮复习</div>
              </div>
              <div>
                <span
                  key={`stat-b-${completedCount}`}
                  className="review-big-stat-value review-shake-glow-settle"
                  style={{ '--glow-color': pickRandom(CONFETTI_COLORS), animationDelay: '0.1s' } as CSSProperties}
                >
                  {sessionResult.accuracyRate !== null ? `${Math.round(sessionResult.accuracyRate * 100)}%` : '—'}
                </span>
                <div className="review-big-stat-label">首答正确率</div>
              </div>
            </div>
          )}
          {sessionResult && (sessionResult.newPersonalBestDay || sessionResult.currentStreak >= 2) && (
            <div style={{ marginTop: 8, position: 'relative', zIndex: 2, textAlign: 'center' }}>
              {sessionResult.newPersonalBestDay && (
                <p style={{ fontSize: 'var(--text-base)', fontWeight: 700 }}>
                  🏆 新纪录 —— 今天已完成 {sessionResult.todayCardsTotal} 张卡！
                </p>
              )}
              {sessionResult.currentStreak >= 2 && (
                <p style={{ fontSize: 'var(--text-base)', fontWeight: 700 }}>
                  🔥 连续学习 {sessionResult.currentStreak} 天！
                </p>
              )}
            </div>
          )}
          {sessionResult?.rewards && (sessionResult.rewards.xp > 0 || sessionResult.rewards.coins > 0) && (
            <div style={{ marginTop: 16, position: 'relative', zIndex: 2, textAlign: 'center' }}>
              <p style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--color-accent)' }}>
                +{sessionResult.rewards.xp} XP
                {sessionResult.rewards.coins > 0 && <> · +{sessionResult.rewards.coins} 金币</>}
              </p>
            </div>
          )}
          {sessionResult?.weeklyGoal && (
            <div style={{ marginTop: 8, position: 'relative', zIndex: 2 }}>
              <p style={{ fontSize: 'var(--text-base)', textAlign: 'center' }}>
                {sessionResult.weeklyGoal.sessionsCompleted >= sessionResult.weeklyGoal.sessionsRequired
                  ? <>🎉 本周作业已完成 —— {sessionResult.weeklyGoal.sessionsCompleted}/{sessionResult.weeklyGoal.sessionsRequired} 次。</>
                  : <>本周已完成 {sessionResult.weeklyGoal.sessionsCompleted} / {sessionResult.weeklyGoal.sessionsRequired} 次作业。</>}
              </p>
              {sessionResult.weeklyGoal.justFinishedSessionCounted === false && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 4 }}>
                  （复习间隔太近，这次不计入作业。最好间隔约 24 小时。）
                </p>
              )}
            </div>
          )}
          <div style={{ maxWidth: 320, margin: '24px auto 0', textAlign: 'left', position: 'relative', zIndex: 2 }}>
            {focusSelector}
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16, position: 'relative', zIndex: 2 }}>
            {weakCards.length > 0 && (
              <button className="btn btn-primary" onClick={keepStudying}>
                继续复习薄弱词（{weakCards.length}）
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => startSession()}>继续复习</button>
            <button className="btn btn-secondary" onClick={() => navigate('/student/stats')}>查看统计</button>
          </div>
        </div>
      )}
    </div>
  )
}

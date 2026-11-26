import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ZHONGKAO_23_DAYS } from '@vanilla-srs/shared/vocab'
import { api } from '../../utils/api'
import { trackAnalyticsEvent } from '../../utils/analytics'
import ShareCardModal from '../../components/ShareCardModal'
import { useEnrollment } from '../../utils/enrollment'
import { speakWord } from '../../utils/audio'
import { useGame } from '../../components/GameContext'
import MnemonicCardBlock from '../../components/MnemonicCardBlock'
import WorldDialog from '../../components/WorldDialog'
import { getWorldContent } from '../../components/WorldHome'
import type { WorldContentPack } from '@vanilla-srs/shared/world-content'
import { DEFAULT_WORLD_CONTENT } from '@vanilla-srs/shared/world-content'

interface LevelStatus {
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'BOSS' | 'REVIEW'
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'CLEARED' | 'FAILED' | 'SKIPPED'
  stars: number
  cleared: boolean
  questionCount: number
  answeredCount: number
}

interface DailyTaskSummary {
  taskId: string
  studyDate: string
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED'
  newWordTarget: number
  reviewTarget: number
  newWordCount: number
  reviewWordCount: number
  levels: LevelStatus[]
  progress: { completed: boolean; hasWords: boolean }
}

interface CampDayNode {
  day: number
  totalWords: number
  learnedCount: number
  stage4Count: number
  stage4Target: number
  l1To3Done: boolean
  bossDone: boolean
  stars: number
  status: 'CLEARED' | 'IN_PROGRESS' | 'LOCKED'
  isMajorBoss: boolean
  isFinale: boolean
}

interface CampMapData {
  days: CampDayNode[]
  currentDay: number
  clearedDays: number
  totalStars: number
  maxStars: number
}

const LEVEL_NAMES: Record<string, string> = {
  L1: 'L1 邂逅',
  L2: 'L2 辨义',
  L3: 'L3 辨词',
  L5: 'L5 念咒语',
  BOSS: '雾兽战',
  REVIEW: '艾斯复习',
}

function MiniRingSvg({ ratio, color, label }: { ratio: number; color: string; label: string }) {
  const r = 14
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(1, ratio)))
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-label={label}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--color-border)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 18 18)"
      />
    </svg>
  )
}

interface SmartPlanData {
  studyDate: string
  seasonActive: boolean
  returnProtected: boolean
  rawDueCount: number
  todayDueTarget: number
  remainingDueToday: number
  newWordTarget: number
  isDebtPaydownMode: boolean
  debtDays: number
  debtDailyPlan: number[]
  extraNewAvailable: boolean
  suggestedExtraNew: number
  estimatedMinutes: number
  avgSecondsPerWord: number
  reasonText: string
}

interface SeasonStatusData {
  configured: boolean
  name?: string
  examDate?: string
  startDate?: string
  isActive: boolean
  isEnded: boolean
  daysRemaining?: number
  milestones?: {
    stage4Count: number
    totalWords: number
    pct: number
    reachedMilestones: Array<{ pct: number; name: string; skinKey: string; badgeKey: string }>
    nextMilestone: { pct: number; name: string; targetWords: number } | null
  }
}

interface SquadStatusData {
  enabled: boolean
  weekStart: string
  mySquad: {
    id: string
    name: string
    members: Array<{ nickname: string; avatarKey: string; avatarFrame: string; isSelf: boolean }>
    progress: {
      totalMembers: number
      qualifiedMembers: number
      goalAchieved: boolean
      progressPct: number
    }
    cheersSentToday: number
    maxCheersPerDay: number
    recentCheers: Array<{ id: string; senderNickname: string; sticker: string; message: string }>
  } | null
  availableSquads: Array<{ id: string; name: string; memberCount: number; maxSize: number }>
  presets: Array<{ key: string; sticker: string; message: string }>
}

export default function TaskPage() {
  const [searchParams] = useSearchParams()
  const selectedDay = Math.max(1, Math.min(23, Number(searchParams.get('day')) || 1))
  const [worldContent, setWorldContent] = useState<WorldContentPack>(DEFAULT_WORLD_CONTENT)
  const [storyDay, setStoryDay] = useState<number | null>(null)
  const { active } = useEnrollment()
  const { summary } = useGame()
  const navigate = useNavigate()
  const [task, setTask] = useState<DailyTaskSummary | null>(null)
  const [campMap, setCampMap] = useState<CampMapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startingLevel, setStartingLevel] = useState<string | null>(null)
  const [previewIdx, setPreviewIdx] = useState(1)
  const [weekModalOpen, setWeekModalOpen] = useState(false)
  const [mapModalOpen, setMapModalOpen] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)

  const [smartPlan, setSmartPlan] = useState<SmartPlanData | null>(null)
  const [season, setSeason] = useState<SeasonStatusData | null>(null)
  const [squad, setSquad] = useState<SquadStatusData | null>(null)
  const [seasonModalOpen, setSeasonModalOpen] = useState(false)
  const [squadModalOpen, setSquadModalOpen] = useState(false)
  const [shareSeasonOpen, setShareSeasonOpen] = useState(false)
  const [newSquadName, setNewSquadName] = useState('')
  const [squadBusy, setSquadBusy] = useState(false)
  const [squadMsg, setSquadMsg] = useState<string | null>(null)

  const loadStage4Widgets = useCallback(async () => {
    if (!active) return
    const [p, se, sq] = await Promise.all([
      api.get<SmartPlanData>(`/students/plan/today?enrollmentId=${active.enrollmentId}`).catch(() => null),
      api.get<SeasonStatusData>(`/students/season?enrollmentId=${active.enrollmentId}`).catch(() => null),
      api.get<SquadStatusData>(`/students/squad?enrollmentId=${active.enrollmentId}`).catch(() => null),
    ])
    setSmartPlan(p)
    setSeason(se)
    setSquad(sq)
  }, [active])

  useEffect(() => {
    void loadStage4Widgets()
  }, [loadStage4Widgets])

  const handleJoinSquad = async (opts: { squadId?: string; name?: string }) => {
    if (!active || squadBusy) return
    setSquadBusy(true)
    setSquadMsg(null)
    try {
      const updated = await api.post<SquadStatusData>('/students/squad/join', {
        enrollmentId: active.enrollmentId,
        ...opts,
      })
      setSquad(updated)
      setNewSquadName('')
      setSquadMsg('已加入学习搭子小队，本周全员复习满 4 天即得小队徽章！')
    } catch (err: any) {
      setSquadMsg(err.message || '加入小队失败')
    } finally {
      setSquadBusy(false)
    }
  }

  const handleSendCheer = async (presetKey: string) => {
    if (!active || squadBusy) return
    setSquadBusy(true)
    setSquadMsg(null)
    try {
      await api.post('/students/squad/cheer', {
        enrollmentId: active.enrollmentId,
        presetKey,
      })
      trackAnalyticsEvent('squad_cheer_send', { presetKey }, { enrollmentId: active.enrollmentId })
      await loadStage4Widgets()
      setSquadMsg('已送出搭子击掌鼓励！')
    } catch (err: any) {
      setSquadMsg(err.message || '送出击掌失败')
    } finally {
      setSquadBusy(false)
    }
  }

  const day1Words = ZHONGKAO_23_DAYS[0]?.words ?? []
  const sampleWord = day1Words[previewIdx % Math.max(1, day1Words.length)]

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      api.get<DailyTaskSummary>(`/students/task/today?enrollmentId=${active.enrollmentId}`),
      api.get<CampMapData>(`/students/game/map?enrollmentId=${active.enrollmentId}`).catch(() => null),
    ])
      .then(([taskRes, mapRes]) => {
        if (cancelled) return
        setTask(taskRes)
        if (mapRes) setCampMap(mapRes)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '加载今日任务失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    getWorldContent(active.enrollmentId).then((r) => setWorldContent(r.content)).catch(() => undefined)
  }, [active?.enrollmentId])

  const handleStartLevel = async (level: string) => {
    if (!task) return
    setStartingLevel(level)
    try {
      const session = await api.post<{ sessionId: string }>('/students/levels/start', {
        taskId: task.taskId,
        level,
      })
      navigate(`/student/levels/${session.sessionId}`, { state: { day: currentDay } })
    } catch (err: any) {
      setError(err.message || '启动闯关失败')
    } finally {
      setStartingLevel(null)
    }
  }

  const visibleLevels = (task?.levels ?? []).filter((l) => l.level !== 'L4')
  const rings = summary?.today.rings
  const currentDay = campMap?.currentDay ?? 1
  const weekSliceStart = Math.min(16, Math.floor((currentDay - 1) / 7) * 7)
  const weekNodes = (campMap?.days ?? []).slice(weekSliceStart, weekSliceStart + 7)
  const challenge = summary?.classChallenge

  return (
    <>
      {/* 每日循环出口：家园与迷雾预报；这里保留复习/探险顺序选择权 */}
      {/* F2: 每日双环 + 连续天数 + 冻结券 */}
      {summary ? (
        <section className="dual-ring-strip" aria-label="每日双环与连续学习">
          <div className="dual-ring-pair">
            <div className="ring-item">
              <MiniRingSvg
                ratio={rings?.reviewRatio ?? 0}
                color="var(--color-accent)"
                label="复习环进度"
              />
              <div>
                <div className="ring-label">复习环</div>
                <div className="ring-val">
                  {rings?.reviewDue === 0
                    ? '今日已满'
                    : `${rings?.reviewDone ?? 0}/${rings?.reviewDue ?? 0}`}
                </div>
              </div>
            </div>
            <div className="ring-item">
              <MiniRingSvg
                ratio={rings?.levelRatio ?? 0}
                color="var(--color-accent-alt)"
                label="闯关环进度"
              />
              <div>
                <div className="ring-label">闯关环</div>
                <div className="ring-val">
                  {rings?.levelDone ?? 0}/{rings?.levelTotal ?? 3}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            className={`candy-pill ${rings?.ringsClosed ? 'berry' : ''}`}
            style={{ minHeight: 38, padding: '0 10px', fontSize: 12 }}
            onClick={() => setWeekModalOpen(true)}
          >
            🔥 {summary.profile.streakDays}天 · 🧊{summary.profile.freezeTickets}
          </button>
        </section>
      ) : null}

      {/* F8 / 22:30 护眼边界 */}
      {summary?.lateNightQuiet ? (
        <div className="camp-quiet-bar">
          <span>🌙 22:30 后不开启新限时活动，早点休息也助于记忆巩固</span>
        </div>
      ) : challenge && challenge.totalStudents > 0 ? (
        <section className="camp-challenge-bar" aria-label="班级周挑战">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 800 }}>
            <span>🏆 {challenge.title}</span>
            <span style={{ color: 'var(--color-berry-deep)' }}>
              {challenge.currentCount}/{challenge.targetCount} · 已参与 {challenge.participatingStudents}/{challenge.totalStudents} 人
            </span>
          </div>
          <div className="progress-bar" style={{ height: 6, marginTop: 4 }}>
            <div className="progress-fill" style={{ width: `${challenge.progressPct}%`, background: 'var(--color-accent-alt)' }} />
          </div>
        </section>
      ) : null}

      {!active ? (
        <div className="camp-hero-card">
          <div>
            <h1 className="camp-word-title" style={{ fontSize: 24 }}>尚未选择学习班级</h1>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
              可以先点「去选班级」，或直接用下方 23 天中考高频邪修卡热身。
            </p>
          </div>
          <Link to="/student" className="camp-btn camp-btn-berry">前往选择班级</Link>
        </div>
      ) : (
        <section className="camp-hero-card" style={{ flex: '0 0 auto', padding: '10px 12px', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong style={{ fontSize: 15 }}>今日探险任务</strong>
              {summary?.today.rings.ringsClosed && (
                <span className="badge badge-green">双环已合拢</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(summary?.weakWordCount ?? 0) > 0 && (
                <Link
                  to="/student/review?mode=weak-boss"
                  className="candy-pill"
                  style={{ minHeight: 34, padding: '0 8px', fontSize: 12, background: 'var(--color-sticky)', color: 'var(--color-sticky-ink)' }}
                >
                  ⚔️ 雾兽 ({summary?.weakWordCount})
                </Link>
              )}
              <Link
                to="/student/review"
                className="candy-pill berry"
                style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}
              >
                驱雾复习
              </Link>
            </div>
          </div>

          {(smartPlan || season?.configured || squad?.enabled) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {smartPlan && (
                <span className="badge badge-blue" title={smartPlan.reasonText}>
                  ⏱ 约 {smartPlan.estimatedMinutes} 分钟 · {smartPlan.isDebtPaydownMode ? `清账优先(新词0/${smartPlan.debtDays}天计划)` : `新词 ${smartPlan.newWordTarget}`}
                </span>
              )}
              {smartPlan?.extraNewAvailable && (
                <button
                  type="button"
                  className="candy-pill sticky"
                  style={{ minHeight: 28, padding: '0 10px', fontSize: 11 }}
                  onClick={() => navigate('/student/review?bypass=1')}
                >
                  +{smartPlan.suggestedExtraNew} 加餐
                </button>
              )}
              {season?.configured && (
                <button
                  type="button"
                  className="candy-pill berry"
                  style={{ minHeight: 28, padding: '0 10px', fontSize: 11 }}
                  onClick={() => setSeasonModalOpen(true)}
                >
                  🏁 {season.isEnded ? '赛季已收官' : `距考 ${season.daysRemaining ?? 0} 天`} · {season.milestones?.pct ?? 0}%
                </button>
              )}
              {squad?.enabled && (
                <button
                  type="button"
                  className="candy-pill mint"
                  style={{ minHeight: 28, padding: '0 10px', fontSize: 11 }}
                  onClick={() => setSquadModalOpen(true)}
                >
                  🤝 {squad.mySquad ? `小队 ${squad.mySquad.progress.qualifiedMembers}/${squad.mySquad.progress.totalMembers}` : '搭子小队'}
                </button>
              )}
            </div>
          )}

          {seasonModalOpen && season?.configured && (
            <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="冲刺赛季进度">
              <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="modal-header" style={{ marginBottom: 0 }}>
                  <h2>{season.name ?? '中考冲刺赛季'}</h2>
                  <button type="button" className="candy-pill" onClick={() => setSeasonModalOpen(false)}>关闭</button>
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  目标日期：{season.examDate} · {season.isEnded ? '赛季已收官' : `剩余 ${season.daysRemaining ?? 0} 天`} · 仅影响优先级排序，不改 FSRS 间隔
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                    <span>核心词达成 Stage ≥ 4</span>
                    <span>{season.milestones?.stage4Count ?? 0}/{season.milestones?.totalWords ?? 688} ({season.milestones?.pct ?? 0}%)</span>
                  </div>
                  <div className="progress-bar" style={{ height: 10, marginTop: 4 }}>
                    <div className="progress-fill" style={{ width: `${season.milestones?.pct ?? 0}%` }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[25, 50, 75, 100].map((pct) => {
                    const hit = (season.milestones?.pct ?? 0) >= pct
                    return (
                      <span key={pct} className={`badge ${hit ? 'badge-green' : 'badge-gray'}`}>
                        {hit ? '🏅' : '🔒'} {pct}% 赛季皮肤
                      </span>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className="camp-btn camp-btn-berry"
                  onClick={() => {
                    setSeasonModalOpen(false)
                    setShareSeasonOpen(true)
                  }}
                >
                  生成赛季回顾分享卡
                </button>
              </div>
            </div>
          )}

          {squadModalOpen && squad?.enabled && (
            <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="学习搭子小队">
              <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="modal-header" style={{ marginBottom: 0 }}>
                  <h2>🤝 学习搭子小队（2–3人）</h2>
                  <button type="button" className="candy-pill" onClick={() => setSquadModalOpen(false)}>关闭</button>
                </div>
                {squadMsg && <div className="alert alert-info" style={{ marginBottom: 0 }}>{squadMsg}</div>}
                {squad.mySquad ? (
                  <>
                    <div className="camp-def-box" style={{ padding: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                        <span>{squad.mySquad.name}</span>
                        <span>{squad.mySquad.progress.qualifiedMembers}/{squad.mySquad.progress.totalMembers} 人本周 ≥4 天合拢</span>
                      </div>
                      <div className="progress-bar" style={{ height: 8, marginTop: 6 }}>
                        <div className="progress-fill" style={{ width: `${squad.mySquad.progress.progressPct}%` }} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {squad.mySquad.members.map((m, idx) => (
                          <span key={idx} className="badge badge-blue">
                            {m.nickname}{m.isSelf ? '（我）' : ''}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                        全员每周 ≥ 4 天复习环合拢即可获得小队徽章；不展示个人未完成明细。
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                        送出搭子击掌（今日 {squad.mySquad.cheersSentToday}/{squad.mySquad.maxCheersPerDay} 次）
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {squad.presets.map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            className="candy-pill"
                            style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}
                            disabled={squadBusy || squad.mySquad!.cheersSentToday >= squad.mySquad!.maxCheersPerDay}
                            onClick={() => void handleSendCheer(p.key)}
                          >
                            {p.sticker} {p.message}
                          </button>
                        ))}
                      </div>
                    </div>
                    {squad.mySquad.recentCheers.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
                        {squad.mySquad.recentCheers.slice(0, 5).map((c) => (
                          <div key={c.id} style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                            {c.sticker} <strong>{c.senderNickname}</strong>：{c.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="form-control"
                        placeholder="新小队名称（如：晨读冲刺小队）"
                        value={newSquadName}
                        onChange={(e) => setNewSquadName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="camp-btn camp-btn-mint"
                        disabled={squadBusy}
                        onClick={() => void handleJoinSquad({ name: newSquadName.trim() || '香草并肩小队' })}
                      >
                        创建小队
                      </button>
                    </div>
                    {squad.availableSquads.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>或加入本班空位小队：</div>
                        {squad.availableSquads.map((s) => (
                          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{s.name}（{s.memberCount}/{s.maxSize}人）</span>
                            <button
                              type="button"
                              className="candy-pill"
                              disabled={squadBusy}
                              onClick={() => void handleJoinSquad({ squadId: s.id })}
                            >
                              加入
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <ShareCardModal open={shareSeasonOpen} onClose={() => setShareSeasonOpen(false)} initialTab="season" />

          {error && <div className="alert alert-danger" style={{ marginBottom: 0 }}>{error}</div>}

          {loading ? (
            <div style={{ padding: 10, textAlign: 'center', color: 'var(--color-text-muted)' }}>加载今日特训中...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {visibleLevels.map((lvl) => (
                <button
                  key={lvl.level}
                  type="button"
                  className={`camp-btn ${lvl.cleared ? 'camp-btn-mint' : lvl.state === 'IN_PROGRESS' ? 'camp-btn-sticky' : ''}`}
                  style={{ minHeight: 42, flexDirection: 'column', gap: 0, padding: '3px 4px', fontSize: 12 }}
                  disabled={startingLevel === lvl.level}
                  onClick={() => void handleStartLevel(lvl.level)}
                >
                  <span>{LEVEL_NAMES[lvl.level] ?? lvl.level}</span>
                  <span style={{ fontSize: 11, opacity: 0.9 }}>
                    {lvl.cleared ? `已通关 ${'★'.repeat(lvl.stars)}` : lvl.state === 'IN_PROGRESS' ? '继续' : '开始'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* F3: 本周 7 格营地地图卡片（点开看 23 天全图，不新增长滚动） */}
      <section className="camp-hero-card" style={{ padding: '10px 12px', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <div>
            <strong style={{ fontSize: 14 }}>香草群岛 · {(() => { const island = worldContent.islands.find((i) => currentDay >= i.startDay && currentDay <= i.endDay); return island ? `${island.name} · 第 ${currentDay} 天` : `第 ${currentDay} 天` })()}</strong>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {campMap
                ? `已通关 ${campMap.clearedDays}/23 天 · ⭐ ${campMap.totalStars}/${campMap.maxStars}`
                : 'D7 / D14 / D21 大关 · D23 终章'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="candy-pill"
              style={{ minHeight: 34, padding: '0 8px', fontSize: 12 }}
              onClick={() => setPreviewModalOpen(true)}
            >
              邪修速记卡
            </button>
            <button
              type="button"
              className="candy-pill sky"
              style={{ minHeight: 34, padding: '0 8px', fontSize: 12 }}
              onClick={() => setMapModalOpen(true)}
            >
              23天全图
            </button>
          </div>
        </div>

        <div className="camp-week-grid">
          {weekNodes.map((node) => (
            <button
              key={node.day}
              type="button"
              className={`camp-day-node ${node.status.toLowerCase()} ${node.isMajorBoss || node.isFinale ? 'milestone' : ''}`}
              onClick={() => setMapModalOpen(true)}
            >
              <span className="day-num">D{node.day}</span>
              <span className="day-stars">
                {node.status === 'LOCKED'
                  ? '🔒'
                  : node.stars > 0
                    ? '★'.repeat(node.stars) + '☆'.repeat(3 - node.stars)
                    : '进行中'}
              </span>
              {(node.isMajorBoss || node.isFinale) && (
                <span className="day-tag">{node.isFinale ? '终章' : '大关'}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* 本周 7 天双环 & 冻结券弹层 */}
      {weekModalOpen && summary && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="本周连续学习">
          <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="modal-header" style={{ marginBottom: 0 }}>
              <h2>本周连续打卡 & 冻结券</h2>
              <button type="button" className="candy-pill" onClick={() => setWeekModalOpen(false)}>关闭</button>
            </div>
            <div className="week-dots-grid">
              {summary.weekDays.map((d) => (
                <div
                  key={d.localDate}
                  className={`week-dot-cell ${d.ringsClosed ? 'lit' : ''} ${d.isToday ? 'today' : ''}`}
                >
                  <span>{d.label}</span>
                  <strong>{d.ringsClosed ? '✅' : d.xpEarned > 0 ? '🌱' : '·'}</strong>
                  <span style={{ fontSize: 10 }}>{d.xpEarned}XP</span>
                </div>
              ))}
            </div>
            <div className="camp-def-box" style={{ fontSize: 13 }}>
              <div>当前连续：<strong>{summary.profile.streakDays} 天</strong>（历史最长 {summary.profile.longestStreak} 天）</div>
              <div style={{ marginTop: 4 }}>
                冻结券：<strong>{summary.profile.freezeTickets} / 2 张</strong>（每连胜 7 天自动获得 1 张；断签 1 天时自动抵扣保护连胜）
              </div>
              <div style={{ marginTop: 4, color: 'var(--color-text-muted)' }}>
                双环合拢条件：今日复习环清零 + 闯关 L1–L3 全部通过，奖励 +30 XP！
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 23 天全图弹层 (F3) */}
      {mapModalOpen && campMap && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="香草群岛四岛地图">
          <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '85vh' }}>
            <div className="modal-header" style={{ marginBottom: 0 }}>
              <h2>香草群岛 · 23 天旅程</h2>
              <button type="button" className="candy-pill" onClick={() => setMapModalOpen(false)}>关闭</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              1–3 星代表据点灯数：通过 L1–L3 点 1 盏，再过雾兽点 2 盏，该天 ≥80% 词灵达艾斯第 4 阶点 3 盏。
            </div>
            <div className="camp-full-map-grid">
              {campMap.days.map((node) => (
                <div
                  key={node.day}
                  className={`camp-day-node ${node.status.toLowerCase()} ${node.isMajorBoss || node.isFinale ? 'milestone' : ''}`}
                  style={{ cursor: 'default' }}
                >
                  <span className="day-num">
                    D{node.day} {node.isFinale ? '🏆' : node.isMajorBoss ? '🚩' : ''}
                  </span>
                  <span className="day-stars">
                    {node.status === 'LOCKED'
                      ? '🔒'
                      : `${'★'.repeat(node.stars)}${'☆'.repeat(3 - node.stars)}`}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.8 }}>
                    4阶 {node.stage4Count}/{node.stage4Target}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 抢先邪修词卡弹窗 */}
      {previewModalOpen && sampleWord && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="邪修速记卡">
          <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="modal-header" style={{ marginBottom: 0 }}>
              <span className="badge badge-blue">23天高频抢先记 · Day 1</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="candy-pill" onClick={() => speakWord(sampleWord.word)}>🔊 读音</button>
                <button type="button" className="candy-pill" onClick={() => setPreviewModalOpen(false)}>关闭</button>
              </div>
            </div>
            <div>
              <div className="camp-word-title" style={{ fontSize: 30 }}>{sampleWord.word}</div>
              <div className="camp-ipa">{sampleWord.ipa} · {sampleWord.meaning}</div>
            </div>
            <MnemonicCardBlock word={sampleWord.word} mnemonic={sampleWord.mnemonic} compact />
            <button
              type="button"
              className="camp-btn camp-btn-sticky"
              onClick={() => setPreviewIdx((i) => (i + 1) % day1Words.length)}
            >
              换张邪修卡
            </button>
          </div>
        </div>
      )}
    </>
  )
}

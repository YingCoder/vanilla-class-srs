import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { useEnrollment } from '../../utils/enrollment'

export interface LevelStatusView {
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'BOSS' | 'REVIEW'
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'FAILED' | 'CLEARED' | 'SKIPPED'
  stars: number
  cleared: boolean
  attemptNo: number | null
  questionCount: number
  answeredCount: number
}

export interface DailyTaskSummary {
  taskId: string
  enrollmentId: string
  studyDate: string
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED'
  newWordTarget: number
  reviewTarget: number
  newWordCount: number
  reviewWordCount: number
  levels: LevelStatusView[]
  progress: {
    newWordPartDone: boolean
    reviewPartDone: boolean
    completed: boolean
    hasWords: boolean
  }
  completedAt: string | null
}

const LEVEL_ORDER = ['L1', 'L2', 'L3', 'L4', 'L5', 'BOSS', 'REVIEW'] as const

const LEVEL_META: Record<LevelStatusView['level'], { icon: string; name: string; desc: string }> = {
  L1: { icon: '👀', name: '认识新词', desc: '看一遍今天要学的新单词' },
  L2: { icon: '🔤', name: '英译中选择', desc: '看英文选中文释义' },
  L3: { icon: '🀄', name: '中译英选择', desc: '看中文选英文单词' },
  L4: { icon: '🔊', name: '听音辨词', desc: '音频尚未接入，做等价练习' },
  L5: { icon: '✍️', name: '拼写挑战', desc: '根据释义拼出单词' },
  BOSS: { icon: '👹', name: 'Boss 关卡', desc: '混合题型大考验' },
  REVIEW: { icon: '🔁', name: '复习关卡', desc: '巩固到期的旧单词' },
}

function starsText(stars: number): string {
  if (stars <= 0) return '—'
  return '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars))
}

function stateBadge(level: LevelStatusView): { cls: string; label: string } | null {
  switch (level.state) {
    case 'CLEARED':
      return { cls: 'badge badge-green', label: '已通过' }
    case 'FAILED':
      return { cls: 'badge badge-red', label: '未通过' }
    case 'IN_PROGRESS':
      return { cls: 'badge badge-blue', label: `进行中 ${level.answeredCount}/${level.questionCount}` }
    case 'SKIPPED':
      return { cls: 'badge badge-gray', label: '等价练习' }
    default:
      return null
  }
}

export default function TaskPage() {
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const location = useLocation()
  const [task, setTask] = useState<DailyTaskSummary | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState<LevelStatusView['level'] | null>(null)

  const load = useCallback(async () => {
    if (!active) return
    setError('')
    try {
      const data = await api.get<DailyTaskSummary>(
        `/students/task/today?enrollmentId=${encodeURIComponent(active.enrollmentId)}`,
      )
      setTask(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '今日任务加载失败')
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load, location.key])

  if (!active) { navigate('/student'); return null }

  const start = async (level: LevelStatusView) => {
    if (!task || starting) return
    setError('')
    // L4 has no real audio yet: send the student to the equivalent choice practice.
    if (level.level === 'L4') {
      navigate('/student/choice')
      return
    }
    setStarting(level.level)
    try {
      const view = await api.post<{ sessionId: string }>('/students/levels/start', {
        taskId: task.taskId,
        level: level.level,
      })
      navigate(`/student/levels/${view.sessionId}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '关卡开启失败，请重试')
      setStarting(null)
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  if (!task) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 16px' }}>
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error || '今日任务加载失败'}</div>
        <button className="btn btn-secondary" onClick={() => { setLoading(true); void load() }}>重新加载</button>
      </div>
    )
  }

  const ordered = [...task.levels].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  )
  const newWordLevels = ordered.filter((level) => level.level !== 'REVIEW')
  const reviewLevel = ordered.find((level) => level.level === 'REVIEW') ?? null
  const reviewUnavailable = task.reviewWordCount === 0

  const renderLevelCard = (level: LevelStatusView) => {
    const meta = LEVEL_META[level.level]
    const badge = stateBadge(level)
    const unavailable = level.level === 'REVIEW' && reviewUnavailable
    const busy = starting === level.level
    const actionable = !unavailable
    return (
      <div
        key={level.level}
        className="card"
        style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: unavailable ? 0.55 : 1 }}
      >
        <div style={{ fontSize: 30, lineHeight: 1 }} aria-hidden>{meta.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>{level.level} · {meta.name}</span>
            {level.stars > 0 && (
              <span style={{ color: 'var(--color-warning)', fontSize: 'var(--text-sm)' }}>{starsText(level.stars)}</span>
            )}
            {badge && <span className={badge.cls}>{badge.label}</span>}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 2 }}>
            {unavailable ? '今天没有到期复习词' : meta.desc}
            {level.state === 'FAILED' && level.attemptNo !== null && ` · 第 ${level.attemptNo} 次挑战未通过，可以再试一次`}
          </div>
        </div>
        {actionable && (
          <button
            className={`btn ${level.state === 'NOT_STARTED' ? 'btn-primary' : 'btn-secondary'}`}
            disabled={busy}
            onClick={() => void start(level)}
          >
            {busy
              ? '开启中…'
              : level.level === 'L4'
                ? '去练习'
                : level.state === 'CLEARED'
                  ? '查看'
                  : level.state === 'IN_PROGRESS'
                    ? '继续'
                    : level.state === 'FAILED'
                      ? '重试'
                      : '开始'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 40px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title" style={{ marginBottom: 6 }}>今日任务</h1>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          {task.studyDate} · 新词 {task.newWordCount}/{task.newWordTarget} · 复习 {task.reviewWordCount}/{task.reviewTarget}
        </div>
      </div>

      {task.progress.completed && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          🎉 今日任务全部完成！明天再来继续加油。
        </div>
      )}
      {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

      {!task.progress.hasWords && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          今天没有新词或到期复习词。可以去做<Link to="/student/review" style={{ margin: '0 4px' }}>自由复习</Link>，或明天再来。
        </div>
      )}

      <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: '0 0 10px' }}>新词闯关</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {task.newWordCount === 0 ? (
          <div className="card" style={{ color: 'var(--color-text-muted)' }}>今天没有新词任务。</div>
        ) : (
          newWordLevels.map(renderLevelCard)
        )}
      </div>

      <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: '0 0 10px' }}>今日复习</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {reviewLevel && renderLevelCard(reviewLevel)}
        <div className="card" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          想找更多练习？试试
          <Link to="/student/choice" style={{ margin: '0 4px' }}>认词练习</Link>·
          <Link to="/student/spelling" style={{ margin: '0 4px' }}>拼写练习</Link>·
          <Link to="/student/review" style={{ margin: '0 4px' }}>自由复习</Link>
        </div>
      </div>
    </div>
  )
}

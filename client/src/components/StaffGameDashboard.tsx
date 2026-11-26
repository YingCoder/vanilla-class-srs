import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../utils/api'
import {
  StaffEffectDashboardPanel,
  StaffStage4ClassControls,
  StaffWeeklyReportPanel,
} from './StaffStage4Panels'
import ThemeToggleButton from './ThemeToggleButton'

interface ClassOption {
  id: string
  name: string
  subjectGrade: { name: string }
  _count: { enrollments: number }
}

interface CheerPreset {
  key: string
  sticker: string
  message: string
}

interface GameOverview {
  studyDate: string
  classInfo: { id: string; name: string; subjectGradeName: string }
  totalStudents: number
  todayAchievedCount: number
  streakDistribution: { zero: number; d1to2: number; d3to6: number; d7plus: number }
  atRiskStudents: Array<{
    studentId: string
    name: string
    username: string | null
    daysInactive: number
    lastStudiedDate: string | null
    streakDays: number
  }>
  students: Array<{
    studentId: string
    name: string
    username: string | null
    nickname: string | null
    level: number
    totalXp: number
    streakDays: number
    achievedToday: boolean
    todayXp: number
  }>
  settings: {
    leaderboardOpen: boolean
    weeklyTargetCards: number
  }
  challenge: {
    weekStart: string
    title: string
    targetCount: number
    currentCount: number
    participatingStudents: number
    totalStudents: number
    completed: boolean
    progressPct: number
    recommendedTarget: number
  }
  recentCheers: Array<{
    id: string
    senderName: string
    studentId: string | null
    sticker: string
    message: string
    createdAt: string
  }>
  presets: CheerPreset[]
}

export default function StaffGameDashboard({ scope }: { scope: 'teacher' | 'admin' }) {
  const basePath = scope === 'admin' ? '/admin/game' : '/teachers/game'
  const [stage4Tab, setStage4Tab] = useState<'overview' | 'effect' | 'report'>('overview')
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [classId, setClassId] = useState<string>('')
  const [overview, setOverview] = useState<GameOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [weeklyTarget, setWeeklyTarget] = useState(300)
  const [challengeTitle, setChallengeTitle] = useState('本周全班挑战 · 到期复习清零')
  const [savingSettings, setSavingSettings] = useState(false)

  const [cheerTarget, setCheerTarget] = useState<string>('ALL')
  const [presetKey, setPresetKey] = useState<string>('great_streak')
  const [sendingCheer, setSendingCheer] = useState(false)

  useEffect(() => {
    api
      .get<ClassOption[]>(`${basePath}/classes`)
      .then((list) => {
        setClasses(list)
        if (list.length > 0) setClassId((prev) => prev || list[0].id)
        else setLoading(false)
      })
      .catch((err) => {
        setError(err.message || '加载班级列表失败')
        setLoading(false)
      })
  }, [basePath])

  const loadOverview = useCallback(async (cid: string) => {
    if (!cid) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<GameOverview>(`${basePath}/overview?classId=${cid}`)
      setOverview(data)
      setLeaderboardOpen(data.settings.leaderboardOpen)
      setWeeklyTarget(data.challenge.targetCount)
      setChallengeTitle(data.challenge.title)
      if (data.presets[0]) setPresetKey((prev) => prev || data.presets[0].key)
    } catch (err: any) {
      setError(err.message || '加载激励看板失败')
    } finally {
      setLoading(false)
    }
  }, [basePath])

  useEffect(() => {
    if (classId) void loadOverview(classId)
  }, [classId, loadOverview])

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault()
    if (!classId) return
    setSavingSettings(true)
    setError(null)
    setNotice(null)
    try {
      await api.put(`${basePath}/settings`, {
        classId,
        leaderboardOpen,
        weeklyTargetCards: Number(weeklyTarget),
        challengeTitle: challengeTitle.trim() || undefined,
      })
      setNotice('班级激励设置已更新！')
      await loadOverview(classId)
    } catch (err: any) {
      setError(err.message || '保存设置失败')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleSendCheer = async (targetStudentId?: string | null, overridePreset?: string) => {
    if (!classId) return
    setSendingCheer(true)
    setError(null)
    setNotice(null)
    try {
      await api.post(`${basePath}/cheer`, {
        classId,
        studentId: targetStudentId !== undefined ? targetStudentId : cheerTarget === 'ALL' ? null : cheerTarget,
        presetKey: overridePreset ?? presetKey,
      })
      setNotice('鼓励击掌已发出！学生下次打开学习页即可看到。')
      await loadOverview(classId)
    } catch (err: any) {
      setError(err.message || '发送鼓励失败')
    } finally {
      setSendingCheer(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header print-hide">
        <div>
          <h1 className="page-title">班级激励看板、留存效果与周报</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${stage4Tab === 'overview' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setStage4Tab('overview')}
          >
            激励与开关
          </button>
          <button
            type="button"
            className={`btn btn-sm ${stage4Tab === 'effect' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setStage4Tab('effect')}
          >
            留存效果看板 (R2)
          </button>
          <button
            type="button"
            className={`btn btn-sm ${stage4Tab === 'report' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setStage4Tab('report')}
          >
            每周周报 (R8)
          </button>
        </div>
      </div>

      {stage4Tab === 'effect' && <StaffEffectDashboardPanel scope={scope} />}
      {stage4Tab === 'report' && <StaffWeeklyReportPanel scope={scope} />}
      {stage4Tab === 'overview' && <StaffStage4ClassControls scope={scope} />}

      {stage4Tab === 'overview' && (
      <div style={{ marginTop: 12 }}>
      <div className="page-header" style={{ display: 'none' }}>
        <div>
          <h1 className="page-title">班级激励看板与击掌（Stage 3）</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            查看今日双环达成、连续天数分布、掉队预警名单，配置班内进步榜与全班周挑战，并发送击掌鼓励。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {classes.length > 0 && (
            <select
              aria-label="选择班级"
              className="form-select"
              style={{ width: 'auto', minWidth: 180 }}
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.subjectGrade.name} · {c._count.enrollments}人）
                </option>
              ))}
            </select>
          )}
          <ThemeToggleButton />
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {loading && !overview ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : !overview ? (
        <div className="card">暂无可管理的班级，请先创建班级并导入学生。</div>
      ) : (
        <>
          <div className="grid-3">
            <div className="card stat-block">
              <div className="stat-value">
                {overview.todayAchievedCount} / {overview.totalStudents}
              </div>
              <div className="stat-label">今日双环达成人数（{overview.studyDate}）</div>
            </div>
            <div className="card stat-block">
              <div className="stat-value">
                {overview.challenge.currentCount} / {overview.challenge.targetCount}
              </div>
              <div className="stat-label">
                本周全班挑战进度（已参与 {overview.challenge.participatingStudents}/{overview.challenge.totalStudents} 人）
              </div>
            </div>
            <div className="card stat-block">
              <div className="stat-value" style={{ color: overview.atRiskStudents.length > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                {overview.atRiskStudents.length} 人
              </div>
              <div className="stat-label">掉队预警（连续 ≥ 3 天未达成，仅师长可见）</div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 16, marginBottom: 10 }}>连续打卡天数分布</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <div className="camp-def-box" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{overview.streakDistribution.zero}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>0 天（待启动）</div>
              </div>
              <div className="camp-def-box" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{overview.streakDistribution.d1to2}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>1–2 天（起步中）</div>
              </div>
              <div className="camp-def-box" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{overview.streakDistribution.d3to6}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>3–6 天（渐入佳境）</div>
              </div>
              <div className="camp-def-box" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{overview.streakDistribution.d7plus}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>7 天+（获冻结券）</div>
              </div>
            </div>
          </div>

          <div className="grid-2">
            <form className="card" onSubmit={(e) => void handleSaveSettings(e)}>
              <h2 style={{ fontSize: 17, marginBottom: 12 }}>班级开关与周挑战目标</h2>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={leaderboardOpen}
                    onChange={(e) => setLeaderboardOpen(e.target.checked)}
                  />
                  开启班内进步榜（默认关闭，仅显示前 10 名昵称与本周 XP 增量）
                </label>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wk-title">本周全班挑战名称</label>
                <input
                  id="wk-title"
                  className="form-input"
                  value={challengeTitle}
                  onChange={(e) => setChallengeTitle(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wk-target">
                  本周全班到期复习清理目标（系统推荐：{overview.challenge.recommendedTarget} 张）
                </label>
                <input
                  id="wk-target"
                  type="number"
                  min={10}
                  max={50000}
                  className="form-input"
                  value={weeklyTarget}
                  onChange={(e) => setWeeklyTarget(Number(e.target.value))}
                />
              </div>
              <button type="submit" className="camp-btn camp-btn-mint" disabled={savingSettings}>
                {savingSettings ? '保存中...' : '保存班级配置'}
              </button>
            </form>

            <div className="card">
              <h2 style={{ fontSize: 17, marginBottom: 12 }}>发送预设击掌鼓励（不打断做题）</h2>
              <div className="form-group">
                <label className="form-label" htmlFor="cheer-target">接收对象</label>
                <select
                  id="cheer-target"
                  className="form-select"
                  value={cheerTarget}
                  onChange={(e) => setCheerTarget(e.target.value)}
                >
                  <option value="ALL">全班所有同学</option>
                  {overview.students.map((s) => (
                    <option key={s.studentId} value={s.studentId}>
                      {s.name}（{s.username ?? '无用户名'} · 连胜 {s.streakDays} 天）
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cheer-preset">选择 6 条预设鼓励之一</label>
                <select
                  id="cheer-preset"
                  className="form-select"
                  value={presetKey}
                  onChange={(e) => setPresetKey(e.target.value)}
                >
                  {overview.presets.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.sticker} {p.message}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="camp-btn camp-btn-berry"
                disabled={sendingCheer}
                onClick={() => void handleSendCheer()}
              >
                {sendingCheer ? '发送中...' : '发送击掌鼓励 🙌'}
              </button>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 17, marginBottom: 10 }}>
              掉队学生名单（连续 ≥ 3 天未达成 · 仅教师与管理员可见）
            </h2>
            {overview.atRiskStudents.length === 0 ? (
              <div className="alert alert-success" style={{ marginBottom: 0 }}>
                太棒了！目前没有连续 3 天未达成双环的学生。
              </div>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>真实姓名</th>
                      <th>登录名</th>
                      <th>未达成天数</th>
                      <th>最近活跃</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.atRiskStudents.map((s) => (
                      <tr key={s.studentId}>
                        <td><strong>{s.name}</strong></td>
                        <td style={{ fontFamily: 'monospace' }}>{s.username ?? '—'}</td>
                        <td><span className="badge badge-red">{s.daysInactive} 天</span></td>
                        <td>{s.lastStudiedDate ?? '尚未开始'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={sendingCheer}
                            onClick={() => void handleSendCheer(s.studentId, 'come_back')}
                          >
                            🍦 发送回归鼓励
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { api } from '../utils/api'

interface ClassOption {
  id: string
  name: string
  subjectGrade?: { name: string } | null
}

interface EffectDashboardData {
  classInfo: { id: string; name: string; subjectGradeName: string }
  asOfDate: string
  weeks: number
  totalStudents: number
  activeConfigVersion: string
  activeConfigScope: string | { mode: 'ALL' } | { mode: 'CLASSES'; classIds?: string[] }
  summary: {
    weeklyActiveDaysAvg: number
    dueCompletionRate: number
    dualRingCloseRate: number
    todayDualRingCloseRate: number
    retention7dRate: number
    reminderRecallRate: number
    mnemonicCoverageRate: number
    xpCapHitRate: number
    gamificationOptOutRate: number
  }
  weeklyTrends: Array<{
    weekStart: string
    activeStudents: number
    weeklyActiveDaysAvg: number
    dueCompletionRate: number
    dualRingCloseRate: number
    retention7dRate: number
    xpCapHitRate: number
    gamificationOptOutRate: number
  }>
  funnel: {
    appOpen: number
    reviewStart: number
    reviewRingClosed: number
    levelRingClosed: number
    dualRingClosed: number
  }
  badgeDistribution: Array<{ key: string; name: string; icon: string; earnedCount: number }>
  bossParticipationRate: number
  challengeParticipationRate: number
}

interface WeeklyReportResponse {
  report: {
    classId: string
    weekStart: string
    generatedAt: string
    payload: {
      classInfo: { id: string; name: string; subjectGradeName: string }
      weekStart: string
      weekEnd: string
      totalStudents: number
      metrics: {
        weeklyActiveDaysAvg: number
        dueCompletionRate: number
        dualRingCloseRate: number
        retention7dRate: number
        xpCapHitRate: number
        gamificationOptOutRate: number
      }
      delta: {
        weeklyActiveDaysAvg: number
        dueCompletionRate: number
        dualRingCloseRate: number
        retention7dRate: number
      } | null
      topImproved: Array<{
        studentId: string
        name: string
        nickname: string | null
        thisWeekXp: number
        prevWeekXp: number
        deltaXp: number
      }>
      atRiskStudents: Array<{
        studentId: string
        name: string
        username: string | null
        daysInactive: number
        lastStudiedDate: string | null
      }>
      advice: Array<{
        level?: string
        metric?: string
        configKey?: string
        title: string
        detail?: string
        reason?: string
      }>
      activeConfigVersion: string
    }
  }
  availableWeeks: Array<{ weekStart: string; generatedAt: string }>
}

interface StaffSquadResponse {
  squadEnabled: boolean
  squads: Array<{
    id: string
    name: string
    members: Array<{
      studentId: string
      name: string
      username: string | null
      nickname: string | null
    }>
  }>
  students?: Array<{
    studentId: string
    name: string
    username: string | null
  }>
  unassignedStudents?: Array<{
    studentId: string
    name: string
    username: string | null
    nickname?: string | null
  }>
}

function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`
}

export function useStaffClasses(scope: 'teacher' | 'admin') {
  const basePath = scope === 'admin' ? '/admin/game' : '/teachers/game'
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')

  useEffect(() => {
    api
      .get<{ classes?: ClassOption[] } | ClassOption[]>(`${basePath}/classes`)
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.classes ?? [])
        setClasses(list)
        if (list.length > 0 && !selectedClassId) setSelectedClassId(list[0].id)
      })
      .catch(() => {})
  }, [basePath])

  return { classes, selectedClassId, setSelectedClassId }
}

export function StaffStage4ClassControls({ scope }: { scope: 'teacher' | 'admin' }) {
  const staffBase = scope === 'admin' ? '/admin' : '/teachers'
  const gameBase = scope === 'admin' ? '/admin/game' : '/teachers/game'
  const { classes, selectedClassId, setSelectedClassId } = useStaffClasses(scope)

  const [coCreateOpen, setCoCreateOpen] = useState(false)
  const [squadsData, setSquadsData] = useState<StaffSquadResponse | null>(null)
  const [newSquadName, setNewSquadName] = useState('第1并肩小队')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [seasonName, setSeasonName] = useState('中考冲刺赛季')
  const [examDate, setExamDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [seasonStatus, setSeasonStatus] = useState<'AUTO' | 'ACTIVE' | 'PAUSED' | 'ENDED'>('AUTO')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loadClassDetails = useCallback(async () => {
    if (!selectedClassId) return
    const [sq, se, dashboard] = await Promise.all([
      api.get<StaffSquadResponse>(`${staffBase}/classes/${selectedClassId}/squads`).catch(() => null),
      api.get<any>(`${staffBase}/classes/${selectedClassId}/season`).catch(() => null),
      api.get<{ settings?: { mnemonicCoCreateOpen?: boolean } }>(`${gameBase}/overview?classId=${selectedClassId}`).catch(() => null),
    ])
    setSquadsData(sq)
    if (dashboard?.settings) {
      setCoCreateOpen(Boolean(dashboard.settings.mnemonicCoCreateOpen))
    }
    if (se) {
      setSeasonName(se.name || '中考冲刺赛季')
      setExamDate(se.examDate || '')
      setStartDate(se.startDate || '')
      setSeasonStatus(se.status || 'AUTO')
    } else {
      setExamDate('')
      setStartDate('')
      setSeasonStatus('AUTO')
    }
  }, [staffBase, gameBase, selectedClassId])

  useEffect(() => {
    void loadClassDetails()
  }, [loadClassDetails])

  const saveToggle = async (field: 'mnemonicCoCreateOpen' | 'squadEnabled', val: boolean) => {
    if (!selectedClassId) return
    setSaving(true)
    setNotice(null)
    try {
      if (field === 'mnemonicCoCreateOpen') {
        await api.put(`${gameBase}/settings`, { classId: selectedClassId, mnemonicCoCreateOpen: val })
        setCoCreateOpen(val)
      } else {
        const updated = await api.put<StaffSquadResponse>(`${staffBase}/classes/${selectedClassId}/squads`, {
          squadEnabled: val,
        })
        setSquadsData(updated)
      }
      setNotice('班级开关已更新')
    } catch (err: any) {
      setNotice(err.message || '更新失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateSquad = async () => {
    if (!selectedClassId || selectedMembers.length < 2 || selectedMembers.length > 3) return
    setSaving(true)
    setNotice(null)
    try {
      const existing = (squadsData?.squads ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        studentIds: s.members.map((m) => m.studentId),
      }))
      const updated = await api.put<StaffSquadResponse>(`${staffBase}/classes/${selectedClassId}/squads`, {
        squadEnabled: true,
        squads: [
          ...existing,
          { name: newSquadName.trim() || '学习小队', studentIds: selectedMembers },
        ],
      })
      setSquadsData(updated)
      setSelectedMembers([])
      setNotice('已创建并指派 2–3 人学习小队')
    } catch (err: any) {
      setNotice(err.message || '创建小队失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSeason = async () => {
    if (!selectedClassId || !examDate) return
    setSaving(true)
    setNotice(null)
    try {
      await api.put(`${staffBase}/classes/${selectedClassId}/season`, {
        name: seasonName.trim() || '中考冲刺赛季',
        examDate,
        ...(startDate ? { startDate } : {}),
        status: seasonStatus,
      })
      setNotice('冲刺赛季配置已保存（未改动 FSRS 调度算法）')
      await loadClassDetails()
    } catch (err: any) {
      setNotice(err.message || '保存赛季失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <strong>Stage 4 班级控制：共创口诀、搭子小队与冲刺赛季</strong>
        <select
          className="form-control"
          style={{ width: 220 }}
          value={selectedClassId}
          onChange={(e) => setSelectedClassId(e.target.value)}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      {notice && <div className="alert alert-info" style={{ marginBottom: 0 }}>{notice}</div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={coCreateOpen}
            disabled={saving}
            onChange={(e) => void saveToggle('mnemonicCoCreateOpen', e.target.checked)}
          />
          开启本班学生口诀共创（R4）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={Boolean(squadsData?.squadEnabled)}
            disabled={saving}
            onChange={(e) => void saveToggle('squadEnabled', e.target.checked)}
          />
          开启 2–3 人学习搭子小队（R5）
        </label>
      </div>

      {squadsData?.squadEnabled && (() => {
        const assignedIds = new Set(
          (squadsData.squads ?? []).flatMap((sq) => sq.members.map((m) => m.studentId)),
        )
        const unassignedList =
          squadsData.unassignedStudents ??
          (squadsData.students ?? []).filter((st) => !assignedIds.has(st.studentId))

        return (
        <div className="camp-def-box" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            搭子小队分组（已有 {squadsData.squads?.length ?? 0} 组 · 未组队 {unassignedList.length} 人）
          </div>
          {unassignedList.length >= 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  className="form-control"
                  style={{ width: 180 }}
                  value={newSquadName}
                  onChange={(e) => setNewSquadName(e.target.value)}
                  placeholder="新小队名称"
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={saving || selectedMembers.length < 2 || selectedMembers.length > 3}
                  onClick={() => void handleCreateSquad()}
                >
                  指派小队（{selectedMembers.length}/2–3人）
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {unassignedList.map((st) => {
                  const picked = selectedMembers.includes(st.studentId)
                  return (
                    <button
                      key={st.studentId}
                      type="button"
                      className={`btn btn-sm ${picked ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => {
                        setSelectedMembers((prev) =>
                          prev.includes(st.studentId) ? prev.filter((x) => x !== st.studentId) : [...prev, st.studentId],
                        )
                      }}
                    >
                      {st.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        )
      })()}

      <div className="camp-def-box" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>冲刺赛季目标日设置（R6，考前 100 天自动开跑）</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 145px 145px 115px auto', gap: 8, alignItems: 'center' }}>
          <input className="form-control" placeholder="赛季名称" value={seasonName} onChange={(e) => setSeasonName(e.target.value)} />
          <input type="date" className="form-control" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          <input type="date" className="form-control" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="自动-100天" />
          <select className="form-control" value={seasonStatus} onChange={(e) => setSeasonStatus(e.target.value as any)}>
            <option value="AUTO">AUTO 自动</option>
            <option value="ACTIVE">ACTIVE 进行</option>
            <option value="PAUSED">PAUSED 暂停</option>
            <option value="ENDED">ENDED 收官</option>
          </select>
          <button type="button" className="btn btn-sm btn-primary" disabled={saving || !examDate} onClick={() => void handleSaveSeason()}>
            保存赛季
          </button>
        </div>
      </div>
    </div>
  )
}

export function StaffEffectDashboardPanel({ scope }: { scope: 'teacher' | 'admin' }) {
  const gameBase = scope === 'admin' ? '/admin/game' : '/teachers/game'
  const { classes, selectedClassId, setSelectedClassId } = useStaffClasses(scope)
  const [weeks, setWeeks] = useState(8)
  const [data, setData] = useState<EffectDashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedClassId) return
    setLoading(true)
    setError(null)
    api
      .get<EffectDashboardData>(`${gameBase}/effect?classId=${selectedClassId}&weeks=${weeks}`)
      .then((res) => setData(res))
      .catch((err: any) => setError(err.message || '加载效果看板失败'))
      .finally(() => setLoading(false))
  }, [gameBase, selectedClassId, weeks])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>留存效果与健康监测看板（R2）</strong>
          {data && (
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
              当前配置：{data.activeConfigVersion}（{typeof data.activeConfigScope === 'string' ? data.activeConfigScope : data.activeConfigScope?.mode === 'CLASSES' ? `指定 ${data.activeConfigScope.classIds?.length ?? 0} 班灰度` : '全校'}）· 班级 {data.totalStudents} 人
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="form-control" style={{ width: 200 }} value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="form-control" style={{ width: 110 }} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={4}>近 4 周</option>
            <option value={8}>近 8 周</option>
            <option value={12}>近 12 周</option>
          </select>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 0 }}>{error}</div>}
      {loading && <div className="card" style={{ padding: 20, textAlign: 'center' }}>加载效果指标中...</div>}

      {data && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            {[
              { label: '人均周活跃天数', value: `${data.summary.weeklyActiveDaysAvg} 天` },
              { label: '到期词按时完成率', value: pct(data.summary.dueCompletionRate) },
              { label: '本周双环合拢率', value: pct(data.summary.dualRingCloseRate) },
              { label: '7 日真实留存率', value: pct(data.summary.retention7dRate) },
              { label: '邪修口诀覆盖率', value: pct(data.summary.mnemonicCoverageRate) },
              { label: '触达防沉迷上限比', value: pct(data.summary.xpCapHitRate) },
              { label: '关闭动效/静音占比', value: pct(data.summary.gamificationOptOutRate) },
              { label: '提醒 2h 召回率', value: pct(data.summary.reminderRecallRate) },
            ].map((k) => (
              <div key={k.label} className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{k.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="card" style={{ padding: 14 }}>
              <h3 style={{ fontSize: 15, marginTop: 0 }}>本周漏斗转化（人数）</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: '打开 App', val: data.funnel.appOpen },
                  { label: '开始复习', val: data.funnel.reviewStart },
                  { label: '闭合复习环', val: data.funnel.reviewRingClosed },
                  { label: '闭合闯关环', val: data.funnel.levelRingClosed },
                  { label: '闭合双环', val: data.funnel.dualRingClosed },
                ].map((step) => (
                  <div key={step.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{step.label}</span>
                    <strong>{step.val} / {data.totalStudents}</strong>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
                弱词 Boss 参与率：{pct(data.bossParticipationRate)} · 周挑战参与率：{pct(data.challengeParticipationRate)}
              </div>
            </div>

            <div className="card" style={{ padding: 14 }}>
              <h3 style={{ fontSize: 15, marginTop: 0 }}>近 {data.weeks} 周趋势</h3>
              <div style={{ maxHeight: 210, overflowY: 'auto' }}>
                <table className="table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>周起始</th>
                      <th>活跃天数</th>
                      <th>完成率</th>
                      <th>双环率</th>
                      <th>7日留存</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.weeklyTrends.map((w) => (
                      <tr key={w.weekStart}>
                        <td>{w.weekStart}</td>
                        <td>{w.weeklyActiveDaysAvg}</td>
                        <td>{pct(w.dueCompletionRate)}</td>
                        <td>{pct(w.dualRingCloseRate)}</td>
                        <td>{pct(w.retention7dRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function StaffWeeklyReportPanel({ scope }: { scope: 'teacher' | 'admin' }) {
  const staffBase = scope === 'admin' ? '/admin' : '/teachers'
  const { classes, selectedClassId, setSelectedClassId } = useStaffClasses(scope)
  const [selectedWeek, setSelectedWeek] = useState('')
  const [data, setData] = useState<WeeklyReportResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedClassId) return
    setLoading(true)
    setError(null)
    const q = selectedWeek ? `&week=${selectedWeek}` : ''
    api
      .get<WeeklyReportResponse>(`${staffBase}/reports/weekly?classId=${selectedClassId}${q}`)
      .then((res) => {
        setData(res)
        if (!selectedWeek && res?.report?.weekStart) setSelectedWeek(res.report.weekStart)
      })
      .catch((err: any) => setError(err.message || '加载每周教学周报失败'))
      .finally(() => setLoading(false))
  }, [staffBase, selectedClassId, selectedWeek])

  const p = data?.report.payload

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card print-hide" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <strong>每周教学周报与自动调参建议（R8）</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="form-control" style={{ width: 200 }} value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="form-control" style={{ width: 150 }} value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)}>
            {(data?.availableWeeks ?? []).map((w) => (
              <option key={w.weekStart} value={w.weekStart}>{w.weekStart} 周报</option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()}>
            打印 / 导出 PDF
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 0 }}>{error}</div>}
      {loading && <div className="card" style={{ padding: 20, textAlign: 'center' }}>生成/读取周报中...</div>}

      {p && !loading && (
        <div className="card print-report-sheet" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{p.classInfo.name} 周报（{p.weekStart} ~ {p.weekEnd}）</h2>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              全班 {p.totalStudents} 人 · 配置版本 {p.activeConfigVersion}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 10 }}>
            <div><div style={{ fontSize: 12 }}>周活跃天数</div><strong>{p.metrics.weeklyActiveDaysAvg} 天</strong></div>
            <div><div style={{ fontSize: 12 }}>到期完成率</div><strong>{pct(p.metrics.dueCompletionRate)}</strong></div>
            <div><div style={{ fontSize: 12 }}>双环合拢率</div><strong>{pct(p.metrics.dualRingCloseRate)}</strong></div>
            <div><div style={{ fontSize: 12 }}>7日留存率</div><strong>{pct(p.metrics.retention7dRate)}</strong></div>
          </div>

          <div>
            <h3 style={{ fontSize: 15, marginBottom: 6 }}>参数调优建议（需确认后由热更发布生效）</h3>
            {p.advice.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>本周各项指标处于健康区间，无需调整。</p>
            ) : (
              p.advice.map((a, idx) => (
                <div key={idx} className={`alert ${a.level === 'warn' ? 'alert-warning' : 'alert-info'}`} style={{ marginBottom: 6 }}>
                  <strong>{a.title}</strong>：{a.detail ?? a.reason}
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 6 }}>本周进步前三名</h3>
              {p.topImproved.map((s, idx) => (
                <div key={s.studentId} style={{ fontSize: 13, marginBottom: 4 }}>
                  {idx + 1}. {s.name}（+{s.deltaXp} XP 环比 / 本周 {s.thisWeekXp} XP）
                </div>
              ))}
            </div>
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 6 }}>连续 ≥3 天未活跃（仅教师可见）</h3>
              {p.atRiskStudents.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>无连续缺勤学生</div>
              ) : (
                p.atRiskStudents.map((s) => (
                  <div key={s.studentId} style={{ fontSize: 13, marginBottom: 4 }}>
                    {s.name}：已 {s.daysInactive} 天未达标
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

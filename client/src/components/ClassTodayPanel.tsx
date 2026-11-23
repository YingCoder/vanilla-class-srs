import { api } from '../utils/api'
import { useApi } from '../hooks/useApi'

interface RosterEntry {
  studentId: string
  name: string
  username: string | null
  reviewedCards: number
  lastEndedAt: string | null
}

interface Roster {
  studyDate: string
  totalStudents: number
  studiedCount: number
  pending: RosterEntry[]
  studied: RosterEntry[]
}

interface Props {
  classId: string
  /** 'teacher' or 'admin' — selects the matching API prefix. */
  audience: 'teacher' | 'admin'
}

export default function ClassTodayPanel({ classId, audience }: Props) {
  const endpoint = audience === 'admin'
    ? `/admin/classes/${classId}/pending-today`
    : `/teachers/classes/${classId}/pending-today`
  const { data, loading, error, reload } = useApi<Roster>(() => api.get(endpoint), [endpoint])

  if (loading && !data) return <div className="loading-center"><div className="spinner" /></div>
  if (error && !data) return <div className="alert alert-danger">{error}</div>
  if (!data) return null

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>今日学习（{data.studyDate}）</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            口径：北京时间自然日内完成至少一轮复习且复习卡数 ≥ 1。用于私下提醒，不等同于关卡任务“完成”。
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={reload}>刷新</button>
      </div>

      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{data.totalStudents}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>班级人数</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-success)' }}>{data.studiedCount}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>今日已学习</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-danger)' }}>{data.pending.length}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>今日未学习</div>
        </div>
      </div>

      <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 8 }}>
        今日未学习（{data.pending.length}）
      </h3>
      {data.pending.length === 0 ? (
        <div className="alert alert-success" style={{ marginBottom: 20 }}>今天全班都已学习。</div>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 24 }}>
          <table className="table">
            <thead>
              <tr><th>姓名</th><th>登录名</th></tr>
            </thead>
            <tbody>
              {data.pending.map((student) => (
                <tr key={student.studentId}>
                  <td>{student.name}</td>
                  <td style={{ fontFamily: 'monospace' }}>{student.username ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 8 }}>
        今日已学习（{data.studied.length}）
      </h3>
      {data.studied.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>还没有学生完成今日复习。</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>姓名</th><th>登录名</th><th>今日复习卡数</th><th>最近完成</th></tr>
            </thead>
            <tbody>
              {data.studied.map((student) => (
                <tr key={student.studentId}>
                  <td>{student.name}</td>
                  <td style={{ fontFamily: 'monospace' }}>{student.username ?? '—'}</td>
                  <td>{student.reviewedCards}</td>
                  <td>{student.lastEndedAt ? new Date(student.lastEndedAt).toLocaleString('zh-CN') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
import { api } from '../../utils/api'
import { useApi } from '../../hooks/useApi'

interface RewardSummary {
  totalXp: number
  coinBalance: number
  todayXp: number
  todayCoins: number
  studyDate: string
  level: {
    level: number
    title: string
    minXp: number
    nextLevelXp: number | null
    nextLevelTitle: string | null
    xpIntoLevel: number
    xpForNextLevel: number | null
  }
  recent: {
    id: string
    eventKey: string
    rewardType: string
    amount: number
    reason: string
    studyDate: string
    createdAt: string
  }[]
}

const reasonLabels: Record<string, string> = {
  word_learned: '学会新词',
  review_ok: '复习答对',
  boss_clear: '首次通关 Boss',
  daily_done: '完成每日任务',
  streak7: '连续 7 天',
}

export default function RewardsPage() {
  const { data, loading, error } = useApi<RewardSummary>(() => api.get('/students/rewards'))

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 className="page-title">我的成长</h1>
      {error && <div className="alert alert-danger">{error}</div>}

      {data && (
        <>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>当前等级</div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>
                  Lv.{data.level.level} · {data.level.title}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>累计经验</div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>{data.totalXp} XP</div>
              </div>
            </div>
            {data.level.nextLevelXp !== null && data.level.xpForNextLevel ? (
              <div style={{ marginTop: 16 }}>
                <div style={{ height: 10, background: 'var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.round((data.level.xpIntoLevel / data.level.xpForNextLevel) * 100))}%`,
                      background: 'var(--color-accent)',
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                  再获得 {data.level.nextLevelXp - data.totalXp} XP 升级为「{data.level.nextLevelTitle}」
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 12 }}>已达到最高等级</div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>今日经验</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.todayXp} XP</div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>金币余额</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.coinBalance}</div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>今日金币</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.todayCoins}</div>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>奖励记录</h2>
            {data.recent.length === 0 ? (
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>完成一次复习就能获得第一笔经验。</p>
            ) : (
              <div className="table-scroll">
                <table className="table" style={{ fontSize: 14 }}>
                  <thead>
                    <tr><th>日期</th><th>事项</th><th>奖励</th></tr>
                  </thead>
                  <tbody>
                    {data.recent.map((row) => (
                      <tr key={row.id}>
                        <td>{row.studyDate}</td>
                        <td>{reasonLabels[row.reason] ?? row.reason}</td>
                        <td>
                          {row.rewardType === 'xp' ? `+${row.amount} XP` : `+${row.amount} 金币`}
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
  )
}
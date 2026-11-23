import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import { ApiError } from '../../utils/api'

export default function LoginPage() {
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (authLoading || !user) return
    if (user.mustChangePassword) {
      navigate('/change-password', { replace: true })
    } else if (user.role === 'ADMIN') {
      navigate('/admin/departments', { replace: true })
    } else if (user.role === 'TEACHER') {
      navigate('/teacher/classes', { replace: true })
    } else {
      navigate('/student', { replace: true })
    }
  }, [user, authLoading, navigate])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(identifier, password)
      // navigation handled by state change above
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="login-split" style={{ display: 'flex', maxWidth: 960, width: '100%', minHeight: 600 }}>
        <div className="card login-split-panel" style={{ flex: 1, padding: 40, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <img
              src="/Vanilla-Class-SRS_title.png"
              alt="Vanilla Class SRS"
              style={{ maxWidth: 220, width: '100%', height: 'auto' }}
            />
          </div>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 28, fontSize: 16, textAlign: 'center' }}>
            登录你的账号
          </p>
          {error && <div className="alert alert-danger">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">用户名或邮箱</label>
              <input
                className="form-input"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="例如：zhang_san01"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">密码</label>
              <input
                className="form-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? '登录中…' : '登录'}
            </button>
          </form>
          <p style={{ marginTop: 16, fontSize: 13, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            忘记密码？学生请联系老师重置，教师请联系管理员。
          </p>
        </div>
        <div
          className="login-split-panel"
          style={{
            flex: 1,
            background: 'var(--color-accent)',
            color: '#fff',
            padding: 40,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            overflowY: 'auto',
          }}
        >
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
            欢迎来到单词特训营
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 16, opacity: 0.9 }}>
            按老师布置的单词表，每天完成少量复习，积少成多。
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
            你可以：
          </h2>
          <ul style={{ fontSize: 16, lineHeight: 1.6, opacity: 0.9, paddingLeft: 20, marginBottom: 16 }}>
            <li>完成老师布置的每日单词任务</li>
            <li>复习自己的生词本，系统自动安排复习节奏</li>
            <li>在手机上随时继续未完成的学习</li>
            <li>查看连续学习天数、星级和班级排行榜</li>
          </ul>
          <p style={{ fontSize: 16, lineHeight: 1.6, opacity: 0.9 }}>
            学生账号由老师统一创建。登录名通常是你的姓名拼音或老师指定的编号，
            初始密码请向老师索取，首次登录后请立即修改。
          </p>
        </div>
      </div>
    </div>
  )
}

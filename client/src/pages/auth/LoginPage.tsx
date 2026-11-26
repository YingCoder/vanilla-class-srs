import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import ThemeToggleButton from '../../components/ThemeToggleButton'
import FirstWakeExperience, { hasTriedFirstWake } from '../../components/FirstWakeExperience'
import IslandScene from '../../components/IslandScene'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showLogin, setShowLogin] = useState(hasTriedFirstWake)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await login(identifier.trim(), password)
      if (user.mustChangePassword) navigate('/change-password', { replace: true })
      else if (user.role === 'ADMIN') navigate('/admin', { replace: true })
      else if (user.role === 'TEACHER') navigate('/teacher', { replace: true })
      else navigate('/student', { replace: true })
    } catch (err: any) {
      setError(err.message || '登录失败，请检查账号和密码')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
        background: 'var(--color-bg)',
      }}
    >
      <div className="camp-modal-card" style={{ width: 'min(420px, 100%)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/Vanilla-card.png" alt="香草单词营" style={{ width: 44, height: 44, borderRadius: 12, border: '2px solid var(--color-text)' }} />
            <div>
              <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 22, lineHeight: 1.1 }}>香草单词营</h1>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>香草群岛 · 和艾斯一起唤醒词灵</span>
            </div>
          </div>
          <ThemeToggleButton compact />
        </div>

        {!showLogin ? <>
          <FirstWakeExperience onFinish={() => setShowLogin(true)} />
          <button type="button" className="world-text-button" onClick={() => setShowLogin(true)}>已有账号 / 教师入口</button>
        </> : <>
        <IslandScene lit />
        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-id">账号 / 用户名 / 邮箱</label>
            <input
              id="login-id"
              className="form-input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="输入学生或教师账号"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="login-pw">登录密码</label>
            <input
              id="login-pw"
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="camp-btn camp-btn-berry"
            style={{ width: '100%' }}
          >
            {loading ? '正在进入特训营...' : '进入香草单词营'}
          </button>
        </form>
        <button type="button" className="world-text-button" onClick={() => setShowLogin(false)}>先认识词灵</button>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          登录后可将营地添加到手机主屏幕。
        </div>
        </>}
      </div>
    </div>
  )
}

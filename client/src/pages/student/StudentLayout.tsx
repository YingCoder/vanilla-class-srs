import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import { useEnrollment } from '../../utils/enrollment'
import AppShell from '../../components/AppShell'

const navItems = [
  { to: '/student/task', label: '今日任务' },
  { to: '/student/review', label: '学习' },
  { to: '/student/deck', label: '我的词库' },
  { to: '/student/cardsets', label: '班级词集' },
  { to: '/student/stats', label: '统计' },
  { to: '/student/rewards', label: '我的成长' },
]

export default function StudentLayout() {
  const { user, logout } = useAuth()
  const { active, setActive, enrollmentCount } = useEnrollment()
  const navigate = useNavigate()

  return (
    <AppShell
      roleLabel="Student"
      userName={user?.name}
      navItems={active ? navItems : []}
      onSignOut={async () => { setActive(null); await logout(); navigate('/login') }}
      extra={active && (
        <div style={{ padding: '6px 16px', background: 'var(--color-sidebar-well)', fontSize: 'var(--text-xs)' }}>
          <span style={{ color: 'var(--color-sidebar-muted)' }}>Class: </span>
          <span style={{ color: 'var(--color-sidebar-text)', fontWeight: 500 }}>{active.className}</span>
          {enrollmentCount > 1 && (
            <button
              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '0 0 0 8px', textDecoration: 'underline' }}
              onClick={() => { setActive(null); navigate('/student') }}
            >
              Switch
            </button>
          )}
        </div>
      )}
    />
  )
}

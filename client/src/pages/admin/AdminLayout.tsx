import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import AppShell from '../../components/AppShell'

const navItems = [
  { to: '/admin/study', label: '学习', disabled: true, disabledReason: '即将上线' },
  { to: '/admin/departments', label: '部门' },
  { to: '/admin/subject-grades', label: '年级/科目' },
  { to: '/admin/teachers', label: '教师' },
  { to: '/admin/classes', label: '班级' },
  { to: '/admin/cardsets', label: '词集' },
  { to: '/admin/stats', label: '统计' },
  { to: '/admin/game', label: '激励看板' },
  { to: '/admin/mnemonics', label: '邪修口诀库' },
  { to: '/admin/leadership', label: '学科/年级报表' },
  { to: '/admin/releases', label: '热更新推送' },
]

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <AppShell
      roleLabel="管理员"
      userName={user?.name}
      navItems={navItems}
      onSignOut={async () => { await logout(); navigate('/login') }}
    />
  )
}

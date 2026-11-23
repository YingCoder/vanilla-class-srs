import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
import { api } from '../../utils/api'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../utils/auth'
import AppShell from '../../components/AppShell'

const navItems = [
  { to: '/teacher/classes', label: '我的班级' },
  { to: '/teacher/cardsets', label: '词集' },
]

export default function TeacherLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: groups, reload } = useApi<{id:string}[]>(() => api.get('/teachers/leadership'), [location.pathname])
  useEffect(() => { const refresh = () => { reload() }; window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh) }, [reload])

  return (
    <AppShell
      roleLabel={groups?.length ? '学科组长' : '教师'}
      userName={user?.name}
      navItems={groups?.length ? [...navItems.map(item => item.to === '/teacher/classes' ? { ...item, label: '班级' } : item), { to: '/teacher/leadership', label: '学科组管理' }] : navItems}
      onSignOut={async () => { await logout(); navigate('/login') }}
    />
  )
}

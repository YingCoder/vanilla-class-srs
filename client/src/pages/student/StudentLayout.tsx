import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../../utils/api'
import { useAuth } from '../../utils/auth'
import { useEnrollment, type ActiveEnrollment } from '../../utils/enrollment'
import ThemeToggleButton from '../../components/ThemeToggleButton'
import { useHotUpdate } from '../../components/HotUpdateBanner'
import { GameProvider, useGame } from '../../components/GameContext'
import { trackAnalyticsEvent } from '../../utils/analytics'

interface EnrollmentApiItem {
  id: string
  classId: string
  class: {
    name: string
    subjectGrade: { name: string }
    teacher?: { user?: { name: string } }
  }
}

function StudentLayoutShell() {
  const { user } = useAuth()
  const { active, setActive, setEnrollmentCount } = useEnrollment()
  const { currentMeta, pendingRelease, checkForUpdates, openIosGuide, iosInstallHint } = useHotUpdate()
  const {
    summary,
    xpFloats,
    levelUpModal,
    dismissLevelUp,
    badgeToast,
    dismissBadgeToast,
    dismissCheer,
  } = useGame()
  const location = useLocation()
  const navigate = useNavigate()
  const [xpDrawerOpen, setXpDrawerOpen] = useState(false)
  const [reminderBanner, setReminderBanner] = useState<{
    showReminder: boolean
    message: string | null
    freezeTicketNotice: string | null
  } | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    trackAnalyticsEvent('app_open', { path: location.pathname }, { enrollmentId: active?.enrollmentId })
    const params = new URLSearchParams(location.search)
    const reminderId = params.get('reminderId')
    if (reminderId) {
      void api.post(`/students/reminders/${reminderId}/open`, {}).catch(() => undefined)
    }
  }, [active?.enrollmentId])

  useEffect(() => {
    if (!active) return
    api
      .get<{ showReminder: boolean; message: string | null; freezeTicketNotice: string | null }>(
        `/students/reminders/banner?enrollmentId=${active.enrollmentId}`,
      )
      .then(setReminderBanner)
      .catch(() => undefined)
  }, [active, location.pathname])

  useEffect(() => {
    let cancelled = false
    api
      .get<EnrollmentApiItem[]>('/students/enrollments')
      .then((list) => {
        if (cancelled) return
        setEnrollmentCount(list.length)
        if (!active && list.length === 1) {
          const item = list[0]
          const next: ActiveEnrollment = {
            enrollmentId: item.id,
            className: item.class.name,
            subjectGradeName: item.class.subjectGrade.name,
          }
          setActive(next)
          if (location.pathname === '/student') {
            navigate('/student/task', { replace: true })
          }
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [active, location.pathname, navigate, setActive, setEnrollmentCount])

  const deskLinks = [
    { to: '/student/task', label: '营地家园' },
    { to: '/student/review', label: '驱雾复习' },
    { to: '/student/adventure', label: '岛屿探险' },
    { to: '/student/deck', label: '词灵图鉴' },
    { to: '/student/stats', label: '我的App' },
    { to: '/student/choice', label: '极速四选一' },
    { to: '/student/spelling', label: '拼写特训' },
    { to: '/student/cardsets', label: '班级词集' },
    { to: '/student/rewards', label: '经验勋章' },
  ]

  const mobileTabs = [
    { to: '/student/task', label: '家园' },
    { to: '/student/review', label: '驱雾' },
    { to: '/student/adventure', label: '探险' },
    { to: '/student/deck', label: '图鉴' },
    { to: '/student/stats', label: '我的App' },
  ]

  const canShowCheer =
    location.pathname === '/student/task' || location.pathname === '/student/stats'
  const activeCheer = canShowCheer ? summary?.unreadCheers?.[0] ?? null : null

  return (
    <div className="student-app-shell">
      <header className="student-topbar">
        <NavLink to="/student/task" className="student-brand">
          <img src="/Vanilla-card.png" alt="香草单词营" className="student-mascot-avatar" />
          <div style={{ minWidth: 0 }}>
            <div className="student-brand-title">香草单词营</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {active ? `${active.className}` : (user?.name ?? '学生端')}
            </div>
          </div>
        </NavLink>

        {summary && (
          <button
            type="button"
            className="topbar-xp-pill"
            onClick={() => setXpDrawerOpen(true)}
            title="查看今日经验与等级详情"
          >
            <div className="topbar-xp-row">
              <span>Lv.{summary.level.level}</span>
              <span className="topbar-xp-num">
                {summary.today.capped ? '今天够了' : `${summary.today.xpEarned}/${summary.today.dailyCap}`}
              </span>
            </div>
            <div className="topbar-xp-track">
              <div
                className="topbar-xp-fill"
                style={{ width: `${summary.level.progressPct}%` }}
              />
            </div>
          </button>
        )}

        <div className="student-topbar-right">
          {iosInstallHint && (
            <button type="button" className="candy-pill sky" onClick={openIosGuide}>
              装到桌面
            </button>
          )}
          <button
            type="button"
            className={`candy-pill ${pendingRelease ? 'berry' : ''}`}
            style={{ minHeight: 36, padding: '0 8px', fontSize: 12 }}
            onClick={() => void checkForUpdates()}
            title="点击检测教师端热更新推送"
          >
            {pendingRelease ? '有热更' : currentMeta.version}
          </button>
          <ThemeToggleButton compact />
        </div>
      </header>

      <div className="student-workspace">
        <aside className="student-desk-rail" aria-label="学生端导航">
          {deskLinks.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `student-rail-link ${isActive ? 'active' : ''}`}
            >
              <span>{item.label}</span>
            </NavLink>
          ))}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" className="candy-pill sky" onClick={openIosGuide}>
              iPhone免签名安装
            </button>
          </div>
        </aside>

        <main className="student-stage-viewport">
          <div className="student-stage-inner">
            {/* R3 Gentle In-App Reminder / Freeze Ticket Notice */}
            {canShowCheer && !bannerDismissed && (reminderBanner?.freezeTicketNotice || reminderBanner?.showReminder) && (
              <div className="cheer-inline-banner" role="status" aria-live="polite" style={{ background: 'var(--color-sky-tint)', borderColor: 'var(--color-sky)' }}>
                <div className="hot-update-toast-text">
                  <strong>
                    {reminderBanner.freezeTicketNotice ? '🧊 冻结券生效' : '⏰ 温习小提醒'}
                  </strong>
                  <span>{reminderBanner.freezeTicketNotice ?? reminderBanner.message}</span>
                </div>
                <button
                  type="button"
                  className="candy-pill"
                  style={{ minHeight: 32, padding: '2px 10px', fontSize: 12, flexShrink: 0 }}
                  onClick={() => setBannerDismissed(true)}
                >
                  知道了
                </button>
              </div>
            )}

            {/* Teacher Cheer Non-Blocking Banner (F10) */}
            {activeCheer && (
              <div className="cheer-inline-banner" role="status" aria-live="polite">
                <div className="hot-update-toast-text">
                  <strong>
                    {activeCheer.sticker} {activeCheer.senderName} 发来击掌鼓励
                  </strong>
                  <span>{activeCheer.message}</span>
                </div>
                <button
                  type="button"
                  className="camp-btn camp-btn-sticky"
                  style={{ minHeight: 34, padding: '2px 10px', fontSize: 12, flexShrink: 0 }}
                  onClick={() => void dismissCheer(activeCheer.id)}
                >
                  击掌 🙌
                </button>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="student-bottom-nav" aria-label="手机底栏">
        {mobileTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `student-bottom-link ${isActive ? 'active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {/* XP Floating Feedback (F5) */}
      <div className="xp-float-layer" aria-live="polite">
        {xpFloats.map((f) => (
          <div key={f.id} className="xp-float-pill">
            <strong>{f.text}</strong>
            {f.sub && <span>{f.sub}</span>}
          </div>
        ))}
      </div>

      {/* Level-up celebration (<= 1.5s, tap anywhere to skip, reduced-motion safe) */}
      {levelUpModal && (
        <div
          className="modal-backdrop level-up-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="升级庆祝"
          onClick={dismissLevelUp}
        >
          <div className="camp-modal-card level-up-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36 }}>🎉</div>
            <h2 style={{ fontSize: 22, marginTop: 4 }}>
              升级到 Lv.{levelUpModal.toLevel}！
            </h2>
            <div className="badge badge-yellow" style={{ marginTop: 6 }}>
              新称号：{levelUpModal.newTitle}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
              轻点任意位置立即跳过
            </div>
          </div>
        </div>
      )}

      {/* Badge Unlocked Toast */}
      {badgeToast && (
        <div className="cheer-toast badge-unlock-toast" role="status" onClick={dismissBadgeToast}>
          <div className="hot-update-toast-text">
            <strong>{badgeToast.icon} 解锁新徽章：{badgeToast.name}</strong>
            <span>{badgeToast.description}</span>
          </div>
          <button type="button" className="candy-pill" onClick={dismissBadgeToast}>
            太棒了
          </button>
        </div>
      )}

      {/* Topbar XP Breakdown Modal (F1) */}
      {xpDrawerOpen && summary && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="营员经验详情">
          <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="modal-header" style={{ marginBottom: 0 }}>
              <h2>
                Lv.{summary.level.level} · {summary.level.title}
              </h2>
              <button type="button" className="candy-pill" onClick={() => setXpDrawerOpen(false)}>
                关闭
              </button>
            </div>
            <div className="camp-def-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14 }}>
                <span>累计经验：{summary.level.totalXp} XP</span>
                <span>还差 {summary.level.nextLevelXp - summary.level.totalXp} XP 升 Lv.{summary.level.level + 1}</span>
              </div>
              <div className="progress-bar" style={{ marginTop: 8, height: 10 }}>
                <div className="progress-fill" style={{ width: `${summary.level.progressPct}%` }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                下一级称号：{summary.level.nextLevelTitle}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="camp-def-box" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>今日已获 XP</div>
                <strong style={{ fontSize: 20 }}>
                  {summary.today.xpEarned} / {summary.today.dailyCap}
                </strong>
              </div>
              <div className="camp-def-box" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>今日封顶余量</div>
                <strong style={{ fontSize: 20 }}>{summary.today.remainingDailyXp} XP</strong>
              </div>
            </div>
            {summary.today.capped && (
              <div className="alert alert-success" style={{ marginBottom: 0 }}>
                今天够了！今日经验已达上限，仍可自由巩固复习，记得劳逸结合～
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function StudentLayout() {
  return (
    <GameProvider>
      <StudentLayoutShell />
    </GameProvider>
  )
}

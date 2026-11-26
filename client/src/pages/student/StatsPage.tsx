import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AVATAR_FRAME_OPTIONS,
  AVATAR_OPTIONS,
  CARD_SKIN_OPTIONS,
} from '@vanilla-srs/shared/gamification'
import { api } from '../../utils/api'
import {
  isWeChatBrowser,
  isWebPushSupported,
  subscribeBrowserPush,
  trackAnalyticsEvent,
  unsubscribeBrowserPush,
} from '../../utils/analytics'
import { useAuth } from '../../utils/auth'
import { useEnrollment } from '../../utils/enrollment'
import { setSoundEnabled } from '../../utils/audio'
import ThemeToggleButton from '../../components/ThemeToggleButton'
import { useHotUpdate } from '../../components/HotUpdateBanner'
import { useGame } from '../../components/GameContext'
import ShareCardModal from '../../components/ShareCardModal'

interface SummaryData {
  deckBreakdown: {
    NEW: number
    LEARNING: number
    REVIEW: number
    RELEARNING: number
    dueToday: number
  }
  streak: {
    current: number
    longest: number
    mostCardsInDay: number
  }
}

interface BadgeItem {
  key: string
  name: string
  category: string
  categoryLabel: string
  description: string
  icon: string
  earned: boolean
  progressText: string
}

interface LeaderboardEntry {
  rank: number
  nickname: string
  avatarKey: string
  avatarFrame: string
  deltaXp: number
  thisWeekXp: number
  isSelf: boolean
}

export default function StatsPage() {
  const { logout } = useAuth()
  const { active } = useEnrollment()
  const navigate = useNavigate()
  const { currentMeta, checking, pendingRelease, checkForUpdates, openIosGuide, applyPendingUpdate } = useHotUpdate()
  const { summary: gameSummary, refreshSummary } = useGame()

  const [statsSummary, setStatsSummary] = useState<SummaryData | null>(null)
  const [badgesModalOpen, setBadgesModalOpen] = useState(false)
  const [badgesData, setBadgesData] = useState<{ earnedCount: number; totalCount: number; badges: BadgeItem[] } | null>(null)
  const [badgeCat, setBadgeCat] = useState<string>('all')

  const [boardModalOpen, setBoardModalOpen] = useState(false)
  const [boardData, setBoardData] = useState<{
    enabled: boolean
    entries: LeaderboardEntry[]
    myEntry: LeaderboardEntry | null
  } | null>(null)

  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [nickname, setNickname] = useState('')
  const [avatarKey, setAvatarKey] = useState('vanilla')
  const [avatarFrame, setAvatarFrame] = useState('vanilla')
  const [cardSkin, setCardSkin] = useState('classic')
  const [savingProfile, setSavingProfile] = useState(false)

  const [shareOpen, setShareOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [reminderPref, setReminderPref] = useState<{
    enabled: boolean
    hour: number
    pausedUntil: string | null
    consecutiveUnopened: number
    activeSubscriptions: number
  } | null>(null)
  const [reminderBusy, setReminderBusy] = useState(false)
  const [prefsMsg, setPrefsMsg] = useState<string | null>(null)
  const [fontScale, setFontScale] = useState<'normal' | 'large' | 'xlarge'>('normal')
  const [reduceMotion, setReduceMotion] = useState(false)
  const [lowSpecMode, setLowSpecMode] = useState(false)

  useEffect(() => {
    if (gameSummary?.profile) {
      setFontScale(gameSummary.profile.fontScale ?? 'normal')
      setReduceMotion(Boolean(gameSummary.profile.reduceMotion))
      setLowSpecMode(Boolean(gameSummary.profile.lowSpecMode))
    }
  }, [gameSummary?.profile])

  useEffect(() => {
    api
      .get<typeof reminderPref>('/students/reminder-pref')
      .then((res) => setReminderPref(res))
      .catch(() => {})
  }, [])

  const updateReminderSetting = async (patch: { enabled?: boolean; hour?: number; resume?: boolean }) => {
    setReminderBusy(true)
    setPrefsMsg(null)
    try {
      if (patch.enabled === true && !isWeChatBrowser() && isWebPushSupported()) {
        const subRes = await subscribeBrowserPush()
        if (!subRes.ok) {
          setPrefsMsg(subRes.error || '未能开启系统通知')
        }
      } else if (patch.enabled === false) {
        await unsubscribeBrowserPush()
      }
      const updated = await api.put<NonNullable<typeof reminderPref>>('/students/reminder-pref', patch)
      setReminderPref(updated)
      setPrefsMsg('提醒偏好已更新')
    } catch (err: any) {
      setPrefsMsg(err.message || '保存提醒偏好失败')
    } finally {
      setReminderBusy(false)
    }
  }

  const updateA11ySetting = async (patch: {
    fontScale?: 'normal' | 'large' | 'xlarge'
    reduceMotion?: boolean
    lowSpecMode?: boolean
  }) => {
    const nextFont = patch.fontScale ?? fontScale
    const nextReduce = patch.reduceMotion ?? reduceMotion
    const nextLow = patch.lowSpecMode ?? lowSpecMode
    setFontScale(nextFont)
    setReduceMotion(nextReduce)
    setLowSpecMode(nextLow)
    setReminderBusy(true)
    setPrefsMsg(null)
    try {
      await api.patch('/students/game/profile', {
        fontScale: nextFont,
        reduceMotion: nextReduce,
        lowSpecMode: nextLow,
      })
      trackAnalyticsEvent('game_setting_toggle', patch, { enrollmentId: active?.enrollmentId })
      await refreshSummary()
      setPrefsMsg('显示与省电设置已保存')
    } catch (err: any) {
      setPrefsMsg(err.message || '保存设置失败')
    } finally {
      setReminderBusy(false)
    }
  }

  useEffect(() => {
    if (!active) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    api
      .get<SummaryData>(`/students/stats/summary?enrollmentId=${active.enrollmentId}&tz=${encodeURIComponent(tz)}`)
      .then(setStatsSummary)
      .catch(() => undefined)
  }, [active])

  useEffect(() => {
    if (gameSummary) {
      setNickname(gameSummary.profile.nickname)
      setAvatarKey(gameSummary.profile.avatarKey)
      setAvatarFrame(gameSummary.profile.avatarFrame)
      setCardSkin(gameSummary.profile.cardSkin)
    }
  }, [gameSummary])

  const openBadges = async () => {
    setBadgesModalOpen(true)
    if (!active) return
    const data = await api
      .get<{ earnedCount: number; totalCount: number; badges: BadgeItem[] }>(
        `/students/game/badges?enrollmentId=${active.enrollmentId}`,
      )
      .catch(() => null)
    if (data) setBadgesData(data)
  }

  const openLeaderboard = async () => {
    setBoardModalOpen(true)
    if (!active) return
    const data = await api
      .get<{ enabled: boolean; entries: LeaderboardEntry[]; myEntry: LeaderboardEntry | null }>(
        `/students/game/leaderboard?enrollmentId=${active.enrollmentId}`,
      )
      .catch(() => null)
    if (data) setBoardData(data)
  }

  const toggleSound = async () => {
    const next = !(gameSummary?.profile.soundEnabled ?? false)
    setSoundEnabled(next)
    await api.patch('/students/game/profile', { soundEnabled: next }).catch(() => undefined)
    await refreshSummary()
  }

  const saveCustomization = async (e: FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    try {
      await api.patch('/students/game/profile', {
        nickname: nickname.trim() || undefined,
        avatarKey,
        avatarFrame,
        cardSkin,
      })
      await refreshSummary()
      setCustomizeOpen(false)
    } finally {
      setSavingProfile(false)
    }
  }

  const avatarEmoji =
    AVATAR_OPTIONS.find((a) => a.key === (gameSummary?.profile.avatarKey ?? 'vanilla'))?.emoji ?? '🍦'
  const currentLevel = gameSummary?.level.level ?? 1

  return (
    <>
      <section className="camp-hero-card" style={{ flex: '0 0 auto', padding: '10px 12px', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button
              type="button"
              className={`avatar-badge frame-${gameSummary?.profile.avatarFrame ?? 'vanilla'}`}
              onClick={() => setCustomizeOpen(true)}
              title="更换头像与昵称"
            >
              {avatarEmoji}
            </button>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 17, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {gameSummary?.profile.nickname ?? '香草小营员'}
              </h1>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Lv.{currentLevel} · {gameSummary?.level.title ?? '香草学徒'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="candy-pill"
              style={{ minHeight: 34, padding: '0 8px', fontSize: 12 }}
              onClick={() => void toggleSound()}
            >
              {gameSummary?.profile.soundEnabled ? '🔔 音效开' : '🔕 音效关'}
            </button>
            <ThemeToggleButton compact />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, textAlign: 'center' }}>
          <div className="camp-def-box" style={{ padding: 6 }}>
            <strong style={{ fontSize: 17 }}>{statsSummary?.deckBreakdown.dueToday ?? 0}</strong>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>今日到期</div>
          </div>
          <div className="camp-def-box" style={{ padding: 6 }}>
            <strong style={{ fontSize: 17 }}>{gameSummary?.today.xpEarned ?? 0}</strong>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>今日 XP</div>
          </div>
          <div className="camp-def-box" style={{ padding: 6 }}>
            <strong style={{ fontSize: 17 }}>{gameSummary?.profile.streakDays ?? 0}天</strong>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>连胜</div>
          </div>
          <div className="camp-def-box" style={{ padding: 6 }}>
            <strong style={{ fontSize: 17 }}>{gameSummary?.profile.freezeTickets ?? 0}张</strong>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>冻结券</div>
          </div>
        </div>
      </section>

      <section className="camp-hero-card" style={{ padding: '10px 12px', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button type="button" className="camp-btn camp-btn-sticky" style={{ minHeight: 42 }} onClick={() => void openBadges()}>
            🏅 徽章墙 ({gameSummary?.badgesEarnedCount ?? 0}/{gameSummary?.badgesTotalCount ?? 19})
          </button>
          <button type="button" className="camp-btn camp-btn-mint" style={{ minHeight: 42 }} onClick={() => void openLeaderboard()}>
            📈 班内进步榜
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button type="button" className="camp-btn" style={{ minHeight: 40 }} onClick={() => setCustomizeOpen(true)}>
            🎨 头像框与皮肤
          </button>
          <button type="button" className="camp-btn camp-btn-berry" style={{ minHeight: 40 }} onClick={() => setShareOpen(true)}>
            🖼️ 战报分享卡
          </button>
        </div>

        <div className="camp-def-box" style={{ fontSize: 12, padding: '6px 10px' }}>
          <div>当前版本：{currentMeta.version} · {currentMeta.packVersion}</div>
          <div style={{ color: 'var(--color-text-muted)' }}>
            {active ? `${active.className} · ${active.subjectGradeName}` : '未选班级'}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>常用功能</strong>
          <button
            type="button"
            className="candy-pill sticky"
            style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
            onClick={() => {
              setPrefsMsg(null)
              setPrefsOpen(true)
            }}
          >
            ⚙️ 提醒 / 字体 / 省电
          </button>
        </div>
        {prefsOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="提醒与适老化偏好">
            <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="modal-header" style={{ marginBottom: 0 }}>
                <h2>⚙️ 提醒、字号与低配模式</h2>
                <button type="button" className="candy-pill" onClick={() => setPrefsOpen(false)}>关闭</button>
              </div>
              {prefsMsg && <div className="alert alert-info" style={{ marginBottom: 0 }}>{prefsMsg}</div>}

              <div className="camp-def-box" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <strong>⏰ 温和复习提醒（R3）</strong>
                {isWeChatBrowser() ? (
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                    微信内浏览器暂不支持系统级 Web Push，系统将在每晚 20:00 后通过站内温和横幅与老师击掌提示复习，绝不发连续弹窗或惩罚通知。
                  </p>
                ) : !isWebPushSupported() ? (
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                    当前浏览器暂不支持 Web Push，将自动使用站内温和横幅提醒（iOS 请先添加到主屏幕后开启）。
                  </p>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>
                      系统复习提醒（最多 1 次/天 · 每周 ≤ 4 次）
                    </span>
                    <button
                      type="button"
                      className={`candy-pill ${reminderPref?.enabled ? 'mint' : ''}`}
                      style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
                      disabled={reminderBusy}
                      onClick={() => void updateReminderSetting({ enabled: !(reminderPref?.enabled ?? false) })}
                    >
                      {reminderPref?.enabled ? '已开启（点击关闭）' : '开启推送'}
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>优选提醒时段（仅 07:00–21:30）</span>
                  <select
                    className="form-control"
                    style={{ width: 110 }}
                    disabled={reminderBusy}
                    value={reminderPref?.hour ?? 19}
                    onChange={(e) => void updateReminderSetting({ hour: Number(e.target.value) })}
                  >
                    {Array.from({ length: 15 }, (_, idx) => 7 + idx).map((h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>

                {reminderPref?.pausedUntil && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span>连续 3 次未打开已自动静默至 {reminderPref.pausedUntil.slice(0, 10)}</span>
                    <button
                      type="button"
                      className="candy-pill berry"
                      style={{ minHeight: 30, fontSize: 11 }}
                      disabled={reminderBusy}
                      onClick={() => void updateReminderSetting({ resume: true, enabled: true })}
                    >
                      恢复提醒
                    </button>
                  </div>
                )}
              </div>

              <div className="camp-def-box" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <strong>🔍 视觉与低配设备适配（R11）</strong>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13 }}>全局字号</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { key: 'normal', label: '标准' },
                      { key: 'large', label: '大号' },
                      { key: 'xlarge', label: '超大' },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        className={`candy-pill ${fontScale === opt.key ? 'berry' : ''}`}
                        style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                        disabled={reminderBusy}
                        onClick={() => void updateA11ySetting({ fontScale: opt.key as 'normal' | 'large' | 'xlarge' })}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13 }}>减弱动效（保护视力与专注）</span>
                  <button
                    type="button"
                    className={`candy-pill ${reduceMotion ? 'mint' : ''}`}
                    style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
                    disabled={reminderBusy}
                    onClick={() => void updateA11ySetting({ reduceMotion: !reduceMotion })}
                  >
                    {reduceMotion ? '已开启' : '关闭'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13 }}>低配 / 省电模式（降阴影动画）</span>
                  <button
                    type="button"
                    className={`candy-pill ${lowSpecMode ? 'mint' : ''}`}
                    style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
                    disabled={reminderBusy}
                    onClick={() => void updateA11ySetting({ lowSpecMode: !lowSpecMode })}
                  >
                    {lowSpecMode ? '已开启' : '关闭'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button type="button" className="candy-pill" style={{ minHeight: 38 }} onClick={openIosGuide}>
            iPhone 免签名安装
          </button>
          {pendingRelease ? (
            <button type="button" className="candy-pill berry" style={{ minHeight: 38 }} onClick={applyPendingUpdate}>
              升级到 {pendingRelease.version}
            </button>
          ) : (
            <button
              type="button"
              className="candy-pill"
              style={{ minHeight: 38 }}
              disabled={checking}
              onClick={() => void checkForUpdates()}
            >
              {checking ? '检测中...' : '检查热更新推送'}
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <Link to="/student/cardsets" className="candy-pill" style={{ minHeight: 36, fontSize: 12 }}>班级词集</Link>
          <Link to="/student" className="candy-pill" style={{ minHeight: 36, fontSize: 12 }}>切换班级</Link>
          <button
            type="button"
            className="candy-pill"
            style={{ minHeight: 36, fontSize: 12 }}
            onClick={async () => { await logout(); navigate('/login') }}
          >
            退出账号
          </button>
        </div>
      </section>

      {/* F6: 徽章墙弹窗 */}
      {badgesModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="徽章墙">
          <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '85vh' }}>
            <div className="modal-header" style={{ marginBottom: 0 }}>
              <h2>我的徽章墙 ({badgesData?.earnedCount ?? 0}/{badgesData?.totalCount ?? 19})</h2>
              <button type="button" className="candy-pill" onClick={() => setBadgesModalOpen(false)}>关闭</button>
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
              {[
                { key: 'all', label: '全部' },
                { key: 'persistence', label: '坚持' },
                { key: 'memory', label: '记忆' },
                { key: 'challenge', label: '闯关' },
                { key: 'comeback', label: '逆袭' },
                { key: 'graduation', label: '结业' },
              ].map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`candy-pill ${badgeCat === c.key ? 'berry' : ''}`}
                  style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                  onClick={() => setBadgeCat(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="badge-wall-grid">
              {(badgesData?.badges ?? [])
                .filter((b) => badgeCat === 'all' || b.category === badgeCat)
                .map((b) => (
                  <div key={b.key} className={`badge-tile ${b.earned ? 'earned' : 'locked'}`}>
                    <div className="badge-tile-icon">{b.icon}</div>
                    <strong style={{ fontSize: 13 }}>{b.name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{b.description}</div>
                    <span className={`badge ${b.earned ? 'badge-green' : 'badge-gray'}`} style={{ marginTop: 4 }}>
                      {b.progressText}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* F9: 班内进步榜弹窗（默认关闭，仅显示昵称与头像） */}
      {boardModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="班内进步榜">
          <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '85vh' }}>
            <div className="modal-header" style={{ marginBottom: 0 }}>
              <h2>本周班内进步榜</h2>
              <button type="button" className="candy-pill" onClick={() => setBoardModalOpen(false)}>关闭</button>
            </div>
            {!boardData?.enabled ? (
              <div className="camp-def-box" style={{ fontSize: 13 }}>
                老师暂未开启班内进步榜，专注跟自己的昨天比较就很棒！
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  仅比拼「本周 XP 相对上周增量」，每周一 00:00 重置，只显示昵称与头像。
                </div>
                {boardData.myEntry && (
                  <div className="alert alert-info" style={{ marginBottom: 0, padding: '8px 10px' }}>
                    我的位置：第 <strong>{boardData.myEntry.rank}</strong> 名 · 本周进步 {boardData.myEntry.deltaXp >= 0 ? `+${boardData.myEntry.deltaXp}` : boardData.myEntry.deltaXp} XP
                  </div>
                )}
                <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {boardData.entries.map((e) => {
                    const em = AVATAR_OPTIONS.find((a) => a.key === e.avatarKey)?.emoji ?? '🍦'
                    return (
                      <div key={`${e.rank}-${e.nickname}`} className="camp-def-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong>#{e.rank}</strong>
                          <span>{em}</span>
                          <span>{e.nickname}{e.isSelf ? '（我）' : ''}</span>
                        </div>
                        <span className="badge badge-green">
                          {e.deltaXp >= 0 ? `+${e.deltaXp}` : e.deltaXp} XP
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* F11: 昵称、头像框与卡牌皮肤弹窗 */}
      {customizeOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="装扮与昵称设置">
          <form className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => void saveCustomization(e)}>
            <div className="modal-header" style={{ marginBottom: 0 }}>
              <h2>装扮与昵称设置</h2>
              <button type="button" className="candy-pill" onClick={() => setCustomizeOpen(false)}>取消</button>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="camp-nickname">展示昵称（榜内不展示真名）</label>
              <input
                id="camp-nickname"
                className="form-input"
                maxLength={20}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>选择头像</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {AVATAR_OPTIONS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className={`candy-pill ${avatarKey === a.key ? 'berry' : ''}`}
                    style={{ minHeight: 38 }}
                    onClick={() => setAvatarKey(a.key)}
                  >
                    {a.emoji} {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>头像框（随等级解锁）</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {AVATAR_FRAME_OPTIONS.map((f) => {
                  const unlocked = currentLevel >= f.minLevel
                  return (
                    <button
                      key={f.key}
                      type="button"
                      disabled={!unlocked}
                      className={`candy-pill ${avatarFrame === f.key ? 'berry' : ''}`}
                      style={{ minHeight: 36, opacity: unlocked ? 1 : 0.45 }}
                      onClick={() => setAvatarFrame(f.key)}
                    >
                      {f.label} {!unlocked ? `(Lv.${f.minLevel})` : ''}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>词卡皮肤</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CARD_SKIN_OPTIONS.map((s) => {
                  const unlocked =
                    currentLevel >= s.minLevel ||
                    Boolean(gameSummary?.profile.unlockedSkins?.includes(s.key))
                  return (
                    <button
                      key={s.key}
                      type="button"
                      disabled={!unlocked}
                      className={`candy-pill ${cardSkin === s.key ? 'berry' : ''}`}
                      style={{ minHeight: 36, opacity: unlocked ? 1 : 0.45 }}
                      onClick={() => setCardSkin(s.key)}
                    >
                      {s.label} {!unlocked ? `(Lv.${s.minLevel})` : ''}
                    </button>
                  )
                })}
              </div>
            </div>
            <button type="submit" className="camp-btn camp-btn-berry" disabled={savingProfile}>
              {savingProfile ? '保存中...' : '保存装扮'}
            </button>
          </form>
        </div>
      )}

      <ShareCardModal open={shareOpen} onClose={() => setShareOpen(false)} />
    </>
  )
}

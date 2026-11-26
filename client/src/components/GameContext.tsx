import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../utils/api'
import { useEnrollment } from '../utils/enrollment'
import { playSfx, setSoundEnabled, triggerHaptic } from '../utils/audio'

export interface RewardFeedback {
  xp: number
  bonusXp: number
  totalAwardedXp: number
  totalXp: number
  dailyXp: number
  dailyCap: number
  remainingDailyXp: number
  capped: boolean
  level: number
  title: string
  levelUp: { fromLevel: number; toLevel: number; newTitle: string } | null
  ringsClosed: boolean
  ringsClosedJustNow: boolean
  streakDays: number
  freezeTickets: number
  ticketEarned: number
  newBadges: Array<{ key: string; name: string; icon: string; description: string }>
  configVersion: string
  replayed?: boolean
}

export interface StudentGameSummary {
  studyDate: string
  weekStart: string
  configVersion: string
  lateNightQuiet: boolean
  profile: {
    nickname: string
    avatarKey: string
    avatarFrame: string
    cardSkin: string
    soundEnabled: boolean
    streakDays: number
    longestStreak: number
    freezeTickets: number
    lastAchievedDate: string | null
    fontScale?: 'normal' | 'large' | 'xlarge'
    reduceMotion?: boolean
    lowSpecMode?: boolean
    unlockedSkins?: string[]
  }
  classSettings?: {
    mnemonicCoCreateOpen: boolean
    squadEnabled: boolean
    activePackId: string | null
  }
  level: {
    level: number
    title: string
    totalXp: number
    minXp: number
    nextLevelXp: number
    nextLevelTitle: string
    xpIntoLevel: number
    xpForNextLevel: number
    progressPct: number
  }
  today: {
    xpEarned: number
    dailyCap: number
    remainingDailyXp: number
    capped: boolean
    rings: {
      reviewDue: number
      reviewDone: number
      reviewRatio: number
      reviewClosed: boolean
      levelDone: number
      levelTotal: number
      levelRatio: number
      levelClosed: boolean
      ringsClosed: boolean
    }
    weakBossDone: boolean
  }
  weekDays: Array<{
    localDate: string
    label: string
    ringsClosed: boolean
    xpEarned: number
    isToday: boolean
  }>
  tomorrowDueCount: number
  weakWordCount: number
  badgesEarnedCount: number
  badgesTotalCount: number
  classChallenge: {
    weekStart: string
    title: string
    targetCount: number
    currentCount: number
    participatingStudents: number
    totalStudents: number
    completed: boolean
    progressPct: number
  }
  unreadCheers: Array<{
    id: string
    senderName: string
    presetKey: string
    message: string
    sticker: string
    createdAt: string
  }>
}

interface XpFloat {
  id: number
  text: string
  sub?: string
}

interface GameContextValue {
  summary: StudentGameSummary | null
  loading: boolean
  refreshSummary: () => Promise<void>
  applyRewardFeedback: (reward?: RewardFeedback | null) => void
  xpFloats: XpFloat[]
  levelUpModal: { fromLevel: number; toLevel: number; newTitle: string } | null
  dismissLevelUp: () => void
  badgeToast: { key: string; name: string; icon: string; description: string } | null
  dismissBadgeToast: () => void
  dismissCheer: (cheerId: string) => Promise<void>
}

const GameContext = createContext<GameContextValue | null>(null)

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used within GameProvider')
  return ctx
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { active } = useEnrollment()
  const [summary, setSummary] = useState<StudentGameSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [xpFloats, setXpFloats] = useState<XpFloat[]>([])
  const [levelUpModal, setLevelUpModal] = useState<{
    fromLevel: number
    toLevel: number
    newTitle: string
  } | null>(null)
  const [badgeToast, setBadgeToast] = useState<{
    key: string
    name: string
    icon: string
    description: string
  } | null>(null)
  const floatSeq = useRef(1)

  const refreshSummary = useCallback(async () => {
    if (!active) {
      setSummary(null)
      return
    }
    setLoading(true)
    try {
      const data = await api.get<StudentGameSummary>(
        `/students/game/summary?enrollmentId=${active.enrollmentId}`,
      )
      setSummary(data)
      setSoundEnabled(Boolean(data.profile.soundEnabled))
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-font-scale', data.profile.fontScale || 'normal')
        document.documentElement.setAttribute('data-reduce-motion', String(Boolean(data.profile.reduceMotion)))
        document.documentElement.setAttribute('data-low-spec', String(Boolean(data.profile.lowSpecMode)))
      }
    } catch {
      /* Keep resilient if API is momentarily unavailable */
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => {
    void refreshSummary()
  }, [refreshSummary])

  const pushFloat = useCallback((text: string, sub?: string) => {
    const id = floatSeq.current++
    setXpFloats((prev) => [...prev.slice(-2), { id, text, sub }])
    window.setTimeout(() => {
      setXpFloats((prev) => prev.filter((f) => f.id !== id))
    }, 1150)
  }, [])

  const applyRewardFeedback = useCallback(
    (reward?: RewardFeedback | null) => {
      if (!reward) return
      if (reward.totalAwardedXp > 0) {
        const sub = reward.ringsClosedJustNow ? '双环合拢！' : undefined
        pushFloat(`+${reward.totalAwardedXp} XP`, sub)
        playSfx(reward.ringsClosedJustNow ? 'ring' : 'xp')
        triggerHaptic(12)
      } else if (reward.capped && !reward.replayed) {
        pushFloat('今天够了', '今日 XP 已封顶')
      }

      if (reward.levelUp) {
        setLevelUpModal(reward.levelUp)
        playSfx('levelup')
        triggerHaptic(24)
        window.setTimeout(() => {
          setLevelUpModal((curr) =>
            curr?.toLevel === reward.levelUp?.toLevel ? null : curr,
          )
        }, 1450)
      }

      if (reward.newBadges && reward.newBadges.length > 0) {
        setBadgeToast(reward.newBadges[0])
        window.setTimeout(() => setBadgeToast(null), 3200)
      }

      void refreshSummary()
    },
    [pushFloat, refreshSummary],
  )

  const dismissCheer = useCallback(
    async (cheerId: string) => {
      setSummary((prev) =>
        prev
          ? { ...prev, unreadCheers: prev.unreadCheers.filter((c) => c.id !== cheerId) }
          : prev,
      )
      await api.post(`/students/game/cheers/${cheerId}/read`, {}).catch(() => undefined)
    },
    [],
  )

  return (
    <GameContext.Provider
      value={{
        summary,
        loading,
        refreshSummary,
        applyRewardFeedback,
        xpFloats,
        levelUpModal,
        dismissLevelUp: () => setLevelUpModal(null),
        badgeToast,
        dismissBadgeToast: () => setBadgeToast(null),
        dismissCheer,
      }}
    >
      {children}
    </GameContext.Provider>
  )
}

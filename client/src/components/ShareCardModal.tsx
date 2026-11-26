import { useEffect, useState } from 'react'
import { AVATAR_OPTIONS } from '@vanilla-srs/shared/gamification'
import {
  renderParentWeeklyCardDataUrl,
  renderSeasonShareCardDataUrl,
  renderShareCardDataUrl,
} from '../utils/shareCard'
import { useGame } from './GameContext'
import { useEnrollment } from '../utils/enrollment'
import { api } from '../utils/api'
import { trackAnalyticsEvent } from '../utils/analytics'

interface ShareCardModalProps {
  open: boolean
  onClose: () => void
  initialTab?: 'daily' | 'parent' | 'season'
}

export default function ShareCardModal({ open, onClose, initialTab = 'daily' }: ShareCardModalProps) {
  const { summary } = useGame()
  const { active } = useEnrollment()
  const [tab, setTab] = useState<'daily' | 'parent' | 'season'>(initialTab)
  const [imgUrl, setImgUrl] = useState<string>('')
  const [hasSeason, setHasSeason] = useState(false)

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  useEffect(() => {
    if (!open || !summary) return
    let cancelled = false
    const avatarEmoji =
      AVATAR_OPTIONS.find((a) => a.key === summary.profile.avatarKey)?.emoji ?? '🍦'

    const loadAndRender = async () => {
      let collectedCount = 0
      let diamondCount = 0
      let goldPlusCount = 0
      let seasonData: any = null

      if (active) {
        try {
          const [album, season] = await Promise.all([
            api.get<{
              summary: { collectedCount: number; diamondCount: number; goldCount?: number }
            }>(`/students/game/cards?enrollmentId=${active.enrollmentId}&day=1`),
            api.get<any>(`/students/season?enrollmentId=${active.enrollmentId}`).catch(() => null),
          ])
          collectedCount = album.summary.collectedCount
          diamondCount = album.summary.diamondCount
          goldPlusCount = (album.summary.goldCount ?? 0) + diamondCount
          seasonData = season
          if (!cancelled) setHasSeason(Boolean(season?.configured))
        } catch {
          /* ignore */
        }
      }
      if (cancelled) return

      if (tab === 'parent') {
        const weeklyActiveDays = summary.weekDays.filter((d) => d.ringsClosed || d.xpEarned > 0).length
        const url = renderParentWeeklyCardDataUrl({
          nickname: summary.profile.nickname,
          avatarEmoji,
          weeklyActiveDays,
          masteredWords: seasonData?.milestones?.stage4Count ?? goldPlusCount,
          streakDays: summary.profile.streakDays,
          studyDate: summary.studyDate,
        })
        setImgUrl(url)
      } else if (tab === 'season' && seasonData?.configured) {
        const url = renderSeasonShareCardDataUrl({
          nickname: summary.profile.nickname,
          avatarEmoji,
          seasonName: seasonData.name ?? '中考冲刺赛季',
          examDate: seasonData.examDate,
          stage4Count: seasonData.milestones?.stage4Count ?? 0,
          totalWords: seasonData.milestones?.totalWords ?? 688,
          pct: seasonData.milestones?.pct ?? 0,
          studyDate: summary.studyDate,
        })
        setImgUrl(url)
      } else {
        const url = renderShareCardDataUrl({
          nickname: summary.profile.nickname,
          avatarEmoji,
          level: summary.level.level,
          title: summary.level.title,
          streakDays: summary.profile.streakDays,
          todayXp: summary.today.xpEarned,
          collectedCount,
          diamondCount,
          studyDate: summary.studyDate,
        })
        setImgUrl(url)
      }
    }

    void loadAndRender()
    return () => {
      cancelled = true
    }
  }, [open, summary, active, tab])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="战报分享卡">
      <div className="camp-modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="modal-header" style={{ marginBottom: 0 }}>
          <h2>我的学习分享卡</h2>
          <button type="button" className="candy-pill" onClick={onClose}>
            关闭
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`candy-pill ${tab === 'daily' ? 'berry' : ''}`}
            style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}
            onClick={() => setTab('daily')}
          >
            今日战报卡
          </button>
          <button
            type="button"
            className={`candy-pill ${tab === 'parent' ? 'berry' : ''}`}
            style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}
            onClick={() => setTab('parent')}
          >
            家长周报卡
          </button>
          {hasSeason && (
            <button
              type="button"
              className={`candy-pill ${tab === 'season' ? 'berry' : ''}`}
              style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}
              onClick={() => setTab('season')}
            >
              赛季回顾卡
            </button>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          仅展示昵称、天数与掌握进度，不含真实姓名与班级排名。在微信或手机端长按图片即可保存分享！
        </p>
        {imgUrl ? (
          <img
            src={imgUrl}
            alt="香草单词营分享卡"
            style={{
              width: '100%',
              borderRadius: 14,
              border: '2px solid var(--color-border)',
              display: 'block',
            }}
          />
        ) : (
          <div style={{ padding: 24, textAlign: 'center' }}>正在生成分享卡...</div>
        )}
        {imgUrl && (
          <a
            href={imgUrl}
            download={`wordcamp-${tab}-${summary?.studyDate ?? 'card'}.png`}
            className="camp-btn camp-btn-berry"
            style={{ width: '100%' }}
            onClick={() => {
              trackAnalyticsEvent(
                'share_card_save',
                { cardType: tab },
                { enrollmentId: active?.enrollmentId, immediate: true },
              )
            }}
          >
            保存分享图片
          </a>
        )}
      </div>
    </div>
  )
}

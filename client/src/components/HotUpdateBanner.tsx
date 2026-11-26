import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  activateWaitingSwAndReload,
  getAppliedReleaseMeta,
  isIosSafariNonStandalone,
  registerAppServiceWorker,
  saveAppliedReleaseMeta,
  triggerSwCheck,
  type AppliedReleaseMeta,
} from '../utils/pwa'
import { trackAnalyticsEvent } from '../utils/analytics'

export interface RemoteReleaseInfo {
  id: string
  version: string
  packVersion: string
  title: string
  notes: string
  pushMode: 'BANNER' | 'FORCE_RELOAD' | 'SILENT'
  payloadType: 'APP_UI' | 'VOCAB_PACK' | 'MNEMONIC_PATCH' | 'GAME_CONFIG' | 'WORLD_CONTENT'
  publishedBy: string
  publisherRole: string
  publishedAt: string
}

interface HotUpdateContextValue {
  currentMeta: AppliedReleaseMeta
  pendingRelease: RemoteReleaseInfo | null
  swWaiting: boolean
  checking: boolean
  iosInstallHint: boolean
  openIosGuide: () => void
  checkForUpdates: () => Promise<void>
  applyPendingUpdate: () => void
  dismissPendingBanner: () => void
}

const HotUpdateContext = createContext<HotUpdateContextValue | null>(null)

export function useHotUpdate(): HotUpdateContextValue {
  const ctx = useContext(HotUpdateContext)
  if (!ctx) throw new Error('useHotUpdate must be used within HotUpdateProvider')
  return ctx
}

export function HotUpdateProvider({ children }: { children: ReactNode }) {
  const [currentMeta, setCurrentMeta] = useState<AppliedReleaseMeta>(getAppliedReleaseMeta)
  const [pendingRelease, setPendingRelease] = useState<RemoteReleaseInfo | null>(null)
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const [swWaiting, setSwWaiting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [iosGuideOpen, setIosGuideOpen] = useState(false)
  const [iosInstallHint] = useState<boolean>(isIosSafariNonStandalone)

  const checkForUpdates = useCallback(async () => {
    setChecking(true)
    try {
      const local = getAppliedReleaseMeta()
      const res = await fetch('/api/releases/latest', {
        credentials: 'include',
        headers: { 'X-Client-Version': local.version },
      })
      if (res.ok) {
        const data = (await res.json()) as { latest?: RemoteReleaseInfo }
        const remote = data.latest
        if (remote && (remote.version !== local.version || remote.packVersion !== local.packVersion)) {
          if (remote.pushMode === 'SILENT') {
            const next = saveAppliedReleaseMeta({
              id: remote.id,
              version: remote.version,
              packVersion: remote.packVersion,
            })
            setCurrentMeta(next)
          } else {
            setPendingRelease(remote)
            if (remote.pushMode === 'FORCE_RELOAD') {
              setTimeout(() => {
                saveAppliedReleaseMeta({
                  id: remote.id,
                  version: remote.version,
                  packVersion: remote.packVersion,
                })
                activateWaitingSwAndReload(true)
              }, 1400)
            }
          }
        }
      }
      const hasWaiting = await triggerSwCheck()
      if (hasWaiting) setSwWaiting(true)
    } catch {
      /* Offline or server unreachable — keep silent */
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    registerAppServiceWorker(() => setSwWaiting(true))
    void checkForUpdates()

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdates()
      }
    }
    window.addEventListener('focus', onFocusOrVisible)
    document.addEventListener('visibilitychange', onFocusOrVisible)
    const timer = window.setInterval(() => {
      void checkForUpdates()
    }, 60_000)

    return () => {
      window.removeEventListener('focus', onFocusOrVisible)
      document.removeEventListener('visibilitychange', onFocusOrVisible)
      window.clearInterval(timer)
    }
  }, [checkForUpdates])

  const applyPendingUpdate = useCallback(() => {
    if (pendingRelease) {
      trackAnalyticsEvent('hot_update_click', { version: pendingRelease.version, payloadType: pendingRelease.payloadType })
      const next = saveAppliedReleaseMeta({
        id: pendingRelease.id,
        version: pendingRelease.version,
        packVersion: pendingRelease.packVersion,
      })
      setCurrentMeta(next)
      const needsReload = pendingRelease.payloadType === 'APP_UI' || swWaiting
      setPendingRelease(null)
      setDismissedId(null)
      activateWaitingSwAndReload(needsReload)
    } else if (swWaiting) {
      activateWaitingSwAndReload(true)
    }
  }, [pendingRelease, swWaiting])

  const dismissPendingBanner = useCallback(() => {
    if (pendingRelease) setDismissedId(pendingRelease.id)
    setPendingRelease(null)
  }, [pendingRelease])

  const showToast = Boolean(
    (pendingRelease && pendingRelease.id !== dismissedId) || swWaiting,
  )

  useEffect(() => {
    if (showToast && pendingRelease) {
      trackAnalyticsEvent(
        'hot_update_shown',
        { version: pendingRelease.version, payloadType: pendingRelease.payloadType },
        { clientEventId: `hot-shown-${pendingRelease.id}` },
      )
    }
  }, [showToast, pendingRelease])

  return (
    <HotUpdateContext.Provider
      value={{
        currentMeta,
        pendingRelease,
        swWaiting,
        checking,
        iosInstallHint,
        openIosGuide: () => setIosGuideOpen(true),
        checkForUpdates,
        applyPendingUpdate,
        dismissPendingBanner,
      }}
    >
      {showToast && (
        <div className="hot-update-toast" role="status" aria-live="polite">
          <div className="hot-update-toast-text">
            <strong>
              {pendingRelease
                ? `老师推送热更 ${pendingRelease.version}｜${pendingRelease.title}`
                : '发现新版应用缓存'}
            </strong>
            <span>
              {pendingRelease?.notes ?? '点击 1 秒完成无感更新，保留当前学习进度。'}
            </span>
          </div>
          <div className="hot-update-toast-actions">
            <button
              type="button"
              className="camp-btn camp-btn-sticky"
              onClick={applyPendingUpdate}
            >
              1秒热更新
            </button>
            {pendingRelease?.pushMode !== 'FORCE_RELOAD' && (
              <button
                type="button"
                className="camp-btn camp-btn-ghost"
                onClick={dismissPendingBanner}
              >
                稍后
              </button>
            )}
          </div>
        </div>
      )}

      {iosGuideOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="iPhone添加到主屏幕指南">
          <div className="modal-card camp-modal-card">
            <div className="modal-header">
              <h2>iPhone 免签名桌面安装指南</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIosGuideOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="ios-guide-steps">
              <div className="ios-guide-step">
                <span className="step-num">第1步</span>
                <p>请使用 iPhone 自带 <strong>Safari 浏览器</strong>打开本学习页面（微信内可点右上角「在 Safari 中打开」）。</p>
              </div>
              <div className="ios-guide-step">
                <span className="step-num">第2步</span>
                <p>点击 Safari 底部中间的 <strong>「分享」图标</strong>（带向上箭头的方框）。</p>
              </div>
              <div className="ios-guide-step">
                <span className="step-num">第3步</span>
                <p>向上滑动菜单，选择 <strong>「添加到主屏幕」</strong>，即可变身全屏独立 App（永久免苹果证书签名，后台新词热更自动直达）。</p>
              </div>
            </div>
            <button
              type="button"
              className="camp-btn camp-btn-mint"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => setIosGuideOpen(false)}
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {children}
    </HotUpdateContext.Provider>
  )
}

export const APP_CLIENT_VERSION = 'v2.4.0'
export const APP_PACK_VERSION = 'Pack-23D-688'
const APPLIED_RELEASE_KEY = 'vanilla-srs-applied-release'

export interface AppliedReleaseMeta {
  id: string
  version: string
  packVersion: string
  appliedAt: string
}

export function getAppliedReleaseMeta(): AppliedReleaseMeta {
  try {
    const raw = localStorage.getItem(APPLIED_RELEASE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppliedReleaseMeta>
      if (parsed.version && parsed.packVersion && parsed.id) {
        return {
          id: parsed.id,
          version: parsed.version,
          packVersion: parsed.packVersion,
          appliedAt: parsed.appliedAt ?? new Date().toISOString(),
        }
      }
    }
  } catch { /* ignore */ }
  return {
    id: 'baseline-v2.4.0',
    version: APP_CLIENT_VERSION,
    packVersion: APP_PACK_VERSION,
    appliedAt: '2026-11-25T00:00:00.000Z',
  }
}

export function saveAppliedReleaseMeta(meta: Omit<AppliedReleaseMeta, 'appliedAt'>): AppliedReleaseMeta {
  const full: AppliedReleaseMeta = { ...meta, appliedAt: new Date().toISOString() }
  try {
    localStorage.setItem(APPLIED_RELEASE_KEY, JSON.stringify(full))
  } catch { /* ignore */ }
  return full
}

export function isIosSafariNonStandalone(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  const mqStandalone = window.matchMedia?.('(display-mode: standalone)').matches
  return Boolean(isIos && !navStandalone && !mqStandalone)
}

let swRegistration: ServiceWorkerRegistration | null = null

export function registerAppServiceWorker(onWaiting?: () => void): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
  if (isDev) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        swRegistration = reg
        if (reg.waiting) onWaiting?.()
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing
          if (!nw) return
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              onWaiting?.()
            }
          })
        })
      })
      .catch(() => undefined)
  })
}

export async function triggerSwCheck(): Promise<boolean> {
  if (!swRegistration) return false
  try {
    await swRegistration.update()
    return Boolean(swRegistration.waiting)
  } catch {
    return false
  }
}

export function activateWaitingSwAndReload(shouldReload: boolean): void {
  if (swRegistration?.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })
  }
  if (shouldReload) {
    window.location.reload()
  }
}

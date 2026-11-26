/**
 * R2 Privacy-safe Analytics & R3 Web Push client helpers.
 * Never collects device fingerprints or third-party trackers.
 */

import { api } from './api'
import { getAppliedReleaseMeta } from './pwa'

let eventSeq = 1
const queue: Array<{
  clientEventId: string
  type: string
  enrollmentId?: string
  props?: Record<string, unknown>
  occurredAt: string
}> = []
let flushTimer: number | null = null

function nextClientEventId(type: string): string {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${eventSeq++}-${Math.random().toString(36).slice(2, 8)}`
  return `${type}-${rand}`
}

export function flushAnalyticsQueue(): void {
  if (queue.length === 0) return
  const batch = queue.splice(0, 20)
  void api
    .post('/students/analytics/events', {
      clientVersion: getAppliedReleaseMeta().version,
      events: batch,
    })
    .catch(() => {
      /* keep silent on offline or non-student sessions */
    })
}

export function trackAnalyticsEvent(
  type: string,
  props?: Record<string, unknown>,
  options?: { enrollmentId?: string; immediate?: boolean; clientEventId?: string },
): void {
  queue.push({
    clientEventId: options?.clientEventId ?? nextClientEventId(type),
    type,
    ...(options?.enrollmentId ? { enrollmentId: options.enrollmentId } : {}),
    ...(props ? { props } : {}),
    occurredAt: new Date().toISOString(),
  })

  if (options?.immediate) {
    flushAnalyticsQueue()
    return
  }

  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flushAnalyticsQueue()
  }, 800)
}

export function isWeChatBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /MicroMessenger/i.test(navigator.userAgent || '')
}

export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (isWeChatBrowser()) return false
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function subscribeBrowserPush(): Promise<{ ok: boolean; error?: string }> {
  if (!isWebPushSupported()) {
    return { ok: false, error: '当前浏览器不支持 Web Push 推送，将使用站内提醒与老师击掌。' }
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: '未授予通知权限，已为你保留站内温和提醒。' }
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const { publicKey } = await api.get<{ publicKey: string }>('/students/push/vapid-key')
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
    }
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: '无法读取推送订阅密钥' }
    }
    await api.post('/students/push/subscribe', {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || '订阅推送失败' }
  }
}

export async function unsubscribeBrowserPush(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager?.getSubscription()
      if (sub) {
        await api.delete('/students/push/subscribe').catch(() => undefined)
        await sub.unsubscribe().catch(() => undefined)
        return
      }
    }
  } catch {
    /* ignore */
  }
  await api.delete('/students/push/subscribe').catch(() => undefined)
}

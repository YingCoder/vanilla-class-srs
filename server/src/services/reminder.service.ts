/**
 * R3 Gentle Reminder & Recall Service.
 *
 * - In-app reminder banner after 20:00 Shanghai when review ring is unclosed,
 *   plus freeze-ticket consumption explanation notice.
 * - Opt-in iOS/Web Push subscription & preference management.
 * - Strict frequency & safety guardrails:
 *   * max 1/day, max 4/week
 *   * 07:00–21:30 Asia/Shanghai only
 *   * skipped when review ring closed today
 *   * auto-paused 7 days after 3 consecutive unopened reminders
 *   * only positive/neutral templates from GameConfig
 */

import type { PrismaClient } from '@prisma/client'
import {
  addCalendarDays,
  shanghaiTimeParts,
} from '@vanilla-srs/shared/gamification'
import {
  DEFAULT_REMINDER_TEMPLATES,
  REMINDER_LIMITS,
  evaluateReminderEligibility,
  renderReminderTemplate,
} from '@vanilla-srs/shared/stage4'
import { getEffectiveGameConfig } from './gameConfig.service'
import { sendWebPushNotification } from '../lib/webpush'
import { recordServerAnalyticsEvent } from './analytics.service'

export interface InAppReminderBanner {
  showReminder: boolean
  dueCount: number
  streakDays: number
  message: string | null
  freezeTicketNotice: string | null
}

export async function getInAppReminderBanner(
  prisma: PrismaClient,
  studentId: string,
  enrollmentId: string,
  now: Date = new Date(),
): Promise<InAppReminderBanner> {
  const { localDate, hour } = shanghaiTimeParts(now)
  const [profile, daily, freezeEvent] = await Promise.all([
    prisma.studentGameProfile.findUnique({ where: { studentId } }),
    prisma.dailyGameState.findUnique({
      where: { studentId_localDate: { studentId, localDate } },
    }),
    prisma.gameEvent.findUnique({
      where: {
        studentId_type_sourceId: { studentId, type: 'FREEZE_TICKET_USED', sourceId: localDate },
      },
    }),
  ])

  const freezeTicketNotice = freezeEvent
    ? `已用 ${(freezeEvent.meta as any)?.consumed ?? 1} 张冻结券保住连续天数（当前 ${profile?.streakDays ?? 0} 天）`
    : null

  const dueCount = daily ? Math.max(0, daily.reviewDue - daily.reviewDone) : 0
  const reviewClosed = daily ? daily.reviewDue === 0 || daily.reviewDone >= daily.reviewDue : false
  const streakDays = profile?.streakDays ?? 0

  const showReminder = Boolean(hour >= 20 && !reviewClosed && dueCount > 0)
  const message = showReminder
    ? `今天有 ${dueCount} 个词快到复习点了${streakDays > 0 ? `，已完成连续 ${streakDays} 天` : ''}，花 3 分钟巩固一下吧～`
    : null

  return {
    showReminder,
    dueCount,
    streakDays,
    message,
    freezeTicketNotice,
  }
}

export async function getReminderPref(prisma: PrismaClient, studentId: string) {
  const [pref, subs] = await Promise.all([
    prisma.reminderPref.findUnique({ where: { studentId } }),
    prisma.pushSubscription.findMany({
      where: { studentId, disabledAt: null },
      select: { id: true, endpoint: true, createdAt: true },
    }),
  ])
  return {
    enabled: pref?.enabled ?? false,
    hour: pref?.hour ?? 19,
    pausedUntil: pref?.pausedUntil ?? null,
    consecutiveUnopened: pref?.consecutiveUnopened ?? 0,
    activeSubscriptions: subs.length,
  }
}

export async function updateReminderPref(
  prisma: PrismaClient,
  studentId: string,
  input: { enabled?: boolean; hour?: number; resume?: boolean },
) {
  const safeHour =
    input.hour !== undefined ? Math.max(7, Math.min(21, Math.floor(input.hour))) : undefined

  const existing = await prisma.reminderPref.findUnique({ where: { studentId } })
  const updated = await prisma.reminderPref.upsert({
    where: { studentId },
    create: {
      studentId,
      enabled: input.enabled ?? false,
      hour: safeHour ?? 19,
      pausedUntil: null,
      consecutiveUnopened: 0,
    },
    update: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(safeHour !== undefined ? { hour: safeHour } : {}),
      ...(input.resume ? { pausedUntil: null, consecutiveUnopened: 0 } : {}),
    },
  })

  await recordServerAnalyticsEvent(prisma, {
    studentId,
    type: 'game_setting_toggle',
    clientEventId: `reminder-pref-${studentId}-${Date.now()}`,
    props: { setting: 'reminder', enabled: updated.enabled, hour: updated.hour },
  })

  return updated
}

export async function subscribePush(
  prisma: PrismaClient,
  studentId: string,
  sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
) {
  const record = await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      studentId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent: sub.userAgent?.slice(0, 180) ?? null,
      disabledAt: null,
    },
    update: {
      studentId,
      p256dh: sub.p256dh,
      auth: sub.auth,
      disabledAt: null,
    },
  })
  await prisma.reminderPref.upsert({
    where: { studentId },
    create: { studentId, enabled: true, hour: 19 },
    update: { enabled: true, pausedUntil: null, consecutiveUnopened: 0 },
  })
  return record
}

export async function unsubscribePush(
  prisma: PrismaClient,
  studentId: string,
  endpoint?: string,
) {
  if (endpoint) {
    await prisma.pushSubscription.updateMany({
      where: { studentId, endpoint },
      data: { disabledAt: new Date() },
    })
  } else {
    await prisma.pushSubscription.updateMany({
      where: { studentId, disabledAt: null },
      data: { disabledAt: new Date() },
    })
    await prisma.reminderPref.upsert({
      where: { studentId },
      create: { studentId, enabled: false, hour: 19 },
      update: { enabled: false },
    })
  }
  return { ok: true }
}

export async function markReminderOpened(
  prisma: PrismaClient,
  studentId: string,
  reminderLogId: string,
  now: Date = new Date(),
) {
  const log = await prisma.reminderLog.findUnique({ where: { id: reminderLogId } })
  if (!log || log.studentId !== studentId) return { ok: false }

  if (!log.openedAt) {
    await prisma.reminderLog.update({
      where: { id: reminderLogId },
      data: { openedAt: now },
    })
  }
  await prisma.reminderPref.upsert({
    where: { studentId },
    create: { studentId, enabled: true, hour: 19, consecutiveUnopened: 0, pausedUntil: null },
    update: { consecutiveUnopened: 0, pausedUntil: null },
  })
  await recordServerAnalyticsEvent(prisma, {
    studentId,
    type: 'reminder_open',
    clientEventId: `reminder-open-${reminderLogId}`,
    props: { templateId: log.templateId, channel: log.channel },
    now,
  })
  return { ok: true }
}

export type PushSenderFn = (
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: Record<string, unknown>,
) => Promise<{ ok: boolean; status: number; gone?: boolean }>

export interface DispatchRemindersSummary {
  checkedStudents: number
  sentCount: number
  skippedByReason: Record<string, number>
  autoPausedCount: number
}

export async function dispatchDueReminders(
  prisma: PrismaClient,
  now: Date = new Date(),
  sender: PushSenderFn = sendWebPushNotification,
  options?: { ignorePreferredHour?: boolean; studentIds?: string[] },
): Promise<DispatchRemindersSummary> {
  const { localDate, weekStart } = shanghaiTimeParts(now)
  const prefs = await prisma.reminderPref.findMany({
    where: {
      enabled: true,
      ...(options?.studentIds ? { studentId: { in: options.studentIds } } : {}),
    },
    include: {
      student: {
        include: {
          gameProfile: true,
          enrollments: {
            where: { archivedAt: null },
            select: { classId: true },
            take: 1,
          },
          pushSubscriptions: {
            where: { disabledAt: null },
          },
        },
      },
    },
  })

  const summary: DispatchRemindersSummary = {
    checkedStudents: prefs.length,
    sentCount: 0,
    skippedByReason: {},
    autoPausedCount: 0,
  }

  const bumpSkip = (reason: string) => {
    summary.skippedByReason[reason] = (summary.skippedByReason[reason] ?? 0) + 1
  }

  for (const pref of prefs) {
    const studentId = pref.studentId
    const classId = pref.student.enrollments[0]?.classId ?? null
    const [{ config }, dailyState, sentTodayCount, sentThisWeekCount, recentLogs] = await Promise.all([
      getEffectiveGameConfig(prisma, classId),
      prisma.dailyGameState.findUnique({ where: { studentId_localDate: { studentId, localDate } } }),
      prisma.reminderLog.count({ where: { studentId, localDate } }),
      prisma.reminderLog.count({ where: { studentId, weekStart } }),
      prisma.reminderLog.findMany({
        where: { studentId },
        orderBy: { sentAt: 'desc' },
        take: REMINDER_LIMITS.autoPauseAfterUnopened,
      }),
    ])

    // Auto-pause 7 days if 3 consecutive prior reminders were never opened
    let effectivePausedUntil = pref.pausedUntil
    if (
      recentLogs.length >= REMINDER_LIMITS.autoPauseAfterUnopened &&
      recentLogs.every((l) => l.openedAt === null)
    ) {
      const pauseDate = addCalendarDays(localDate, REMINDER_LIMITS.autoPauseDays)
      if (!effectivePausedUntil || effectivePausedUntil < localDate) {
        await prisma.reminderPref.update({
          where: { studentId },
          data: {
            pausedUntil: pauseDate,
            consecutiveUnopened: recentLogs.length,
          },
        })
        effectivePausedUntil = pauseDate
        summary.autoPausedCount += 1
      }
    }

    const reviewClosed = dailyState
      ? dailyState.reviewDue === 0 || dailyState.reviewDone >= dailyState.reviewDue
      : false

    const elig = evaluateReminderEligibility({
      enabled: pref.enabled,
      preferredHour: pref.hour,
      pausedUntil: effectivePausedUntil,
      ringsClosedToday: reviewClosed,
      sentTodayCount,
      sentThisWeekCount,
      now,
      ignorePreferredHour: options?.ignorePreferredHour,
    })

    if (!elig.eligible) {
      bumpSkip(elig.reason)
      continue
    }

    const activeSubs = pref.student.pushSubscriptions
    if (activeSubs.length === 0) {
      bumpSkip('no_active_subscription')
      continue
    }

    const templates = config.reminderTemplates?.length ? config.reminderTemplates : DEFAULT_REMINDER_TEMPLATES
    const dueCount = dailyState ? Math.max(1, dailyState.reviewDue - dailyState.reviewDone) : 5
    const streakDays = pref.student.gameProfile?.streakDays ?? 0
    const tpl = templates[(sentThisWeekCount + streakDays) % templates.length]
    const rendered = renderReminderTemplate(tpl, { dueCount, streakDays })

    const log = await prisma.reminderLog.create({
      data: {
        studentId,
        templateId: tpl.id,
        channel: 'WEB_PUSH',
        localDate,
        weekStart,
        sentAt: now,
      },
    })

    let anyDelivered = false
    for (const sub of activeSubs) {
      try {
        const res = await sender(sub, {
          title: rendered.title,
          body: rendered.body,
          url: `/student/task?reminderId=${log.id}`,
          reminderLogId: log.id,
        })
        if (res.ok) anyDelivered = true
        if (res.gone) {
          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { disabledAt: now },
          })
        }
      } catch {
        /* keep trying remaining subscriptions */
      }
    }

    if (anyDelivered) {
      summary.sentCount += 1
      await recordServerAnalyticsEvent(prisma, {
        studentId,
        classId,
        type: 'reminder_sent',
        clientEventId: `reminder-sent-${log.id}`,
        props: { templateId: tpl.id, dueCount },
        now,
      })
    } else {
      await prisma.reminderLog.delete({ where: { id: log.id } }).catch(() => undefined)
      bumpSkip('push_delivery_failed')
    }
  }

  return summary
}

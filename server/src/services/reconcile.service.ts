/**
 * R1 Daily Gamification Ledger Reconciliation.
 *
 * Verifies ledger invariants across PostgreSQL:
 *  1. StudentGameProfile.totalXp === SUM(GameEvent.xp) for each student.
 *  2. No negative GameEvent.xp or DailyGameState.xpEarned.
 *  3. DailyGameState.xpEarned === SUM(GameEvent.xp) per (studentId, localDate).
 *  4. No duplicate GameEvent (studentId, type, sourceId) or ReviewEvent (sessionId, submissionId).
 */

import fs from 'fs'
import path from 'path'
import type { PrismaClient } from '@prisma/client'

export interface LedgerDiscrepancy {
  kind:
    | 'PROFILE_XP_MISMATCH'
    | 'DAILY_XP_MISMATCH'
    | 'NEGATIVE_GAME_EVENT'
    | 'NEGATIVE_DAILY_STATE'
    | 'DUPLICATE_SUBMISSION_ID'
    | 'DUPLICATE_GAME_EVENT'
  studentId?: string
  detail: string
  recordId?: string
}

export interface ReconcileReport {
  checkedAt: string
  studentsChecked: number
  eventsChecked: number
  dailyStatesChecked: number
  discrepancies: LedgerDiscrepancy[]
  ok: boolean
}

export async function reconcileGamificationLedger(
  prisma: PrismaClient,
  options?: { writeAlertLog?: boolean; alertLogPath?: string },
): Promise<ReconcileReport> {
  const discrepancies: LedgerDiscrepancy[] = []

  const [profiles, events, dailyStates] = await Promise.all([
    prisma.studentGameProfile.findMany({
      select: { studentId: true, totalXp: true },
    }),
    prisma.gameEvent.findMany({
      select: { id: true, studentId: true, type: true, sourceId: true, xp: true, localDate: true },
    }),
    prisma.dailyGameState.findMany({
      select: { studentId: true, localDate: true, xpEarned: true },
    }),
  ])

  const sumByStudent = new Map<string, number>()
  const sumByStudentDate = new Map<string, number>()
  const seenEventKeys = new Set<string>()

  for (const ev of events) {
    if (ev.xp < 0) {
      discrepancies.push({
        kind: 'NEGATIVE_GAME_EVENT',
        studentId: ev.studentId,
        recordId: ev.id,
        detail: `GameEvent ${ev.id} has negative xp=${ev.xp} (${ev.type}:${ev.sourceId})`,
      })
    }
    const key = `${ev.studentId}|${ev.type}|${ev.sourceId}`
    if (seenEventKeys.has(key)) {
      discrepancies.push({
        kind: 'DUPLICATE_GAME_EVENT',
        studentId: ev.studentId,
        recordId: ev.id,
        detail: `Duplicate GameEvent key ${key}`,
      })
    }
    seenEventKeys.add(key)

    sumByStudent.set(ev.studentId, (sumByStudent.get(ev.studentId) ?? 0) + ev.xp)
    const dKey = `${ev.studentId}|${ev.localDate}`
    sumByStudentDate.set(dKey, (sumByStudentDate.get(dKey) ?? 0) + ev.xp)
  }

  const profileStudents = new Set<string>()
  for (const p of profiles) {
    profileStudents.add(p.studentId)
    const expected = sumByStudent.get(p.studentId) ?? 0
    if (p.totalXp !== expected) {
      discrepancies.push({
        kind: 'PROFILE_XP_MISMATCH',
        studentId: p.studentId,
        detail: `Student ${p.studentId} profile totalXp=${p.totalXp} != ledger sum=${expected}`,
      })
    }
  }

  for (const [sid, sum] of sumByStudent.entries()) {
    if (!profileStudents.has(sid) && sum !== 0) {
      discrepancies.push({
        kind: 'PROFILE_XP_MISMATCH',
        studentId: sid,
        detail: `Student ${sid} has GameEvent sum=${sum} but no StudentGameProfile`,
      })
    }
  }

  for (const ds of dailyStates) {
    if (ds.xpEarned < 0) {
      discrepancies.push({
        kind: 'NEGATIVE_DAILY_STATE',
        studentId: ds.studentId,
        detail: `DailyGameState ${ds.studentId}:${ds.localDate} has negative xpEarned=${ds.xpEarned}`,
      })
    }
    const expected = sumByStudentDate.get(`${ds.studentId}|${ds.localDate}`) ?? 0
    if (ds.xpEarned !== expected) {
      discrepancies.push({
        kind: 'DAILY_XP_MISMATCH',
        studentId: ds.studentId,
        detail: `DailyGameState ${ds.studentId}:${ds.localDate} xpEarned=${ds.xpEarned} != ledger sum=${expected}`,
      })
    }
  }

  // Check duplicate submissionId across ReviewEvent (even across sessions or if unique index bypassed)
  const dupRows = await prisma.$queryRaw<Array<{ sessionId: string; submissionId: string; cnt: bigint }>>`
    SELECT "sessionId", "submissionId", COUNT(*) AS cnt
    FROM "ReviewEvent"
    WHERE "submissionId" IS NOT NULL
    GROUP BY "sessionId", "submissionId"
    HAVING COUNT(*) > 1
  `.catch(() => [])

  for (const row of dupRows) {
    discrepancies.push({
      kind: 'DUPLICATE_SUBMISSION_ID',
      detail: `Duplicate submissionId=${row.submissionId} in session=${row.sessionId} (count=${row.cnt})`,
    })
  }

  const report: ReconcileReport = {
    checkedAt: new Date().toISOString(),
    studentsChecked: profiles.length,
    eventsChecked: events.length,
    dailyStatesChecked: dailyStates.length,
    discrepancies,
    ok: discrepancies.length === 0,
  }

  if (!report.ok && options?.writeAlertLog) {
    const logPath = options.alertLogPath ?? path.resolve(process.cwd(), 'logs', 'reconcile-alerts.log')
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      fs.appendFileSync(logPath, `${JSON.stringify(report)}\n`, 'utf8')
    } catch {
      /* never mask reconciliation result on log write failure */
    }
  }

  return report
}

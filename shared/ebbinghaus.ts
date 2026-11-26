/**
 * Ebbinghaus ("艾斯") spaced-repetition helpers layered cleanly over FSRS-5 state.
 *
 * Pure functions only — safe to import in both Node services and the React client.
 */

import type { FSRSState } from './fsrs/fsrs'

export interface EbbinghausStage {
  stage: number
  label: string
  intervalText: string
  targetDays: number
}

export const EBBINGHAUS_STAGES: readonly EbbinghausStage[] = [
  { stage: 0, label: '初记', intervalText: '5分后', targetDays: 0 },
  { stage: 1, label: '第1阶', intervalText: '5分后', targetDays: 0.0035 },
  { stage: 2, label: '第2阶', intervalText: '30分后', targetDays: 0.021 },
  { stage: 3, label: '第3阶', intervalText: '12时后', targetDays: 0.5 },
  { stage: 4, label: '第4阶', intervalText: '1天后', targetDays: 1 },
  { stage: 5, label: '第5阶', intervalText: '2天后', targetDays: 2 },
  { stage: 6, label: '第6阶', intervalText: '4天后', targetDays: 4 },
  { stage: 7, label: '第7阶', intervalText: '7天后', targetDays: 7 },
  { stage: 8, label: '满级稳固', intervalText: '15天后', targetDays: 15 },
]

const DECAY = -0.5
const FACTOR = 19 / 81
const MS_PER_DAY = 86_400_000

export interface EbbinghausCardSnapshot {
  stage: number
  stageLabel: string
  nextReviewText: string
  retrievabilityPct: number
  urgency: 'NEW' | 'DUE' | 'CRITICAL' | 'WARM' | 'SOLID'
  curvePoints: number[]
  gradeLabels: ReadonlyArray<{
    grade: 1 | 2 | 3 | 4
    title: string
    hint: string
  }>
}

/**
 * Compute continuous FSRS-5 retrievability R(t, S) in [0, 1].
 * Mirrors the formula in `shared/fsrs/fsrs.ts` without mutating state.
 */
export function computeRetrievability(
  stability: number,
  lastReview: Date | string | null | undefined,
  now: Date = new Date(),
): number {
  if (!lastReview || stability <= 0) return 1
  const lastMs = lastReview instanceof Date ? lastReview.getTime() : Date.parse(lastReview)
  if (!Number.isFinite(lastMs)) return 1
  const elapsedDays = Math.max(0, (now.getTime() - lastMs) / MS_PER_DAY)
  return Math.max(0, Math.min(1, Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY)))
}

/** Map FSRS stability + reps + state onto an intuitive Ebbinghaus 0..8 stage. */
export function mapFsrsToEbbinghausStage(
  state: FSRSState,
  stability: number,
  reps: number,
): number {
  if (state === 'NEW' || reps <= 0) return 0
  if (state === 'RELEARNING' || stability < 0.15) return 1
  if (stability < 0.45) return 2
  if (stability < 0.9) return 3
  if (stability < 1.8) return 4
  if (stability < 3.5) return 5
  if (stability < 6.5) return 6
  if (stability < 14) return 7
  return 8
}

export function formatDueDeltaZh(due: Date | string, now: Date = new Date()): string {
  const dueMs = due instanceof Date ? due.getTime() : Date.parse(due)
  if (!Number.isFinite(dueMs)) return '现在复习'
  const diffMin = Math.round((dueMs - now.getTime()) / 60_000)
  if (diffMin <= 1) return '到期需巩固'
  if (diffMin < 60) return `${diffMin}分后`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}小时后`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}天后`
}

function estimateNextDaysLabel(stability: number, multiplier: number, fallback: string): string {
  if (stability <= 0) return fallback
  const days = stability * multiplier
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24))
    return `${hours}时`
  }
  return `${Math.max(1, Math.round(days))}天`
}

export function buildEbbinghausSnapshot(params: {
  state: FSRSState
  stability: number
  reps: number
  due: Date | string
  lastReview?: Date | string | null
  now?: Date
}): EbbinghausCardSnapshot {
  const now = params.now ?? new Date()
  const stage = mapFsrsToEbbinghausStage(params.state, params.stability, params.reps)
  const meta = EBBINGHAUS_STAGES[stage] ?? EBBINGHAUS_STAGES[0]
  const r = computeRetrievability(params.stability, params.lastReview, now)
  const retrievabilityPct = Math.round(r * 100)
  const dueMs = params.due instanceof Date ? params.due.getTime() : Date.parse(params.due)
  const isDue = params.state !== 'NEW' && Number.isFinite(dueMs) && dueMs <= now.getTime()

  let urgency: EbbinghausCardSnapshot['urgency'] = 'WARM'
  if (params.state === 'NEW') urgency = 'NEW'
  else if (isDue && retrievabilityPct < 78) urgency = 'CRITICAL'
  else if (isDue) urgency = 'DUE'
  else if (retrievabilityPct >= 90) urgency = 'SOLID'

  const effectiveS = Math.max(0.4, params.stability || 0.4)
  const curvePoints = [0, 0.2, 0.5, 1, 2, 4, 7, 15].map((d) =>
    Math.round(Math.pow(1 + (FACTOR * d) / effectiveS, DECAY) * 100),
  )

  return {
    stage,
    stageLabel: meta.label,
    nextReviewText: params.state === 'NEW' ? '首记立学' : formatDueDeltaZh(params.due, now),
    retrievabilityPct,
    urgency,
    curvePoints,
    gradeLabels: [
      { grade: 1, title: '重来', hint: '5分' },
      { grade: 2, title: '模糊', hint: '30分' },
      {
        grade: 3,
        title: '记住',
        hint: params.state === 'NEW' ? '1天' : estimateNextDaysLabel(params.stability, 1.15, '1天'),
      },
      {
        grade: 4,
        title: '秒杀',
        hint: params.state === 'NEW' ? '4天' : estimateNextDaysLabel(params.stability, 2.1, '4天'),
      },
    ],
  }
}

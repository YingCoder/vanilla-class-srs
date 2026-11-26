/**
 * Effective GameConfig loader with R2 per-class scope support.
 *
 * Evaluates active `GAME_CONFIG` releases in reverse `publishedAt` order and
 * picks the newest active release whose `scope` matches `classId`.
 */

import type { PrismaClient } from '@prisma/client'
import {
  DEFAULT_GAME_CONFIG,
  mergeWithDefaultGameConfig,
  type GameConfig,
} from '@vanilla-srs/shared/gamification'
import {
  doesScopeMatchClass,
  normalizeGameConfigScope,
  type GameConfigScope,
} from '@vanilla-srs/shared/stage4'

export interface EffectiveGameConfig {
  config: GameConfig
  configVersion: string
  releaseId: string | null
  scope: GameConfigScope
}

export async function getEffectiveGameConfig(
  prisma: PrismaClient,
  classId?: string | null,
): Promise<EffectiveGameConfig> {
  try {
    const appRel = (prisma as any)?.appRelease
    if (!appRel) {
      return {
        config: DEFAULT_GAME_CONFIG,
        configVersion: 'default',
        releaseId: null,
        scope: { mode: 'ALL' },
      }
    }
    const candidates = typeof appRel.findMany === 'function'
      ? await appRel.findMany({
          where: { isActive: true, payloadType: 'GAME_CONFIG' },
          orderBy: { publishedAt: 'desc' },
          take: 25,
        })
      : typeof appRel.findFirst === 'function'
        ? [await appRel.findFirst({ where: { isActive: true, payloadType: 'GAME_CONFIG' }, orderBy: { publishedAt: 'desc' } })].filter(Boolean)
        : []

    for (const active of candidates) {
      if (!active || !active.configPayload) continue
      if (doesScopeMatchClass(active.scope, classId)) {
        return {
          config: mergeWithDefaultGameConfig(active.configPayload),
          configVersion: active.version,
          releaseId: active.id,
          scope: normalizeGameConfigScope(active.scope),
        }
      }
    }
    return {
      config: DEFAULT_GAME_CONFIG,
      configVersion: 'default',
      releaseId: null,
      scope: { mode: 'ALL' },
    }
  } catch {
    return {
      config: DEFAULT_GAME_CONFIG,
      configVersion: 'default',
      releaseId: null,
      scope: { mode: 'ALL' },
    }
  }
}

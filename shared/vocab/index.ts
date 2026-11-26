export {
  ZHONGKAO_23_DAYS,
  lookupZhongkaoWord,
  type WordMnemonic,
  type ZhongkaoWord,
  type ZhongkaoDay,
} from './zhongkao23'

import { ZHONGKAO_23_DAYS } from './zhongkao23'

export const ZHONGKAO_TOTAL_WORDS = ZHONGKAO_23_DAYS.reduce((sum, d) => sum + d.words.length, 0)

export function getZhongkaoCoverageStats(): {
  totalWords: number
  builtinMnemonicWords: number
  coveragePct: number
  byDay: Array<{ day: number; totalWords: number; builtinMnemonicWords: number }>
} {
  let builtinMnemonicWords = 0
  const byDay = ZHONGKAO_23_DAYS.map((d) => {
    const mCount = d.words.filter((w) => Boolean(w.mnemonic)).length
    builtinMnemonicWords += mCount
    return {
      day: d.day,
      totalWords: d.words.length,
      builtinMnemonicWords: mCount,
    }
  })
  return {
    totalWords: ZHONGKAO_TOTAL_WORDS,
    builtinMnemonicWords,
    coveragePct: Math.round((builtinMnemonicWords / Math.max(1, ZHONGKAO_TOTAL_WORDS)) * 1000) / 10,
    byDay,
  }
}

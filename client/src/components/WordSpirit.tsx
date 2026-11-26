import type { CSSProperties } from 'react'
import { spiritAppearanceSeed, spiritFormFromStage } from '@vanilla-srs/shared/world'

const FORM_LABELS = { egg: '词灵蛋', hatchling: '雏灵', young: '幼灵', mature: '成灵', radiant: '光灵' }
const BODIES = [
  'M28 70 Q24 40 46 29 Q66 14 79 39 Q104 49 94 78 Q88 98 61 97 Q31 101 28 70Z',
  'M26 70 Q19 54 37 44 L37 24 Q51 23 59 38 Q71 19 84 25 L86 45 Q104 64 90 84 Q66 107 39 91Z',
  'M29 72 Q12 56 37 45 Q29 20 51 31 Q67 12 78 36 Q104 32 95 58 Q112 81 86 91 Q45 111 29 72Z',
  'M29 70 Q28 29 59 27 Q96 25 96 68 L102 89 L84 94 L69 89 L53 97 L36 91 L23 95Z',
  'M25 73 Q15 47 44 37 Q56 14 76 34 Q101 37 99 67 Q112 91 84 95 Q38 108 25 73Z',
  'M30 72 Q21 48 43 41 Q45 23 60 31 Q75 17 81 41 Q104 49 94 76 Q83 104 56 95 Q28 101 30 72Z',
]

/** Appearance is deterministic; only the historical best stage controls growth. */
export default function WordSpirit({ word, bestStage = 0, retention = 1, mist = false, size = 112, decorative = false, celebrate = false }: {
  word: string
  bestStage?: number | null
  retention?: number
  mist?: boolean
  size?: number
  decorative?: boolean
  celebrate?: boolean
}) {
  const seed = spiritAppearanceSeed(word.trim().toLowerCase())
  const form = spiritFormFromStage(bestStage ?? 0)
  const grown = form === 'mature' || form === 'radiant'
  const fog = mist ? Math.max(0.12, Math.min(0.65, 1 - retention)) : 0
  return (
    <span className={`word-spirit spirit-${form} ${celebrate ? 'spirit-celebrate' : ''}`} style={{ width: size, height: size, '--spirit-tone': `var(--spirit-${seed % 4})` } as CSSProperties}>
      <svg viewBox="0 0 124 124" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `${word} · ${FORM_LABELS[form]}${mist ? '，在迷雾中等你' : ''}`}>
        <ellipse cx="62" cy="109" rx="33" ry="6" fill="currentColor" opacity=".12" />
        {form === 'radiant' && <g className="spirit-rays" stroke="var(--color-sticky-deep)" strokeWidth="3" strokeLinecap="round"><path d="M62 3v9M15 22l6 6M109 22l-6 6M6 64h9M118 64h-9" /></g>}
        {form === 'egg' ? <g className="spirit-body"><path d="M29 78C29 49 48 20 62 20S95 49 95 78C95 113 29 113 29 78Z" fill="var(--color-soft-cream)" stroke="currentColor" strokeWidth="2.5" /><path d="M32 76l13-9 13 10 12-11 14 11 10-6" fill="none" stroke="var(--spirit-tone)" strokeWidth="5" /><circle cx="51" cy="52" r="5" fill="var(--spirit-tone)" /><circle cx="73" cy="42" r="3" fill="var(--spirit-tone)" /></g> : <g className="spirit-body">
          {grown && <path d="M32 61Q4 35 16 78L37 82M91 61Q120 35 108 78L87 82" fill="var(--spirit-tone)" stroke="currentColor" strokeWidth="2" />}
          <path d={BODIES[seed % BODIES.length]} fill="var(--spirit-tone)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          <ellipse cx="62" cy="80" rx="20" ry="14" fill="var(--color-surface)" opacity=".5" />
          <circle cx="47" cy="62" r="3.5" fill="currentColor" /><circle cx="77" cy="62" r="3.5" fill="currentColor" />
          <path d="M56 72q6 7 12 0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <ellipse cx="38" cy="72" rx="6" ry="3" fill="var(--color-accent)" opacity=".25" /><ellipse cx="86" cy="72" rx="6" ry="3" fill="var(--color-accent)" opacity=".25" />
          {form !== 'hatchling' && (seed % 2 === 0 ? <path d="M58 31Q41 6 64 20Q78 7 72 29" fill="var(--color-accent-alt)" stroke="currentColor" strokeWidth="2" /> : <path d="M49 34l4-16 10 8 12-11 5 20Z" fill="var(--color-sticky)" stroke="currentColor" strokeWidth="2" />)}
          {grown && <path d="M43 87q19 11 38-1l-3 10q-16 7-33-1Z" fill="var(--color-accent)" stroke="currentColor" strokeWidth="1.5" />}
        </g>}
        {fog > 0 && <g className="spirit-mist" opacity={fog} fill="var(--world-fog)"><ellipse cx="39" cy="81" rx="32" ry="17" /><ellipse cx="81" cy="91" rx="37" ry="16" /><ellipse cx="88" cy="58" rx="27" ry="13" /></g>}
      </svg>
    </span>
  )
}

import WordSpirit from './WordSpirit'

export default function IslandScene({ lit = false, spirits = [], mist = false, island = 'strawberry', lighthouse = false, albumTower = false, flagSquare = false }: {
  lit?: boolean
  spirits?: Array<{ word: string; bestStage?: number | null; retention?: number; isDue?: boolean }>
  mist?: boolean
  island?: string
  lighthouse?: boolean
  albumTower?: boolean
  flagSquare?: boolean
}) {
  return (
    <div className={`world-scene island-${island} ${lit ? 'world-scene-lit' : ''}`} aria-label={`香草群岛营地，篝火${lit ? '已点燃' : '留着小火苗'}`} role="img">
      <svg className="world-landscape" viewBox="0 0 560 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <circle cx="454" cy="45" r="22" fill="var(--color-sticky)" opacity=".85" />
        <g fill="var(--color-surface)" opacity=".55"><path d="M24 54q7-20 25-12 14-20 28 0 19-5 22 12Z" /><path d="M342 28q8-14 19-8 17-15 28 2 14-2 20 10Z" /></g>
        <path d="M0 174q60-11 113 0t112 0 112 0 112 0 111 0V250H0Z" fill="var(--color-sky)" opacity=".12" />
        <ellipse cx="280" cy="205" rx="205" ry="26" fill="var(--color-sky)" opacity=".1" />
        <path d="M91 168Q150 120 280 132Q427 115 478 168L428 208Q280 247 133 203Z" fill="var(--world-soil)" stroke="var(--color-text)" strokeWidth="2.5" />
        <ellipse cx="282" cy="164" rx="196" ry="46" fill="var(--world-grass)" stroke="var(--color-text)" strokeWidth="2.5" />
        <path d="M207 200q62-19 117-59" fill="none" stroke="var(--color-soft-cream)" strokeWidth="18" opacity=".65" />
        <g stroke="var(--color-text)" strokeWidth="2.5" strokeLinejoin="round">
          <path d="M122 158V112l39-30 39 30v46Z" fill="var(--color-soft-cream)" /><path d="M112 116l49-45 49 45Z" fill="var(--color-accent)" /><path d="M147 158v-27q14-18 28 0v27" fill="var(--world-soil)" />
          <path d="M393 151v-46" fill="none" /><path d="M368 119q-9-24 12-30-1-27 24-22 26 3 17 30 22 20-5 30Z" fill="var(--world-grass)" />
          {lighthouse && <g><path d="M343 143l8-68h24l8 68Z" fill="var(--color-soft-cream)" /><path d="M346 75V58h33v17ZM344 58l19-16 19 16Z" fill="var(--color-sticky)" /><path d="M351 107h26" fill="none" /></g>}
          {albumTower && <g><path d="M211 132V82h30v50Z" fill="var(--color-soft-cream)" /><path d="M206 84l20-25 20 25Z" fill="var(--color-sky)" /><path d="M220 96h12v15h-12Z" fill="var(--color-sticky)" /></g>}
          {flagSquare && <g><path d="M428 159V101" fill="none" /><path d="M428 102h31l-9 12 9 12h-31Z" fill="var(--color-accent)" /></g>}
          <g className="world-fire"><path d="M259 175l36 13M263 188l33-15" stroke="var(--world-soil)" strokeWidth="7" /><path d={lit ? 'M277 177Q251 165 272 144Q278 137 279 127Q300 148 291 156Q307 172 277 177Z' : 'M277 179q-12-8 3-23 15 18-3 23Z'} fill="var(--color-accent)" /><path d="M279 176q-10-6 2-18 10 13-2 18Z" fill="var(--color-sticky)" stroke="none" /></g>
        </g>
        {mist && <g fill="var(--world-fog)" opacity=".3" className="world-drifting-mist"><ellipse cx="112" cy="169" rx="95" ry="15" /><ellipse cx="428" cy="195" rx="108" ry="17" /></g>}
      </svg>
      <div className="world-scene-spirits" aria-hidden="true">
        {(spirits.length ? spirits : [{ word: 'make', bestStage: 0 }]).slice(0, 3).map((s) => <WordSpirit key={s.word} {...s} mist={s.isDue} size={72} decorative />)}
      </div>
      <span className="world-scene-caption">{lit ? '双环合拢 · 篝火亮了' : '你的营地，一直都在'}</span>
    </div>
  )
}

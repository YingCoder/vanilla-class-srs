import { useState } from 'react'
import type { EbbinghausCardSnapshot } from '@vanilla-srs/shared/ebbinghaus'
import WorldDialog from './WorldDialog'

interface EbbinghausStripProps { snapshot: EbbinghausCardSnapshot; labelPrefix?: string }
const URGENCY_TEXT = { NEW: '新词首记', CRITICAL: '临近遗忘点', DUE: '到期需复习', WARM: '保持良好', SOLID: '长期稳固' }
const DAYS = [0, .2, .5, 1, 2, 4, 7, 15]

export default function EbbinghausStrip({ snapshot, labelPrefix }: EbbinghausStripProps) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const dotX = Math.round(8 + (snapshot.stage / 8) * 88)
  const dotY = Math.round(28 - (snapshot.stage / 8) * 18)
  const selected = hover ?? snapshot.curvePoints.findIndex((p) => p === snapshot.retrievabilityPct)
  const points = snapshot.curvePoints.map((p, i) => `${12 + i * 43},${86 - p * .64}`).join(' ')
  return <>
    <div className="eb-candy-strip">
      <div className="eb-candy-meta">
        <span className="eb-candy-title">{labelPrefix ? `${labelPrefix}｜` : ''}艾斯的灯 {snapshot.retrievabilityPct}% · {snapshot.stageLabel}</span>
        <span className="eb-candy-sub">{URGENCY_TEXT[snapshot.urgency]}｜预计 {snapshot.nextReviewText}</span>
      </div>
      <div className="eb-retention-controls">
        <svg width="72" height="36" viewBox="0 0 104 36" aria-hidden="true"><path d="M4,6 Q28,30 56,14 T100,8" fill="none" stroke="var(--color-sky)" strokeWidth="2" strokeLinecap="round" /><circle cx={dotX} cy={dotY} r="4.5" fill="var(--color-sky)" stroke="var(--color-surface)" strokeWidth="2" /></svg>
        <button type="button" className="eb-lantern" onClick={() => setOpen(true)} aria-label={`查看艾斯的提灯与保持率曲线，当前${snapshot.retrievabilityPct}%`} title="灯越亮，记得越牢">🏮</button>
      </div>
    </div>
    {open && <WorldDialog title="艾斯的提灯 · 保持率" onClose={() => setOpen(false)}>
      <p>现在保持率约 <strong>{snapshot.retrievabilityPct}%</strong>。曲线展示已预测的时间点，鼠标或触摸可查看。</p>
      <div className="eb-retention-detail">
        <svg className="eb-retention-chart" viewBox="0 0 330 105" role="img" aria-label="未来15天保持率曲线" onMouseLeave={() => setHover(null)}>
          <path d="M12 86H325M12 22V86" stroke="var(--color-border)" fill="none" />
          <polyline points={points} fill="none" stroke="var(--color-sky)" strokeWidth="2" />
          {snapshot.curvePoints.map((point, i) => <g key={i} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}><rect x={i * 43} y="0" width="45" height="98" fill="transparent" /><circle cx={12 + i * 43} cy={86 - point * .64} r={hover === i ? 6 : 4} fill="var(--color-sky)" stroke="var(--color-surface)" strokeWidth="2" /><text x={12 + i * 43} y="102" fontSize="10" textAnchor="middle" fill="var(--color-text)">{DAYS[i]}天</text><title>{DAYS[i]}天：约{point}%</title></g>)}
          {selected >= 0 && <text x="20" y="15" fontSize="12" fontWeight="700" fill="var(--color-text)">第 {DAYS[selected]} 天：约 {snapshot.curvePoints[selected]}%</text>}
        </svg>
        <table><caption className="world-muted">曲线数据表</caption><thead><tr><th scope="col">天数</th><th scope="col">预测保持率</th></tr></thead><tbody>{snapshot.curvePoints.map((point, i) => <tr key={i}><td>{DAYS[i]} 天</td><td>{point}%</td></tr>)}</tbody></table>
      </div>
    </WorldDialog>}
  </>
}

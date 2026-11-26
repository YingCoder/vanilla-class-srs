/**
 * F12 / R6 / R9: Local PNG report-card renderer on <canvas>.
 * Never includes real names or class rankings — only nickname, level, streak & collection count.
 */

export interface ShareCardPayload {
  nickname: string
  avatarEmoji: string
  level: number
  title: string
  streakDays: number
  todayXp: number
  collectedCount: number
  diamondCount: number
  studyDate: string
}

export interface ParentWeeklyCardPayload {
  nickname: string
  avatarEmoji: string
  weeklyActiveDays: number
  masteredWords: number
  streakDays: number
  studyDate: string
}

export interface SeasonShareCardPayload {
  nickname: string
  avatarEmoji: string
  seasonName: string
  examDate: string
  stage4Count: number
  totalWords: number
  pct: number
  studyDate: string
}

function initCardCanvas() {
  const width = 640
  const height = 420
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  return { canvas, ctx, width, height }
}

function drawCardShell(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pillText: string,
  dateText: string,
  bgFrom = '#FFF8E6',
  bgTo = '#FFE8EE',
) {
  const grad = ctx.createLinearGradient(0, 0, width, height)
  grad.addColorStop(0, bgFrom)
  grad.addColorStop(1, bgTo)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = '#3B281B'
  ctx.lineWidth = 6
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, 20, 20, width - 40, height - 40, 28)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = '#C92E56'
  roundRect(ctx, 44, 42, 240, 38, 19)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 18px sans-serif'
  ctx.fillText(pillText, 58, 67)

  ctx.fillStyle = '#664D3C'
  ctx.font = 'bold 16px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(dateText, width - 48, 67)
  ctx.textAlign = 'left'
}

export function renderShareCardDataUrl(data: ShareCardPayload): string {
  const { canvas, ctx, width, height } = initCardCanvas()
  if (!ctx) return ''
  drawCardShell(ctx, width, height, '香草单词营 · 今日战报', data.studyDate)

  ctx.fillStyle = '#FFE066'
  ctx.beginPath()
  ctx.arc(92, 146, 42, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#3B281B'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.font = '40px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(data.avatarEmoji, 92, 160)
  ctx.textAlign = 'left'

  ctx.fillStyle = '#3B281B'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText(data.nickname, 152, 140)
  ctx.fillStyle = '#C92E56'
  ctx.font = 'bold 20px sans-serif'
  ctx.fillText(`Lv.${data.level} · ${data.title}`, 152, 174)

  const stats = [
    { label: '连续打卡', value: `${data.streakDays} 天`, bg: '#FFE8EE' },
    { label: '今日经验', value: `+${data.todayXp} XP`, bg: '#FFE066' },
    { label: '卡册收集', value: `${data.collectedCount}/688`, bg: '#E3F6EC' },
    { label: '闪钻词卡', value: `${data.diamondCount} 张`, bg: '#E6F2FA' },
  ]
  drawFourStatBoxes(ctx, stats)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#664D3C'
  ctx.font = 'bold 15px sans-serif'
  ctx.fillText('23 天中考英语高频词 · 每天稳步前进一点点', width / 2, 374)
  return canvas.toDataURL('image/png')
}

export function renderParentWeeklyCardDataUrl(data: ParentWeeklyCardPayload): string {
  const { canvas, ctx, width, height } = initCardCanvas()
  if (!ctx) return ''
  drawCardShell(ctx, width, height, '香草单词营 · 家长周报', data.studyDate, '#E3F6EC', '#FFF8E6')

  ctx.fillStyle = '#E3F6EC'
  ctx.beginPath()
  ctx.arc(92, 146, 42, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#3B281B'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.font = '40px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(data.avatarEmoji, 92, 160)
  ctx.textAlign = 'left'

  ctx.fillStyle = '#3B281B'
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText(`${data.nickname} 的本周成长`, 152, 140)
  ctx.fillStyle = '#1C7C54'
  ctx.font = 'bold 18px sans-serif'
  ctx.fillText('按艾宾浩斯节奏稳步复习，坚持比速度更重要', 152, 174)

  const stats = [
    { label: '本周学习', value: `${data.weeklyActiveDays} 天`, bg: '#E3F6EC' },
    { label: '稳固词数', value: `${data.masteredWords} 词`, bg: '#FFE066' },
    { label: '当前连胜', value: `${data.streakDays} 天`, bg: '#FFE8EE' },
    { label: '学习节奏', value: data.weeklyActiveDays >= 4 ? '很稳健' : '起步中', bg: '#E6F2FA' },
  ]
  drawFourStatBoxes(ctx, stats)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#125438'
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText('每天多巩固一点点，就是最好的进步——继续保持这份好节奏！', width / 2, 374)
  return canvas.toDataURL('image/png')
}

export function renderSeasonShareCardDataUrl(data: SeasonShareCardPayload): string {
  const { canvas, ctx, width, height } = initCardCanvas()
  if (!ctx) return ''
  drawCardShell(ctx, width, height, '冲刺赛季 · 个人回顾卡', data.examDate, '#FFF0EC', '#FFE066')

  ctx.fillStyle = '#FFE066'
  ctx.beginPath()
  ctx.arc(92, 146, 42, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#3B281B'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.font = '40px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(data.avatarEmoji, 92, 160)
  ctx.textAlign = 'left'

  ctx.fillStyle = '#3B281B'
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText(`${data.nickname} · ${data.seasonName}`, 152, 140)
  ctx.fillStyle = '#C92E56'
  ctx.font = 'bold 19px sans-serif'
  ctx.fillText(`高频词达 4 阶进度：${data.stage4Count} / ${data.totalWords} (${data.pct}%)`, 152, 174)

  const stats = [
    { label: '稳固掌握', value: `${data.stage4Count} 词`, bg: '#E3F6EC' },
    { label: '完成百分比', value: `${data.pct}%`, bg: '#FFE066' },
    { label: '目标日期', value: data.examDate.slice(5), bg: '#FFE8EE' },
    { label: '生成日期', value: data.studyDate.slice(5), bg: '#E6F2FA' },
  ]
  drawFourStatBoxes(ctx, stats)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#664D3C'
  ctx.font = 'bold 15px sans-serif'
  ctx.fillText('聚焦薄弱词、不盲目熬夜——上考场稳稳拿分！', width / 2, 374)
  return canvas.toDataURL('image/png')
}

function drawFourStatBoxes(
  ctx: CanvasRenderingContext2D,
  stats: Array<{ label: string; value: string; bg: string }>,
) {
  const boxW = 128
  const gap = 14
  const startX = 44
  stats.forEach((st, idx) => {
    const x = startX + idx * (boxW + gap)
    ctx.fillStyle = st.bg
    ctx.strokeStyle = '#3B281B'
    ctx.lineWidth = 2.5
    roundRect(ctx, x, 224, boxW, 108, 18)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#664D3C'
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(st.label, x + boxW / 2, 260)

    ctx.fillStyle = '#3B281B'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText(st.value, x + boxW / 2, 304)
  })
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

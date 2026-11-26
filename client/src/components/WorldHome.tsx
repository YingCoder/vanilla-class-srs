import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { HomeResponse, HomeBuildResponse } from '@vanilla-srs/shared/world'
import type { WorldContentPack } from '@vanilla-srs/shared/world-content'
import { DEFAULT_WORLD_CONTENT } from '@vanilla-srs/shared/world-content'
import { api } from '../utils/api'
import { useEnrollment } from '../utils/enrollment'
import { useGame } from './GameContext'
import { trackAnalyticsEvent } from '../utils/analytics'
import IslandScene from './IslandScene'
import WordSpirit from './WordSpirit'
import WorldDialog from './WorldDialog'
import { speakWord } from '../utils/audio'

const BUILDING_ICONS: Record<string, string> = { campfire: '🔥', hatchery: '🥚', lighthouse: '🗼', album_tower: '📚', flag_square: '🚩' }
const BUILDING_DESCRIPTIONS: Record<string, string> = {
  campfire: '双环合拢，篝火就会亮起。',
  hatchery: '今天的蛋，正在慢慢长大。',
  lighthouse: '提前看到明日词灵的到访时段。',
  album_tower: '查看词灵图鉴和秘语小纸条。',
  flag_square: '前往已有的小队、勋章与装扮。',
}
const STORY_KEY = 'wordcamp:world-stories:v1'

export function getWorldContent(enrollmentId: string): Promise<{ contentVersion: string; source: 'builtin' | 'release'; content: WorldContentPack }> {
  return api.get(`/students/world-content?enrollmentId=${encodeURIComponent(enrollmentId)}`)
}

export default function WorldHome() {
  const { active } = useEnrollment()
  const { summary } = useGame()
  const [home, setHome] = useState<HomeResponse | null>(null)
  const [content, setContent] = useState<WorldContentPack>(DEFAULT_WORLD_CONTENT)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [day, setDay] = useState(1)
  const [islandId, setIslandId] = useState('strawberry')
  const [panel, setPanel] = useState<'story' | 'islands' | 'buildings' | 'forecast' | null>(null)
  const [building, setBuilding] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const storyRead = useRef(new Set<number>())
  const buildKeys = useRef(new Map<string, string>())
  const requestVersion = useRef(0)
  const openedAt = useRef(Date.now())

  useEffect(() => { openedAt.current = Date.now() }, [active?.enrollmentId])

  const load = useCallback(async () => {
    if (!active) { setHome(null); setLoading(false); return }
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    const [homeResult, contentResult] = await Promise.allSettled([
      api.get<HomeResponse>(`/students/game/home?enrollmentId=${encodeURIComponent(active.enrollmentId)}`),
      getWorldContent(active.enrollmentId),
    ])
    if (version !== requestVersion.current) return
    if (homeResult.status === 'fulfilled') setHome(homeResult.value)
    else setError(homeResult.reason?.message || '暂时无法打开营地，请稍后重试。')
    if (contentResult.status === 'fulfilled') setContent(contentResult.value.content)
    setLoading(false)
  }, [active?.enrollmentId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!active || !home) return
    trackAnalyticsEvent('world_home_open', { afterThreeSeconds: Date.now() - openedAt.current >= 3000 }, { enrollmentId: active.enrollmentId })
    let read: number[] = []
    try { read = JSON.parse(localStorage.getItem(`${STORY_KEY}:${active.enrollmentId}`) || '[]') as number[] } catch { /* fall back to first story */ }
    if (!read.includes(day)) {
      storyRead.current = new Set(read)
      setPanel('story')
      trackAnalyticsEvent('world_story_view', { day, source: 'auto' }, { enrollmentId: active.enrollmentId })
    }
  }, [active?.enrollmentId, home !== null])

  function closeStory(skipped = false) {
    if (!active) return
    storyRead.current.add(storyDay)
    try { localStorage.setItem(`${STORY_KEY}:${active.enrollmentId}`, JSON.stringify([...storyRead.current])) } catch { /* session-only */ }
    if (skipped) trackAnalyticsEvent('world_story_skip', { day: storyDay }, { enrollmentId: active.enrollmentId })
    setPanel(null)
  }

  async function build(buildingKey: string) {
    if (!active || !home || building) return
    const requestId = buildKeys.current.get(buildingKey) ?? crypto.randomUUID()
    buildKeys.current.set(buildingKey, requestId)
    setBuilding(buildingKey)
    setNotice(null)
    try {
      const result = await api.post<HomeBuildResponse>('/students/game/home/build', { enrollmentId: active.enrollmentId, buildingKey }, { headers: { 'Idempotency-Key': requestId } })
      setHome(result.home)
      buildKeys.current.delete(buildingKey)
      setNotice(`${result.home.buildings.find((b) => b.key === buildingKey)?.name ?? '建筑'}已${result.level > 1 ? '升级' : '建成'}！营地会一直保留它。`)
      trackAnalyticsEvent('world_build', { buildingKey, level: result.level }, { enrollmentId: active.enrollmentId })
    } catch (err: any) {
      setNotice(err.message || '暂时无法建造，糖晶没有扣除。')
    } finally { setBuilding(null) }
  }

  if (!active) return <section className="world-home-empty"><IslandScene lit /><h2>选择班级，安放你的营地。</h2><Link to="/student" className="camp-btn camp-btn-berry">前往选班</Link></section>

  const island = content.islands.find((i) => i.id === islandId) ?? content.islands[0]
  const story = content.stories.find((s) => s.day === day) ?? content.stories.find((s) => s.day === island.startDay)
  const storyDay = story?.day ?? day
  const buildings = home?.buildings ?? []
  const levelOf = (key: string) => buildings.find((b) => b.key === key)?.level ?? 0
  const ringsClosed = summary?.today.rings.ringsClosed ?? false
  const firstSpirit = home?.spirits[0]

  return <>
    <section className={`world-home island-${island.theme}`}>
      <div className="world-home-heading">
        <div><span className="world-eyebrow">{island.name} · 营地家园</span><h1>今日迷雾预报</h1></div>
        <button type="button" className="world-crystal-balance" onClick={() => setPanel('buildings')} title="查看糖晶与家园建造"><span aria-hidden="true">◆</span> {home?.sugarCrystals.balance ?? 0} 糖晶</button>
      </div>
      <IslandScene lit={ringsClosed} mist={(home?.dueCount ?? 0) > 0} island={island.theme} spirits={home?.spirits} lighthouse={levelOf('lighthouse') > 0} albumTower={levelOf('album_tower') > 0} flagSquare={levelOf('flag_square') > 0} />
      {home && home.estimatedMinutes > 0 && <div className="world-muted">艾斯预估今天约 {home.estimatedMinutes} 分钟。</div>}
      {error && <div className="alert alert-danger" role="alert">{error}<button type="button" className="world-text-button" onClick={() => void load()}>重新加载</button></div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {loading && !home ? <div className="world-home-loading" role="status">艾斯正在辨认今天的词灵…</div> : <>
        <div className="world-forecast-copy">
          <p>{home?.dueCount ? `${home.dueCount} 只词灵在雾里等你。它们不会离开。` : home?.spirits.length ? '雾暂时散了，词灵们记得自己的名字。' : '先去认识词灵，它们会在这里安家。'}</p>
          <span className="world-muted">先唤哪一个，由你决定。</span>
        </div>
        <div className="world-action-grid">
          <Link to="/student/review" className="camp-btn camp-btn-berry" onClick={() => trackAnalyticsEvent('world_wake_start', { source: 'review', count: home?.dueCount ?? 0 }, { enrollmentId: active.enrollmentId })}><strong>开始驱雾</strong><span>{home?.dueCount ?? 0} 词 · 复习到期词</span></Link>
          <Link to="/student/adventure" className="camp-btn camp-btn-mint" onClick={() => trackAnalyticsEvent('world_wake_start', { source: 'adventure' }, { enrollmentId: active.enrollmentId })}><strong>去探险</strong><span>认识新词 · 据点闯关</span></Link>
        </div>
        <div className="world-home-shortcuts">
          <button type="button" onClick={() => { setPanel('story'); trackAnalyticsEvent('world_story_view', { day, source: 'manual' }, { enrollmentId: active.enrollmentId }) }}>艾斯的话</button>
          <button type="button" onClick={() => setPanel('islands')}>四岛地图</button>
          <button type="button" onClick={() => setPanel('buildings')}>建造家园</button>
          <button type="button" onClick={() => setPanel('forecast')} disabled={levelOf('lighthouse') === 0}>明日预报{levelOf('lighthouse') === 0 ? ' · 建灯塔' : ''}</button>
        </div>
      </>}
    </section>

    {panel === 'story' && story && <WorldDialog title={`${story.title} · 艾斯`} onClose={() => closeStory(true)}>
      <div className="world-guide"><WordSpirit word="ace-guide" bestStage={4} size={88} /><div className="world-guide-lines">{story.lines.map((line) => <p key={line}>{line}</p>)}</div></div>
      <p className="world-tomorrow">{story.tomorrow}</p>
      <button type="button" className="camp-btn camp-btn-berry" onClick={() => closeStory()}>知道了，去词灵那儿</button>
    </WorldDialog>}
    {panel === 'islands' && home && <WorldDialog title="香草群岛 · 23 天旅程" onClose={() => setPanel(null)}>
      <p className="world-muted">每颗星是一盏据点灯。已点亮的灯，不会熄灭。</p>
      <div className="world-island-list">{content.islands.map((i) => <section key={i.id} className={`world-island-row island-${i.theme}`}><div><strong>{i.name}</strong><span>D{i.startDay}–D{i.endDay} · D{i.bossDay} 雾兽</span></div><button type="button" className="candy-pill" onClick={() => { setIslandId(i.id); setDay(i.startDay); setPanel(null) }}>前往岛屿</button><div className="world-day-dots">{Array.from({ length: i.endDay - i.startDay + 1 }, (_, n) => { const d = i.startDay + n; const node = home.campMap.days.find((item) => item.day === d); return <Link key={d} to={`/student/adventure?day=${d}`} className={`world-day-dot ${node?.status === 'CLEARED' ? 'lit' : ''} ${d === home.campMap.currentDay ? 'current' : ''}`}>{d === i.bossDay ? '🚩' : node?.stars ? '★'.repeat(node.stars) : ''}D{d}</Link> })}</div></section>)}</div>
    </WorldDialog>}
    {panel === 'buildings' && home && <WorldDialog title="让营地慢慢热闹起来" onClose={() => setPanel(null)}>
      <p>可用 <strong>{home.sugarCrystals.balance} 糖晶</strong></p><p className="world-muted">由学习 XP 换算（当前每 XP {home.sugarCrystals.ratio} 糖晶），不清零、不购买、不交易。</p>
      <div className="world-building-list">{home.buildings.map((b) => <div key={b.key} className="world-building-row"><span className="world-building-icon" aria-hidden="true">{BUILDING_ICONS[b.key]}</span><div><strong>{b.name} · {b.level}/{b.maxLevel} 级</strong><p>{BUILDING_DESCRIPTIONS[b.key]}</p></div>{b.level >= b.maxLevel ? <span className="badge badge-green">已建成</span> : <button type="button" className="camp-btn camp-btn-sticky" disabled={!b.canBuild || building !== null} title={!b.canBuild ? `需要 ${b.nextCost} 糖晶，现有 ${home.sugarCrystals.balance}` : undefined} onClick={() => void build(b.key)}>{building === b.key ? '建造中…' : `${b.level ? '升级' : '建造'} ◆${b.nextCost}`}</button>}</div>)}</div>
      <p className="world-muted">糖晶不足时只需继续学习。没有每日限时建造。</p>
    </WorldDialog>}
    {panel === 'forecast' && home?.tomorrowForecast && <WorldDialog title="明日迷雾预报" onClose={() => setPanel(null)}>
      <p>明天（上海时间）预计 {home.tomorrowForecast.total} 只词灵到访。</p>
      <div className="world-forecast-slots">{home.tomorrowForecast.slots.map((s) => <div key={s.key}><span>{s.label}</span><strong>{s.count} 只</strong></div>)}</div>
      <p className="world-muted">预报来自真实到期时间，只提供信息，不影响复习节奏。</p>
    </WorldDialog>}
    {panel === 'forecast' && !home?.tomorrowForecast && <WorldDialog title="明日迷雾预报" onClose={() => setPanel(null)}><p>建好灯塔后，就能看到明日词灵数量和到访时段。</p><button type="button" className="camp-btn camp-btn-berry" onClick={() => setPanel('buildings')}>去看看灯塔</button></WorldDialog>}
  </>
}

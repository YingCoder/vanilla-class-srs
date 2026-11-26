/** Presentation-only world content. Scheduling, rewards and progression are never configurable here. */
export type WorldIslandId = 'strawberry' | 'vanilla' | 'cocoa' | 'star'

export interface WorldIslandConfig {
  id: WorldIslandId
  name: string
  startDay: number
  endDay: number
  bossDay: number
  /** A built-in visual preset, never CSS or an asset URL. */
  theme: WorldIslandId
}

export interface WorldDayStory {
  day: number
  islandId: WorldIslandId
  title: string
  lines: string[]
  tomorrow: string
}

export interface WorldBossStory extends WorldDayStory {}

export interface WorldContentPack {
  schemaVersion: 1
  islands: WorldIslandConfig[]
  stories: WorldDayStory[]
  bosses: WorldBossStory[]
}

export const WORLD_ISLANDS: readonly Readonly<WorldIslandConfig>[] = Object.freeze([
  Object.freeze({ id: 'strawberry', name: '草莓海岸', startDay: 1, endDay: 6, bossDay: 6, theme: 'strawberry' }),
  Object.freeze({ id: 'vanilla', name: '香草森林', startDay: 7, endDay: 12, bossDay: 12, theme: 'vanilla' }),
  Object.freeze({ id: 'cocoa', name: '可可山脉', startDay: 13, endDay: 18, bossDay: 18, theme: 'cocoa' }),
  Object.freeze({ id: 'star', name: '星糖云海', startDay: 19, endDay: 23, bossDay: 23, theme: 'star' }),
] as const)

/** Invalid days have no island; never silently clamp a caller's progression. */
export function getWorldIsland(day: number): Readonly<WorldIslandConfig> | undefined {
  return Number.isInteger(day) ? WORLD_ISLANDS.find((island) => day >= island.startDay && day <= island.endDay) : undefined
}

const dayStory = (day: number, title: string, lines: string[], tomorrow: string): WorldDayStory => ({
  day, islandId: getWorldIsland(day)!.id, title, lines, tomorrow,
})

export const DEFAULT_WORLD_CONTENT: WorldContentPack = {
  schemaVersion: 1,
  islands: WORLD_ISLANDS.map((island) => ({ ...island })),
  stories: [
    dayStory(1, '会打嗝的蛋', ['艾斯：这枚蛋刚打了个嗝。', '词灵：别笑，我忘了名字。', '艾斯：试着把它喊醒吧。'], '明天，沙滩会留下谁的脚印？'),
    dayStory(2, '反着走的脚印', ['脚印一路倒着走向海边。', '艾斯：它大概在找自己的尾巴。', '词灵：我是在等你跟上。'], '明天，贝壳里会传来歌声。'),
    dayStory(3, '跑调的贝壳', ['贝壳只会唱半句歌。', '艾斯：另一半藏在迷雾里。', '词灵：唱跑调也能找到我。'], '明天，漂流瓶要靠岸了。'),
    dayStory(4, '寄给灯的信', ['漂流瓶里写着灯收。', '艾斯：我的灯也有朋友？', '瓶底还躺着一粒发亮的糖。'], '明天，那粒糖会指向哪里？'),
    dayStory(5, '借路的小螃蟹', ['糖光照出一条浅浅的小路。', '螃蟹举钳：借过，我去看日出。', '艾斯：雾后有个大影子。'], '明天，海岸岛主要露面了。'),
    dayStory(6, '海风的名字', ['大影子把浪声当成了闹钟。', '词灵：喊出名字，它就听见了。', '艾斯提灯，海风终于有了方向。'], '明天，森林会借你一把叶伞。'),
    dayStory(7, '会挠痒的叶伞', ['叶伞一张开，艾斯就打喷嚏。', '词灵：它只是在跟你握手。', '树梢亮起一盏小小的灯。'], '明天，树洞会开一家小店。'),
    dayStory(8, '树洞失物店', ['店里摆着半个名字和一声哈欠。', '店主：认领失物，请先读一遍。', '艾斯：哈欠就不用了吧。'], '明天，藤桥要请谁跳舞？'),
    dayStory(9, '藤桥的舞步', ['藤桥左右摇着数拍子。', '词灵：念对名字，我就搭把手。', '艾斯：原来桥也怕痒。'], '明天，蘑菇会送来一封请柬。'),
    dayStory(10, '蘑菇茶会', ['请柬上只画着三个空杯子。', '词灵们排好队，等名字入座。', '艾斯：我的灯不喝茶。'], '明天，最安静的树会说话。'),
    dayStory(11, '树的悄悄话', ['老树小声说，它忘了春天的歌。', '艾斯：把熟悉的词慢慢念给它。', '树叶一片片轻轻合拍。'], '明天，森林岛主要醒来了。'),
    dayStory(12, '把春天叫回来', ['树影里传来长长的一声哈欠。', '词灵们的名字点亮了树冠。', '艾斯：它睡得比石头还沉。'], '明天，山里的石头会打鼓。'),
    dayStory(13, '石头鼓队', ['可可山口响起咚咚的鼓声。', '艾斯：谁把早餐敲得这么响？', '词灵：是石头在练欢迎曲。'], '明天，回声会学谁说话？'),
    dayStory(14, '害羞的回声', ['回声总比大家晚半拍。', '词灵：它只是怕念错名字。', '艾斯：我们陪它慢慢来。'], '明天，矿灯里会藏着一颗星。'),
    dayStory(15, '借住的星光', ['矿灯里有颗星打着小呼噜。', '艾斯：天还没黑，你下班了？', '星光说，它在躲一团厚雾。'], '明天，旧轨道会通向哪里？'),
    dayStory(16, '空车厢的乘客', ['旧矿车说自己已经满员了。', '艾斯：可我只看见一团雾。', '词灵：喊出名字，就看见我们。'], '明天，山顶的钟要响了。'),
    dayStory(17, '不报时的钟', ['山顶的钟只会响叮的一声。', '词灵：它把当忘在雾里了。', '艾斯：难怪总觉得少了点什么。'], '明天，可可岛主要敲门了。'),
    dayStory(18, '山的心跳', ['岛主脚步震得矿灯直晃。', '艾斯：别急，我们听见你了。', '一个个名字让山谷重新明亮。'], '明天，云海会铺出一座桥。'),
    dayStory(19, '云做的鞋', ['云桥给每个人发了一双软鞋。', '艾斯走两步，灯也跟着弹两下。', '词灵：别怕，云接得住你。'], '明天，星星会排错队。'),
    dayStory(20, '星星点名册', ['星星把名字写在彼此背上。', '艾斯：难怪大家都在转圈。', '念出名字，一颗颗星站好位置。'], '明天，月亮会借走一盏灯。'),
    dayStory(21, '月亮借灯', ['月亮说，今晚想看看云底。', '艾斯：记得把灯还回来。', '词灵把微光串成了一条小路。'], '明天，云海深处会传来回应。'),
    dayStory(22, '雾里的回应', ['远处传来我们熟悉的名字。', '艾斯：原来大家一直在等。', '最后一团雾里亮起两只眼睛。'], '明天，星糖岛主要讲个秘密。'),
    dayStory(23, '灯火有名字', ['云海尽头亮起一整片灯火。', '艾斯：每一盏都记得你的声音。', '词灵：今天就到这里，回家吧。'], '明天，家里的词灵会长成什么样？'),
  ],
  bosses: [
    dayStory(6, '海岸岛主的喷嚏', ['岛主：我不是浪，只是鼻子痒。', '艾斯：那我们用名字帮你驱雾。', '一声喷嚏后，海面露出了笑脸。'], '明天，森林的叶伞等你来借。'),
    dayStory(12, '森林岛主的梦话', ['岛主把词灵的名字念成了梦话。', '艾斯：我们来帮它念清楚。', '树冠亮了，岛主终于睁开眼。'], '明天，山口的鼓队要欢迎你。'),
    dayStory(18, '可可岛主的闹钟', ['岛主：我的闹钟怎么不响了？', '艾斯：它只听得懂熟悉的名字。', '雾一散，山谷响起清脆的叮当。'], '明天，云桥会送你一双软鞋。'),
    dayStory(23, '星糖岛主的秘密', ['岛主：迷雾也会迷路呢。', '艾斯：我们用名字给它指路。', '灯火连成家园，今天可以休息了。'], '明天，灯下还会有新的悄悄话。'),
  ],
}

export type WorldContentValidation = { ok: true; content: WorldContentPack } | { ok: false; errors: string[] }

const CONTENT_KEYS = ['schemaVersion', 'islands', 'stories', 'bosses']
const ISLAND_KEYS = ['id', 'name', 'startDay', 'endDay', 'bossDay', 'theme']
const STORY_KEYS = ['day', 'islandId', 'title', 'lines', 'tomorrow']
// Intentionally prose-only. No markup, URL syntax, escaped entities, CSS declarations or code punctuation.
const PLAIN_PROSE = /^[\p{Script=Han}A-Za-z0-9 ，、。！？；：“”‘’（）《》…·—!?'-]+$/u
const CODE_WORDS = /\b(?:script|javascript|vbscript|style|eval|function|import|url|http|https|data)\b/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/** Full replacement, exact schema: unknown keys and incomplete/duplicate days are errors. */
export function validateWorldContent(input: unknown): WorldContentValidation {
  const errors: string[] = []
  const shape = (value: unknown, keys: string[], path: string): value is Record<string, unknown> => {
    if (!isRecord(value)) { errors.push(`${path} 必须是 JSON 对象`); return false }
    const own = Object.keys(value)
    if (own.length !== keys.length || own.some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
      errors.push(`${path} 字段必须恰好为 ${keys.join('、')}`)
    }
    return true
  }
  const text = (value: unknown, path: string, sentence = false) => {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || [...value].length > 20) {
      errors.push(`${path} 必须为 1–20 字的文本，且无首尾空格`)
      return
    }
    if (!PLAIN_PROSE.test(value) || CODE_WORDS.test(value)) errors.push(`${path} 只允许纯文本，不能含 HTML、CSS、脚本或链接`)
    if (sentence && /[。！？!?].+/u.test(value)) errors.push(`${path} 只能包含一句话`)
  }
  if (!shape(input, CONTENT_KEYS, 'content')) return { ok: false, errors }
  if (input.schemaVersion !== 1) errors.push('schemaVersion 必须为 1')
  if (!Array.isArray(input.islands) || input.islands.length !== 4) {
    errors.push('islands 必须包含固定的 4 座岛屿')
  } else {
    input.islands.forEach((island, index) => {
      const path = `islands[${index}]`
      if (!shape(island, ISLAND_KEYS, path)) return
      const fixed = WORLD_ISLANDS[index]
      for (const key of ISLAND_KEYS as Array<keyof WorldIslandConfig>) {
        if (island[key] !== fixed[key]) errors.push(`${path}.${key} 必须为 ${fixed[key]}`)
      }
    })
  }
  const stories = (value: unknown, boss: boolean) => {
    const label = boss ? 'bosses' : 'stories'
    const days = boss ? WORLD_ISLANDS.map((island) => island.bossDay) : Array.from({ length: 23 }, (_, index) => index + 1)
    if (!Array.isArray(value) || value.length !== days.length) { errors.push(`${label} 必须完整包含 ${days.length} 段剧情`); return }
    value.forEach((story, index) => {
      const path = `${label}[${index}]`
      if (!shape(story, STORY_KEYS, path)) return
      const day = days[index]
      if (story.day !== day) errors.push(`${path}.day 必须为 ${day}（按天数排序且不可重复）`)
      if (story.islandId !== getWorldIsland(day)!.id) errors.push(`${path}.islandId 与固定岛屿边界不符`)
      text(story.title, `${path}.title`)
      text(story.tomorrow, `${path}.tomorrow`, true)
      if (!Array.isArray(story.lines) || story.lines.length < 2 || story.lines.length > 3) {
        errors.push(`${path}.lines 必须包含 2–3 句话`)
      } else {
        story.lines.forEach((line, lineIndex) => text(line, `${path}.lines[${lineIndex}]`, true))
      }
    })
  }
  stories(input.stories, false)
  stories(input.bosses, true)
  return errors.length ? { ok: false, errors } : { ok: true, content: JSON.parse(JSON.stringify(input)) as WorldContentPack }
}

export function parseWorldContentJson(json: string): WorldContentValidation {
  if (json.length > 50_000) return { ok: false, errors: ['世界内容 JSON 不能超过 50000 字符'] }
  try { return validateWorldContent(JSON.parse(json)) } catch { return { ok: false, errors: ['世界内容必须为合法 JSON'] } }
}

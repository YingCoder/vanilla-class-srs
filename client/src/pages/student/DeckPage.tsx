import { useCallback, useEffect, useMemo, useState } from 'react'
import { ZHONGKAO_23_DAYS, type ZhongkaoWord } from '@vanilla-srs/shared/vocab'
import { buildEbbinghausSnapshot } from '@vanilla-srs/shared/ebbinghaus'
import { rarityFromStage, type CardRarityInfo } from '@vanilla-srs/shared/gamification'
import type { FSRSState } from '@vanilla-srs/shared/fsrs'
import { api } from '../../utils/api'
import { trackAnalyticsEvent } from '../../utils/analytics'
import { useGame } from '../../components/GameContext'
import type { StudentAlternativeItem } from '../../components/MnemonicCardBlock'
import type { WordMnemonic } from '@vanilla-srs/shared/vocab'
import { useEnrollment } from '../../utils/enrollment'
import { speakWord } from '../../utils/audio'
import MnemonicCardBlock from '../../components/MnemonicCardBlock'

interface DeckCardInstance {
  id: string
  state: FSRSState
  stability: number
  reps: number
  due: string
  bestStage?: number | null
  definitionL1: string | null
  card: {
    id: string
    word: string
    pos: string | null
    ipa?: string | null
    definitionL1: string | null
    definitionL2: string | null
  }
}

interface AlbumCard extends ZhongkaoWord {
  collected: boolean
  bestStage: number | null
  currentStage: number
  rarity: CardRarityInfo | null
}

interface CardAlbumResponse {
  summary: {
    totalWords: number
    collectedCount: number
    candyCount: number
    silverCount: number
    goldCount: number
    diamondCount: number
  }
  day: number
  cards: AlbumCard[]
}

export default function DeckPage() {
  const { active } = useEnrollment()
  const { summary } = useGame()
  const [mode, setMode] = useState<'zhongkao' | 'album' | 'mydeck'>('zhongkao')
  const [selectedDay, setSelectedDay] = useState(1)
  const [query, setQuery] = useState('')
  const [onlyMnemonic, setOnlyMnemonic] = useState(false)
  const [inspectedWord, setInspectedWord] = useState<(ZhongkaoWord & { rarity?: CardRarityInfo | null; bestStage?: number | null }) | null>(null)
  const [patchMap, setPatchMap] = useState<Record<string, WordMnemonic>>({})
  const [studentAltMap, setStudentAltMap] = useState<Record<string, StudentAlternativeItem[]>>({})
  const [vocabPacks, setVocabPacks] = useState<Array<{ id: string; name: string; daysCount: number; totalWords: number; isBuiltin: boolean }>>([])
  const [selectedPackId, setSelectedPackId] = useState<string>('builtin-zhongkao-23d')
  const [customPackCards, setCustomPackCards] = useState<any[] | null>(null)
  const [cocreateOpen, setCocreateOpen] = useState(false)
  const [coTag, setCoTag] = useState('谐音记忆')
  const [coHook, setCoHook] = useState('')
  const [coStory, setCoStory] = useState('')
  const [coChunksText, setCoChunksText] = useState('')
  const [coTrap, setCoTrap] = useState('')
  const [coBusy, setCoBusy] = useState(false)
  const [coNotice, setCoNotice] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{
        days?: Array<{
          day: number
          words: Array<{
            word: string
            mnemonic?: WordMnemonic | null
            studentAlternatives?: StudentAlternativeItem[]
          }>
        }>
      }>('/releases/vocab-pack')
      .then((res) => {
        const nextPatches: Record<string, WordMnemonic> = {}
        const nextAlts: Record<string, StudentAlternativeItem[]> = {}
        for (const d of res?.days ?? []) {
          for (const w of d.words ?? []) {
            const k = w.word.trim().toLowerCase()
            if (w.mnemonic) nextPatches[k] = w.mnemonic
            if (w.studentAlternatives && w.studentAlternatives.length > 0) {
              nextAlts[k] = w.studentAlternatives
            }
          }
        }
        setPatchMap(nextPatches)
        setStudentAltMap(nextAlts)
      })
      .catch(() => {})
    api
      .get<Array<{ id: string; name: string; daysCount: number; totalWords: number; isBuiltin: boolean }>>('/students/vocab-packs')
      .then((packs) => {
        if (Array.isArray(packs)) setVocabPacks(packs)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!active || !selectedPackId || selectedPackId === 'builtin-zhongkao-23d') {
      setCustomPackCards(null)
      return
    }
    api
      .get<{ cards: any[] }>(`/students/vocab-packs/${selectedPackId}/cards?enrollmentId=${active.enrollmentId}&day=${selectedDay}`)
      .then((res) => setCustomPackCards(res.cards ?? []))
      .catch(() => setCustomPackCards([]))
  }, [active, selectedPackId, selectedDay])

  const submitCoCreation = async () => {
    if (!active || !inspectedWord || coBusy) return
    setCoBusy(true)
    setCoNotice(null)
    const chunks: Array<[string, string]> = coChunksText
      .split(/[;；\n]/)
      .map((s) => s.split(/[:|→]/).map((x) => x.trim()))
      .filter((pair) => pair.length >= 2 && pair[0] && pair[1])
      .map(([a, b]) => [a, b] as [string, string])
    try {
      await api.post('/students/mnemonics', {
        enrollmentId: active.enrollmentId,
        word: inspectedWord.word,
        tag: coTag,
        hook: coHook.trim(),
        story: coStory.trim(),
        chunks: chunks.length > 0 ? chunks : [[inspectedWord.word.slice(0, 3), coHook.trim() || inspectedWord.word]],
        trap: coTrap.trim() || null,
      })
      trackAnalyticsEvent('mnemonic_cocreate_submit', { word: inspectedWord.word }, { enrollmentId: active.enrollmentId })
      setCoNotice('已提交教师审核！审核通过后将展示为「同学版」，每日首次通过还可获 XP + 邪修创作者徽章。')
      setCoHook('')
      setCoStory('')
      setCoChunksText('')
      setCoTrap('')
    } catch (err: any) {
      setCoNotice(err.message || '提交失败，请检查内容长度或敏感词')
    } finally {
      setCoBusy(false)
    }
  }

  const [album, setAlbum] = useState<CardAlbumResponse | null>(null)
  const [albumLoading, setAlbumLoading] = useState(false)

  const [instances, setInstances] = useState<DeckCardInstance[]>([])
  const [deckLoading, setDeckLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newWord, setNewWord] = useState('')
  const [newZh, setNewZh] = useState('')
  const [newEx, setNewEx] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const loadDeck = useCallback(async () => {
    if (!active) return
    setDeckLoading(true)
    try {
      const res = await api.get<{ instances: DeckCardInstance[] }>(
        `/students/deck?enrollmentId=${active.enrollmentId}`,
      )
      setInstances(res.instances ?? [])
    } catch {
      /* ignore when browsing built-in 23-day library */
    } finally {
      setDeckLoading(false)
    }
  }, [active])

  const loadAlbum = useCallback(async (day: number) => {
    if (!active) return
    setAlbumLoading(true)
    try {
      const res = await api.get<CardAlbumResponse>(
        `/students/game/cards?enrollmentId=${active.enrollmentId}&day=${day}`,
      )
      setAlbum(res)
    } catch {
      setAlbum(null)
    } finally {
      setAlbumLoading(false)
    }
  }, [active])

  useEffect(() => {
    if (mode === 'mydeck') void loadDeck()
    if (mode === 'album') void loadAlbum(selectedDay)
  }, [mode, selectedDay, loadDeck, loadAlbum])

  const filteredZhongkao = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = q
      ? ZHONGKAO_23_DAYS.flatMap((d) => d.words.map((w) => ({ ...w, day: d.day })))
      : (ZHONGKAO_23_DAYS.find((d) => d.day === selectedDay)?.words ?? []).map((w) => ({
          ...w,
          day: selectedDay,
        }))
    return pool.filter((w) => {
      if (onlyMnemonic && !w.mnemonic) return false
      if (!q) return true
      return w.word.toLowerCase().includes(q) || w.meaning.includes(q)
    })
  }, [query, selectedDay, onlyMnemonic])

  const handleAddOwnCard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!active || !newWord.trim() || !newZh.trim()) return
    try {
      await api.post('/students/deck/cards', {
        enrollmentId: active.enrollmentId,
        word: newWord.trim(),
        definitionL1: newZh.trim(),
        exampleSentence: newEx.trim() || undefined,
      })
      setNewWord('')
      setNewZh('')
      setNewEx('')
      setAddOpen(false)
      setSaveMsg('已加入个人词卡，将按艾宾浩斯节奏提醒复习！')
      void loadDeck()
    } catch (err: any) {
      setSaveMsg(err.message || '添加失败')
    }
  }

  return (
    <>
      <div className="eb-candy-strip">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`candy-pill ${mode === 'zhongkao' ? 'berry' : ''}`}
            style={{ minHeight: 36, padding: '0 10px', fontSize: 12 }}
            onClick={() => setMode('zhongkao')}
          >
            词表
          </button>
          <button
            type="button"
            className={`candy-pill ${mode === 'album' ? 'berry' : ''}`}
            style={{ minHeight: 36, padding: '0 10px', fontSize: 12 }}
            onClick={() => setMode('album')}
          >
            卡册
          </button>
          <button
            type="button"
            className={`candy-pill ${mode === 'mydeck' ? 'berry' : ''}`}
            style={{ minHeight: 36, padding: '0 10px', fontSize: 12 }}
            onClick={() => setMode('mydeck')}
          >
            班级词卡 ({instances.length})
          </button>
        </div>
        {mode === 'mydeck' && active && (
          <button
            type="button"
            className="candy-pill sky"
            style={{ minHeight: 36, padding: '0 10px', fontSize: 12 }}
            onClick={() => setAddOpen(true)}
          >
            + 自建词
          </button>
        )}
      </div>

      {saveMsg && <div className="alert alert-success" style={{ marginBottom: 0 }}>{saveMsg}</div>}

      {mode === 'album' ? (
        <div className="camp-hero-card" style={{ gap: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0, gap: 6, flexWrap: 'wrap' }}>
            <span>
              已收集 {album?.summary.collectedCount ?? 0}/{album?.summary.totalWords ?? 688} · 闪钻 {album?.summary.diamondCount ?? 0}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {vocabPacks.length > 1 && (
                <select
                  className="form-control"
                  aria-label="切换词包"
                  style={{ height: 30, fontSize: 12, width: 155, padding: '2px 6px' }}
                  value={selectedPackId}
                  onChange={(e) => setSelectedPackId(e.target.value)}
                >
                  {vocabPacks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.totalWords})
                    </option>
                  ))}
                </select>
              )}
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                金 {album?.summary.goldCount ?? 0} · 银 {album?.summary.silverCount ?? 0} · 糖 {album?.summary.candyCount ?? 0}
              </span>
            </div>
          </div>

          {selectedPackId !== 'builtin-zhongkao-23d' && customPackCards ? (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                <span>扩展词包第 {selectedDay} 天（共 {customPackCards.length} 词）</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="candy-pill" style={{ minHeight: 28, fontSize: 11 }} onClick={() => setSelectedDay((d) => Math.max(1, d - 1))}>
                    上一天
                  </button>
                  <button type="button" className="candy-pill" style={{ minHeight: 28, fontSize: 11 }} onClick={() => setSelectedDay((d) => d + 1)}>
                    下一天
                  </button>
                </div>
              </div>
              <div className="album-card-grid">
                {customPackCards.map((card: any) => (
                  <button
                    key={`${selectedPackId}-${selectedDay}-${card.word}`}
                    type="button"
                    className={`album-card-tile ${card.rarity ? card.rarity.cssClass : 'rarity-locked'}`}
                    onClick={() =>
                      setInspectedWord({
                        word: card.word,
                        ipa: card.ipa || '',
                        meaning: card.meaning,
                        mnemonic: card.mnemonic ?? null,
                        bestStage: card.bestStage ?? null,
                        rarity: card.rarity ?? null,
                      })
                    }
                  >
                    <div className="album-card-top">
                      <span className="album-rarity-pill">{card.rarity ? card.rarity.label : '未解锁'}</span>
                    </div>
                    <strong className="album-word">{card.word}</strong>
                    <div className="album-meaning">{card.collected ? card.meaning : '学习后解锁释义剪影'}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0, paddingBottom: 4 }}>
                {ZHONGKAO_23_DAYS.map((d) => (
                  <button
                    key={d.day}
                    type="button"
                    className={`candy-pill ${selectedDay === d.day ? 'berry' : ''}`}
                    style={{ minHeight: 36, minWidth: 44, padding: '0 8px', fontSize: 12 }}
                    onClick={() => setSelectedDay(d.day)}
                  >
                    D{d.day}
                  </button>
                ))}
              </div>

              {albumLoading ? (
                <div style={{ padding: 20, textAlign: 'center' }}>正在整理第 {selectedDay} 天卡册...</div>
              ) : (
                <div className="album-card-grid">
                  {(album?.cards ?? (ZHONGKAO_23_DAYS.find((d) => d.day === selectedDay)?.words ?? []).map((w) => ({
                    ...w,
                    collected: false,
                    bestStage: null,
                    currentStage: 0,
                    rarity: null,
                  }))).map((card) => (
                    <button
                      key={`${selectedDay}-${card.word}`}
                      type="button"
                      className={`album-card-tile ${card.rarity ? card.rarity.cssClass : 'rarity-locked'}`}
                      onClick={() => setInspectedWord(card)}
                    >
                      <div className="album-card-top">
                        <span className="album-rarity-pill">
                          {card.rarity ? card.rarity.label : '未解锁'}
                        </span>
                        {card.mnemonic && <span>✨</span>}
                      </div>
                      <strong className="album-word">{card.word}</strong>
                      <div className="album-meaning">
                        {card.collected ? card.meaning : '学习后解锁释义剪影'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : mode === 'zhongkao' ? (
        <div className="camp-hero-card" style={{ gap: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0, paddingBottom: 4 }}>
            {ZHONGKAO_23_DAYS.map((d) => (
              <button
                key={d.day}
                type="button"
                className={`candy-pill ${selectedDay === d.day && !query ? 'berry' : ''}`}
                style={{ minHeight: 36, minWidth: 44, padding: '0 8px', fontSize: 12 }}
                onClick={() => { setQuery(''); setSelectedDay(d.day) }}
              >
                D{d.day}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <input
              className="form-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜 688 个中考词或中文释义..."
              style={{ flex: 1, minHeight: 42 }}
            />
            <button
              type="button"
              className={`candy-pill ${onlyMnemonic ? 'berry' : ''}`}
              style={{ minHeight: 42 }}
              onClick={() => setOnlyMnemonic((v) => !v)}
            >
              仅邪修
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {filteredZhongkao.slice(0, 80).map((w) => (
              <div
                key={`${w.day}-${w.word}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 2px',
                  borderBottom: '1px solid var(--color-border)',
                  minHeight: 48,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong>{w.word}</strong>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{w.ipa}</span>
                    {w.mnemonic && <span className="badge badge-yellow">{w.mnemonic.hook}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{w.meaning}</div>
                </div>
                <button
                  type="button"
                  className="candy-pill"
                  style={{ minHeight: 36, flexShrink: 0 }}
                  onClick={() => setInspectedWord(w)}
                >
                  看邪修卡
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="camp-hero-card" style={{ gap: 8, overflow: 'hidden' }}>
          {deckLoading ? (
            <div style={{ padding: 20, textAlign: 'center' }}>加载班级词卡中...</div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {instances.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', padding: 12 }}>当前班级词卡为空，点击右上角可自建词卡或前往「班级词集」选学。</p>
              ) : (
                instances.map((inst) => {
                  const snap = buildEbbinghausSnapshot({
                    state: inst.state,
                    stability: inst.stability,
                    reps: inst.reps,
                    due: inst.due,
                  })
                  const rarity = rarityFromStage(inst.bestStage ?? (inst.reps > 0 ? snap.stage : null))
                  return (
                    <div
                      key={inst.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 2px',
                        borderBottom: '1px solid var(--color-border)',
                        gap: 8,
                      }}
                    >
                      <div>
                        <strong>{inst.card.word}</strong>{' '}
                        {rarity && <span className="badge badge-yellow">{rarity.label}</span>}
                        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                          {inst.definitionL1 || inst.card.definitionL1 || inst.card.definitionL2}
                        </div>
                      </div>
                      <span className="badge badge-blue">
                        {snap.stageLabel} · {snap.nextReviewText}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}

      {inspectedWord && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div
            className={`camp-modal-card ${inspectedWord.rarity ? inspectedWord.rarity.cssClass : ''}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div className="modal-header" style={{ marginBottom: 0 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 style={{ fontSize: 26 }}>{inspectedWord.word}</h2>
                  {inspectedWord.rarity && (
                    <span className="badge badge-yellow">{inspectedWord.rarity.label}</span>
                  )}
                </div>
                <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
                  {inspectedWord.ipa} · {inspectedWord.meaning}
                </div>
              </div>
              <button type="button" className="candy-pill" onClick={() => speakWord(inspectedWord.word)}>
                🔊 读音
              </button>
            </div>
            <MnemonicCardBlock
              word={inspectedWord.word}
              mnemonic={patchMap[inspectedWord.word.toLowerCase()] ?? inspectedWord.mnemonic}
              studentAlternatives={studentAltMap[inspectedWord.word.toLowerCase()] ?? []}
            />
            {summary?.classSettings?.mnemonicCoCreateOpen && (inspectedWord.bestStage ?? 0) >= 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  type="button"
                  className="candy-pill sticky"
                  style={{ minHeight: 34 }}
                  onClick={() => {
                    setCocreateOpen((v) => !v)
                    setCoNotice(null)
                  }}
                >
                  {cocreateOpen ? '收起共创表单' : '✍️ 写我的邪修口诀（共创）'}
                </button>
                {cocreateOpen && (
                  <div className="camp-def-box" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10 }}>
                    {coNotice && <div className="alert alert-info" style={{ marginBottom: 0 }}>{coNotice}</div>}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {['谐音记忆', '词根词缀', '画面联想', '对比记忆', '考场防坑'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`candy-pill ${coTag === t ? 'berry' : ''}`}
                          style={{ minHeight: 28, padding: '0 8px', fontSize: 11 }}
                          onClick={() => setCoTag(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <input
                      className="form-control"
                      placeholder="记忆钩子（4-40字，如：re(回)+ward(看)）"
                      value={coHook}
                      onChange={(e) => setCoHook(e.target.value)}
                    />
                    <textarea
                      className="form-control"
                      rows={2}
                      placeholder="记忆故事（10-240字）"
                      value={coStory}
                      onChange={(e) => setCoStory(e.target.value)}
                    />
                    <input
                      className="form-control"
                      placeholder="拆解（可选，如 re|回;ward|看）"
                      value={coChunksText}
                      onChange={(e) => setCoChunksText(e.target.value)}
                    />
                    <button
                      type="button"
                      className="camp-btn camp-btn-mint"
                      disabled={coBusy || !coHook.trim() || !coStory.trim()}
                      onClick={() => void submitCoCreation()}
                    >
                      提交老师审核
                    </button>
                  </div>
                )}
              </div>
            )}
            <button type="button" className="camp-btn camp-btn-mint" onClick={() => setInspectedWord(null)}>
              收起词卡
            </button>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="camp-modal-card" onSubmit={(e) => void handleAddOwnCard(e)}>
            <div className="modal-header">
              <h2>添加自习词卡</h2>
              <button type="button" className="candy-pill" onClick={() => setAddOpen(false)}>取消</button>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="own-word">英文单词</label>
              <input id="own-word" className="form-input" value={newWord} onChange={(e) => setNewWord(e.target.value)} required autoCapitalize="none" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="own-zh">中文释义</label>
              <input id="own-zh" className="form-input" value={newZh} onChange={(e) => setNewZh(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="own-ex">例句（选填）</label>
              <input id="own-ex" className="form-input" value={newEx} onChange={(e) => setNewEx(e.target.value)} />
            </div>
            <button type="submit" className="camp-btn camp-btn-berry" style={{ width: '100%' }}>保存并加入复习</button>
          </form>
        </div>
      )}
    </>
  )
}

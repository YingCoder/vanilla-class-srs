import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../utils/api'
import ThemeToggleButton from './ThemeToggleButton'
import type { RemoteReleaseInfo } from './HotUpdateBanner'
import {
  DEFAULT_WORLD_CONTENT,
  parseWorldContentJson,
  type WorldContentPack,
} from '@vanilla-srs/shared/world-content'

interface ReleasesResponse {
  releases: Array<RemoteReleaseInfo & { isActive: boolean }>
  latest: RemoteReleaseInfo
}

interface GameConfigFormState {
  dailyXpCap: number
  ringsClosedXp: number
  backlogCapNormal: number
  backlogCapReturn: number
  xpGrade1: number
  xpGrade2: number
  xpGrade3: number
  xpGrade4: number
  levelL1: number
  levelL2: number
  levelL3: number
  levelL5: number
  levelBoss: number
}

interface ReleasePushManagerProps {
  scope: 'admin' | 'teacher'
}

const PUSH_MODE_LABELS: Record<RemoteReleaseInfo['pushMode'], string> = {
  BANNER: '通知横幅（学生点1秒更新）',
  FORCE_RELOAD: '强制无感刷新（紧急补丁）',
  SILENT: '静默同步版本标签',
}

const PAYLOAD_LABELS: Record<RemoteReleaseInfo['payloadType'], string> = {
  VOCAB_PACK: '23天词包更新',
  MNEMONIC_PATCH: '邪修口诀补丁',
  APP_UI: '前端界面热更新',
  GAME_CONFIG: '全局游戏化参数（仅管理员）',
  WORLD_CONTENT: '世界观剧情与岛屿内容包',
}

export default function ReleasePushManager({ scope }: ReleasePushManagerProps) {
  const basePath = scope === 'admin' ? '/admin/releases' : '/teachers/releases'
  const classesApi = scope === 'admin' ? '/admin/game/classes' : '/teachers/game/classes'
  const [releaseScopeMode, setReleaseScopeMode] = useState<'ALL' | 'CLASSES'>('ALL')
  const [scopeClasses, setScopeClasses] = useState<Array<{ id: string; name: string }>>([])
  const [selectedScopeClassIds, setSelectedScopeClassIds] = useState<string[]>([])

  useEffect(() => {
    api
      .get<{ classes?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>(classesApi)
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.classes ?? [])
        setScopeClasses(list)
      })
      .catch(() => {})
  }, [classesApi])
  const [data, setData] = useState<ReleasesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [version, setVersion] = useState('v2.5.0')
  const [packVersion, setPackVersion] = useState('Pack-23D-688')
  const [title, setTitle] = useState('Day4~10 邪修口诀补全')
  const [notes, setNotes] = useState('新增高频易错词谐音拆分与艾宾浩斯临界提醒微调，学生点1秒即可热更生效。')
  const [pushMode, setPushMode] = useState<RemoteReleaseInfo['pushMode']>('BANNER')
  const [payloadType, setPayloadType] = useState<RemoteReleaseInfo['payloadType']>('MNEMONIC_PATCH')
  const [activeGameVersion, setActiveGameVersion] = useState('default')
  const [worldJson, setWorldJson] = useState(() => JSON.stringify(DEFAULT_WORLD_CONTENT, null, 2))
  const [worldPreview, setWorldPreview] = useState<WorldContentPack | null>(DEFAULT_WORLD_CONTENT)
  const [worldPreviewErrors, setWorldPreviewErrors] = useState<string[]>([])
  const [worldDay, setWorldDay] = useState(1)
  const [worldLoading, setWorldLoading] = useState(false)
  const [gameCfg, setGameCfg] = useState<GameConfigFormState>({
    dailyXpCap: 400,
    ringsClosedXp: 30,
    backlogCapNormal: 50,
    backlogCapReturn: 20,
    xpGrade1: 1,
    xpGrade2: 3,
    xpGrade3: 5,
    xpGrade4: 6,
    levelL1: 10,
    levelL2: 20,
    levelL3: 20,
    levelL5: 20,
    levelBoss: 50,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [res, gc] = await Promise.all([
        api.get<ReleasesResponse>(basePath),
        scope === 'admin'
          ? api.get<{ configVersion: string; config: any }>(`${basePath}/game-config`).catch(() => null)
          : Promise.resolve(null),
      ])
      setData(res)
      if (gc?.config) {
        setActiveGameVersion(gc.configVersion)
        setGameCfg({
          dailyXpCap: gc.config.dailyXpCap ?? 400,
          ringsClosedXp: gc.config.ringsClosedXp ?? 30,
          backlogCapNormal: gc.config.backlogCapNormal ?? 50,
          backlogCapReturn: gc.config.backlogCapReturn ?? 20,
          xpGrade1: gc.config.xpByGrade?.[1] ?? 1,
          xpGrade2: gc.config.xpByGrade?.[2] ?? 3,
          xpGrade3: gc.config.xpByGrade?.[3] ?? 5,
          xpGrade4: gc.config.xpByGrade?.[4] ?? 6,
          levelL1: gc.config.levelXp?.L1 ?? 10,
          levelL2: gc.config.levelXp?.L2 ?? 20,
          levelL3: gc.config.levelXp?.L3 ?? 20,
          levelL5: gc.config.levelXp?.L5 ?? 20,
          levelBoss: gc.config.levelXp?.BOSS ?? 50,
        })
      }
    } catch (err: any) {
      setError(err.message || '加载热更新历史失败')
    } finally {
      setLoading(false)
    }
  }, [basePath, scope])

  useEffect(() => {
    void load()
  }, [load])

  const handlePayloadTypeChange = (nextType: RemoteReleaseInfo['payloadType']) => {
    setPayloadType(nextType)
    if (nextType === 'GAME_CONFIG') {
      setPushMode('SILENT')
      setTitle('Stage 3 游戏化激励参数热更新')
      setNotes('静默更新 XP 奖励与每日护栏参数，不影响正在作答的学生。')
    }
    if (nextType === 'WORLD_CONTENT') {
      setPushMode('SILENT')
      setTitle('香草群岛世界观剧情包')
      setNotes('仅更新纯文本剧情与视觉预设，不改变奖励、复习计划或关卡天数。')
    }
  }

  const handleWorldPreview = () => {
    const check = parseWorldContentJson(worldJson)
    if (check.ok) {
      setWorldPreview(check.content)
      setWorldPreviewErrors([])
    } else {
      setWorldPreview(null)
      setWorldPreviewErrors(check.errors)
    }
    return check
  }

  const loadWorldContent = async () => {
    const previewClass = releaseScopeMode === 'CLASSES' ? selectedScopeClassIds[0] : undefined
    if (scope === 'teacher' && !previewClass) {
      setWorldPreviewErrors(['请选择要预览的自己管理的班级，才能加载当前有效内容。'])
      return
    }
    setWorldLoading(true)
    setError(null)
    try {
      const res = await api.get<{ content: WorldContentPack; contentVersion: string }>(`${basePath}/world-content${previewClass ? `?classId=${encodeURIComponent(previewClass)}` : ''}`)
      setWorldJson(JSON.stringify(res.content, null, 2))
      setWorldPreview(res.content)
      setWorldPreviewErrors([])
      setSuccessMsg(`已载入当前世界内容 ${res.contentVersion}，尚未发布。`)
    } catch (err: any) {
      setError(err.message || '载入世界内容失败')
    } finally {
      setWorldLoading(false)
    }
  }

  const handlePublish = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const configPayload =
        payloadType === 'GAME_CONFIG'
          ? {
              dailyXpCap: Number(gameCfg.dailyXpCap),
              ringsClosedXp: Number(gameCfg.ringsClosedXp),
              backlogCapNormal: Number(gameCfg.backlogCapNormal),
              backlogCapReturn: Number(gameCfg.backlogCapReturn),
              xpByGrade: {
                1: Number(gameCfg.xpGrade1),
                2: Number(gameCfg.xpGrade2),
                3: Number(gameCfg.xpGrade3),
                4: Number(gameCfg.xpGrade4),
              },
              levelXp: {
                L1: Number(gameCfg.levelL1),
                L2: Number(gameCfg.levelL2),
                L3: Number(gameCfg.levelL3),
                L5: Number(gameCfg.levelL5),
                BOSS: Number(gameCfg.levelBoss),
                REVIEW: 0,
              },
            }
          : payloadType === 'WORLD_CONTENT'
            ? (() => { const check = handleWorldPreview(); return check.ok ? check.content : undefined })()
          : undefined

      if (payloadType === 'WORLD_CONTENT' && !configPayload) {
        setError('请先修正内容并预览，完整校验通过后才能发布。')
        return
      }
      if (payloadType === 'WORLD_CONTENT' && releaseScopeMode === 'CLASSES' && selectedScopeClassIds.length === 0) {
        setError('指定班级灰度至少选择一个班级。')
        return
      }
      const created = await api.post<RemoteReleaseInfo>(basePath, {
        version,
        packVersion,
        title,
        notes,
        pushMode,
        payloadType,
        ...(configPayload ? { configPayload } : {}),
        ...(payloadType === 'GAME_CONFIG' || payloadType === 'WORLD_CONTENT'
          ? {
              scope:
                releaseScopeMode === 'CLASSES' && selectedScopeClassIds.length > 0
                  ? { mode: 'CLASSES', classIds: selectedScopeClassIds }
                  : { mode: 'ALL' },
            }
          : {}),
      })
      setSuccessMsg(`已推送热更新 ${created.version}（${created.packVersion}），在线及 iOS 主屏学生将自动收到更新提示。`)
      await load()
    } catch (err: any) {
      setError(err.message || '推送发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRollback = async (id: string) => {
    setError(null)
    setSuccessMsg(null)
    try {
      await api.patch(`${basePath}/${id}/rollback`, {})
      setSuccessMsg('已停用该推送版本，并自动回滚到上一有效版本。')
      await load()
    } catch (err: any) {
      setError(err.message || '回滚失败')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">热更新管理与词包推送</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            向手机端及 iOS 免签名主屏 App 实时推送词库包、邪修口诀补丁与界面更新。
            {scope === 'admin' && `（当前生效游戏参数版本：${activeGameVersion}）`}
          </p>
        </div>
        <ThemeToggleButton />
      </div>

      {data?.latest && (
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <span className="badge badge-green">当前线上生效版本</span>
            <h2 style={{ fontSize: 18, marginTop: 4 }}>{data.latest.version} · {data.latest.packVersion} — {data.latest.title}</h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{data.latest.notes}</p>
          </div>
          <span className="badge badge-blue">{PUSH_MODE_LABELS[data.latest.pushMode]}</span>
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div className="grid-2">
        <form className="card" onSubmit={(e) => void handlePublish(e)}>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>发布新热更新推送</h2>
          <div className="form-group">
            <label className="form-label" htmlFor="rel-ver">版本号</label>
            <input id="rel-ver" className="form-input" value={version} onChange={(e) => setVersion(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rel-pack">词库包编号</label>
            <input id="rel-pack" className="form-input" value={packVersion} onChange={(e) => setPackVersion(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rel-type">更新类型</label>
            <select
              id="rel-type"
              className="form-select"
              value={payloadType}
              onChange={(e) => handlePayloadTypeChange(e.target.value as RemoteReleaseInfo['payloadType'])}
            >
              <option value="MNEMONIC_PATCH">邪修口诀补丁</option>
              <option value="VOCAB_PACK">23天词包更新</option>
              <option value="APP_UI">前端界面热更新</option>
              <option value="WORLD_CONTENT">世界观剧情与岛屿内容包</option>
              {scope === 'admin' && <option value="GAME_CONFIG">全局游戏化参数（GAME_CONFIG）</option>}
            </select>
          </div>

          {scope === 'admin' && payloadType === 'GAME_CONFIG' && (
            <div className="camp-def-box" style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>GameConfig 参数护栏配置（超界将被服务端拒绝）</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label className="form-label">每日 XP 封顶 (50-1000)</label>
                  <input type="number" className="form-input" value={gameCfg.dailyXpCap} onChange={(e) => setGameCfg((s) => ({ ...s, dailyXpCap: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="form-label">双环合拢奖励 (0-150)</label>
                  <input type="number" className="form-input" value={gameCfg.ringsClosedXp} onChange={(e) => setGameCfg((s) => ({ ...s, ringsClosedXp: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="form-label">常规积压保护上限 (10-200)</label>
                  <input type="number" className="form-input" value={gameCfg.backlogCapNormal} onChange={(e) => setGameCfg((s) => ({ ...s, backlogCapNormal: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="form-label">断学回归首日上限 (5-100)</label>
                  <input type="number" className="form-input" value={gameCfg.backlogCapReturn} onChange={(e) => setGameCfg((s) => ({ ...s, backlogCapReturn: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="form-label">评分 XP（重来/模糊）</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type="number" aria-label="重来XP" className="form-input" value={gameCfg.xpGrade1} onChange={(e) => setGameCfg((s) => ({ ...s, xpGrade1: Number(e.target.value) }))} />
                    <input type="number" aria-label="模糊XP" className="form-input" value={gameCfg.xpGrade2} onChange={(e) => setGameCfg((s) => ({ ...s, xpGrade2: Number(e.target.value) }))} />
                  </div>
                </div>
                <div>
                  <label className="form-label">评分 XP（记住/秒杀）</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type="number" aria-label="记住XP" className="form-input" value={gameCfg.xpGrade3} onChange={(e) => setGameCfg((s) => ({ ...s, xpGrade3: Number(e.target.value) }))} />
                    <input type="number" aria-label="秒杀XP" className="form-input" value={gameCfg.xpGrade4} onChange={(e) => setGameCfg((s) => ({ ...s, xpGrade4: Number(e.target.value) }))} />
                  </div>
                </div>
                <div>
                  <label className="form-label">L1 / L2 / L3 XP</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type="number" aria-label="L1 XP" className="form-input" value={gameCfg.levelL1} onChange={(e) => setGameCfg((s) => ({ ...s, levelL1: Number(e.target.value) }))} />
                    <input type="number" aria-label="L2 XP" className="form-input" value={gameCfg.levelL2} onChange={(e) => setGameCfg((s) => ({ ...s, levelL2: Number(e.target.value) }))} />
                    <input type="number" aria-label="L3 XP" className="form-input" value={gameCfg.levelL3} onChange={(e) => setGameCfg((s) => ({ ...s, levelL3: Number(e.target.value) }))} />
                  </div>
                </div>
                <div>
                  <label className="form-label">L5 / BOSS XP</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type="number" aria-label="L5 XP" className="form-input" value={gameCfg.levelL5} onChange={(e) => setGameCfg((s) => ({ ...s, levelL5: Number(e.target.value) }))} />
                    <input type="number" aria-label="BOSS XP" className="form-input" value={gameCfg.levelBoss} onChange={(e) => setGameCfg((s) => ({ ...s, levelBoss: Number(e.target.value) }))} />
                  </div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>生效班级范围（R2 灰度 / A-B 分班试验）</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="radio" checked={releaseScopeMode === 'ALL'} onChange={() => setReleaseScopeMode('ALL')} />
                    全校所有班级
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="radio" checked={releaseScopeMode === 'CLASSES'} onChange={() => setReleaseScopeMode('CLASSES')} />
                    指定灰度班级
                  </label>
                </div>
                {releaseScopeMode === 'CLASSES' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {scopeClasses.map((cls) => {
                      const picked = selectedScopeClassIds.includes(cls.id)
                      return (
                        <button
                          key={cls.id}
                          type="button"
                          className={`btn btn-sm ${picked ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() =>
                            setSelectedScopeClassIds((prev) =>
                              prev.includes(cls.id) ? prev.filter((id) => id !== cls.id) : [...prev, cls.id],
                            )
                          }
                        >
                          {cls.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {payloadType === 'WORLD_CONTENT' && (
            <div className="camp-def-box" style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <strong style={{ fontSize: 13 }}>世界内容包 · 完整 JSON 替换</strong>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                固定 23 个据点、4 座岛和 4 位岛主；只改剧情纯文本，不能改奖励、FSRS、天数边界或注入链接/代码。
              </p>
              <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                <label><input type="radio" disabled={scope === 'teacher'} checked={releaseScopeMode === 'ALL'} onChange={() => setReleaseScopeMode('ALL')} /> 全校所有班级（仅管理员）</label>
                <label><input type="radio" checked={releaseScopeMode === 'CLASSES'} onChange={() => setReleaseScopeMode('CLASSES')} /> 指定灰度班级</label>
              </div>
              {releaseScopeMode === 'CLASSES' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {scopeClasses.map((cls) => {
                    const picked = selectedScopeClassIds.includes(cls.id)
                    return <button key={cls.id} type="button" className={`btn btn-sm ${picked ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSelectedScopeClassIds((prev) => picked ? prev.filter((id) => id !== cls.id) : [...prev, cls.id])}>{cls.name}</button>
                  })}
                  {scopeClasses.length === 0 && <span style={{ fontSize: 12 }}>暂无可管理班级。</span>}
                </div>
              )}
              <label className="form-label" htmlFor="world-content-json">剧情 JSON（最多 50000 字符）</label>
              <textarea id="world-content-json" className="form-textarea" spellCheck={false} value={worldJson} onChange={(e) => { setWorldJson(e.target.value); setWorldPreviewErrors([]) }} style={{ minHeight: 300, maxHeight: 540, fontFamily: 'monospace', fontSize: 12 }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={handleWorldPreview}>校验并预览</button>
                <button type="button" className="btn btn-outline" disabled={worldLoading} onClick={() => void loadWorldContent()}>{worldLoading ? '载入中...' : '载入当前班级内容'}</button>
                <button type="button" className="btn btn-outline" onClick={() => { setWorldJson(JSON.stringify(DEFAULT_WORLD_CONTENT, null, 2)); setWorldPreview(DEFAULT_WORLD_CONTENT); setWorldPreviewErrors([]) }}>恢复内置剧情</button>
              </div>
              {worldPreviewErrors.length > 0 && <div className="alert alert-danger" role="alert">{worldPreviewErrors.slice(0, 20).map((error) => <div key={error}>{error}</div>)}</div>}
              {worldPreview && (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 10 }}>
                  <label className="form-label" htmlFor="world-preview-day">预览天数</label>
                  <select id="world-preview-day" className="form-select" value={worldDay} onChange={(e) => setWorldDay(Number(e.target.value))}>{worldPreview.stories.map((story) => <option key={story.day} value={story.day}>D{story.day} · {story.title}</option>)}</select>
                  {worldPreview.stories.filter((story) => story.day === worldDay).map((story) => (
                    <div key={story.day} style={{ marginTop: 8 }}>
                      <strong>D{story.day} · {story.title}</strong>
                      {story.lines.map((line, i) => <p key={i} style={{ margin: '6px 0', fontSize: 13 }}>{line}</p>)}
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>明日悬念：{story.tomorrow}</div>
                    </div>
                  ))}
                  {worldPreview.bosses.filter((boss) => boss.day === worldDay).map((boss) => <div key={boss.day} style={{ marginTop: 10, fontSize: 12 }}><strong>岛主剧情 · {boss.title}</strong>{boss.lines.map((line, i) => <div key={i}>{line}</div>)}<div>明日悬念：{boss.tomorrow}</div></div>)}
                  <div style={{ marginTop: 10, fontSize: 12 }}>固定岛屿：{worldPreview.islands.map((island) => `${island.name} D${island.startDay}–D${island.endDay}`).join(' · ')}</div>
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="rel-mode">推送方式</label>
            <select
              id="rel-mode"
              className="form-select"
              value={pushMode}
              onChange={(e) => setPushMode(e.target.value as RemoteReleaseInfo['pushMode'])}
            >
              <option value="BANNER">通知横幅（学生点1秒更新）</option>
              <option value="FORCE_RELOAD">强制无感刷新（紧急补丁）</option>
              <option value="SILENT">静默同步版本标签</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rel-title">推送标题</label>
            <input id="rel-title" className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rel-notes">更新说明（展示给学生）</label>
            <textarea id="rel-notes" className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} required />
          </div>
          <button type="submit" className="camp-btn camp-btn-berry" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? '推送中...' : payloadType === 'WORLD_CONTENT' && releaseScopeMode === 'CLASSES' ? `发布给 ${selectedScopeClassIds.length} 个灰度班级` : payloadType === 'WORLD_CONTENT' && scope === 'teacher' ? '请选择灰度班级' : '立即发布内容包'}
          </button>
        </form>

        <div className="card">
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>推送记录与一键撤回</h2>
          {loading ? (
            <p>加载推送记录中...</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>内容</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.releases ?? []).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.version}</strong>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.packVersion}</div>
                      </td>
                      <td>
                        <div>{r.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {PAYLOAD_LABELS[r.payloadType] ?? r.payloadType} · {r.publishedBy}
                          {(r as any).scope?.mode === 'CLASSES' && (
                            <span className="badge badge-blue" style={{ marginLeft: 6 }}>
                              指定 {((r as any).scope?.classIds?.length ?? 0)} 班灰度
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${r.isActive ? 'badge-green' : 'badge-gray'}`}>
                          {r.isActive ? '生效中' : '已撤回'}
                        </span>
                      </td>
                      <td>
                        {r.isActive && !r.id.startsWith('baseline-') && (scope === 'admin' || r.payloadType !== 'GAME_CONFIG') && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => void handleRollback(r.id)}
                          >
                            撤回
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

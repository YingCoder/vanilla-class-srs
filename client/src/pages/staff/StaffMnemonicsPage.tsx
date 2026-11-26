import { useCallback, useEffect, useState } from 'react'
import type { WordMnemonic } from '@vanilla-srs/shared/vocab'
import { api } from '../../utils/api'
import MnemonicCardBlock from '../../components/MnemonicCardBlock'

interface WorkbenchDay {
  day: number
  totalWords: number
  coveredCount: number
  missingCount: number
  pendingReviewCount: number
  draftCount: number
}

interface WorkbenchWord {
  word: string
  day: number
  ipa: string
  meaning: string
  hasBuiltin: boolean
  effectiveMnemonic: WordMnemonic | null
  effectiveStatus: string
  latestStaffEntry: any | null
  studentEntries: any[]
}

interface WorkbenchResponse {
  coverage: {
    totalWords: number
    coveredCount: number
    missingCount: number
    coveragePct: number
    targetCount: number
    targetPct: number
    pendingReviewCount: number
    draftCount: number
    byDay: WorkbenchDay[]
  }
  words: WorkbenchWord[]
  pendingQueue: any[]
  draftQueue: any[]
  activePatchVersions: string[]
}

const TAG_OPTIONS = ['谐音记忆', '词根词缀', '画面联想', '对比记忆', '情景串联', '考场防坑']

export default function StaffMnemonicsPage({ scope }: { scope: 'teacher' | 'admin' }) {
  const basePath = scope === 'admin' ? '/admin/mnemonics' : '/teachers/mnemonics'
  const staffBase = scope === 'admin' ? '/admin' : '/teachers'

  const [tab, setTab] = useState<'workbench' | 'import' | 'reviews' | 'packs'>('workbench')
  const [data, setData] = useState<WorkbenchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Workbench filters
  const [dayFilter, setDayFilter] = useState<number | ''>('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'MISSING' | 'APPROVED' | 'DRAFT' | 'PENDING'>('ALL')
  const [search, setSearch] = useState('')

  // Editor state
  const [selectedWord, setSelectedWord] = useState<WorkbenchWord | null>(null)
  const [editWord, setEditWord] = useState('')
  const [editDay, setEditDay] = useState<number>(1)
  const [editTag, setEditTag] = useState('谐音记忆')
  const [editHook, setEditHook] = useState('')
  const [editStory, setEditStory] = useState('')
  const [editChunksText, setEditChunksText] = useState('')
  const [editTrap, setEditTrap] = useState('')
  const [editExample, setEditExample] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Import + Publish state
  const [csvText, setCsvText] = useState('')
  const [importReport, setImportReport] = useState<{
    batchId: string
    totalRows: number
    importedCount: number
    failedCount: number
    errors: Array<{ row: number; word: string; reason: string }>
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const [pubVersion, setPubVersion] = useState('2.5.1')
  const [pubTitle, setPubTitle] = useState('邪修口诀补丁增量包')
  const [pubNotes, setPubNotes] = useState('扩充高频核心词邪修口诀与学生共创精选。')
  const [pubMode, setPubMode] = useState<'BANNER' | 'SILENT' | 'FORCE_RELOAD'>('BANNER')
  const [promoteDrafts, setPromoteDrafts] = useState(true)
  const [publishing, setPublishing] = useState(false)

  // Review state
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  // R10 Custom vocab pack state
  const [packs, setPacks] = useState<Array<{ id: string; slug: string; name: string; description?: string; daysCount: number; totalWords: number; isBuiltin: boolean }>>([])
  const [packName, setPackName] = useState('')
  const [packDesc, setPackDesc] = useState('')
  const [packCsv, setPackCsv] = useState('1,resilience,/rɪˈzɪliəns/,n. 韧性；恢复力\n1,momentum,/məˈmentəm/,n. 势头；动力')
  const [savingPack, setSavingPack] = useState(false)

  const loadWorkbench = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (dayFilter !== '') params.set('day', String(dayFilter))
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      const [wb, pk] = await Promise.all([
        api.get<WorkbenchResponse>(`${basePath}?${params.toString()}`),
        api.get<any[]>(`${staffBase}/vocab-packs`).catch(() => []),
      ])
      setData(wb)
      if (Array.isArray(pk)) setPacks(pk)
    } catch (err: any) {
      setError(err.message || '加载口诀工作台失败')
    } finally {
      setLoading(false)
    }
  }, [basePath, staffBase, dayFilter, statusFilter, search])

  useEffect(() => {
    void loadWorkbench()
  }, [loadWorkbench])

  const selectWordForEdit = (item: WorkbenchWord) => {
    setSelectedWord(item)
    setEditWord(item.word)
    setEditDay(item.day)
    const mn = item.effectiveMnemonic ?? item.latestStaffEntry
    if (mn) {
      setEditTag(mn.tag || '谐音记忆')
      setEditHook(mn.hook || '')
      setEditStory(mn.story || '')
      const chunksArr: Array<[string, string]> = Array.isArray(mn.chunks) ? mn.chunks : []
      setEditChunksText(chunksArr.map(([a, b]) => `${a}|${b}`).join(';'))
      setEditTrap(mn.trap || '')
      setEditExample(mn.example || '')
    } else {
      setEditTag('谐音记忆')
      setEditHook('')
      setEditStory('')
      setEditChunksText(`${item.word.slice(0, Math.min(4, item.word.length))}|核心词块`)
      setEditTrap('')
      setEditExample('')
    }
  }

  const parseChunksInput = (raw: string, fallbackWord: string): Array<[string, string]> => {
    const parsed = raw
      .split(/[;；\n]/)
      .map((s) => s.split(/[:|→]/).map((x) => x.trim()))
      .filter((pair) => pair.length >= 2 && pair[0] && pair[1])
      .map(([a, b]) => [a, b] as [string, string])
    return parsed.length > 0 ? parsed : [[fallbackWord.slice(0, 4) || '词根', editHook.trim() || '助记']]
  }

  const handleSaveMnemonic = async (status: 'DRAFT' | 'APPROVED') => {
    if (!editWord.trim()) return
    setSavingEdit(true)
    setError(null)
    setToast(null)
    try {
      await api.post(basePath, {
        word: editWord.trim(),
        campDay: editDay,
        tag: editTag,
        hook: editHook.trim(),
        story: editStory.trim(),
        chunks: parseChunksInput(editChunksText, editWord.trim()),
        trap: editTrap.trim() || null,
        example: editExample.trim() || null,
        status,
      })
      setToast(`已保存 ${editWord.trim()}（${status === 'APPROVED' ? '已审核' : '草稿'}）`)
      await loadWorkbench()
    } catch (err: any) {
      setError(err.message || '保存口诀失败')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDownloadCsvTemplate = () => {
    const csv =
      '\uFEFFword,campDay,tag,hook,story,chunks,trap,example\n' +
      'reward,23,词根词缀,re(回)+ward(看顾)→奖赏,"付出努力后回头看收获，就是老师发给你的「报酬、奖赏」。","re|回馈;ward|照看","reward sb for sth 为某事奖赏某人","Closing both rings brings a 30 XP reward."\n'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mnemonic-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFileUpload = async (file: File) => {
    const text = await file.text()
    setCsvText(text)
  }

  const handleBatchImport = async () => {
    if (!csvText.trim()) return
    setImporting(true)
    setError(null)
    setToast(null)
    try {
      const trimmed = csvText.trim()
      const payload = trimmed.startsWith('[')
        ? { rows: JSON.parse(trimmed) }
        : { csvText: trimmed }
      const report = await api.post<NonNullable<typeof importReport>>(`${basePath}/import`, payload)
      setImportReport(report)
      setToast(`导入完成：成功 ${report.importedCount} 条，失败 ${report.failedCount} 条`)
      await loadWorkbench()
    } catch (err: any) {
      setError(err.message || '批量导入失败')
    } finally {
      setImporting(false)
    }
  }

  const handlePublishPatch = async () => {
    setPublishing(true)
    setError(null)
    setToast(null)
    try {
      const res = await api.post<{ release: { version: string }; publishedCount: number }>(`${basePath}/publish`, {
        version: pubVersion.trim(),
        title: pubTitle.trim(),
        notes: pubNotes.trim(),
        pushMode: pubMode,
        promoteDrafts,
      })
      setToast(`已发布 MNEMONIC_PATCH v${res.release.version}（共 ${res.publishedCount} 条生效），可在热更新页面随时回滚。`)
      await loadWorkbench()
    } catch (err: any) {
      setError(err.message || '发布口诀热更失败')
    } finally {
      setPublishing(false)
    }
  }

  const handleReviewDecision = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    setReviewingId(id)
    setError(null)
    setToast(null)
    try {
      await api.post(`${basePath}/${id}/review`, {
        decision,
        reviewNote: decision === 'REJECT' ? '请进一步紧扣单词拼写与考场释义' : undefined,
      })
      setToast(decision === 'APPROVE' ? '已审核通过并触发创作者激励核算' : '已驳回该条同学投稿（0 XP）')
      await loadWorkbench()
    } catch (err: any) {
      setError(err.message || '审核失败')
    } finally {
      setReviewingId(null)
    }
  }

  const handleCreatePack = async () => {
    if (!packName.trim() || !packCsv.trim()) return
    setSavingPack(true)
    setError(null)
    setToast(null)
    try {
      const items = packCsv
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [dayRaw, word, ipa, meaning] = line.split(/[,，]/).map((s) => s.trim())
          return {
            day: Number(dayRaw) || 1,
            word: word || dayRaw,
            ipa: meaning ? ipa : undefined,
            meaning: meaning || ipa || '重点词',
          }
        })
      const created = await api.post<{ name: string }>(`${staffBase}/vocab-packs`, {
        name: packName.trim(),
        description: packDesc.trim() || undefined,
        items,
      })
      setToast(`已导入新词包「${created.name}」`)
      setPackName('')
      setPackDesc('')
      await loadWorkbench()
    } catch (err: any) {
      setError(err.message || '导入新词包失败')
    } finally {
      setSavingPack(false)
    }
  }

  const livePreviewMnemonic: WordMnemonic | null =
    editHook.trim() && editStory.trim()
      ? {
          tag: editTag,
          hook: editHook.trim(),
          story: editStory.trim(),
          chunks: parseChunksInput(editChunksText, editWord || 'word'),
          ...(editTrap.trim() ? { trap: editTrap.trim() } : {}),
          ...(editExample.trim() ? { example: editExample.trim() } : {}),
        }
      : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">邪修口诀工程化与多词包工作台（R4 & R10）</h1>
          <p className="page-subtitle">
            {scope === 'admin' ? '管理员全局口诀覆盖率与审核' : '教研教师口诀编校、批量导入、共创审核与热更发布'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { key: 'workbench', label: '口诀编校台' },
            { key: 'import', label: '批量导入 & 热更发布' },
            { key: 'reviews', label: `学生共创审核 (${data?.coverage.pendingReviewCount ?? 0})` },
            { key: 'packs', label: `多词包扩展 (${packs.length})` },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setTab(t.key as any)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 0 }}>{error}</div>}
      {toast && <div className="alert alert-success" style={{ marginBottom: 0 }}>{toast}</div>}

      {data && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong>688 中考高频词邪修覆盖率：{data.coverage.coveredCount} / {data.coverage.totalWords} ({data.coverage.coveragePct}%)</strong>
              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
                Stage 4 目标 ≥ {data.coverage.targetPct}% ({data.coverage.targetCount} 词) · 草稿 {data.coverage.draftCount} · 待审 {data.coverage.pendingReviewCount}
              </span>
            </div>
            {data.activePatchVersions.length > 0 && (
              <span className="badge badge-green">已生效补丁：{data.activePatchVersions.join(', ')}</span>
            )}
          </div>
          <div className="progress-bar" style={{ height: 10, marginTop: 8 }}>
            <div className="progress-fill" style={{ width: `${Math.min(100, data.coverage.coveragePct)}%` }} />
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              type="button"
              className={`btn btn-sm ${dayFilter === '' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setDayFilter('')}
            >
              全部天数
            </button>
            {data.coverage.byDay.map((d) => (
              <button
                key={d.day}
                type="button"
                className={`btn btn-sm ${dayFilter === d.day ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setDayFilter(d.day)}
                title={`D${d.day}: ${d.coveredCount}/${d.totalWords}`}
              >
                D{d.day} ({d.coveredCount}/{d.totalWords})
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'workbench' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(320px, 1.1fr)', gap: 16 }}>
          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="form-control"
                style={{ flex: 1, minWidth: 140 }}
                placeholder="搜单词或中文释义..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="form-control"
                style={{ width: 130 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="ALL">全部状态</option>
                <option value="MISSING">待配邪修</option>
                <option value="APPROVED">已覆盖</option>
                <option value="DRAFT">导入草稿</option>
                <option value="PENDING">有学生投稿</option>
              </select>
            </div>

            {loading ? (
              <div style={{ padding: 20, textAlign: 'center' }}>加载词库中...</div>
            ) : (
              <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(data?.words ?? []).map((w) => (
                  <button
                    key={w.word}
                    type="button"
                    className="btn btn-outline"
                    style={{
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      borderColor: selectedWord?.word === w.word ? 'var(--color-primary)' : undefined,
                    }}
                    onClick={() => selectWordForEdit(w)}
                  >
                    <span>
                      <strong>{w.word}</strong> <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>D{w.day} · {w.meaning}</span>
                    </span>
                    <span className={`badge ${w.effectiveMnemonic ? 'badge-green' : 'badge-gray'}`}>
                      {w.effectiveMnemonic ? '已覆盖' : '待配邪修'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>
              {editWord ? `编辑口诀：${editWord}` : '选择左侧词条或输入单词新建口诀'}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 120px', gap: 8 }}>
              <input
                className="form-control"
                placeholder="单词 word"
                value={editWord}
                onChange={(e) => setEditWord(e.target.value)}
              />
              <input
                type="number"
                className="form-control"
                min={1}
                max={23}
                value={editDay}
                onChange={(e) => setEditDay(Number(e.target.value) || 1)}
              />
              <select className="form-control" value={editTag} onChange={(e) => setEditTag(e.target.value)}>
                {TAG_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <input
              className="form-control"
              placeholder="记忆钩子 hook（4-40字，如：re(回)+ward(看顾)→奖赏）"
              value={editHook}
              onChange={(e) => setEditHook(e.target.value)}
            />
            <textarea
              className="form-control"
              rows={3}
              placeholder="记忆故事 story（10-240字）"
              value={editStory}
              onChange={(e) => setEditStory(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="拆解 chunks（格式：re|回馈;ward|照看）"
              value={editChunksText}
              onChange={(e) => setEditChunksText(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="考场避坑提示 trap（可选）"
              value={editTrap}
              onChange={(e) => setEditTrap(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="例句 example（可选）"
              value={editExample}
              onChange={(e) => setEditExample(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingEdit || !editWord.trim() || !editHook.trim() || !editStory.trim()}
                onClick={() => void handleSaveMnemonic('APPROVED')}
              >
                保存并通过（APPROVED）
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={savingEdit || !editWord.trim() || !editHook.trim() || !editStory.trim()}
                onClick={() => void handleSaveMnemonic('DRAFT')}
              >
                存为草稿（DRAFT）
              </button>
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>实时学生端便利贴预览</div>
              <MnemonicCardBlock word={editWord || 'sample'} mnemonic={livePreviewMnemonic} />
            </div>
          </div>
        </div>
      )}

      {tab === 'import' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>CSV / JSON 批量导入口诀（入草稿待审）</h2>
              <button type="button" className="btn btn-sm btn-outline" onClick={handleDownloadCsvTemplate}>
                下载 CSV 模板
              </button>
            </div>
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFileUpload(file)
              }}
            />
            <textarea
              className="form-control"
              rows={8}
              placeholder="粘贴 CSV（含 word,campDay,tag,hook,story,chunks,trap）或 JSON 数组..."
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={importing || !csvText.trim()}
              onClick={() => void handleBatchImport()}
            >
              {importing ? '校验导入中...' : '执行逐行校验并导入草稿'}
            </button>
            {importReport && (
              <div className="camp-def-box" style={{ padding: 10, fontSize: 13 }}>
                <div>
                  共 {importReport.totalRows} 行 · 导入草稿 <strong>{importReport.importedCount}</strong> 条 · 失败 <strong>{importReport.failedCount}</strong> 条
                </div>
                {importReport.errors.length > 0 && (
                  <ul style={{ margin: '6px 0 0 16px', padding: 0, color: 'var(--color-danger)' }}>
                    {importReport.errors.map((err, i) => (
                      <li key={i}>第 {err.row} 行（{err.word || '空词'}）：{err.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>一键发布热更包（MNEMONIC_PATCH）</h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              将已审核与本次草稿打包成实时口诀补丁下发，学生在 /releases 与词卡中立即可见，随时可在「热更新推送」页面一键回滚。
            </p>
            <input className="form-control" placeholder="版本号（如 2.5.1）" value={pubVersion} onChange={(e) => setPubVersion(e.target.value)} />
            <input className="form-control" placeholder="发布标题" value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} />
            <textarea className="form-control" rows={3} placeholder="发布说明" value={pubNotes} onChange={(e) => setPubNotes(e.target.value)} />
            <select className="form-control" value={pubMode} onChange={(e) => setPubMode(e.target.value as any)}>
              <option value="BANNER">BANNER（温和横幅提示）</option>
              <option value="SILENT">SILENT（静默生效）</option>
              <option value="FORCE_RELOAD">FORCE_RELOAD（强制刷新）</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={promoteDrafts} onChange={(e) => setPromoteDrafts(e.target.checked)} />
              发布时一并将 DRAFT 草稿晋升为 APPROVED
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={publishing || !pubVersion.trim() || !pubTitle.trim()}
              onClick={() => void handlePublishPatch()}
            >
              {publishing ? '打包发布中...' : '立即发布 MNEMONIC_PATCH'}
            </button>
          </div>
        </div>
      )}

      {tab === 'reviews' && (
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>学生共创口诀待审队列（{data?.pendingQueue.length ?? 0} 条）</h2>
          {(!data?.pendingQueue || data.pendingQueue.length === 0) ? (
            <p style={{ color: 'var(--color-text-muted)' }}>暂无待审核的同学共创口诀。</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.pendingQueue.map((item) => (
                <div key={item.id} className="camp-def-box" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div>
                      <strong>{item.word}</strong> · <span className="badge badge-blue">{item.tag}</span> · 创作者：{item.authorNickname || '匿名小香草'}
                    </div>
                    <div style={{ marginTop: 4 }}><strong>钩子：</strong>{item.hook}</div>
                    <div style={{ fontSize: 13 }}>{item.story}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={reviewingId === item.id}
                      onClick={() => void handleReviewDecision(item.id, 'APPROVE')}
                    >
                      ✅ 通过（发奖+徽章）
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      disabled={reviewingId === item.id}
                      onClick={() => void handleReviewDecision(item.id, 'REJECT')}
                    >
                      ❌ 驳回（0 XP）
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'packs' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>可用词包列表（{packs.length} 个）</h2>
            {packs.map((p) => (
              <div key={p.id} className="camp-def-box" style={{ padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                  <span>{p.name}</span>
                  <span className="badge badge-blue">{p.daysCount} 天 · {p.totalWords} 词</span>
                </div>
                {p.description && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{p.description}</div>}
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>导入新阶段/专题词包（R10）</h2>
            <input className="form-control" placeholder="词包名称（如：九年级冲刺精选100词）" value={packName} onChange={(e) => setPackName(e.target.value)} />
            <input className="form-control" placeholder="描述（可选）" value={packDesc} onChange={(e) => setPackDesc(e.target.value)} />
            <textarea
              className="form-control"
              rows={6}
              placeholder="每行一条：day,word,ipa,meaning"
              value={packCsv}
              onChange={(e) => setPackCsv(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingPack || !packName.trim() || !packCsv.trim()}
              onClick={() => void handleCreatePack()}
            >
              {savingPack ? '创建中...' : '创建词包（自动复用卡册与8阶段）'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

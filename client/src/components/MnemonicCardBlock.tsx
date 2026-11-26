import { lookupZhongkaoWord, type WordMnemonic } from '@vanilla-srs/shared/vocab'

export interface StudentAlternativeItem {
  id: string
  authorNickname: string
  mnemonic: WordMnemonic
}

interface MnemonicCardBlockProps {
  word: string
  mnemonic?: WordMnemonic | null
  studentAlternatives?: StudentAlternativeItem[]
  compact?: boolean
  rescueTitle?: string
}

export default function MnemonicCardBlock({
  word,
  mnemonic,
  studentAlternatives = [],
  compact = false,
  rescueTitle,
}: MnemonicCardBlockProps) {
  const resolved = mnemonic ?? lookupZhongkaoWord(word)?.mnemonic ?? null

  if (!resolved && studentAlternatives.length === 0) {
    return (
      <div className="camp-sticky-box">
        <div className="camp-sticky-head">
          <span className="camp-sticky-hook">{rescueTitle ? `${rescueTitle}：${word}` : word}</span>
          <span className="camp-sticky-badge">待配邪修</span>
        </div>
        <div className="camp-sticky-story">
          该词条暂未配制定制邪修口诀，可先结合音标切分与艾宾浩斯节点反复提取。
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {resolved ? (
        <div className="camp-sticky-box">
          <div className="camp-sticky-head">
            <span className="camp-sticky-hook">
              {rescueTitle ? `${rescueTitle}：${resolved.hook}` : resolved.hook}
            </span>
            <span className="camp-sticky-badge">{resolved.tag}</span>
          </div>
          <div className="camp-sticky-story">{resolved.story}</div>
          {!compact && resolved.chunks && resolved.chunks.length > 0 && (
            <div className="camp-chunks">
              {resolved.chunks.slice(0, 4).map(([en, zh], idx) => (
                <span className="camp-chunk" key={`${en}-${idx}`}>
                  {en} → {zh}
                </span>
              ))}
            </div>
          )}
          {resolved.trap && (
            <div className="camp-sticky-trap">避坑提醒：{resolved.trap}</div>
          )}
        </div>
      ) : (
        <div className="camp-sticky-box">
          <div className="camp-sticky-head">
            <span className="camp-sticky-hook">{word}</span>
            <span className="camp-sticky-badge">待配邪修</span>
          </div>
        </div>
      )}

      {!compact && studentAlternatives.length > 0 && (
        <div className="camp-def-box" style={{ fontSize: 12, padding: '6px 8px' }}>
          <div style={{ fontWeight: 800, marginBottom: 2 }}>
            ✍️ 同学版 · {studentAlternatives[0].authorNickname}
          </div>
          <div>
            <strong>{studentAlternatives[0].mnemonic.hook}</strong>（{studentAlternatives[0].mnemonic.tag}）
          </div>
          <div style={{ color: 'var(--color-text-muted)' }}>{studentAlternatives[0].mnemonic.story}</div>
        </div>
      )}
    </div>
  )
}

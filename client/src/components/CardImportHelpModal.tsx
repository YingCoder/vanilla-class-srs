import { useState } from 'react'
import { Modal } from './Modal'

const SAMPLE_CSV = `word,meaning_zh,unit,phonetic,pos,example_en,example_zh,category,difficulty,variants
engine,发动机,Unit 01,,n.,The engine is running.,发动机正在运转。,汽修,1,
color,颜色,Unit 03,,n.,My favorite color is blue.,我最喜欢的颜色是蓝色。,公共,1,colour
`

const LLM_PROMPT = `I need to generate a CSV file (template file attached) for a word list. The word list is below. Add each word to its own row in the CSV with: meaning_zh (clear Chinese meaning), pos (part of speech), example_en (an English example sentence), example_zh (its Chinese translation), and variants (other accepted spellings separated by |, or blank). Keep the unit/category/difficulty columns as provided or blank.

My word list:

ant
bug
crab
etc.`

interface Props {
  onClose: () => void
}

export function CardImportHelpModal({ onClose }: Props) {
  const [copied, setCopied] = useState(false)

  const handleDownload = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'vanilla-cards-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(LLM_PROMPT).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Modal title="How do I add a word list?" onClose={onClose}>
      <div style={{ maxWidth: 560, overflowY: 'auto', maxHeight: '70vh' }}>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
          Add a set of cards (in Vanilla Class SRS this is called a CardSet) by uploading a CSV
          file with all of the word data. Download the sample CSV below to see what data goes in
          the CSV. Then create your word list and use your LLM of choice (ChatGPT, Gemini, Claude,
          Deepseek all work fine) to fill out all the fields in your CSV for your word list. You
          can use the prompt below. After you get your CSV you can still edit it as needed, then
          upload the CSV file here to import your words.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16, color: 'var(--color-text-muted)' }}>
          支持 UTF-8 与 Excel 默认导出的 GBK（含 BOM）编码；表头可用 <code>meaning_zh</code>，
          也兼容旧的 <code>definition_l1</code>。<code>variants</code> 用 <code>|</code> 分隔可接受的其他拼写。
        </p>

        <div style={{ marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={handleDownload} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 12l-4-4h2.5V2h3v6H12L8 12z"/>
              <path d="M2 14h12v-2H2v2z"/>
            </svg>
            Download sample CSV
          </button>
        </div>

        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>LLM prompt</div>
        <div style={{ position: 'relative' }}>
          <pre style={{
            background: 'var(--color-pistachio, #f4f7f4)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '12px 40px 12px 12px',
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            color: 'var(--color-text)',
          }}>
            {LLM_PROMPT}
          </pre>
          <button
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy prompt'}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: copied ? 'var(--color-accent-alt, #2ecc71)' : 'var(--color-surface, #fff)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: '3px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: copied ? '#fff' : 'var(--color-text-muted)',
              transition: 'all 0.15s',
            }}
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.5 2.5l-7 7-3-3-1.5 1.5 4.5 4.5 8.5-8.5z"/>
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 4h8v10H4V4zm1 1v8h6V5H5zM6 2h7v9h-1V3H6V2z"/>
                </svg>
                Copy
              </>
            )}
          </button>
        </div>

        <div style={{ marginTop: 20 }} className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  )
}

import { describe, it, expect } from 'vitest'
import { escapeCsvCell, toCsv } from '../lib/csv'

describe('escapeCsvCell', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('defuses formula injection from all spreadsheet trigger characters', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1")
    expect(escapeCsvCell('+1')).toBe("'+1")
    expect(escapeCsvCell('-1')).toBe("'-1")
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeCsvCell('\tcmd')).toBe("'\tcmd")
  })

  it('quotes a formula value that also contains a comma', () => {
    expect(escapeCsvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"')
  })

  it('keeps normal Chinese and empty cells intact', () => {
    expect(escapeCsvCell('颜色')).toBe('颜色')
    expect(escapeCsvCell('')).toBe('')
    expect(escapeCsvCell(null)).toBe('')
  })
})

describe('toCsv', () => {
  it('adds a UTF-8 BOM and CRLF rows', () => {
    const csv = toCsv(['word', 'meaning'], [['color', '颜色']])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toBe('\uFEFFword,meaning\r\ncolor,颜色\r\n')
  })
})
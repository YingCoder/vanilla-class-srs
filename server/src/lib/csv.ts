/**
 * Decode an uploaded CSV: UTF-8/BOM first, then GBK for Excel-exported files.
 * Shared by card import and student-roster import so both paths behave alike.
 */
export function decodeCsvBuffer(buffer: Buffer): { text: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buffer.subarray(3)), encoding: 'utf-8-bom' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'utf-16le' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'utf-16be' }
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' }
  }
}

/**
 * CSV output helpers for downloaded student/teacher files.
 *
 * Excel/LibreOffice and Google Sheets evaluate a cell as a formula when it
 * starts with `=`, `+`, `-` or `@` (and some control characters). A student can
 * type those into a card or example sentence, so exports must prefix the value
 * with an apostrophe to keep it text. The leading UTF-8 BOM makes Chinese open
 * correctly in Excel on Windows.
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/

/** Escape one already-stringified CSV cell, defusing formula injection. */
export function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''

  const text = FORMULA_PREFIX.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/** Join a header and rows into a BOM-prefixed CSV document. */
export function toCsv(header: string[], rows: (string | null | undefined)[][]): string {
  return '\uFEFF' + [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n'
}
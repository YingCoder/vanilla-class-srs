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
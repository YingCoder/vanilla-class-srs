/**
 * Card validation and CSV import — applied consistently at CSV import and API
 * endpoints (spec §8, §6.1). At least one definition (L1 or L2) is required.
 *
 * Import encoding: teachers export from Excel on Chinese Windows, which commonly
 * produces GBK/GB2312 rather than UTF-8. The parser decodes UTF-8 (with or
 * without BOM) first, then falls back to GBK; it never guesses in the client.
 */

import { parse } from 'csv-parse/sync'
import { decodeCsvBuffer } from '../lib/csv'

export interface CardRowInput {
  word: string
  pos?: string
  definition_l2?: string
  definition_l1?: string
  example_sentence?: string
  variants?: string
}

export interface CardRowError {
  row: number
  word?: string
  error: string
}

export interface CardRowErrorWithCode extends CardRowError {
  code?: 'invalid_encoding' | 'empty'
}

const HEADER_ALIASES: Record<string, string> = {
  // native-language definition
  definition_l1: 'definition_l1',
  meaning_zh: 'definition_l1',
  meaning: 'definition_l1',
  // target-language definition
  definition_l2: 'definition_l2',
  definition_en: 'definition_l2',
  english_definition: 'definition_l2',
  // example
  example_sentence: 'example_sentence',
  example_en: 'example_sentence',
  example: 'example_sentence',
  // part of speech
  pos: 'pos',
  part_of_speech: 'pos',
  // alternative spellings
  variants: 'variants',
  variant: 'variants',
  alt_spellings: 'variants',
}

/** Decode an uploaded CSV: UTF-8/BOM first, then GBK for Excel-exported files. */
export { decodeCsvBuffer } from '../lib/csv'

/**
 * Parse a card CSV and map spec/legacy headers onto the internal column names.
 * Throws on malformed CSV; returns an empty array for a header-only file.
 */
export function parseCardCsvBuffer(buffer: Buffer): { rows: Record<string, string>[]; encoding: string } {
  const { text, encoding } = decodeCsvBuffer(buffer)
  const raw = parse(text, {
    columns: (header: string[]) => header.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[]

  return { rows: raw, encoding }
}

/**
 * Validate a batch of card rows.
 * Returns an array of errors (empty = all valid).
 * Per spec §15: partial imports rejected — all rows must pass before any DB write.
 */
export function validateCardRows(rows: unknown[]): CardRowError[] {
  const errors: CardRowError[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, string>
    if (!r.word?.trim()) {
      errors.push({ row: i + 1, error: 'word is required' })
      continue
    }
    if (!r.definition_l2?.trim() && !r.definition_l1?.trim()) {
      errors.push({
        row: i + 1,
        word: r.word,
        error: 'At least one definition (L1 or L2) is required.',
      })
    }
  }
  return errors
}

/** Split `colour|color` into a clean, de-duplicated list without the headword itself. */
export function parseVariants(word: string, value: string | undefined): string[] {
  if (!value) return []
  const head = word.trim().toLowerCase()
  const seen = new Set<string>()
  return value
    .split('|')
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false
      const key = part.toLowerCase()
      if (key === head || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Normalise a validated CSV row into the shape Prisma expects.
 */
export function normaliseCardRow(r: Record<string, string>) {
  const word = r.word.trim()
  return {
    word,
    pos: r.pos?.trim() || null,
    definitionL2: r.definition_l2?.trim() || null,
    definitionL1: r.definition_l1?.trim() || null,
    exampleSentence: r.example_sentence?.trim() || null,
    variants: parseVariants(word, r.variants),
  }
}

/** Case-insensitive match key: word + part of speech. Distinct POS (e.g. "bank" noun vs. verb) is not a duplicate. */
export function cardDedupeKey(word: string, pos: string | null): string {
  return `${word.trim().toLowerCase()}::${(pos ?? '').trim().toLowerCase()}`
}

export interface SkippedDuplicate {
  row: number
  word: string
}

/**
 * Splits normalised rows into ones to insert vs. ones skipped as duplicates —
 * either of an existing card in the set, or of an earlier row in the same import.
 */
export function partitionDuplicateRows<T extends { word: string; pos: string | null }>(
  rows: T[],
  existingKeys: Set<string>,
): { toInsert: T[]; skipped: SkippedDuplicate[] } {
  const seen = new Set(existingKeys)
  const toInsert: T[] = []
  const skipped: SkippedDuplicate[] = []

  rows.forEach((row, i) => {
    const key = cardDedupeKey(row.word, row.pos)
    if (seen.has(key)) {
      skipped.push({ row: i + 1, word: row.word })
      return
    }
    seen.add(key)
    toInsert.push(row)
  })

  return { toInsert, skipped }
}
import { describe, it, expect } from 'vitest'
import { editDistance, judgeSpelling, normalizeSpelling } from '../services/spelling.service'

describe('normalizeSpelling', () => {
  it('trims, lowercases and collapses internal whitespace', () => {
    expect(normalizeSpelling('  Ice   Cream  ')).toBe('ice cream')
  })
})

describe('editDistance', () => {
  it('counts one missing, extra or substituted character', () => {
    expect(editDistance('color', 'colour')).toBe(1)
    expect(editDistance('clor', 'color')).toBe(1)
    expect(editDistance('color', 'color')).toBe(0)
    expect(editDistance('', 'abc')).toBe(3)
  })
})

describe('judgeSpelling', () => {
  it('accepts the headword with case/space tolerance', () => {
    expect(judgeSpelling(' Ice  Cream ', 'ice cream')).toBe('correct')
  })

  it('accepts teacher-configured variants', () => {
    expect(judgeSpelling('colour', 'color', ['colour'])).toBe('correct')
    expect(judgeSpelling('COLOR', 'color', ['colour'])).toBe('correct')
  })

  it('reports a single-character difference as close, not correct', () => {
    expect(judgeSpelling('colr', 'color')).toBe('close')
    expect(judgeSpelling('colourrr', 'color', ['colour'])).toBe('wrong')
  })

  it('rejects empty and unrelated answers', () => {
    expect(judgeSpelling('', 'color')).toBe('wrong')
    expect(judgeSpelling('banana', 'color')).toBe('wrong')
  })
})
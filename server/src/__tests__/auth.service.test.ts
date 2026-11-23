import { describe, it, expect } from 'vitest'
import {
  generateTempPassword,
  normalizeUsername,
  isValidUsername,
  suggestUsername,
} from '../services/auth.service'
import { PASSWORD_WORDS } from '../data/passwordWords'

describe('username identity', () => {
  it('normalises case and surrounding whitespace', () => {
    expect(normalizeUsername('  Zhang_San01 ')).toBe('zhang_san01')
  })

  it('accepts 3-32 characters of letters, digits and underscore', () => {
    expect(isValidUsername('abc')).toBe(true)
    expect(isValidUsername('student_2026')).toBe(true)
    expect(isValidUsername('a')).toBe(false)
    expect(isValidUsername('with space')).toBe(false)
    expect(isValidUsername('a'.repeat(33))).toBe(false)
  })

  it('derives a readable candidate from an email local part', () => {
    expect(suggestUsername('Zhang San', 'Zhang.San@school.edu')).toBe('zhang_san')
  })

  it('falls back to a safe candidate for CJK names without an email', () => {
    const generated = suggestUsername('张三')
    expect(generated.startsWith('user_')).toBe(true)
    expect(isValidUsername(generated)).toBe(true)
  })
})

describe('generateTempPassword', () => {
  it('produces three lowercase words from the word list plus a two-digit number, hyphen-joined', () => {
    const password = generateTempPassword()
    const parts = password.split('-')
    expect(parts).toHaveLength(4)
    for (const word of parts.slice(0, 3)) {
      expect(PASSWORD_WORDS).toContain(word)
    }
    expect(parts[3]).toMatch(/^\d{2}$/)
  })

  it('is not derived from any input — every call is independent', () => {
    // No teacher name, no date: the whole point of C1 is that nothing
    // guessable feeds into this anymore.
    expect(generateTempPassword.length).toBe(0)
  })

  it('generates distinct passwords across many calls', () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generateTempPassword()))
    // With ~209 words^3 * 100 combinations, 200 draws colliding would be
    // astronomically unlikely — this just guards against a broken RNG that
    // always returns the same value.
    expect(passwords.size).toBeGreaterThan(190)
  })
})

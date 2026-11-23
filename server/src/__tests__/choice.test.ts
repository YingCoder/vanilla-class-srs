import { describe, it, expect } from 'vitest'
import { buildChoiceOptions } from '../services/choice.service'

describe('buildChoiceOptions', () => {
  it('includes the correct meaning and fills to four unique options', () => {
    const options = buildChoiceOptions('颜色', ['形状', '味道', '大小'], 'seed-1')
    expect(options).toHaveLength(4)
    expect(options).toContain('颜色')
    expect(new Set(options).size).toBe(4)
  })

  it('deduplicates candidates that normalize to the correct answer', () => {
    const options = buildChoiceOptions('Color', ['color', '颜色', '形状'], 'seed-2')
    expect(options.filter((option) => option.toLowerCase() === 'color')).toHaveLength(1)
    expect(options).toContain('颜色')
  })

  it('is deterministic for the same seed and question', () => {
    const first = buildChoiceOptions('颜色', ['形状', '味道', '大小', '重量'], 'same')
    const second = buildChoiceOptions('颜色', ['大小', '形状', '重量', '味道'], 'same')
    expect(first).toEqual(second)
  })

  it('pads a tiny deck so the screen still has four choices', () => {
    const options = buildChoiceOptions('颜色', [], 'seed-3')
    expect(options).toHaveLength(4)
    expect(options[0]).toBeDefined()
  })
})
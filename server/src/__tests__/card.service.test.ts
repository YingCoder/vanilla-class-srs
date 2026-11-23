import { describe, it, expect } from 'vitest'
import { parseCardCsvBuffer, normaliseCardRow, parseVariants, validateCardRows } from '../services/card.service'

describe('parseCardCsvBuffer', () => {
  it('reads a UTF-8 BOM file and maps spec headers to internal columns', () => {
    const csv = '\ufeffword,meaning_zh,example_en,variants\ncolor,颜色,My favorite color.,colour|color\n'
    const { rows, encoding } = parseCardCsvBuffer(Buffer.from(csv, 'utf8'))

    expect(encoding).toBe('utf-8-bom')
    expect(rows).toHaveLength(1)
    expect(rows[0].word).toBe('color')
    expect(rows[0].definition_l1).toBe('颜色')
    expect(rows[0].example_sentence).toBe('My favorite color.')
    expect(rows[0].variants).toBe('colour|color')
  })

  it('decodes GBK exported by Chinese Excel', () => {
    const head = Buffer.from('word,meaning_zh\ncolor,', 'ascii')
    const chinese = Buffer.from([0xd6, 0xd0]) // 中 in GBK
    const { rows, encoding } = parseCardCsvBuffer(Buffer.concat([head, chinese, Buffer.from('\n', 'ascii')]))

    expect(encoding).toBe('gbk')
    expect(rows[0].definition_l1).toBe('中')
  })

  it('rejects malformed CSV', () => {
    expect(() => parseCardCsvBuffer(Buffer.from('word,meaning_zh\n"unterminated,中文', 'utf8'))).toThrow()
  })
})

describe('parseVariants', () => {
  it('splits on pipes, trims, ignores blanks/headword/duplicates', () => {
    expect(parseVariants('color', ' colour | Color |  | red|colour ')).toEqual(['colour', 'red'])
    expect(parseVariants('color', undefined)).toEqual([])
  })
})

describe('normaliseCardRow', () => {
  it('includes variants and nulls empty optional fields', () => {
    const row = normaliseCardRow({
      word: ' color ',
      definition_l1: '颜色',
      variants: 'colour|color',
    })
    expect(row).toEqual({
      word: 'color',
      pos: null,
      definitionL2: null,
      definitionL1: '颜色',
      exampleSentence: null,
      variants: ['colour'],
    })
  })

  it('still requires a word and at least one definition', () => {
    expect(validateCardRows([{ word: 'color' }])).toHaveLength(1)
    expect(validateCardRows([{ word: '', definition_l1: '颜色' }])).toHaveLength(1)
    expect(validateCardRows([{ word: 'color', definition_l1: '颜色' }])).toHaveLength(0)
  })
})
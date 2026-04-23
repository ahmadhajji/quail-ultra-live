import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildNodeIndex,
  mergeAdjacent,
  offsetsFromRange,
  pointFromOffset,
  rangeFromOffsets,
  trimWhitespaceOffsets
} from './serialize'

function container(html: string): HTMLElement {
  const element = document.createElement('div')
  element.innerHTML = html
  document.body.appendChild(element)
  return element
}

describe('buildNodeIndex', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns empty entries for empty container', () => {
    const el = container('')
    const index = buildNodeIndex(el)
    expect(index.entries).toEqual([])
    expect(index.text).toBe('')
  })

  it('indexes a single text node', () => {
    const el = container('hello world')
    const index = buildNodeIndex(el)
    expect(index.text).toBe('hello world')
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]!.start).toBe(0)
    expect(index.entries[0]!.end).toBe(11)
  })

  it('walks inline elements in document order', () => {
    const el = container('one <em>two</em> three')
    const index = buildNodeIndex(el)
    expect(index.text).toBe('one two three')
    expect(index.entries).toHaveLength(3)
    expect(index.entries[0]!.end).toBe(4)
    expect(index.entries[1]!.start).toBe(4)
    expect(index.entries[1]!.end).toBe(7)
    expect(index.entries[2]!.start).toBe(7)
  })

  it('skips non-text nodes (images, <br>)', () => {
    const el = container('before <br><img src="x" alt="">after')
    const index = buildNodeIndex(el)
    expect(index.text).toBe('before after')
    expect(index.entries).toHaveLength(2)
  })

  it('preserves leading and trailing whitespace', () => {
    const el = container('\n  leading')
    const index = buildNodeIndex(el)
    expect(index.text).toBe('\n  leading')
    expect(index.entries[0]!.start).toBe(0)
  })
})

describe('rangeFromOffsets / offsetsFromRange round-trip', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('round-trips a mid-sentence selection', () => {
    const el = container('The quick brown fox jumps')
    const index = buildNodeIndex(el)
    const range = rangeFromOffsets(index, 4, 15)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('quick brown')
    expect(offsetsFromRange(index, range!)).toEqual({ start: 4, end: 15 })
  })

  it('round-trips a selection crossing inline tags', () => {
    const el = container('aaa <em>bbb</em> ccc')
    const index = buildNodeIndex(el)
    // "aa bb" — covers part of each text node.
    const range = rangeFromOffsets(index, 1, 6)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('aa bb')
    expect(offsetsFromRange(index, range!)).toEqual({ start: 1, end: 6 })
  })

  it('round-trips a selection spanning <br>', () => {
    const el = container('top<br>bottom')
    const index = buildNodeIndex(el)
    const range = rangeFromOffsets(index, 0, 9)
    expect(range).not.toBeNull()
    // <br> has no text content; the selection covers both sides.
    expect(offsetsFromRange(index, range!)).toEqual({ start: 0, end: 9 })
  })

  it('returns null for zero-width ranges', () => {
    const el = container('text')
    const index = buildNodeIndex(el)
    expect(rangeFromOffsets(index, 2, 2)).toBeNull()
  })

  it('clamps out-of-bounds offsets', () => {
    const el = container('abc')
    const index = buildNodeIndex(el)
    const range = rangeFromOffsets(index, -10, 100)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('abc')
  })
})

describe('pointFromOffset', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('maps offset to correct text node + local offset', () => {
    const el = container('abc <em>def</em>ghi')
    const index = buildNodeIndex(el)
    const point = pointFromOffset(index, 5)
    expect(point).not.toBeNull()
    expect(point!.node.data).toBe('def')
    expect(point!.localOffset).toBe(1)
  })

  it('returns null for empty index', () => {
    const el = container('')
    const index = buildNodeIndex(el)
    expect(pointFromOffset(index, 0)).toBeNull()
  })
})

describe('offsetsFromRange for element-typed endpoints (Safari quirk)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('resolves element start to first text descendant', () => {
    const el = container('<p>alpha</p><p>beta</p>')
    const index = buildNodeIndex(el)
    const range = document.createRange()
    // Start at the second <p> as an element endpoint.
    const secondP = el.children[1]!
    range.setStart(secondP, 0)
    range.setEnd(index.entries[1]!.node, 4)
    expect(offsetsFromRange(index, range)).toEqual({ start: 5, end: 9 })
  })
})

describe('trimWhitespaceOffsets', () => {
  it('returns original range when no whitespace at edges', () => {
    expect(trimWhitespaceOffsets('hello world', 0, 5)).toEqual({ start: 0, end: 5 })
  })

  it('trims trailing spaces', () => {
    expect(trimWhitespaceOffsets('hello   ', 0, 8)).toEqual({ start: 0, end: 5 })
  })

  it('trims leading spaces', () => {
    expect(trimWhitespaceOffsets('   world', 0, 8)).toEqual({ start: 3, end: 8 })
  })

  it('trims cross-block newline + indent (the phantom-wing case)', () => {
    // textContent between two <p> elements looks like "first\n  second".
    // A selection ending right after "first" that extended to the next line
    // picks up "\n  " which paints as a wing on the CSS Highlights API.
    const text = 'first\n  second'
    expect(trimWhitespaceOffsets(text, 0, 8)).toEqual({ start: 0, end: 5 })
  })

  it('trims non-breaking and Unicode spaces', () => {
    //   NBSP,   thin space,   narrow NBSP.
    const text = '  word '
    expect(trimWhitespaceOffsets(text, 0, text.length)).toEqual({ start: 2, end: 6 })
  })

  it('returns null for all-whitespace range', () => {
    expect(trimWhitespaceOffsets('   \n\t  ', 0, 7)).toBeNull()
  })

  it('returns null for empty range', () => {
    expect(trimWhitespaceOffsets('anything', 3, 3)).toBeNull()
  })

  it('clamps inputs outside the string bounds', () => {
    expect(trimWhitespaceOffsets('abc', -5, 100)).toEqual({ start: 0, end: 3 })
  })
})

describe('mergeAdjacent', () => {
  it('returns empty for empty input', () => {
    expect(mergeAdjacent([])).toEqual([])
  })

  it('merges touching ranges', () => {
    expect(mergeAdjacent([
      { start: 0, end: 5 },
      { start: 5, end: 10 }
    ])).toEqual([{ start: 0, end: 10 }])
  })

  it('merges overlapping ranges', () => {
    expect(mergeAdjacent([
      { start: 0, end: 7 },
      { start: 3, end: 10 }
    ])).toEqual([{ start: 0, end: 10 }])
  })

  it('keeps disjoint ranges', () => {
    expect(mergeAdjacent([
      { start: 0, end: 3 },
      { start: 10, end: 15 }
    ])).toEqual([
      { start: 0, end: 3 },
      { start: 10, end: 15 }
    ])
  })

  it('handles unsorted input and drops zero-length ranges', () => {
    expect(mergeAdjacent([
      { start: 10, end: 15 },
      { start: 7, end: 7 },
      { start: 0, end: 3 }
    ])).toEqual([
      { start: 0, end: 3 },
      { start: 10, end: 15 }
    ])
  })
})

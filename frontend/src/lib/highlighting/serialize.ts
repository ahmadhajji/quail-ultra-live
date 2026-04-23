/**
 * Serialization primitives for the highlight engine.
 *
 * Highlights are persisted as character offsets (start, end) into
 * `container.textContent`. Because the question/explanation HTML files are
 * immutable per question id, textContent offsets are stable across reopens,
 * navigations, and React re-renders of the outer component. The Range API
 * provides the DOM-level precision — we convert offsets <-> Range via a
 * TreeWalker pass that enumerates all text descendants in document order.
 */

export interface NodeIndexEntry {
  node: Text
  start: number
  end: number
}

export interface NodeIndex {
  readonly container: HTMLElement
  readonly text: string
  readonly entries: NodeIndexEntry[]
  /** O(1) lookup from a Text node to its index entry. */
  readonly byNode: ReadonlyMap<Text, NodeIndexEntry>
}

/**
 * Walk every text-node descendant of `container` in document order,
 * recording its (start, end) character range in the container's textContent.
 */
export function buildNodeIndex(container: HTMLElement): NodeIndex {
  if (typeof document === 'undefined') {
    return { container, text: '', entries: [], byNode: new Map() }
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const entries: NodeIndexEntry[] = []
  const byNode = new Map<Text, NodeIndexEntry>()
  let cursor = 0
  let current = walker.nextNode()
  const parts: string[] = []
  while (current) {
    const textNode = current as Text
    const length = textNode.data.length
    const entry: NodeIndexEntry = { node: textNode, start: cursor, end: cursor + length }
    entries.push(entry)
    byNode.set(textNode, entry)
    parts.push(textNode.data)
    cursor += length
    current = walker.nextNode()
  }
  return { container, text: parts.join(''), entries, byNode }
}

/** Binary-search the entries for the one containing `offset`. */
function findEntryContaining(index: NodeIndex, offset: number): NodeIndexEntry | null {
  const { entries } = index
  if (entries.length === 0) {
    return null
  }
  if (offset <= entries[0]!.start) {
    return entries[0]!
  }
  if (offset >= entries[entries.length - 1]!.end) {
    return entries[entries.length - 1]!
  }
  let lo = 0
  let hi = entries.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const entry = entries[mid]!
    if (offset < entry.start) {
      hi = mid - 1
    } else if (offset >= entry.end) {
      lo = mid + 1
    } else {
      return entry
    }
  }
  return entries[Math.min(lo, entries.length - 1)] ?? null
}

/**
 * Translate a character offset into the container's textContent into a
 * (text-node, localOffset) pair that `range.setStart/setEnd` can consume.
 */
export function pointFromOffset(index: NodeIndex, offset: number): { node: Text; localOffset: number } | null {
  const entry = findEntryContaining(index, offset)
  if (!entry) {
    return null
  }
  const clamped = Math.max(entry.start, Math.min(entry.end, offset))
  return { node: entry.node, localOffset: clamped - entry.start }
}

/** Build a Range spanning [start, end) in the indexed container. */
export function rangeFromOffsets(index: NodeIndex, start: number, end: number): Range | null {
  if (typeof document === 'undefined' || index.entries.length === 0) {
    return null
  }
  const clampedStart = Math.max(0, Math.min(index.text.length, start))
  const clampedEnd = Math.max(clampedStart, Math.min(index.text.length, end))
  if (clampedEnd <= clampedStart) {
    return null
  }
  const startPoint = pointFromOffset(index, clampedStart)
  const endPoint = pointFromOffset(index, clampedEnd)
  if (!startPoint || !endPoint) {
    return null
  }
  const range = document.createRange()
  try {
    range.setStart(startPoint.node, startPoint.localOffset)
    range.setEnd(endPoint.node, endPoint.localOffset)
  } catch {
    return null
  }
  return range
}

/**
 * Resolve a DOM point (which may target an Element rather than a Text node,
 * as happens in some Safari selection normalizations) to the nearest
 * character offset in our textContent.
 */
export function offsetFromPoint(index: NodeIndex, node: Node, localOffset: number, which: 'start' | 'end'): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text
    const match = index.byNode.get(text)
    if (match) {
      const clamped = Math.max(0, Math.min(text.data.length, localOffset))
      return match.start + clamped
    }
    return null
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null
  }
  const element = node as Element
  const children = Array.from(element.childNodes)
  const hasBoundary = localOffset >= 0 && localOffset <= children.length
  if (!hasBoundary) {
    return null
  }
  // If the selection endpoint lands on an Element, pick the nearest text-node descendant.
  // For 'start' we want the first text inside the child at `localOffset` (or the end of
  // the previous child for boundary clamping). For 'end' we want the end of the last
  // text inside the child immediately before `localOffset`.
  if (which === 'start') {
    for (let i = localOffset; i < children.length; i += 1) {
      const first = firstTextDescendant(children[i]!, index)
      if (first) {
        return first.start
      }
    }
    // Fall back: end of container.
    return index.text.length
  }
  // which === 'end'
  for (let i = localOffset - 1; i >= 0; i -= 1) {
    const last = lastTextDescendant(children[i]!, index)
    if (last) {
      return last.end
    }
  }
  return 0
}

function firstTextDescendant(root: Node, index: NodeIndex): NodeIndexEntry | null {
  if (root.nodeType === Node.TEXT_NODE) {
    return index.byNode.get(root as Text) ?? null
  }
  // The entries are in document order, so the first match is the right one.
  for (const entry of index.entries) {
    if (root.contains(entry.node)) {
      return entry
    }
  }
  return null
}

function lastTextDescendant(root: Node, index: NodeIndex): NodeIndexEntry | null {
  if (root.nodeType === Node.TEXT_NODE) {
    return index.byNode.get(root as Text) ?? null
  }
  let last: NodeIndexEntry | null = null
  for (const entry of index.entries) {
    if (root.contains(entry.node)) {
      last = entry
    }
  }
  return last
}

/** Convert a Range within the container to [start, end) offsets. Returns null if range is unusable. */
export function offsetsFromRange(index: NodeIndex, range: Range): { start: number; end: number } | null {
  const start = offsetFromPoint(index, range.startContainer, range.startOffset, 'start')
  const end = offsetFromPoint(index, range.endContainer, range.endOffset, 'end')
  if (start === null || end === null) {
    return null
  }
  if (end <= start) {
    return null
  }
  return { start, end }
}

/** Merge overlapping/adjacent ranges of the SAME color for a tidy CSS registry. */
export function mergeAdjacent(
  entries: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (entries.length === 0) {
    return []
  }
  const sorted = entries
    .map((entry) => ({ start: entry.start, end: entry.end }))
    .filter((entry) => entry.end > entry.start)
    .sort((a, b) => a.start - b.start)
  if (sorted.length === 0) {
    return []
  }
  const result: Array<{ start: number; end: number }> = []
  let current = sorted[0]!
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!
    if (next.start <= current.end) {
      current = { start: current.start, end: Math.max(current.end, next.end) }
    } else {
      result.push(current)
      current = next
    }
  }
  result.push(current)
  return result
}

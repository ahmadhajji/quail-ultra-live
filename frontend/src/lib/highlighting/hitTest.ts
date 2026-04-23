import type { SerializedHighlight } from './types'
import { offsetFromPoint, type NodeIndex } from './serialize'

interface CaretPositionLike {
  offsetNode: Node
  offset: number
}

function pointFromViewport(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => CaretPositionLike | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caret = doc.caretPositionFromPoint?.(x, y)
  if (caret) {
    return { node: caret.offsetNode, offset: caret.offset }
  }
  const range = doc.caretRangeFromPoint?.(x, y)
  if (range) {
    return { node: range.startContainer, offset: range.startOffset }
  }
  return null
}

function findAtOffset(highlights: SerializedHighlight[], offset: number): SerializedHighlight | null {
  return highlights.find((highlight) => offset >= highlight.start && offset < highlight.end) ?? null
}

export function hitTestHighlight(index: NodeIndex, highlights: SerializedHighlight[], x: number, y: number): SerializedHighlight | null {
  if (typeof document === 'undefined') {
    return null
  }
  const point = pointFromViewport(x, y)
  if (!point) {
    return null
  }
  const offset = offsetFromPoint(index, point.node, point.offset, 'start')
  if (offset === null) {
    return null
  }
  return findAtOffset(highlights, offset) ?? findAtOffset(highlights, Math.max(0, offset - 1))
}

import { clearTarget, setRangesFor } from './cssRegistry'
import { hitTestHighlight } from './hitTest'
import { buildNodeIndex, mergeAdjacent, offsetsFromRange, rangeFromOffsets, type NodeIndex } from './serialize'
import { HIGHLIGHT_COLORS, makeHighlightId, type HighlightColor, type SerializedHighlight, type Target } from './types'

interface HighlightEngineOptions {
  container: HTMLElement
  target: Target
  initial: SerializedHighlight[]
  getActiveColor: () => HighlightColor | null
  isEnabled: () => boolean
  onChange: (entries: SerializedHighlight[]) => void
}

export class HighlightEngine {
  private readonly container: HTMLElement
  private readonly target: Target
  private readonly getActiveColor: () => HighlightColor | null
  private readonly isEnabled: () => boolean
  private readonly onChange: (entries: SerializedHighlight[]) => void
  private index: NodeIndex
  private highlights: SerializedHighlight[]
  private destroyed = false
  private suppressClickUntil = 0
  private rendering = false
  private readonly observer: MutationObserver

  constructor(options: HighlightEngineOptions) {
    this.container = options.container
    this.target = options.target
    this.getActiveColor = options.getActiveColor
    this.isEnabled = options.isEnabled
    this.onChange = options.onChange
    this.index = buildNodeIndex(this.container)
    this.highlights = sanitizeHighlights(options.initial, this.index.text.length)
    this.observer = new MutationObserver(() => {
      if (!this.rendering && !this.destroyed && this.highlights.length > 0) {
        this.renderAfterReactCommit()
      }
    })
    this.observer.observe(this.container, { childList: true, subtree: true })
    this.render()
    document.addEventListener('mouseup', this.onSelectionFinalized)
    document.addEventListener('touchend', this.onSelectionFinalized)
    document.addEventListener('keyup', this.onSelectionFinalized)
    this.container.addEventListener('click', this.onClick)
  }

  setEntries(entries: SerializedHighlight[]): void {
    this.index = buildNodeIndex(this.container)
    this.highlights = sanitizeHighlights(entries, this.index.text.length)
    this.render()
  }

  clearAll(): void {
    if (this.highlights.length === 0) {
      return
    }
    this.highlights = []
    this.render()
    this.onChange([])
    this.renderAfterReactCommit()
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    document.removeEventListener('mouseup', this.onSelectionFinalized)
    document.removeEventListener('touchend', this.onSelectionFinalized)
    document.removeEventListener('keyup', this.onSelectionFinalized)
    this.container.removeEventListener('click', this.onClick)
    this.observer.disconnect()
    clearRenderedHighlights(this.container)
    clearTarget(this.target)
  }

  private readonly onSelectionFinalized = () => {
    window.setTimeout(() => this.finalizeSelection(), 0)
  }

  private finalizeSelection(): void {
    if (this.destroyed || !this.isEnabled()) {
      return
    }
    const color = this.getActiveColor()
    if (!color) {
      return
    }
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return
    }
    const range = selection.getRangeAt(0)
    if (!this.containsNode(range.commonAncestorContainer)) {
      return
    }
    this.index = buildNodeIndex(this.container)
    const offsets = offsetsFromRange(this.index, range)
    selection.removeAllRanges()
    if (!offsets) {
      return
    }
    const next = sanitizeHighlights([
      ...this.highlights,
      {
        id: makeHighlightId(),
        start: offsets.start,
        end: offsets.end,
        color
      }
    ], this.index.text.length)
    this.highlights = next
    this.suppressClickUntil = Date.now() + 250
    this.render()
    this.onChange(this.highlights)
    this.renderAfterReactCommit()
  }

  private readonly onClick = (event: MouseEvent) => {
    if (this.destroyed || this.highlights.length === 0) {
      return
    }
    if (Date.now() < this.suppressClickUntil) {
      return
    }
    const rendered = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-quail-highlight-rendered="true"]')
      : null
    const renderedId = rendered?.dataset.quailHighlightId
    if (renderedId) {
      this.removeHighlight(renderedId)
      return
    }
    this.index = buildNodeIndex(this.container)
    const hit = hitTestHighlight(this.index, this.highlights, event.clientX, event.clientY)
    if (!hit) {
      return
    }
    this.removeHighlight(hit.id)
  }

  private removeHighlight(id: string): void {
    this.highlights = this.highlights.filter((highlight) => highlight.id !== id)
    this.render()
    this.onChange(this.highlights)
    this.renderAfterReactCommit()
  }

  private containsNode(node: Node): boolean {
    return node === this.container || this.container.contains(node)
  }

  private render(): void {
    this.rendering = true
    try {
      clearRenderedHighlights(this.container)
      this.index = buildNodeIndex(this.container)
      for (const color of HIGHLIGHT_COLORS) {
        const merged = mergeAdjacent(this.highlights.filter((entry) => entry.color === color))
        const ranges = merged
          .map((entry) => rangeFromOffsets(this.index, entry.start, entry.end))
          .filter((range): range is Range => range !== null)
        setRangesFor(this.target, color, ranges)
      }
      renderHighlightSpans(this.container, this.highlights)
      this.index = buildNodeIndex(this.container)
    } finally {
      window.setTimeout(() => {
        this.rendering = false
      }, 0)
    }
  }

  private renderAfterReactCommit(): void {
    for (const delay of [0, 50, 150, 500, 900]) {
      window.setTimeout(() => {
        if (!this.destroyed) {
          this.render()
        }
      }, delay)
    }
  }
}

export function sanitizeHighlights(entries: SerializedHighlight[], maxOffset: number): SerializedHighlight[] {
  const seen = new Set<string>()
  return entries
    .filter((entry) => HIGHLIGHT_COLORS.includes(entry.color))
    .map((entry) => ({
      id: entry.id || makeHighlightId(),
      start: Math.max(0, Math.min(maxOffset, entry.start)),
      end: Math.max(0, Math.min(maxOffset, entry.end)),
      color: entry.color
    }))
    .filter((entry) => entry.end > entry.start)
    .filter((entry) => {
      if (seen.has(entry.id)) {
        return false
      }
      seen.add(entry.id)
      return true
    })
}

function clearRenderedHighlights(container: HTMLElement): void {
  const rendered = Array.from(container.querySelectorAll<HTMLSpanElement>('span[data-quail-highlight-rendered="true"]'))
  for (const span of rendered) {
    const parent = span.parentNode
    if (!parent) {
      continue
    }
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span)
    }
    parent.removeChild(span)
    parent.normalize()
  }
  container.normalize()
}

function renderHighlightSpans(container: HTMLElement, highlights: SerializedHighlight[]): void {
  const ordered = [...highlights].sort((left, right) => {
    const leftPriority = HIGHLIGHT_COLORS.indexOf(left.color)
    const rightPriority = HIGHLIGHT_COLORS.indexOf(right.color)
    return leftPriority - rightPriority
  })

  for (const highlight of ordered) {
    wrapHighlightText(container, highlight)
  }
}

function wrapHighlightText(container: HTMLElement, highlight: SerializedHighlight): void {
  const index = buildNodeIndex(container)
  const pieces = index.entries
    .map((entry, order) => ({
      order,
      node: entry.node,
      start: Math.max(highlight.start, entry.start) - entry.start,
      end: Math.min(highlight.end, entry.end) - entry.start
    }))
    .filter((piece) => piece.end > piece.start)
    .sort((left, right) => right.order - left.order)

  for (const piece of pieces) {
    const text = piece.node.data
    const before = text.slice(0, piece.start)
    const selected = text.slice(piece.start, piece.end)
    const after = text.slice(piece.end)
    const fragment = document.createDocumentFragment()

    if (before) {
      fragment.appendChild(document.createTextNode(before))
    }

    const span = document.createElement('span')
    span.className = `quail-rendered-highlight quail-rendered-highlight-${highlight.color}`
    span.dataset.quailHighlightRendered = 'true'
    span.dataset.quailHighlightId = highlight.id
    span.dataset.quailHighlightColor = highlight.color
    span.textContent = selected
    fragment.appendChild(span)

    if (after) {
      fragment.appendChild(document.createTextNode(after))
    }

    piece.node.replaceWith(fragment)
  }
}

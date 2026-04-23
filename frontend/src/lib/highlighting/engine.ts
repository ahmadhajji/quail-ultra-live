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
  private pendingRaf = 0
  private pendingTimer = 0
  private readonly observer: MutationObserver
  private observerPaused = false

  constructor(options: HighlightEngineOptions) {
    this.container = options.container
    this.target = options.target
    this.getActiveColor = options.getActiveColor
    this.isEnabled = options.isEnabled
    this.onChange = options.onChange
    this.index = buildNodeIndex(this.container)
    this.highlights = sanitizeHighlights(options.initial, this.index.text.length)
    this.observer = new MutationObserver(() => {
      if (!this.observerPaused && !this.destroyed && this.highlights.length > 0) {
        this.scheduleRender()
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
    this.scheduleRender()
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
    if (this.pendingRaf) {
      cancelAnimationFrame(this.pendingRaf)
      this.pendingRaf = 0
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = 0
    }
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
    this.scheduleRender()
  }

  private readonly onClick = (event: MouseEvent) => {
    if (this.destroyed || this.highlights.length === 0) {
      return
    }
    if (Date.now() < this.suppressClickUntil) {
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
    this.scheduleRender()
  }

  private containsNode(node: Node): boolean {
    return node === this.container || this.container.contains(node)
  }

  /**
   * Core render: rebuild the node index once and push ranges into the CSS
   * Custom Highlights registry. No DOM mutation — just Range objects handed
   * to the browser's native highlight painting.
   */
  private render(): void {
    this.observerPaused = true
    try {
      this.index = buildNodeIndex(this.container)
      for (const color of HIGHLIGHT_COLORS) {
        const merged = mergeAdjacent(this.highlights.filter((entry) => entry.color === color))
        const ranges = merged
          .map((entry) => rangeFromOffsets(this.index, entry.start, entry.end))
          .filter((range): range is Range => range !== null)
        setRangesFor(this.target, color, ranges)
      }
    } finally {
      // Keep the observer paused through the current microtask so any
      // pending MutationObserver callbacks (which fire as microtasks) are
      // also suppressed.
      Promise.resolve().then(() => {
        this.observerPaused = false
      })
    }
  }

  /**
   * Schedule a single deferred re-render to catch React commits or other
   * DOM mutations that happen after our synchronous render. Uses
   * requestAnimationFrame for the next paint, plus one 120ms safety net.
   *
   * Replaces the old shotgun approach of 5 setTimeout calls.
   */
  private scheduleRender(): void {
    if (this.pendingRaf) {
      cancelAnimationFrame(this.pendingRaf)
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
    }
    this.pendingRaf = requestAnimationFrame(() => {
      this.pendingRaf = 0
      if (!this.destroyed) {
        this.render()
      }
    })
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = 0
      if (!this.destroyed) {
        this.render()
      }
    }, 120)
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

import { clearTarget, promoteHighlight, setRangesFor } from './cssRegistry'
import { hitTestHighlight } from './hitTest'
import {
  buildNodeIndex,
  mergeAdjacent,
  offsetsFromRange,
  rangeFromOffsets,
  trimWhitespaceOffsets,
  type NodeIndex
} from './serialize'
import { HIGHLIGHT_COLORS, makeHighlightId, type HighlightColor, type SerializedHighlight, type Target } from './types'

interface HighlightEngineOptions {
  container: HTMLElement
  target: Target
  initial: SerializedHighlight[]
  getActiveColor: () => HighlightColor | null
  isEnabled: () => boolean
  onChange: (entries: SerializedHighlight[]) => void
}

/**
 * Captured selection data, resolved synchronously at the moment the browser
 * fires mouseup/touchend/keyup so we never reference a Range after React
 * has had a chance to re-render the container (which invalidates the Range).
 */
interface CapturedSelection {
  start: number
  end: number
  color: HighlightColor
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
  private lastRenderedText: string

  constructor(options: HighlightEngineOptions) {
    this.container = options.container
    this.target = options.target
    this.getActiveColor = options.getActiveColor
    this.isEnabled = options.isEnabled
    this.onChange = options.onChange
    this.index = buildNodeIndex(this.container)
    this.highlights = sanitizeHighlights(options.initial, this.index.text.length)
    this.lastRenderedText = this.index.text
    this.observer = new MutationObserver(() => {
      if (this.observerPaused || this.destroyed || this.highlights.length === 0) {
        return
      }
      // Skip storms of no-op mutations: MathJax typesetting, lazy-loaded
      // images flipping attributes, aria updates, etc. When the container's
      // textContent is unchanged, our offsets still anchor to new text nodes
      // with the same content, so we do need to rebuild ranges — but only
      // once the mutation storm settles. The structural rebuild itself is
      // handled by scheduleRender; the guard here just avoids rebuilding
      // when nothing text-affecting has happened since the last render.
      const currentText = this.container.textContent ?? ''
      if (currentText === this.lastRenderedText) {
        return
      }
      this.scheduleRender()
    })
    this.observer.observe(this.container, { childList: true, subtree: true, characterData: true })
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

  /**
   * Capture selection data synchronously so we have concrete offsets before
   * React can re-render. Commit the highlight asynchronously (setTimeout 0)
   * only to let the browser clear the native selection first.
   */
  private readonly onSelectionFinalized = () => {
    const captured = this.captureSelection()
    if (!captured) {
      return
    }
    window.setTimeout(() => this.commitCapturedHighlight(captured), 0)
  }

  /**
   * Resolve the current browser selection to character offsets right now,
   * while the DOM is guaranteed to still contain the ranges' anchor nodes.
   */
  private captureSelection(): CapturedSelection | null {
    if (this.destroyed || !this.isEnabled()) {
      return null
    }
    const color = this.getActiveColor()
    if (!color) {
      return null
    }
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null
    }
    const range = selection.getRangeAt(0)
    if (!this.containsNode(range.commonAncestorContainer)) {
      return null
    }
    this.index = buildNodeIndex(this.container)
    const offsets = offsetsFromRange(this.index, range)
    if (!offsets) {
      return null
    }
    // Trim whitespace at the edges so the highlight visually ends at the
    // last glyph the user dragged across. Without this the CSS Highlights
    // API paints trailing newlines/indents as a "wing" past the line and
    // leading indent as a bar to the left of the first visible character.
    const trimmed = trimWhitespaceOffsets(this.index.text, offsets.start, offsets.end)
    if (!trimmed) {
      return null
    }
    return { start: trimmed.start, end: trimmed.end, color }
  }

  /**
   * Apply a previously-captured highlight and clear the browser selection.
   */
  private commitCapturedHighlight(captured: CapturedSelection): void {
    if (this.destroyed) {
      return
    }
    window.getSelection()?.removeAllRanges()
    this.index = buildNodeIndex(this.container)
    const next = sanitizeHighlights([
      ...this.highlights,
      {
        id: makeHighlightId(),
        start: captured.start,
        end: captured.end,
        color: captured.color
      }
    ], this.index.text.length)
    this.highlights = next
    // Small suppress window so the trailing `click` that the browser fires
    // after a drag-select doesn't immediately remove the highlight we just
    // created. 60ms is enough to cover the post-mouseup click but short
    // enough that a user who deliberately clicks to remove the highlight
    // doesn't feel a stall.
    this.suppressClickUntil = Date.now() + 60
    // Last-drawn color wins on overlap. Promote before render so the
    // Highlight object already has its new priority when ranges are added.
    promoteHighlight(this.target, captured.color)
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
      this.lastRenderedText = this.index.text
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
   * requestAnimationFrame for the next paint with a 120ms timer as a
   * fallback for backgrounded tabs where rAF is throttled. The two are
   * mutually exclusive: whichever runs first cancels the other so we never
   * render twice for a single scheduled pass.
   */
  private scheduleRender(): void {
    if (this.pendingRaf) {
      cancelAnimationFrame(this.pendingRaf)
      this.pendingRaf = 0
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = 0
    }
    this.pendingRaf = requestAnimationFrame(() => {
      this.pendingRaf = 0
      if (this.pendingTimer) {
        clearTimeout(this.pendingTimer)
        this.pendingTimer = 0
      }
      if (!this.destroyed) {
        this.render()
      }
    })
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = 0
      if (this.pendingRaf) {
        cancelAnimationFrame(this.pendingRaf)
        this.pendingRaf = 0
      }
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

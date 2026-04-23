export type HighlightColor = 'yellow' | 'green' | 'cyan' | 'red'

export type Target = 'question' | 'explanation'

export interface SerializedHighlight {
  /** Stable identifier. Used for click-to-remove and dedup. */
  id: string
  /** Character offset into container.textContent at which the highlight starts. */
  start: number
  /** Exclusive character offset at which the highlight ends. */
  end: number
  color: HighlightColor
}

export interface HighlightDocV1 {
  v: 1
  question: SerializedHighlight[]
  explanation: SerializedHighlight[]
}

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'cyan', 'red']

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(value)
}

export function createEmptyHighlightDoc(): HighlightDocV1 {
  return { v: 1, question: [], explanation: [] }
}

/** Generate a short id. Collision probability is negligible for in-browser use. */
export function makeHighlightId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `hl_${time}_${rand}`
}

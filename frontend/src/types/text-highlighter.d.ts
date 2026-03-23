declare class TextHighlighter {
  constructor(element: HTMLElement, options?: {
    color?: string
    onAfterHighlight?: (range: Range, highlights: HTMLElement[]) => void
  })
  setColor(color: string): void
  getHighlights(params?: { container?: HTMLElement }): HTMLElement[]
  removeHighlights(element: HTMLElement): void
  serializeHighlights(): string
  deserializeHighlights(serialized: string): void
}

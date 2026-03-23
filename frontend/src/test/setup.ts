import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

class MockTextHighlighter {
  color: string

  constructor(_element: HTMLElement, options?: { color?: string }) {
    this.color = options?.color ?? '#fff59d'
  }

  setColor(color: string) {
    this.color = color
  }

  getHighlights() {
    return [] as HTMLElement[]
  }

  removeHighlights(_element: HTMLElement) {}

  serializeHighlights() {
    return '[]'
  }

  deserializeHighlights(_serialized: string) {}
}

vi.stubGlobal('TextHighlighter', MockTextHighlighter)
vi.stubGlobal('alert', vi.fn())
vi.stubGlobal('confirm', vi.fn(() => true))
Object.defineProperty(window, 'open', {
  writable: true,
  value: vi.fn()
})

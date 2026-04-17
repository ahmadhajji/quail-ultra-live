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

vi.mock('../lib/text-highlighter-core', () => ({
  default: MockTextHighlighter
}))
if (typeof window !== 'undefined') {
  vi.stubGlobal('alert', vi.fn())
  vi.stubGlobal('confirm', vi.fn(() => true))
  Object.defineProperty(window, 'open', {
    writable: true,
    value: vi.fn()
  })

  if (typeof window.localStorage?.clear !== 'function') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        _store: new Map<string, string>(),
        getItem(key: string) {
          return this._store.has(key) ? this._store.get(key)! : null
        },
        setItem(key: string, value: string) {
          this._store.set(key, String(value))
        },
        removeItem(key: string) {
          this._store.delete(key)
        },
        clear() {
          this._store.clear()
        }
      }
    })
  }
}

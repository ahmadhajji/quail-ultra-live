/**
 * Singleton wrapper around window.CSS.highlights.
 *
 * We register 8 named Highlight objects — one per (target, color) pair —
 * so that clearing ranges in the question container never touches the
 * explanation container and vice versa. Priority is assigned so that
 * darker colors paint on top of lighter ones when the user overlays
 * highlights of different colors on the same text.
 */
import { HIGHLIGHT_COLORS, type HighlightColor, type Target } from './types'

export type HighlightName = `quail-${'q' | 'e'}-${HighlightColor}`

interface HighlightLike {
  size: number
  add(range: Range): void
  delete(range: Range): void
  clear(): void
  priority?: number
}

interface HighlightCtor {
  new (...ranges: Range[]): HighlightLike
}

interface HighlightsRegistry {
  set(name: string, highlight: HighlightLike): HighlightsRegistry
  has(name: string): boolean
  get(name: string): HighlightLike | undefined
  delete(name: string): boolean
}

const COLOR_PRIORITY: Record<HighlightColor, number> = {
  yellow: 1,
  green: 2,
  cyan: 3,
  red: 4
}

function targetPrefix(target: Target): 'q' | 'e' {
  return target === 'question' ? 'q' : 'e'
}

export function highlightName(target: Target, color: HighlightColor): HighlightName {
  return `quail-${targetPrefix(target)}-${color}` as HighlightName
}

function getRegistry(): HighlightsRegistry | null {
  if (typeof window === 'undefined') {
    return null
  }
  const cssObj = (window as unknown as { CSS?: { highlights?: HighlightsRegistry } }).CSS
  if (!cssObj || !cssObj.highlights) {
    return null
  }
  return cssObj.highlights
}

function getHighlightCtor(): HighlightCtor | null {
  if (typeof window === 'undefined') {
    return null
  }
  const ctor = (window as unknown as { Highlight?: HighlightCtor }).Highlight
  return ctor ?? null
}

const registeredKeys = new Set<HighlightName>()

export function ensureRegistered(target: Target, color: HighlightColor): HighlightLike | null {
  const registry = getRegistry()
  const Ctor = getHighlightCtor()
  if (!registry || !Ctor) {
    return null
  }
  const name = highlightName(target, color)
  let highlight = registry.get(name)
  if (!highlight) {
    highlight = new Ctor()
    highlight.priority = COLOR_PRIORITY[color]
    registry.set(name, highlight)
    registeredKeys.add(name)
  }
  return highlight
}

export function setRangesFor(target: Target, color: HighlightColor, ranges: Range[]): void {
  const highlight = ensureRegistered(target, color)
  if (!highlight) {
    return
  }
  highlight.clear()
  for (const range of ranges) {
    try {
      highlight.add(range)
    } catch {
      // Swallow invalid ranges — they're usually transient during re-mounts.
    }
  }
}

export function clearTarget(target: Target): void {
  for (const color of HIGHLIGHT_COLORS) {
    const highlight = getRegistry()?.get(highlightName(target, color))
    if (highlight) {
      highlight.clear()
    }
  }
}

export function isHighlightApiSupported(): boolean {
  return getRegistry() !== null && getHighlightCtor() !== null
}

/** Expose for tests. */
export function __resetRegistryForTests(): void {
  const registry = getRegistry()
  if (!registry) {
    return
  }
  for (const name of registeredKeys) {
    const highlight = registry.get(name)
    if (highlight) {
      highlight.clear()
    }
    registry.delete(name)
  }
  registeredKeys.clear()
}

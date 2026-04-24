import { useCallback, useEffect, useState } from 'react'
import { localStore } from './store'
import { getCurrentTheme, onThemeChange, setTheme as setGlobalTheme } from './theme'

const STORE_NAMESPACE = 'exam'
const STORE_KEY = 'ui-prefs'

export type UiTheme = 'light' | 'dark'

export interface UiPreferences {
  /** Multiplier applied to reading-area base font size. */
  fontSizeScale: number
  /** Additive delta applied to reading-area base font weight. */
  fontWeightDelta: number
  /** Active theme. Only 'light' is visually active today. */
  theme: UiTheme
  /** Whether to render the left-bar unsubmitted indicator dot. */
  showUnsubmittedIndicator: boolean
}

export const FONT_SIZE_MIN = 0.8
export const FONT_SIZE_MAX = 1.4
export const FONT_SIZE_STEP = 0.05
export const FONT_SIZE_DEFAULT = 1

export const FONT_WEIGHT_MIN = -100
export const FONT_WEIGHT_MAX = 200
export const FONT_WEIGHT_STEP = 50
export const FONT_WEIGHT_DEFAULT = 0

export const DEFAULT_UI_PREFS: UiPreferences = Object.freeze({
  fontSizeScale: FONT_SIZE_DEFAULT,
  fontWeightDelta: FONT_WEIGHT_DEFAULT,
  theme: 'light',
  showUnsubmittedIndicator: true
})

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function roundToStep(value: number, step: number): number {
  const steps = Math.round(value / step)
  // Multiply first then divide by a power of 10 to dodge FP drift (e.g. 1.05 * 20 = 21).
  const precision = Math.max(0, (step.toString().split('.')[1] ?? '').length)
  const factor = Math.pow(10, precision)
  return Math.round(steps * step * factor) / factor
}

export function normalizeFontSizeScale(value: number): number {
  return roundToStep(clamp(value, FONT_SIZE_MIN, FONT_SIZE_MAX), FONT_SIZE_STEP)
}

export function normalizeFontWeightDelta(value: number): number {
  return roundToStep(clamp(value, FONT_WEIGHT_MIN, FONT_WEIGHT_MAX), FONT_WEIGHT_STEP)
}

export function normalizeUiPreferences(input: unknown): UiPreferences {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_UI_PREFS }
  }
  const raw = input as Partial<UiPreferences>
  const fontSizeScale = typeof raw.fontSizeScale === 'number'
    ? normalizeFontSizeScale(raw.fontSizeScale)
    : DEFAULT_UI_PREFS.fontSizeScale
  const fontWeightDelta = typeof raw.fontWeightDelta === 'number'
    ? normalizeFontWeightDelta(raw.fontWeightDelta)
    : DEFAULT_UI_PREFS.fontWeightDelta
  const theme: UiTheme = raw.theme === 'dark' ? 'dark' : 'light'
  const showUnsubmittedIndicator = typeof raw.showUnsubmittedIndicator === 'boolean'
    ? raw.showUnsubmittedIndicator
    : DEFAULT_UI_PREFS.showUnsubmittedIndicator
  return { fontSizeScale, fontWeightDelta, theme, showUnsubmittedIndicator }
}

export function loadUiPreferences(): UiPreferences {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_UI_PREFS }
  }
  try {
    const stored = localStore.getJson<unknown>(STORE_KEY, STORE_NAMESPACE)
    if (stored === undefined) {
      return { ...DEFAULT_UI_PREFS }
    }
    return normalizeUiPreferences(stored)
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

export function saveUiPreferences(prefs: UiPreferences): void {
  if (typeof window === 'undefined') {
    return
  }
  localStore.set(STORE_KEY, prefs, STORE_NAMESPACE)
}

function renderedFontWeight(delta: number): number {
  if (delta <= 0) {
    return 400 + delta
  }
  return Math.min(800, 400 + (delta * 2))
}

export function applyUiPreferencesToDocument(prefs: UiPreferences): void {
  if (typeof document === 'undefined') {
    return
  }
  const root = document.documentElement
  root.style.setProperty('--q-font-size-scale', String(prefs.fontSizeScale))
  root.style.setProperty('--q-font-weight-delta', String(prefs.fontWeightDelta))
  root.style.setProperty('--q-reading-font-size', `${16 * prefs.fontSizeScale}px`)
  root.style.setProperty('--q-reading-font-weight', String(renderedFontWeight(prefs.fontWeightDelta)))
  // Delegate theme to the global theme helper so the sidebar ThemeToggle and
  // the in-exam Settings panel share one source of truth (localStorage key
  // `quail-theme` + `quail-theme-change` custom event). setGlobalTheme also
  // writes the data-theme attribute, so we always go through it.
  setGlobalTheme(prefs.theme)
}

export type UiPreferencesHook = readonly [UiPreferences, (patch: Partial<UiPreferences>) => void, () => void]

export function useUiPreferences(): UiPreferencesHook {
  const [prefs, setPrefs] = useState<UiPreferences>(() => {
    const loaded = loadUiPreferences()
    // The global theme (sidebar toggle) is authoritative on mount so a
    // previously-set dark theme survives across views.
    if (typeof document !== 'undefined') {
      const globalTheme = getCurrentTheme()
      if (globalTheme !== loaded.theme) {
        return { ...loaded, theme: globalTheme }
      }
    }
    return loaded
  })

  useEffect(() => {
    applyUiPreferencesToDocument(prefs)
    saveUiPreferences(prefs)
  }, [prefs])

  // If the user flips the theme from elsewhere (sidebar ThemeToggle), keep
  // the local prefs in sync so the exam Settings radio reflects reality.
  useEffect(() => {
    return onThemeChange((nextTheme) => {
      setPrefs((current) => (current.theme === nextTheme ? current : { ...current, theme: nextTheme }))
    })
  }, [])

  const update = useCallback((patch: Partial<UiPreferences>) => {
    setPrefs((current) => normalizeUiPreferences({ ...current, ...patch }))
  }, [])

  const reset = useCallback(() => {
    setPrefs({ ...DEFAULT_UI_PREFS, theme: getCurrentTheme() })
  }, [])

  return [prefs, update, reset] as const
}

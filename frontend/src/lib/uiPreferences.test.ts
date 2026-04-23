import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_UI_PREFS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  loadUiPreferences,
  normalizeFontSizeScale,
  normalizeFontWeightDelta,
  normalizeUiPreferences,
  saveUiPreferences,
  applyUiPreferencesToDocument
} from './uiPreferences'

describe('uiPreferences.normalize', () => {
  it('returns defaults for invalid input', () => {
    expect(normalizeUiPreferences(null)).toEqual(DEFAULT_UI_PREFS)
    expect(normalizeUiPreferences(undefined)).toEqual(DEFAULT_UI_PREFS)
    expect(normalizeUiPreferences('nope')).toEqual(DEFAULT_UI_PREFS)
  })

  it('clamps font size scale to bounds', () => {
    expect(normalizeFontSizeScale(5)).toBe(FONT_SIZE_MAX)
    expect(normalizeFontSizeScale(-1)).toBe(FONT_SIZE_MIN)
    expect(normalizeFontSizeScale(Number.NaN)).toBe(FONT_SIZE_MIN)
  })

  it('snaps font size scale to step', () => {
    expect(normalizeFontSizeScale(1.0)).toBe(1)
    expect(normalizeFontSizeScale(1.04)).toBe(1.05)
    expect(normalizeFontSizeScale(1.28)).toBe(1.3)
  })

  it('clamps font weight delta to bounds', () => {
    expect(normalizeFontWeightDelta(999)).toBe(FONT_WEIGHT_MAX)
    expect(normalizeFontWeightDelta(-999)).toBe(FONT_WEIGHT_MIN)
  })

  it('snaps font weight delta to step', () => {
    expect(normalizeFontWeightDelta(0)).toBe(0)
    expect(normalizeFontWeightDelta(30)).toBe(50)
    expect(normalizeFontWeightDelta(-73)).toBe(-50)
  })

  it('coerces theme to light or dark', () => {
    expect(normalizeUiPreferences({ theme: 'dark' }).theme).toBe('dark')
    expect(normalizeUiPreferences({ theme: 'light' }).theme).toBe('light')
    expect(normalizeUiPreferences({ theme: 'anything-else' }).theme).toBe('light')
  })

  it('preserves showUnsubmittedIndicator when boolean', () => {
    expect(normalizeUiPreferences({ showUnsubmittedIndicator: false }).showUnsubmittedIndicator).toBe(false)
    expect(normalizeUiPreferences({ showUnsubmittedIndicator: true }).showUnsubmittedIndicator).toBe(true)
    expect(normalizeUiPreferences({ showUnsubmittedIndicator: 'yes' }).showUnsubmittedIndicator).toBe(true)
  })
})

describe('uiPreferences.persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  it('round-trips through localStorage', () => {
    const value = { ...DEFAULT_UI_PREFS, fontSizeScale: 1.2, theme: 'light' as const, showUnsubmittedIndicator: false }
    saveUiPreferences(value)
    const loaded = loadUiPreferences()
    expect(loaded.fontSizeScale).toBe(1.2)
    expect(loaded.showUnsubmittedIndicator).toBe(false)
  })

  it('returns defaults if nothing is stored', () => {
    expect(loadUiPreferences()).toEqual(DEFAULT_UI_PREFS)
  })

  it('returns defaults if stored blob is corrupt', () => {
    window.localStorage.setItem('quail-live:store:exam:ui-prefs', '{not json')
    expect(loadUiPreferences()).toEqual(DEFAULT_UI_PREFS)
  })
})

describe('uiPreferences.applyToDocument', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.removeProperty('--q-font-size-scale')
    document.documentElement.style.removeProperty('--q-font-weight-delta')
    document.documentElement.style.removeProperty('--q-reading-font-size')
    document.documentElement.style.removeProperty('--q-reading-font-weight')
  })

  it('writes CSS variables and theme attribute to <html>', () => {
    applyUiPreferencesToDocument({ fontSizeScale: 1.15, fontWeightDelta: 50, theme: 'light', showUnsubmittedIndicator: true })
    expect(document.documentElement.style.getPropertyValue('--q-font-size-scale')).toBe('1.15')
    expect(document.documentElement.style.getPropertyValue('--q-font-weight-delta')).toBe('50')
    expect(document.documentElement.style.getPropertyValue('--q-reading-font-size')).toBe('18.4px')
    expect(document.documentElement.style.getPropertyValue('--q-reading-font-weight')).toBe('500')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

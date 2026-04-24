export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'quail-theme'

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    // localStorage may be unavailable (SSR, private mode)
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    try {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
      }
    } catch {
      // ignore matchMedia failures
    }
  }
  return 'light'
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.setAttribute('data-theme', theme)
}

export function initTheme(): void {
  applyTheme(readStoredTheme())
}

export function getCurrentTheme(): Theme {
  if (typeof document === 'undefined') {
    return 'light'
  }
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'dark' ? 'dark' : 'light'
}

export function toggleTheme(): Theme {
  const next: Theme = getCurrentTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

export function setTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('quail-theme-change', { detail: theme }))
  }
}

export function onThemeChange(callback: (theme: Theme) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Theme>).detail
    if (detail === 'light' || detail === 'dark') {
      callback(detail)
    }
  }
  window.addEventListener('quail-theme-change', handler)
  return () => window.removeEventListener('quail-theme-change', handler)
}

import { useEffect, useState } from 'react'
import { getCurrentTheme, onThemeChange, toggleTheme, type Theme } from '../lib/theme'

interface ThemeToggleProps {
  collapsed?: boolean
}

export function ThemeToggle({ collapsed }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => getCurrentTheme())

  useEffect(() => {
    return onThemeChange((next) => setTheme(next))
  }, [])

  const isDark = theme === 'dark'
  const label = isDark ? 'Light mode' : 'Dark mode'
  const icon = isDark ? '☀' : '☾'

  return (
    <button
      className="q-theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = toggleTheme()
        setTheme(next)
      }}
    >
      <span className="q-theme-toggle-icon" aria-hidden="true">{icon}</span>
      {collapsed ? null : <span className="q-theme-toggle-label">{label}</span>}
    </button>
  )
}

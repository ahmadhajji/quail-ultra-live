import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { refractive } from '@hashintel/refractive'

/**
 * GlassSurface — subtle Apple "liquid glass" wrapper for overlay chrome.
 *
 * Wraps @hashintel/refractive's <refractive.div> with theme-aware presets so
 * every call site shares the same refraction tuning. The sibling CSS class
 * `.q-glass` in app.css supplies a semi-transparent tinted background + border
 * + shadow, and a @supports fallback makes it fully opaque on browsers that
 * lack backdrop-filter support.
 *
 * Use sparingly — only on overlay/chrome surfaces (floating windows, sidebars,
 * popover menus, toolbars). Do NOT wrap dense reading content.
 */

export type GlassSurfaceVariant = 'overlay' | 'panel' | 'pill'

interface PresetValue {
  radius: number
  blur: number
  bezelWidth: number
}

const PRESETS: Record<GlassSurfaceVariant, PresetValue> = {
  // Floating windows (calc, labs, shortcuts, settings, image inspector)
  overlay: { radius: 14, blur: 14, bezelWidth: 10 },
  // Sidebar, appbar, tool sheets
  panel: { radius: 10, blur: 8, bezelWidth: 6 },
  // Toolbar pills, tabs, dropdowns
  pill: { radius: 999, blur: 6, bezelWidth: 4 },
}

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GlassSurfaceVariant
  /** Override the preset radius (keeps blur/bezel) — handy for fixed-height panels. */
  radius?: number
  children?: ReactNode
}

export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(function GlassSurface(
  { variant = 'panel', radius, className, children, ...rest },
  ref,
) {
  const preset = PRESETS[variant]
  const refraction = radius !== undefined ? { ...preset, radius } : preset
  const classes = ['q-glass', `q-glass--${variant}`, className].filter(Boolean).join(' ')
  return (
    <refractive.div
      ref={ref}
      refraction={refraction}
      className={classes}
      {...rest}
    >
      {children}
    </refractive.div>
  )
})

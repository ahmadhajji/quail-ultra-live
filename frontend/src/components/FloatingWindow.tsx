import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { refractive } from '@hashintel/refractive'

/**
 * @hashintel/refractive builds its SVG displacement map with `new ImageData()`.
 * jsdom doesn't expose ImageData, so in tests we fall back to a plain div and
 * the window still renders (no refraction, but visually tolerable via the
 * `.q-glass` CSS fallback). */
const supportsRefractive = typeof globalThis !== 'undefined' && typeof (globalThis as { ImageData?: unknown }).ImageData === 'function'
// Loose any-typed shell so the conditional (div vs refractive.div) type-checks —
// we pass `refraction` only in the refractive branch at runtime.
const FloatingWindowShell = (supportsRefractive ? refractive.div : 'div') as unknown as ComponentType<Record<string, unknown>>

export interface FloatingWindowProps {
  /** Controls visibility. */
  open: boolean
  /** Title text shown in the draggable header. */
  title: string
  /** Body content. */
  children: ReactNode
  /** Optional id used for aria-labelledby on the dialog title. */
  titleId?: string
  /** Fired when the user requests close (close button, escape, scrim). */
  onClose: () => void
  /** Optional class name applied to the window root for tailored sizing. */
  className?: string
  /** Minimum top offset when auto-centering, useful to avoid topbars. */
  minTop?: number
  /** Padding kept around the window when clamping to the viewport. */
  edgePadding?: number
  /** When true, clicking the dim scrim closes the window. */
  closeOnScrimClick?: boolean
  /** When true, pressing escape closes the window. */
  closeOnEscape?: boolean
  /** Show a translucent scrim behind the window. */
  showScrim?: boolean
  /** ARIA role override (defaults to "dialog"). */
  role?: string
  /** ARIA label when no titleId is supplied. */
  ariaLabel?: string
  /** Optional content rendered to the left of the title (e.g. a tab strip). */
  headerExtras?: ReactNode
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

interface Position {
  x: number
  y: number
}

function clampToViewport(x: number, y: number, width: number, height: number, padding: number): Position {
  if (typeof window === 'undefined') {
    return { x, y }
  }
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxX = Math.max(padding, viewportWidth - width - padding)
  const maxY = Math.max(padding, viewportHeight - height - padding)
  return {
    x: Math.min(Math.max(padding, x), maxX),
    y: Math.min(Math.max(padding, y), maxY)
  }
}

/**
 * A reusable, freely draggable floating window.
 *
 * Position is owned by the component and preserved across content changes
 * (tab switches, search filtering, etc.). It only resets back to the centered
 * default when the window closes and re-opens.
 */
export function FloatingWindow(props: FloatingWindowProps) {
  const {
    open,
    title,
    titleId,
    children,
    onClose,
    className,
    minTop = 96,
    edgePadding = 16,
    closeOnScrimClick = true,
    closeOnEscape = true,
    showScrim = true,
    role = 'dialog',
    ariaLabel,
    headerExtras
  } = props

  const windowRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const positionedRef = useRef(false)
  const [position, setPosition] = useState<Position | null>(null)

  // Reset positioning whenever the window is closed so the next open re-centers.
  useEffect(() => {
    if (!open) {
      positionedRef.current = false
      setPosition(null)
      dragRef.current = null
    }
  }, [open])

  // On first open, center the window using its measured size. We use a
  // layout effect so the position is applied before the browser paints.
  useLayoutEffect(() => {
    if (!open || positionedRef.current) {
      return
    }
    const node = windowRef.current
    if (!node) {
      return
    }
    const width = node.offsetWidth
    const height = node.offsetHeight
    if (width === 0 || height === 0) {
      // Wait until the next paint for measurements to settle.
      return
    }
    const centerX = Math.round((window.innerWidth - width) / 2)
    const centerY = Math.max(minTop, Math.round((window.innerHeight - height) / 2))
    setPosition(clampToViewport(centerX, centerY, width, height, edgePadding))
    positionedRef.current = true
  })

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const node = windowRef.current
    const target = event.target instanceof HTMLElement ? event.target : null
    if (!node || event.button !== 0 || target?.closest('[data-floating-window-no-drag="true"]')) {
      return
    }
    const current = position ?? { x: node.offsetLeft, y: node.offsetTop }
    event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y
    }
  }, [position])

  // Window-level pointer handlers for drag and viewport-resize clamping.
  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerMove(event: PointerEvent): void {
      const drag = dragRef.current
      const node = windowRef.current
      if (!drag || !node || drag.pointerId !== event.pointerId) {
        return
      }
      const next = clampToViewport(
        drag.originX + (event.clientX - drag.startX),
        drag.originY + (event.clientY - drag.startY),
        node.offsetWidth,
        node.offsetHeight,
        edgePadding
      )
      setPosition(next)
    }

    function handlePointerUp(event: PointerEvent): void {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null
      }
    }

    function handleResize(): void {
      const node = windowRef.current
      if (!node) {
        return
      }
      setPosition((current) => {
        const base = current ?? { x: node.offsetLeft, y: node.offsetTop }
        return clampToViewport(base.x, base.y, node.offsetWidth, node.offsetHeight, edgePadding)
      })
    }

    function handleKey(event: KeyboardEvent): void {
      if (closeOnEscape && event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKey)

    // Re-clamp the window if its content reflows (e.g. tab switch changes
    // body height). Position itself is preserved — we only nudge it back if
    // it would otherwise spill off the viewport.
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && windowRef.current) {
      observer = new ResizeObserver(() => handleResize())
      observer.observe(windowRef.current)
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKey)
      observer?.disconnect()
    }
  }, [open, edgePadding, closeOnEscape, onClose])

  if (!open) {
    return null
  }

  // While we wait for the first measurement, fall back to CSS-based centering
  // using transform. This keeps the dialog accessible (not visibility:hidden)
  // on mount, so screen readers and tests can still find it immediately.
  const style = position
    ? { left: position.x, top: position.y, transform: 'none' }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }

  return (
    <>
      {showScrim ? (
        <button
          className="floating-window-scrim"
          type="button"
          aria-label="Close window"
          tabIndex={-1}
          onClick={() => {
            if (closeOnScrimClick) {
              onClose()
            }
          }}
        />
      ) : null}
      <FloatingWindowShell
        ref={windowRef}
        {...(supportsRefractive ? { refraction: { radius: 14, blur: 14, bezelWidth: 10 } } : {})}
        className={`floating-window q-glass q-glass--overlay ${className ?? ''}`.trim()}
        role={role}
        aria-modal={role === 'dialog' ? 'true' : undefined}
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : ariaLabel ?? title}
        style={style}
      >
        <div className="floating-window-header" onPointerDown={beginDrag}>
          <button
            type="button"
            className="floating-window-close"
            data-floating-window-no-drag="true"
            aria-label="Close"
            onClick={onClose}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <div className="floating-window-title-wrap">
            <h2 id={titleId} className="floating-window-title">{title}</h2>
            {headerExtras ? <div className="floating-window-header-extras">{headerExtras}</div> : null}
          </div>
          <span className="floating-window-drag-hint" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="6" r="1.2" />
              <circle cx="15" cy="6" r="1.2" />
              <circle cx="9" cy="12" r="1.2" />
              <circle cx="15" cy="12" r="1.2" />
              <circle cx="9" cy="18" r="1.2" />
              <circle cx="15" cy="18" r="1.2" />
            </svg>
          </span>
        </div>
        <div className="floating-window-body">
          {children}
        </div>
      </FloatingWindowShell>
    </>
  )
}

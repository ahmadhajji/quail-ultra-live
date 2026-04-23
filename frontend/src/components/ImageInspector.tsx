import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { FloatingWindow } from './FloatingWindow'

export interface ImageInspectorItem {
  /** Absolute URL or asset path for the image. */
  src: string
  /** Optional descriptive label shown in the window title. */
  alt?: string
  /** Optional suggested filename for download. */
  filename?: string
}

interface ImageInspectorProps {
  open: boolean
  item: ImageInspectorItem | null
  onClose: () => void
}

const MIN_SCALE = 0.2
const MAX_SCALE = 8
const SCALE_STEP = 0.25

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

function deriveFilenameFromSrc(src: string, fallback = 'image'): string {
  try {
    const pathname = new URL(src, window.location.href).pathname
    const last = pathname.split('/').filter(Boolean).pop() ?? ''
    if (last) {
      return decodeURIComponent(last)
    }
  } catch {
    // ignore and fall back
  }
  return fallback
}

/**
 * ImageInspector renders a floating dialog with a pannable, zoomable image
 * preview. Keeps the same chrome as the shortcuts window so the look-and-feel
 * matches the rest of the exam UI.
 */
export function ImageInspector(props: ImageInspectorProps) {
  const { open, item, onClose } = props
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle')
  const copyResetRef = useRef<number | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // Reset view whenever the image changes or window reopens.
  useEffect(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
    setFullscreen(false)
    setCopyState('idle')
  }, [item?.src, open])

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current)
      }
    }
  }, [])

  const title = useMemo(() => {
    if (!item) {
      return 'Inspect image'
    }
    return item.alt?.trim() || 'Inspect image'
  }, [item])

  const onZoomIn = useCallback(() => {
    setScale((current) => clampScale(current + SCALE_STEP))
  }, [])

  const onZoomOut = useCallback(() => {
    setScale((current) => clampScale(current - SCALE_STEP))
  }, [])

  const onReset = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  const onFit = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  const onToggleFullscreen = useCallback(() => {
    setFullscreen((current) => !current)
    // Re-center on fullscreen toggle for predictable feel.
    setTranslate({ x: 0, y: 0 })
  }, [])

  const onDownload = useCallback(() => {
    if (!item) {
      return
    }
    const filename = item.filename || deriveFilenameFromSrc(item.src)
    const anchor = document.createElement('a')
    anchor.href = item.src
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.target = '_blank'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }, [item])

  const onCopy = useCallback(async () => {
    if (!item) {
      return
    }
    if (copyResetRef.current !== null) {
      window.clearTimeout(copyResetRef.current)
      copyResetRef.current = null
    }
    try {
      const response = await window.fetch(item.src, { credentials: 'include' })
      if (!response.ok) {
        throw new Error(`Copy failed (${response.status})`)
      }
      const blob = await response.blob()
      if (typeof window.ClipboardItem === 'function' && navigator.clipboard?.write) {
        const clipboardItem = new window.ClipboardItem({ [blob.type || 'image/png']: blob })
        await navigator.clipboard.write([clipboardItem])
        setCopyState('success')
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.src)
        setCopyState('success')
      } else {
        throw new Error('Clipboard API unavailable')
      }
    } catch {
      setCopyState('error')
    } finally {
      copyResetRef.current = window.setTimeout(() => {
        setCopyState('idle')
        copyResetRef.current = null
      }, 1600)
    }
  }, [item])

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!open) {
      return
    }
    event.preventDefault()
    // Tame trackpad sensitivity: trackpads emit many small wheel events at
    // ~60Hz, so a per-event multiplicative step felt like the image was
    // whip-zooming. Map deltaY continuously through an exp() curve and clamp
    // the per-event effect to a gentle ±3% change regardless of delta size.
    const delta = event.deltaY
    const rawFactor = Math.exp(-delta * 0.0015)
    const boundedFactor = Math.min(1.03, Math.max(0.97, rawFactor))
    setScale((current) => clampScale(current * boundedFactor))
  }, [open])

  const beginPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: translate.x,
      originY: translate.y
    }
  }, [translate.x, translate.y])

  const updatePan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    setTranslate({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY)
    })
  }, [])

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        onZoomIn()
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        onZoomOut()
      } else if (event.key === '0') {
        event.preventDefault()
        onReset()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onReset, onZoomIn, onZoomOut])

  if (!item) {
    return null
  }

  const copyLabel = copyState === 'success' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy image'
  const scaleLabel = `${Math.round(scale * 100)}%`

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title={title}
      titleId="exam-image-inspector-title"
      className={`exam-image-inspector ${fullscreen ? 'exam-image-inspector-fullscreen' : ''}`.trim()}
      showScrim={true}
      closeOnScrimClick={true}
    >
      <div
        ref={viewportRef}
        className="exam-image-inspector-viewport"
        onPointerDown={beginPan}
        onPointerMove={updatePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onWheel={onWheel}
        role="presentation"
      >
        <img
          className="exam-image-inspector-image"
          src={item.src}
          alt={item.alt ?? ''}
          draggable={false}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`
          }}
        />
      </div>
      <div className="exam-image-inspector-toolbar" role="toolbar" aria-label="Image controls">
        <button type="button" className="exam-image-inspector-btn" aria-label="Zoom in" onClick={onZoomIn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
            <path d="M11 8v6M8 11h6" />
          </svg>
        </button>
        <button type="button" className="exam-image-inspector-btn" aria-label="Zoom out" onClick={onZoomOut}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
            <path d="M8 11h6" />
          </svg>
        </button>
        <span className="exam-image-inspector-zoom" aria-live="polite">{scaleLabel}</span>
        <button type="button" className="exam-image-inspector-btn" aria-label="Reset view" onClick={onReset}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
        </button>
        <button type="button" className="exam-image-inspector-btn" aria-label="Fit to window" onClick={onFit}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 4H4v4" />
            <path d="M16 4h4v4" />
            <path d="M16 20h4v-4" />
            <path d="M8 20H4v-4" />
          </svg>
        </button>
        <span className="exam-image-inspector-divider" aria-hidden="true" />
        <button type="button" className={`exam-image-inspector-btn ${copyState === 'success' ? 'is-success' : ''} ${copyState === 'error' ? 'is-error' : ''}`.trim()} aria-label={copyLabel} onClick={onCopy}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </button>
        <button type="button" className="exam-image-inspector-btn" aria-label="Download image" onClick={onDownload}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        </button>
        <button type="button" className={`exam-image-inspector-btn ${fullscreen ? 'is-active' : ''}`.trim()} aria-label={fullscreen ? 'Exit fullscreen' : 'Expand to fill screen'} aria-pressed={fullscreen} onClick={onToggleFullscreen}>
          {fullscreen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 4v5H4" />
              <path d="M15 4v5h5" />
              <path d="M15 20v-5h5" />
              <path d="M9 20v-5H4" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9V4h5" />
              <path d="M20 9V4h-5" />
              <path d="M20 15v5h-5" />
              <path d="M4 15v5h5" />
            </svg>
          )}
        </button>
      </div>
    </FloatingWindow>
  )
}

import { HighlightEngine, isHighlightColor, type HighlightColor, type SerializedHighlight, type Target } from './highlighting'

interface MountQuestionHighlighterOptions {
  container: HTMLDivElement
  color: string
  serializedHighlights: string
  onSerializedChange: (serialized: string) => void
  target?: Target
}

export interface MountedQuestionHighlighter {
  setColor: (color: string) => void
  setEnabled: (enabled: boolean) => void
  setEntries: (entries: SerializedHighlight[]) => void
  clearAll: () => void
  destroy: () => void
}

const COLOR_BY_HEX: Record<string, HighlightColor> = {
  '#fff59d': 'yellow',
  '#b8f2e6': 'green',
  '#cde7ff': 'cyan',
  '#ffd6d6': 'red'
}

function colorFromInput(color: string): HighlightColor | null {
  const normalized = color.trim().toLowerCase()
  if (isHighlightColor(normalized)) {
    return normalized
  }
  return COLOR_BY_HEX[normalized] ?? null
}

function parseSerializedHighlights(serialized: string): SerializedHighlight[] {
  if (!serialized || serialized === '[]') {
    return []
  }
  try {
    const parsed = JSON.parse(serialized)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((entry): entry is SerializedHighlight => (
      entry &&
      typeof entry === 'object' &&
      typeof entry.id === 'string' &&
      typeof entry.start === 'number' &&
      typeof entry.end === 'number' &&
      isHighlightColor((entry as { color?: unknown }).color)
    ))
  } catch {
    return []
  }
}

export function mountQuestionHighlighter(options: MountQuestionHighlighterOptions): MountedQuestionHighlighter {
  const { container, serializedHighlights, onSerializedChange, target = 'question' } = options
  let enabled = true
  let activeColor = colorFromInput(options.color)

  // Image clicks are owned by the ExamViewPage image-inspector wiring, not
  // by the highlighter. We intentionally do NOT attach a click handler here;
  // opening the image in a new tab (the previous behavior) competed with the
  // inspector and caused images to sometimes fail to reopen after the
  // inspector was closed.

  const engine = new HighlightEngine({
    container,
    target,
    initial: parseSerializedHighlights(serializedHighlights),
    getActiveColor: () => activeColor,
    isEnabled: () => enabled,
    onChange(entries) {
      onSerializedChange(entries.length > 0 ? JSON.stringify(entries) : '[]')
    },
  })

  return {
    setColor(nextColor) {
      activeColor = colorFromInput(nextColor)
    },
    setEnabled(nextEnabled) {
      enabled = nextEnabled
    },
    setEntries(entries) {
      engine.setEntries(entries)
    },
    clearAll() {
      engine.clearAll()
    },
    destroy() {
      engine.destroy()
    }
  }
}

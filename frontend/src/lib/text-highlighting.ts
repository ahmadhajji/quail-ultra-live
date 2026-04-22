import TextHighlighter from './text-highlighter-core'

interface MountQuestionHighlighterOptions {
  container: HTMLDivElement
  color: string
  serializedHighlights: string
  onSerializedChange: (serialized: string) => void
}

export interface MountedQuestionHighlighter {
  setColor: (color: string) => void
  setEnabled: (enabled: boolean) => void
  clearAll: () => void
  destroy: () => void
}

function bindHighlightRemoval(highlighter: TextHighlighter, onSerializedChange: (serialized: string) => void): void {
  highlighter.getHighlights().forEach((highlight: HTMLElement) => {
    highlight.onclick = () => {
      highlighter.removeHighlights(highlight)
      onSerializedChange(highlighter.serializeHighlights())
    }
  })
}

export function mountQuestionHighlighter(options: MountQuestionHighlighterOptions): MountedQuestionHighlighter {
  const { container, color, serializedHighlights, onSerializedChange } = options
  let enabled = true

  container.querySelectorAll<HTMLImageElement>('img[data-openable-image="true"]').forEach((image) => {
    image.onclick = () => window.open(image.src)
  })

  const highlighter = new TextHighlighter(container, {
    color,
    onBeforeHighlight: () => enabled,
    onAfterHighlight: (_range: unknown, highlights: HTMLElement[]) => {
      onSerializedChange(highlighter.serializeHighlights())
      highlights.forEach((highlight: HTMLElement) => {
        highlight.onclick = () => {
          highlighter.removeHighlights(highlight)
          onSerializedChange(highlighter.serializeHighlights())
        }
      })
    }
  })

  highlighter.deserializeHighlights(serializedHighlights)
  bindHighlightRemoval(highlighter, onSerializedChange)

  return {
    setColor(nextColor) {
      highlighter.setColor(nextColor)
    },
    setEnabled(nextEnabled) {
      enabled = nextEnabled
    },
    clearAll() {
      highlighter.removeHighlights()
      onSerializedChange(highlighter.serializeHighlights())
    },
    destroy() {
      highlighter.getHighlights().forEach((highlight: HTMLElement) => {
        highlight.onclick = null
      })
    }
  }
}

import type { BlockRecord } from '../types/domain'
import { createEmptyHighlightDoc, isHighlightColor, type HighlightDocV1, type SerializedHighlight, type Target } from './highlighting'

function normalizeEntries(input: unknown): SerializedHighlight[] {
  if (!Array.isArray(input)) {
    return []
  }
  return input.filter((entry): entry is SerializedHighlight => (
    entry &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    typeof entry.start === 'number' &&
    typeof entry.end === 'number' &&
    entry.end > entry.start &&
    isHighlightColor((entry as { color?: unknown }).color)
  ))
}

function hasHighlightDocEntries(doc: HighlightDocV1): boolean {
  return doc.question.length > 0 || doc.explanation.length > 0
}

export function getHighlightDoc(block: BlockRecord, index: number): HighlightDocV1 {
  const raw = block.highlights[index]
  if (!raw || raw === '[]') {
    return createEmptyHighlightDoc()
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.v === 1) {
      return {
        v: 1,
        question: normalizeEntries(parsed.question),
        explanation: normalizeEntries(parsed.explanation)
      }
    }
  } catch {
    // Legacy tuple payloads are intentionally dropped.
  }
  return createEmptyHighlightDoc()
}

export function setHighlightDocTarget(block: BlockRecord, index: number, target: Target, entries: SerializedHighlight[]): void {
  const current = getHighlightDoc(block, index)
  const next: HighlightDocV1 = {
    ...current,
    [target]: normalizeEntries(entries)
  }
  block.highlights[index] = hasHighlightDocEntries(next) ? JSON.stringify(next) : '[]'
}

export function getQuestionNote(block: BlockRecord, index: number): string {
  return block.notes[index] ?? ''
}

export function setQuestionNote(block: BlockRecord, index: number, note: string): void {
  block.notes[index] = note
}

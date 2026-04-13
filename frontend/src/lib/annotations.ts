import type { BlockRecord } from '../types/domain'

export function getQuestionHighlight(block: BlockRecord, index: number): string {
  return block.highlights[index] ?? '[]'
}

export function setQuestionHighlight(block: BlockRecord, index: number, serialized: string): void {
  block.highlights[index] = serialized || '[]'
}

export function getQuestionNote(block: BlockRecord, index: number): string {
  return block.notes[index] ?? ''
}

export function setQuestionNote(block: BlockRecord, index: number, note: string): void {
  block.notes[index] = note
}

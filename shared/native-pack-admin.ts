import crypto from 'node:crypto'

export type NativeQuestionStatus = 'draft' | 'ready' | 'blocked' | 'deprecated'

export interface NativeQuestionSummary {
  id: string
  path: string
  status: NativeQuestionStatus
  titlePreview: string
  contentHash: string
  correctChoiceId: string
  tags: Record<string, unknown>
  source: Record<string, unknown>
  parserConfidence: number | null
  reviewStatus: string
  validationStatus: string
  warnings: string[]
  changeSummary: string
  replacesQuestionId: string
}

export interface NativePackDiff {
  targetPackId: string
  incomingPackId: string
  currentRevision: number
  incomingRevision: number
  activeQuestionCount: number
  totalQuestionCount: number
  added: NativeQuestionSummary[]
  changed: NativeQuestionSummary[]
  unchanged: NativeQuestionSummary[]
  deprecated: NativeQuestionSummary[]
  blocked: NativeQuestionSummary[]
  removed: NativeQuestionSummary[]
  warnings: string[]
  errors: string[]
  canPublish: boolean
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)])
  )
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

export function sha256Json(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex')
}

export function activeNativeQuestionCount(manifest: any): number {
  return (Array.isArray(manifest?.questionIndex) ? manifest.questionIndex : [])
    .filter((entry: any) => entry?.status === 'ready')
    .length
}

export function summarizeNativeQuestion(entry: any, question?: any): NativeQuestionSummary {
  const status = (entry?.status || question?.status || 'draft') as NativeQuestionStatus
  const quality = question?.quality && typeof question.quality === 'object' ? question.quality : {}
  return {
    id: String(entry?.id || question?.id || ''),
    path: String(entry?.path || ''),
    status,
    titlePreview: String(entry?.titlePreview || ''),
    contentHash: String(entry?.contentHash || question?.integrity?.contentHash || ''),
    correctChoiceId: String(entry?.answerSummary?.correctChoiceId || question?.answerKey?.correctChoiceId || ''),
    tags: entry?.tags && typeof entry.tags === 'object' ? entry.tags : (question?.tags || {}),
    source: entry?.source && typeof entry.source === 'object' ? entry.source : (question?.source || {}),
    parserConfidence: typeof quality.parserConfidence === 'number' ? quality.parserConfidence : null,
    reviewStatus: String(quality.reviewStatus || ''),
    validationStatus: String(quality.validationStatus || ''),
    warnings: Array.isArray(quality.warnings) ? quality.warnings.filter((warning: unknown): warning is string => typeof warning === 'string') : [],
    changeSummary: String(entry?.changeSummary || ''),
    replacesQuestionId: String(entry?.replacesQuestionId || '')
  }
}

export function diffNativePackManifests(currentManifest: any, incomingManifest: any, targetPackId?: string): NativePackDiff {
  const currentEntries = Array.isArray(currentManifest?.questionIndex) ? currentManifest.questionIndex : []
  const incomingEntries = Array.isArray(incomingManifest?.questionIndex) ? incomingManifest.questionIndex : []
  const incomingPackId = String(incomingManifest?.packId || '')
  const logicalTargetPackId = String(targetPackId || currentManifest?.packId || incomingPackId || '')
  const errors: string[] = []
  const warnings: string[] = []

  if (!incomingPackId) {
    errors.push('Incoming native pack is missing packId.')
  } else if (logicalTargetPackId && incomingPackId !== logicalTargetPackId) {
    errors.push(`Incoming packId "${incomingPackId}" does not match target packId "${logicalTargetPackId}".`)
  }

  const currentById = new Map<string, any>()
  for (const entry of currentEntries) {
    if (entry?.id) {
      currentById.set(String(entry.id), entry)
    }
  }

  const incomingById = new Map<string, any>()
  const duplicateIncomingIds = new Set<string>()
  for (const entry of incomingEntries) {
    const id = String(entry?.id || '')
    if (!id) {
      continue
    }
    if (incomingById.has(id)) {
      duplicateIncomingIds.add(id)
    }
    incomingById.set(id, entry)
  }
  for (const id of duplicateIncomingIds) {
    errors.push(`Duplicate incoming question id "${id}".`)
  }

  const added: NativeQuestionSummary[] = []
  const changed: NativeQuestionSummary[] = []
  const unchanged: NativeQuestionSummary[] = []
  const deprecated: NativeQuestionSummary[] = []
  const blocked: NativeQuestionSummary[] = []

  for (const entry of incomingEntries) {
    const summary = summarizeNativeQuestion(entry)
    const current = currentById.get(summary.id)
    if (summary.status === 'blocked' || summary.status === 'draft') {
      blocked.push(summary)
      errors.push(`Question "${summary.id}" has status "${summary.status}" and cannot be published.`)
      continue
    }
    if (summary.status === 'deprecated') {
      deprecated.push(summary)
    }
    if (!current) {
      added.push(summary)
      continue
    }
    const answerChanged = String(current?.answerSummary?.correctChoiceId || '') !== summary.correctChoiceId
    const contentChanged = String(current?.contentHash || '') !== summary.contentHash
    const statusChanged = String(current?.status || '') !== summary.status
    if (answerChanged || contentChanged || statusChanged) {
      changed.push(summary)
    } else {
      unchanged.push(summary)
    }
  }

  const removed: NativeQuestionSummary[] = []
  for (const entry of currentEntries) {
    const id = String(entry?.id || '')
    if (!id || incomingById.has(id)) {
      continue
    }
    const summary = summarizeNativeQuestion(entry)
    removed.push(summary)
    errors.push(`Existing question "${id}" is missing from the incoming pack. Mark it deprecated instead of hard-deleting it.`)
  }

  const activeQuestionCount = activeNativeQuestionCount(incomingManifest)
  const totalQuestionCount = incomingEntries.length
  const incomingRevision = Number(incomingManifest?.revision?.number || 0)
  const currentRevision = Number(currentManifest?.revision?.number || 0)
  if (currentRevision > 0 && incomingRevision > 0 && incomingRevision <= currentRevision) {
    warnings.push(`Incoming revision ${incomingRevision} is not greater than current revision ${currentRevision}. Publishing will rewrite the manifest revision.`)
  }
  if (activeQuestionCount === 0) {
    errors.push('Incoming native pack has no ready questions.')
  }

  return {
    targetPackId: logicalTargetPackId,
    incomingPackId,
    currentRevision,
    incomingRevision,
    activeQuestionCount,
    totalQuestionCount,
    added,
    changed,
    unchanged,
    deprecated,
    blocked,
    removed,
    warnings,
    errors,
    canPublish: errors.length === 0
  }
}

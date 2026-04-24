export type NativeContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'media'; mediaId: string; caption?: string }

export interface NativeMediaRef {
  id: string
  path: string
  mimeType: string
  role: 'stem' | 'explanation' | 'source_slide'
  sha256?: string
  width?: number
  height?: number
}

export interface NativeChoice {
  id: string
  label?: string
  displayOrder: number
  originalOrder?: number
  text: NativeContentBlock[]
  textHash?: string
}

export interface NativeQuestion {
  id: string
  schemaVersion: 1
  status: 'draft' | 'ready' | 'blocked' | 'deprecated'
  stem: {
    blocks: NativeContentBlock[]
  }
  choices: NativeChoice[]
  answerKey: {
    correctChoiceId: string
  }
  explanation: {
    correct: NativeContentBlock[]
    incorrect?: Record<string, NativeContentBlock[]>
    educationalObjective?: NativeContentBlock[]
    references?: string[]
  }
  media: NativeMediaRef[]
  integrity?: {
    contentHash?: string
  }
}

const NATIVE_QUESTION_CACHE = new Map<string, NativeQuestion | Promise<NativeQuestion>>()
const NATIVE_QUESTION_CACHE_LIMIT = 64

function cacheKey(basePath: string, qid: string): string {
  return `${basePath}::${qid}`
}

function trimCache(): void {
  while (NATIVE_QUESTION_CACHE.size > NATIVE_QUESTION_CACHE_LIMIT) {
    const oldest = NATIVE_QUESTION_CACHE.keys().next().value
    if (!oldest) {
      return
    }
    NATIVE_QUESTION_CACHE.delete(oldest)
  }
}

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

export function nativeQuestionUrl(basePath: string, qid: string): string {
  return `${basePath}/questions/${encodeURIComponent(qid)}.json`
}

export function nativeMediaUrl(basePath: string, relativePath: string): string {
  return `${basePath}/${encodeRelativePath(relativePath.replace(/^\.?\//, ''))}`
}

async function fetchNativeQuestionUncached(basePath: string, qid: string): Promise<NativeQuestion> {
  const response = await window.fetch(nativeQuestionUrl(basePath, qid), { credentials: 'include' })
  if (!response.ok) {
    throw new Error('Unable to load native question content.')
  }
  return response.json()
}

export async function fetchNativeQuestion(basePath: string, qid: string): Promise<NativeQuestion> {
  if (!basePath || !qid) {
    throw new Error('Unable to load native question content.')
  }
  const key = cacheKey(basePath, qid)
  const cached = NATIVE_QUESTION_CACHE.get(key)
  if (cached && !(cached instanceof Promise)) {
    return cached
  }
  if (cached instanceof Promise) {
    return cached
  }
  const pending = fetchNativeQuestionUncached(basePath, qid)
    .then((question) => {
      NATIVE_QUESTION_CACHE.set(key, question)
      trimCache()
      return question
    })
    .catch((error) => {
      NATIVE_QUESTION_CACHE.delete(key)
      throw error
    })
  NATIVE_QUESTION_CACHE.set(key, pending)
  return pending
}

export function prefetchNativeQuestion(basePath: string, qid: string): void {
  if (!basePath || !qid) {
    return
  }
  const key = cacheKey(basePath, qid)
  if (NATIVE_QUESTION_CACHE.has(key)) {
    return
  }
  void fetchNativeQuestion(basePath, qid).catch(() => {
    // Prefetch failures are non-fatal; the on-demand fetch will retry.
  })
}

export function blocksToPlainText(blocks: NativeContentBlock[] | undefined): string {
  if (!Array.isArray(blocks)) {
    return ''
  }
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      parts.push(block.text)
    } else if (block.type === 'list') {
      parts.push(...block.items)
    } else if (block.type === 'table') {
      for (const row of block.rows) {
        parts.push(row.join(' '))
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function getNativeChoiceLabels(question: NativeQuestion): Record<string, string> {
  return Object.fromEntries(
    [...question.choices]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((choice) => [choice.id, blocksToPlainText(choice.text) || choice.label || `Choice ${choice.id}`])
  )
}

export function prefetchNativeQuestionMedia(basePath: string, question: NativeQuestion): void {
  if (typeof window === 'undefined') {
    return
  }
  for (const media of question.media) {
    if (!media.mimeType.startsWith('image/') || !media.path) {
      continue
    }
    const preload = new window.Image()
    preload.decoding = 'async'
    preload.src = nativeMediaUrl(basePath, media.path)
  }
}

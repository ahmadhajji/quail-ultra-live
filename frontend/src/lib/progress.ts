import type {
  BlockRecord,
  BucketName,
  BucketState,
  Mode,
  ProgressRecord,
  QbankInfo,
  QuestionState
} from '../types/domain'

type LegacyBlockRecord = Partial<BlockRecord> & Record<string, unknown>
type LooseProgressRecord = {
  blockhist?: Record<string, unknown>
  tagbuckets?: ProgressRecord['tagbuckets']
} & Record<string, unknown>

export function deriveBlockMode(block: Partial<BlockRecord> & { timelimit?: number; showans?: boolean }): Mode {
  return 'tutor'
}

export function createEmptyQuestionState(): QuestionState {
  return {
    submitted: false,
    revealed: false,
    correct: false,
    eliminatedChoices: []
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeBlockRecord(block: LegacyBlockRecord, choices: QbankInfo['choices']): BlockRecord {
  const blockqlist = asStringArray(block.blockqlist)
  const answers = asStringArray(block.answers).slice(0, blockqlist.length)
  while (answers.length < blockqlist.length) {
    answers.push('')
  }

  const highlights = asStringArray(block.highlights).slice(0, blockqlist.length)
  while (highlights.length < blockqlist.length) {
    highlights.push('[]')
  }

  const notes = asStringArray(block.notes).slice(0, blockqlist.length)
  while (notes.length < blockqlist.length) {
    notes.push('')
  }

  const mode: Mode = 'tutor'
  const sourceStates = Array.isArray(block.questionStates) ? block.questionStates : []
  const questionStates: QuestionState[] = []

  for (let index = 0; index < blockqlist.length; index += 1) {
    const state = typeof sourceStates[index] === 'object' && sourceStates[index] !== null
      ? sourceStates[index] as Partial<QuestionState>
      : undefined
    const answer = answers[index] ?? ''
    const qid = blockqlist[index] ?? ''
    const choiceMeta = choices[qid] ?? { correct: '' }
    const submitted = state?.submitted ?? answer !== ''
    const revealedDefault = Boolean(block.complete) || (mode === 'tutor' && submitted)
    const revealed = state?.revealed ?? revealedDefault
    const correct = state?.correct ?? (answer !== '' && answer === choiceMeta.correct)
    questionStates.push({
      submitted,
      revealed,
      correct,
      eliminatedChoices: asStringArray(state?.eliminatedChoices)
    })
  }

  return {
    blockqlist,
    answers,
    highlights,
    notes,
    questionStates,
    complete: Boolean(block.complete),
    timelimit: -1,
    elapsedtime: asFiniteNumber(block.elapsedtime, 0),
    numcorrect: asFiniteNumber(block.numcorrect, 0),
    mode,
    qpoolstr: typeof block.qpoolstr === 'string' ? block.qpoolstr : 'Unused',
    tagschosenstr: typeof block.tagschosenstr === 'string' ? block.tagschosenstr : '',
    allsubtagsenabled: block.allsubtagsenabled !== false,
    starttime: typeof block.starttime === 'string' ? block.starttime : new Date().toLocaleString(),
    currentquesnum: asFiniteNumber(block.currentquesnum, 0),
    showans: true,
    reviewLayout: block.reviewLayout === 'stacked' ? 'stacked' : 'split'
  }
}

function createEmptyBucketState(): BucketState {
  return {
    all: [],
    unused: [],
    incorrects: [],
    flagged: []
  }
}

export function createTagBuckets(index: QbankInfo['index'], tagnames: QbankInfo['tagnames']): ProgressRecord['tagbuckets'] {
  const tagBuckets: ProgressRecord['tagbuckets'] = {}
  const tagKeys = Object.keys(tagnames.tagnames).sort((a, b) => Number(a) - Number(b))
  const tags = tagKeys.map((key) => tagnames.tagnames[key] ?? '').filter(Boolean)

  for (const tag of tags) {
    tagBuckets[tag] = {}
  }

  for (const qid of Object.keys(index)) {
    for (const key of tagKeys) {
      const tagName = tagnames.tagnames[key]
      const subtag = index[qid]?.[key]
      if (!tagName || !subtag) {
        continue
      }
      tagBuckets[tagName] ??= {}
      tagBuckets[tagName][subtag] ??= createEmptyBucketState()
      tagBuckets[tagName][subtag].all.push(qid)
      tagBuckets[tagName][subtag].unused.push(qid)
    }
  }

  return tagBuckets
}

function getPrimaryBucket(progress: ProgressRecord, qbankinfo: Pick<QbankInfo, 'index' | 'tagnames'>, qid: string, bucket: BucketName): string[] {
  const primaryTag = qbankinfo.tagnames.tagnames['0']
  const primarySubtag = qbankinfo.index[qid]?.['0']
  if (!primaryTag || !primarySubtag) {
    return []
  }
  const tagBucket = progress.tagbuckets[primaryTag]?.[primarySubtag]
  if (!tagBucket) {
    return []
  }
  return tagBucket[bucket]
}

export function isInBucket(progress: ProgressRecord, qbankinfo: Pick<QbankInfo, 'index' | 'tagnames'>, qid: string, bucket: BucketName): boolean {
  return getPrimaryBucket(progress, qbankinfo, qid, bucket).includes(qid)
}

export function addToBucket(progress: ProgressRecord, qbankinfo: Pick<QbankInfo, 'index' | 'tagnames'>, qid: string, bucket: BucketName): void {
  const tagKeys = Object.keys(qbankinfo.tagnames.tagnames).sort((a, b) => Number(a) - Number(b))
  for (const key of tagKeys) {
    const tagName = qbankinfo.tagnames.tagnames[key]
    const subtag = qbankinfo.index[qid]?.[key]
    if (!tagName || !subtag) {
      continue
    }
    const target = progress.tagbuckets[tagName]?.[subtag]?.[bucket]
    if (target && !target.includes(qid)) {
      target.push(qid)
    }
  }
}

export function removeFromBucket(progress: ProgressRecord, qbankinfo: Pick<QbankInfo, 'index' | 'tagnames'>, qid: string, bucket: BucketName): void {
  const tagKeys = Object.keys(qbankinfo.tagnames.tagnames).sort((a, b) => Number(a) - Number(b))
  for (const key of tagKeys) {
    const tagName = qbankinfo.tagnames.tagnames[key]
    const subtag = qbankinfo.index[qid]?.[key]
    if (!tagName || !subtag) {
      continue
    }
    const target = progress.tagbuckets[tagName]?.[subtag]?.[bucket]
    const existingIndex = target?.indexOf(qid) ?? -1
    if (target && existingIndex > -1) {
      target.splice(existingIndex, 1)
    }
  }
}

function replayBuckets(progress: ProgressRecord, qbankinfo: Pick<QbankInfo, 'index' | 'tagnames'>): void {
  progress.tagbuckets = createTagBuckets(qbankinfo.index, qbankinfo.tagnames)
  const blockKeys = Object.keys(progress.blockhist).sort((a, b) => Number(a) - Number(b))
  for (const blockKey of blockKeys) {
    const block = progress.blockhist[blockKey]
    if (!block) {
      continue
    }
    for (let index = 0; index < block.blockqlist.length; index += 1) {
      const qid = block.blockqlist[index]
      if (!qid) {
        continue
      }
      if (isInBucket(progress, qbankinfo, qid, 'unused')) {
        removeFromBucket(progress, qbankinfo, qid, 'unused')
      }
      if (block.questionStates[index]?.correct === false) {
        addToBucket(progress, qbankinfo, qid, 'incorrects')
      }
    }
  }
}

export function normalizeProgress(progressLike: LooseProgressRecord | ProgressRecord, qbankinfo: Pick<QbankInfo, 'index' | 'tagnames' | 'choices'>): ProgressRecord {
  const rawBlockhist = typeof progressLike.blockhist === 'object' && progressLike.blockhist !== null
    ? progressLike.blockhist as Record<string, LegacyBlockRecord>
    : {}
  const progress: ProgressRecord = {
    blockhist: {},
    tagbuckets: typeof progressLike.tagbuckets === 'object' && progressLike.tagbuckets !== null
      ? progressLike.tagbuckets as ProgressRecord['tagbuckets']
      : createTagBuckets(qbankinfo.index, qbankinfo.tagnames)
  }

  for (const blockKey of Object.keys(rawBlockhist)) {
    progress.blockhist[blockKey] = normalizeBlockRecord(rawBlockhist[blockKey] ?? {}, qbankinfo.choices)
  }

  if (!progress.tagbuckets || Object.keys(progress.tagbuckets).length === 0) {
    replayBuckets(progress, qbankinfo)
  }

  return progress
}

export function getNextBlockKey(progress: ProgressRecord): string {
  const keys = Object.keys(progress.blockhist)
  if (keys.length === 0) {
    return '0'
  }
  return String(Math.max(...keys.map((key) => Number(key))) + 1)
}

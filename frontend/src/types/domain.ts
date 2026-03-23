export type Mode = 'tutor' | 'timed' | 'untimed'
export type ReviewLayout = 'split' | 'stacked'
export type BucketName = 'all' | 'unused' | 'incorrects' | 'flagged'

export interface User {
  id: string
  username: string
  createdAt: string
}

export interface StudyPackSummary {
  id: string
  name: string
  questionCount: number
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ChoiceMeta {
  options: string[]
  correct: string
}

export interface GroupLink {
  prev?: string | null | undefined
  next?: string | null | undefined
}

export interface PaneDefinition {
  file: string
  prefs: string
}

export interface QuestionState {
  submitted: boolean
  revealed: boolean
  correct: boolean
  eliminatedChoices: string[]
}

export interface BucketState {
  all: string[]
  unused: string[]
  incorrects: string[]
  flagged: string[]
}

export interface BlockRecord {
  blockqlist: string[]
  answers: string[]
  highlights: string[]
  questionStates: QuestionState[]
  complete: boolean
  timelimit: number
  elapsedtime: number
  numcorrect: number
  mode: Mode
  qpoolstr: string
  tagschosenstr: string
  allsubtagsenabled: boolean
  starttime: string
  currentquesnum: number
  showans: boolean
  reviewLayout: ReviewLayout
}

export interface ProgressRecord {
  blockhist: Record<string, BlockRecord>
  tagbuckets: Record<string, Record<string, BucketState>>
}

export interface QbankInfo {
  index: Record<string, Record<string, string>>
  tagnames: {
    tagnames: Record<string, string>
  }
  choices: Record<string, ChoiceMeta>
  groups: Record<string, GroupLink>
  panes: Record<string, PaneDefinition>
  progress: ProgressRecord
  path: string
  revision: number
  blockToOpen: string
}

export interface ImportSessionStatus {
  sessionId: string
  status: 'uploading' | 'finalizing' | 'completed' | 'failed'
  error: string
  pack: StudyPackSummary | null
}

export interface CachedPackEntry {
  id: string
  qbankinfo: QbankInfo
  packMeta: StudyPackSummary | null
  updatedAt: string
}

export interface DirtyProgressEntry {
  packId: string
  progress: ProgressRecord
  baseRevision: number
}

export interface StartBlockPreferences {
  mode: Mode
  timeperq: string
  qpoolstr: string
  tagschosenstr: string
  allsubtagsenabled: boolean
}

export interface BlockStartResult {
  blockKey: string
  revision: number
}

export interface RevisionPayload {
  revision: number
}

export interface ConflictPayload {
  error: string
  serverRevision: number
  qbankinfo?: QbankInfo
}

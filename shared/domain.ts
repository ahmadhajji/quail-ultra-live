export type Mode = 'tutor' | 'timed' | 'untimed'
export type ReviewLayout = 'split' | 'stacked'
export type BucketName = 'all' | 'unused' | 'incorrects' | 'flagged'
export type UserRole = 'user' | 'admin'
export type UserStatus = 'active' | 'disabled'
export type RegistrationMode = 'invite-only' | 'closed'
export type StorageBackend = 'local' | 'cloud' | 'railway'
export type UploadMode = 'multipart' | 'vercel-blob' | 'presigned'

export interface User {
  id: string
  username: string
  email: string
  role: UserRole
  status: UserStatus
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

export interface SourceSlideMeta {
  asset_path: string
  expandable: boolean
}

export interface FactCheckMeta {
  status: string
  note: string
  sources: string[]
  model: string
}

export interface ChoicePresentationMeta {
  shuffle_allowed: boolean
  display_order: string[]
}

export interface QuestionMeta {
  source: {
    deck_id: string
    slide_number: number
    question_index: number
    question_id: string
  }
  source_group_id: string
  source_slide: SourceSlideMeta
  slide_consensus: {
    status: string
  }
  fact_check: FactCheckMeta
  choice_text_by_letter: Record<string, string>
  choice_presentation: ChoicePresentationMeta
  warnings: string[]
  related_qids: string[]
  dedupe_fingerprint: string
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
  notes: string[]
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
  questionMeta?: Record<string, QuestionMeta>
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
  clientInstanceId: string
  clientMutationSeq: number
  clientUpdatedAt: string
  queuedAt: string
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
  applied?: boolean
  serverAcceptedAt?: string
}

export interface ConflictPayload {
  error: string
  serverRevision: number
  qbankinfo?: QbankInfo
}

export interface SyncMetadata {
  clientInstanceId: string
  clientMutationSeq: number
  clientUpdatedAt: string
}

export interface SyncProgressResult {
  revision?: number
  applied?: boolean
  serverAcceptedAt?: string
  queued?: boolean
}

export interface SyncProgressOptions {
  immediate?: boolean
  keepalive?: boolean
  silent?: boolean
}

export interface AppSettings {
  registrationMode: RegistrationMode
  storageBackend?: StorageBackend | undefined
  uploadMode?: UploadMode | undefined
  directBlobUploads?: boolean | undefined
}

export interface AdminUser extends User {
  updatedAt: string
  packCount: number
}

export interface InviteRecord {
  id: string
  email: string
  role: UserRole
  createdAt: string
  expiresAt: string
  usedAt: string
  revokedAt: string
  usedByUsername: string
  createdByUsername: string
}

export interface InviteCreationResult {
  invite: InviteRecord
  inviteUrl: string
}

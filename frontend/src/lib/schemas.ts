import { z } from 'zod'
import type { AdminUser, AppSettings, InviteCreationResult, InviteRecord, LibraryPackSummary, NativePackContent, NativePackDiff, NativeQuestionSummary, PackProgressSummary, QbankInfo, StudyPackSummary, User } from '../types/domain'

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().default(''),
  role: z.enum(['user', 'admin']).default('user'),
  status: z.enum(['active', 'disabled']).default('active'),
  created_at: z.string()
}).transform((value): User => ({
  id: value.id,
  username: value.username,
  email: value.email,
  role: value.role,
  status: value.status,
  createdAt: value.created_at
}))

export const adminUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().default(''),
  role: z.enum(['user', 'admin']),
  status: z.enum(['active', 'disabled']),
  created_at: z.string(),
  updated_at: z.string(),
  pack_count: z.number().default(0)
}).transform((value): AdminUser => ({
  id: value.id,
  username: value.username,
  email: value.email,
  role: value.role,
  status: value.status,
  createdAt: value.created_at,
  updatedAt: value.updated_at,
  packCount: value.pack_count
}))

export const inviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(['user', 'admin']),
  created_at: z.string(),
  expires_at: z.string(),
  used_at: z.string().nullable().default('').transform((value) => value ?? ''),
  revoked_at: z.string().nullable().default('').transform((value) => value ?? ''),
  used_by_username: z.string().nullable().default('').transform((value) => value ?? ''),
  created_by_username: z.string().nullable().default('').transform((value) => value ?? '')
}).transform((value): InviteRecord => ({
  id: value.id,
  email: value.email,
  role: value.role,
  createdAt: value.created_at,
  expiresAt: value.expires_at,
  usedAt: value.used_at,
  revokedAt: value.revoked_at,
  usedByUsername: value.used_by_username,
  createdByUsername: value.created_by_username
}))

export const studyPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  questionCount: z.number(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
})

const choiceMetaSchema = z.object({
  options: z.array(z.string()),
  correct: z.string()
})

const questionMetaSchema = z.object({
  source: z.object({
    deck_id: z.string().default(''),
    slide_number: z.number().default(0),
    question_index: z.number().default(1),
    question_id: z.string().default('')
  }),
  source_group_id: z.string().default(''),
  source_slide: z.object({
    asset_path: z.string().default(''),
    expandable: z.boolean().default(false)
  }).default({ asset_path: '', expandable: false }),
  slide_consensus: z.object({
    status: z.string().default('')
  }).default({ status: '' }),
  fact_check: z.object({
    status: z.string().default(''),
    note: z.string().default(''),
    sources: z.array(z.string()).default([]),
    model: z.string().default('')
  }).default({ status: '', note: '', sources: [], model: '' }),
  choice_text_by_letter: z.record(z.string(), z.string()).default({}),
  choice_presentation: z.object({
    shuffle_allowed: z.boolean().default(false),
    display_order: z.array(z.string()).default([])
  }).default({ shuffle_allowed: false, display_order: [] }),
  warnings: z.array(z.string()).default([]),
  related_qids: z.array(z.string()).default([]),
  dedupe_fingerprint: z.string().default('')
})

const bucketStateSchema = z.object({
  all: z.array(z.string()),
  unused: z.array(z.string()),
  incorrects: z.array(z.string()),
  flagged: z.array(z.string())
})

const progressSchema = z.object({
  blockhist: z.record(z.string(), z.unknown()).default({}),
  tagbuckets: z.record(z.string(), z.record(z.string(), bucketStateSchema)).default({})
})

export const qbankInfoSchema = z.object({
  format: z.enum(['legacy', 'native']).optional(),
  nativeContent: z.object({
    format: z.string(),
    schemaVersion: z.number(),
    manifestPath: z.string(),
    questionPaths: z.record(z.string(), z.string()).default({})
  }).optional(),
  index: z.record(z.string(), z.record(z.string(), z.string())),
  tagnames: z.object({
    tagnames: z.record(z.string(), z.string())
  }),
  choices: z.record(z.string(), choiceMetaSchema),
  groups: z.record(z.string(), z.object({
    prev: z.string().nullable().optional(),
    next: z.string().nullable().optional()
  })),
  panes: z.record(z.string(), z.object({
    file: z.string(),
    prefs: z.string()
  })),
  questionMeta: z.record(z.string(), questionMetaSchema).optional(),
  progress: progressSchema,
  path: z.string(),
  revision: z.number(),
  blockToOpen: z.string().default('')
})

export const sessionResponseSchema = z.object({
  user: userSchema.nullable()
})

export const authResponseSchema = z.object({
  user: userSchema
})

export const authConfigSchema = z.object({
  settings: z.object({
    registrationMode: z.enum(['invite-only', 'closed']),
    storageBackend: z.enum(['local', 'cloud', 'railway']).optional(),
    uploadMode: z.enum(['multipart', 'vercel-blob', 'presigned']).optional(),
    directBlobUploads: z.boolean().optional()
  })
}).transform((value): { settings: AppSettings } => value)

export const studyPacksResponseSchema = z.object({
  packs: z.array(studyPackSchema)
})

export const qbankInfoResponseSchema = z.object({
  qbankinfo: qbankInfoSchema,
  pack: studyPackSchema
})

export const manifestResponseSchema = z.object({
  files: z.array(z.string()),
  revision: z.number()
})

export const startBlockResponseSchema = z.object({
  blockKey: z.string(),
  revision: z.number()
})

export const revisionResponseSchema = z.object({
  revision: z.number(),
  applied: z.boolean().optional(),
  serverAcceptedAt: z.string().optional()
})

export const importSessionSchema = z.object({
  sessionId: z.string(),
  status: z.enum(['uploading', 'finalizing', 'completed', 'failed']),
  error: z.string(),
  pack: studyPackSchema.nullable()
})

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema)
})

export const appSettingsResponseSchema = z.object({
  settings: z.object({
    registrationMode: z.enum(['invite-only', 'closed'])
  })
}).transform((value): { settings: AppSettings } => value)

export const invitesResponseSchema = z.object({
  invites: z.array(inviteSchema)
})

export const inviteCreationResponseSchema = z.object({
  invite: inviteSchema,
  inviteUrl: z.string(),
  emailSent: z.boolean().optional()
}).transform((value): InviteCreationResult => value)

export const packsParser = (value: unknown): StudyPackSummary[] => studyPacksResponseSchema.parse(value).packs

export const libraryPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  questionCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
}).transform((value): LibraryPackSummary => value)

export const libraryPacksResponseSchema = z.object({
  packs: z.array(libraryPackSchema)
})

export const packProgressSummarySchema = z.object({
  totalBlocks: z.number(),
  completedBlocks: z.number(),
  totalQuestions: z.number(),
  correctCount: z.number(),
  unusedCount: z.number(),
  incorrectCount: z.number()
}).transform((value): PackProgressSummary => value)

export const nativeQuestionSummarySchema = z.object({
  id: z.string(),
  path: z.string().default(''),
  status: z.enum(['draft', 'ready', 'blocked', 'deprecated']),
  titlePreview: z.string().default(''),
  contentHash: z.string().default(''),
  correctChoiceId: z.string().default(''),
  tags: z.record(z.string(), z.unknown()).default({}),
  source: z.record(z.string(), z.unknown()).default({}),
  parserConfidence: z.number().nullable().default(null),
  reviewStatus: z.string().default(''),
  validationStatus: z.string().default(''),
  warnings: z.array(z.string()).default([]),
  changeSummary: z.string().default(''),
  replacesQuestionId: z.string().default('')
}).transform((value): NativeQuestionSummary => value)

export const nativePackDiffSchema = z.object({
  targetPackId: z.string().default(''),
  incomingPackId: z.string().default(''),
  currentRevision: z.number().default(0),
  incomingRevision: z.number().default(0),
  activeQuestionCount: z.number().default(0),
  totalQuestionCount: z.number().default(0),
  added: z.array(nativeQuestionSummarySchema).default([]),
  changed: z.array(nativeQuestionSummarySchema).default([]),
  unchanged: z.array(nativeQuestionSummarySchema).default([]),
  deprecated: z.array(nativeQuestionSummarySchema).default([]),
  blocked: z.array(nativeQuestionSummarySchema).default([]),
  removed: z.array(nativeQuestionSummarySchema).default([]),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  canPublish: z.boolean().default(false)
}).transform((value): NativePackDiff => value)

export const nativePackContentSchema = z.object({
  pack: libraryPackSchema,
  native: z.boolean(),
  error: z.string().optional(),
  manifest: z.object({
    packId: z.string(),
    title: z.string(),
    revision: z.object({
      number: z.number(),
      hash: z.string(),
      previousHash: z.string().optional()
    }),
    validation: z.object({
      status: z.string(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      blockedQuestionCount: z.number()
    }),
    activeQuestionCount: z.number(),
    totalQuestionCount: z.number()
  }).optional(),
  validation: z.object({
    ok: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string())
  }).optional(),
  questions: z.array(nativeQuestionSummarySchema).optional()
}).transform((value): NativePackContent => value)

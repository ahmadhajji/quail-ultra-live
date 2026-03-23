import { z } from 'zod'
import type { QbankInfo, StudyPackSummary, User } from '../types/domain'

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  created_at: z.string()
}).transform((value): User => ({
  id: value.id,
  username: value.username,
  createdAt: value.created_at
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
  revision: z.number()
})

export const importSessionSchema = z.object({
  sessionId: z.string(),
  status: z.enum(['uploading', 'finalizing', 'completed', 'failed']),
  error: z.string(),
  pack: studyPackSchema.nullable()
})

export const packsParser = (value: unknown): StudyPackSummary[] => studyPacksResponseSchema.parse(value).packs

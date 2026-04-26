// @ts-nocheck
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const Ajv2020Module = require('ajv/dist/2020.js')
const Ajv2020 = Ajv2020Module.default || Ajv2020Module
const packSchema = require('./native-contracts/quail-ultra-qbank/v1/pack.schema.json')
const questionSchema = require('./native-contracts/quail-ultra-qbank/v1/question.schema.json')
let progressHelpers
try {
  progressHelpers = require('./progress')
} catch (_error) {
  progressHelpers = require('./progress.ts')
}
const { createTagBuckets, normalizeProgress } = progressHelpers

const NATIVE_QBANK_FORMAT = 'quail-ultra-qbank'
const NATIVE_QBANK_SCHEMA_VERSION = 1
const NATIVE_QBANK_MANIFEST = 'quail-ultra-pack.json'
const NATIVE_QBANK_INFO_SNAPSHOT = 'qbankinfo-native.json'

type ValidationIssue = {
  path: string
  message: string
}

function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(questionSchema)
  return ajv
}

const ajv = createAjv()
const validatePackDocument = ajv.compile(packSchema)
const validateQuestionDocument = ajv.compile(questionSchema)

async function exists(targetPath: string) {
  try {
    await fsp.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath: string) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'))
}

function ajvErrors(prefix: string, errors: any[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const field = error.instancePath || '/'
    return `${prefix}${field}: ${error.message ?? 'invalid value'}`
  })
}

function safePackPath(workspaceDir: string, relativePath: string): string | null {
  if (!relativePath || path.isAbsolute(relativePath)) {
    return null
  }
  const cleanRelative = relativePath.split('/').filter(Boolean).join(path.sep)
  if (!cleanRelative || cleanRelative.split(path.sep).includes('..')) {
    return null
  }
  const root = path.resolve(workspaceDir)
  const resolved = path.resolve(root, cleanRelative)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null
  }
  return resolved
}

function pushDuplicateIssue(kind: string, id: string, seen: Set<string>, errors: string[]) {
  if (seen.has(id)) {
    errors.push(`Duplicate ${kind} id "${id}".`)
  }
  seen.add(id)
}

function collectMediaBlockIds(blocks: any[] | undefined): string[] {
  if (!Array.isArray(blocks)) {
    return []
  }
  return blocks
    .filter((block) => block && block.type === 'media' && typeof block.mediaId === 'string')
    .map((block) => block.mediaId)
}

function appendBlockText(parts: string[], blocks: any[] | undefined) {
  if (!Array.isArray(blocks)) {
    return
  }
  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      continue
    }
    if (block.type === 'paragraph' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'list' && Array.isArray(block.items)) {
      parts.push(...block.items.filter((item: unknown): item is string => typeof item === 'string'))
    } else if (block.type === 'table' && Array.isArray(block.rows)) {
      for (const row of block.rows) {
        if (Array.isArray(row)) {
          parts.push(row.filter((cell: unknown): cell is string => typeof cell === 'string').join(' '))
        }
      }
    }
  }
}

function blocksToText(blocks: any[] | undefined): string {
  const parts: string[] = []
  appendBlockText(parts, blocks)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function questionWarnings(question: any): string[] {
  const warnings = question?.quality?.warnings
  return Array.isArray(warnings) ? warnings.filter((entry): entry is string => typeof entry === 'string') : []
}

function buildIssuePath(issue: ValidationIssue): string {
  return issue.path ? `${issue.path}: ${issue.message}` : issue.message
}

async function hasNativeQbankManifest(workspaceDir: string): Promise<boolean> {
  return exists(path.join(workspaceDir, NATIVE_QBANK_MANIFEST))
}

async function detectQbankWorkspaceFormat(workspaceDir: string): Promise<'native' | 'legacy' | 'unknown'> {
  if (await hasNativeQbankManifest(workspaceDir)) {
    return 'native'
  }
  const entries = await fsp.readdir(workspaceDir, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  if (files.includes('index.json') || files.some((file) => file.endsWith('-q.html'))) {
    return 'legacy'
  }
  return 'unknown'
}

async function validateNativeQbankDirectory(workspaceDir: string) {
  const errors: string[] = []
  const warnings: string[] = []
  const questions: Record<string, any> = {}
  const manifestPath = path.join(workspaceDir, NATIVE_QBANK_MANIFEST)

  if (!(await exists(manifestPath))) {
    return {
      ok: false,
      manifest: null,
      questions,
      errors: [`Missing ${NATIVE_QBANK_MANIFEST}.`],
      warnings,
      questionCount: 0
    }
  }

  let manifest: any
  try {
    manifest = await readJson(manifestPath)
  } catch (error) {
    return {
      ok: false,
      manifest: null,
      questions,
      errors: [`Unable to parse ${NATIVE_QBANK_MANIFEST}: ${error instanceof Error ? error.message : String(error)}`],
      warnings,
      questionCount: 0
    }
  }

  if (!validatePackDocument(manifest)) {
    errors.push(...ajvErrors(`${NATIVE_QBANK_MANIFEST}`, validatePackDocument.errors))
  }

  if (manifest?.format !== NATIVE_QBANK_FORMAT) {
    errors.push(`${NATIVE_QBANK_MANIFEST}: format must be "${NATIVE_QBANK_FORMAT}".`)
  }
  if (manifest?.schemaVersion !== NATIVE_QBANK_SCHEMA_VERSION) {
    errors.push(`${NATIVE_QBANK_MANIFEST}: schemaVersion must be ${NATIVE_QBANK_SCHEMA_VERSION}.`)
  }
  if (manifest?.validation?.status === 'failed') {
    errors.push(`${NATIVE_QBANK_MANIFEST}: validation.status is failed.`)
  }

  const mediaById = new Map<string, any>()
  const seenMediaIds = new Set<string>()
  for (const media of Array.isArray(manifest?.mediaIndex) ? manifest.mediaIndex : []) {
    if (!media || typeof media.id !== 'string') {
      continue
    }
    pushDuplicateIssue('media', media.id, seenMediaIds, errors)
    mediaById.set(media.id, media)
    const mediaPath = safePackPath(workspaceDir, String(media.path ?? ''))
    if (!mediaPath) {
      errors.push(`mediaIndex "${media.id}" has unsafe path "${media.path ?? ''}".`)
    } else if (!(await exists(mediaPath))) {
      errors.push(`mediaIndex "${media.id}" points to missing file "${media.path}".`)
    }
  }

  const seenQuestionIds = new Set<string>()
  const questionIndex = Array.isArray(manifest?.questionIndex) ? manifest.questionIndex : []
  for (const entry of questionIndex) {
    const qid = String(entry?.id ?? '')
    if (!qid) {
      continue
    }
    pushDuplicateIssue('question', qid, seenQuestionIds, errors)
    if (entry.status === 'blocked' || entry.status === 'draft') {
      errors.push(`Question "${qid}" has status "${entry.status}". Published native packs may only include ready or deprecated questions.`)
    } else if (entry.status === 'deprecated') {
      warnings.push(`Question "${qid}" is deprecated and will be excluded from new blocks.`)
    }

    const questionPath = safePackPath(workspaceDir, String(entry?.path ?? ''))
    if (!questionPath) {
      errors.push(`Question "${qid}" has unsafe path "${entry?.path ?? ''}".`)
      continue
    }
    if (!(await exists(questionPath))) {
      errors.push(`Question "${qid}" points to missing file "${entry.path}".`)
      continue
    }

    let question: any
    try {
      question = await readJson(questionPath)
    } catch (error) {
      errors.push(`Unable to parse question "${qid}": ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    questions[qid] = question

    if (!validateQuestionDocument(question)) {
      errors.push(...ajvErrors(entry.path, validateQuestionDocument.errors))
    }
    if (question?.id !== qid) {
      errors.push(`Question file "${entry.path}" has id "${question?.id ?? ''}" but manifest uses "${qid}".`)
    }
    if (question?.status !== entry.status) {
      errors.push(`Question "${qid}" status mismatch between manifest and question file.`)
    }
    if (question?.integrity?.contentHash && question.integrity.contentHash !== entry.contentHash) {
      errors.push(`Question "${qid}" contentHash mismatch between manifest and question file.`)
    }

    const choiceIds = new Set<string>()
    for (const choice of Array.isArray(question?.choices) ? question.choices : []) {
      if (typeof choice?.id === 'string') {
        pushDuplicateIssue(`choice for question "${qid}"`, choice.id, choiceIds, errors)
      }
    }
    const correctChoiceId = question?.answerKey?.correctChoiceId
    if (typeof correctChoiceId === 'string' && !choiceIds.has(correctChoiceId)) {
      errors.push(`Question "${qid}" answerKey.correctChoiceId "${correctChoiceId}" is not present in choices.`)
    }
    if (entry?.answerSummary?.correctChoiceId && correctChoiceId !== entry.answerSummary.correctChoiceId) {
      errors.push(`Question "${qid}" correct answer mismatch between manifest and question file.`)
    }

    const questionMediaById = new Map<string, any>()
    for (const media of Array.isArray(question?.media) ? question.media : []) {
      if (!media || typeof media.id !== 'string') {
        continue
      }
      questionMediaById.set(media.id, media)
      if (!mediaById.has(media.id)) {
        errors.push(`Question "${qid}" references media "${media.id}" missing from manifest mediaIndex.`)
      }
      const mediaPath = safePackPath(workspaceDir, String(media.path ?? ''))
      if (!mediaPath) {
        errors.push(`Question "${qid}" media "${media.id}" has unsafe path "${media.path ?? ''}".`)
      } else if (!(await exists(mediaPath))) {
        errors.push(`Question "${qid}" media "${media.id}" points to missing file "${media.path}".`)
      }
    }

    for (const mediaId of collectMediaBlockIds(question?.stem?.blocks)) {
      const media = questionMediaById.get(mediaId) ?? mediaById.get(mediaId)
      if (!media) {
        errors.push(`Question "${qid}" stem references missing media "${mediaId}".`)
      } else if (media.role !== 'stem') {
        errors.push(`Question "${qid}" stem media "${mediaId}" has role "${media.role}" instead of "stem".`)
      }
    }

    const explanationMediaIds = [
      ...collectMediaBlockIds(question?.explanation?.correct),
      ...collectMediaBlockIds(question?.explanation?.educationalObjective)
    ]
    const incorrect = question?.explanation?.incorrect
    if (incorrect && typeof incorrect === 'object') {
      for (const blocks of Object.values(incorrect)) {
        explanationMediaIds.push(...collectMediaBlockIds(blocks as any[]))
      }
    }
    for (const mediaId of explanationMediaIds) {
      const media = questionMediaById.get(mediaId) ?? mediaById.get(mediaId)
      if (!media) {
        errors.push(`Question "${qid}" explanation references missing media "${mediaId}".`)
      } else if (media.role !== 'explanation') {
        errors.push(`Question "${qid}" explanation media "${mediaId}" has role "${media.role}" instead of "explanation".`)
      }
    }

    const sourceSlideMediaId = question?.source?.sourceSlideMediaId
    if (sourceSlideMediaId) {
      const media = questionMediaById.get(sourceSlideMediaId) ?? mediaById.get(sourceSlideMediaId)
      if (!media) {
        errors.push(`Question "${qid}" sourceSlideMediaId "${sourceSlideMediaId}" is not defined.`)
      } else if (media.role !== 'source_slide') {
        errors.push(`Question "${qid}" source slide media "${sourceSlideMediaId}" has role "${media.role}" instead of "source_slide".`)
      }
    }
  }

  const statusIssues: ValidationIssue[] = []
  for (const [qid, question] of Object.entries(questions)) {
    if (question?.quality?.validationStatus === 'failed') {
      statusIssues.push({ path: qid, message: 'question quality validationStatus is failed.' })
    }
    if (question?.quality?.reviewStatus === 'rejected') {
      statusIssues.push({ path: qid, message: 'question reviewStatus is rejected.' })
    }
  }
  errors.push(...statusIssues.map(buildIssuePath))

  return {
    ok: errors.length === 0,
    manifest,
    questions,
    errors,
    warnings,
    questionCount: Object.keys(questions).length
  }
}

function nativeQuestionToMeta(question: any, mediaById: Map<string, any>) {
  const sourceSlideMedia = question?.source?.sourceSlideMediaId
    ? mediaById.get(question.source.sourceSlideMediaId)
    : undefined
  const factCheck = question?.quality?.factCheck && typeof question.quality.factCheck === 'object'
    ? question.quality.factCheck
    : {}
  const orderedChoices = [...(Array.isArray(question?.choices) ? question.choices : [])]
    .sort((a, b) => Number(a?.displayOrder ?? 0) - Number(b?.displayOrder ?? 0))

  return {
    source: {
      deck_id: String(question?.source?.documentId ?? ''),
      slide_number: Number(question?.source?.slideNumber ?? 0),
      question_index: Number(question?.source?.questionIndex ?? 1),
      question_id: String(question?.id ?? '')
    },
    adjudication: {
      extraction_classification: String(question?.quality?.validationStatus === 'failed' ? 'needs_review' : 'accepted'),
      review_status: String(question?.quality?.reviewStatus ?? ''),
      review_reasons: [],
      validation: {
        status: String(question?.quality?.validationStatus ?? ''),
        errors: Array.isArray(question?.quality?.errors) ? question.quality.errors : []
      }
    },
    source_group_id: String(question?.source?.sourceGroupId ?? ''),
    source_slide: {
      asset_path: sourceSlideMedia?.path ? String(sourceSlideMedia.path) : '',
      expandable: Boolean(sourceSlideMedia?.path)
    },
    slide_consensus: {
      status: ''
    },
    fact_check: {
      status: String(factCheck.status ?? ''),
      note: String(factCheck.note ?? ''),
      sources: Array.isArray(factCheck.sources) ? factCheck.sources.filter((entry: unknown): entry is string => typeof entry === 'string') : [],
      model: String(factCheck.model ?? '')
    },
    choice_text_by_letter: Object.fromEntries(
      orderedChoices.map((choice) => [String(choice.id), blocksToText(choice.text)])
    ),
    choice_presentation: {
      shuffle_allowed: true,
      display_order: orderedChoices.map((choice) => String(choice.id))
    },
    warnings: questionWarnings(question),
    related_qids: Array.isArray(question?.dedupe?.relatedQuestionIds) ? question.dedupe.relatedQuestionIds : [],
    dedupe_fingerprint: String(question?.dedupe?.fingerprint ?? '')
  }
}

async function loadNativeWorkspaceData(workspaceDir: string) {
  const validation = await validateNativeQbankDirectory(workspaceDir)
  if (!validation.ok || !validation.manifest) {
    throw new Error(`Native QBank validation failed: ${validation.errors.slice(0, 10).join('; ')}`)
  }

  const notPublishable = validation.manifest.questionIndex
    .filter((entry: any) => entry.status === 'draft' || entry.status === 'blocked')
    .map((entry: any) => entry.id)
  if (notPublishable.length > 0) {
    throw new Error(`Native QBank contains draft or blocked questions: ${notPublishable.slice(0, 10).join(', ')}`)
  }

  const tagnames = {
    tagnames: {
      '0': 'Rotation',
      '1': 'Subject',
      '2': 'System',
      '3': 'Topic',
      '4': 'Source Material'
    }
  }
  const index: Record<string, Record<string, string>> = {}
  const choices: Record<string, { options: string[], correct: string }> = {}
  const groups: Record<string, Record<string, string>> = {}
  const panes: Record<string, { file: string, prefs: string }> = {}
  const questionMeta: Record<string, any> = {}
  const questionPaths: Record<string, string> = {}
  const mediaById = new Map<string, any>()
  for (const media of validation.manifest.mediaIndex ?? []) {
    mediaById.set(String(media.id), media)
  }

  for (const entry of validation.manifest.questionIndex) {
    const qid = String(entry.id)
    questionPaths[qid] = String(entry.path || `questions/${qid}.json`)
    const question = validation.questions[qid]
    const tags = question?.tags ?? entry.tags ?? {}
    if (entry.status === 'ready') {
      index[qid] = {
        '0': String(tags.rotation || validation.manifest.rotation || 'Untagged'),
        '1': String(tags.subject || 'Untagged'),
        '2': String(tags.system || 'Untagged'),
        '3': String(tags.topic || 'Untagged'),
        '4': String(tags.source_material || 'Untagged')
      }
    }
    const orderedChoices = [...(question?.choices ?? [])]
      .sort((a, b) => Number(a?.displayOrder ?? 0) - Number(b?.displayOrder ?? 0))
    choices[qid] = {
      options: orderedChoices.map((choice) => String(choice.id)),
      correct: String(question?.answerKey?.correctChoiceId ?? '')
    }
    questionMeta[qid] = nativeQuestionToMeta(question, mediaById)
  }

  let progress
  const progressPath = path.join(workspaceDir, 'progress.json')
  if (fs.existsSync(progressPath)) {
    progress = JSON.parse(await fsp.readFile(progressPath, 'utf8'))
  } else {
    progress = {
      blockhist: {},
      tagbuckets: createTagBuckets(index, tagnames)
    }
    await fsp.writeFile(progressPath, JSON.stringify(progress, null, 2))
  }

  const snapshot = {
    format: 'native',
    nativeContent: {
      format: NATIVE_QBANK_FORMAT,
      schemaVersion: NATIVE_QBANK_SCHEMA_VERSION,
      manifestPath: NATIVE_QBANK_MANIFEST,
      questionPaths
    },
    index,
    tagnames,
    choices,
    groups,
    panes,
    questionMeta
  }
  await fsp.writeFile(path.join(workspaceDir, NATIVE_QBANK_INFO_SNAPSHOT), JSON.stringify(snapshot, null, 2))

  const qbankinfo = {
    ...snapshot,
    progress
  }

  normalizeProgress(qbankinfo.progress, qbankinfo)
  await fsp.writeFile(progressPath, JSON.stringify(qbankinfo.progress, null, 2))
  return qbankinfo
}

function getNativeQuestionText(question: any): string {
  const parts: string[] = []
  appendBlockText(parts, question?.stem?.blocks)
  if (question?.question) {
    parts.push(String(question.question))
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

module.exports = {
  NATIVE_QBANK_FORMAT,
  NATIVE_QBANK_INFO_SNAPSHOT,
  NATIVE_QBANK_MANIFEST,
  NATIVE_QBANK_SCHEMA_VERSION,
  detectQbankWorkspaceFormat,
  getNativeQuestionText,
  hasNativeQbankManifest,
  loadNativeWorkspaceData,
  validateNativeQbankDirectory
}

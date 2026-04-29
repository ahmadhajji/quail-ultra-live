// @ts-nocheck
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const sanitizeHtml = require('sanitize-html')
let progressHelpers
let nativeQbankHelpers
try {
  progressHelpers = require('./progress')
} catch (_error) {
  progressHelpers = require('./progress.ts')
}
try {
  nativeQbankHelpers = require('./native-qbank')
} catch (_error) {
  nativeQbankHelpers = require('./native-qbank.ts')
}
const { createTagBuckets, normalizeProgress } = progressHelpers
const { NATIVE_QBANK_MANIFEST, hasNativeQbankManifest, loadNativeWorkspaceData } = nativeQbankHelpers

async function exists(targetPath) {
  try {
    await fsp.access(targetPath)
    return true
  } catch (error) {
    return false
  }
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2))
}

async function listDirectoryFiles(workspaceDir) {
  const entries = await fsp.readdir(workspaceDir, { withFileTypes: true })
  return entries.filter(function isFile(entry) {
    return entry.isFile()
  }).map(function toName(entry) {
    return entry.name
  })
}

function generateChoicesFromHtml(questionHtml, solutionHtml) {
  const regexcorrect = /[Cc]orrect[ \u00a0\n]*[Aa]nswer[ \u00a0\n]*[\.:][ \u00a0\n]*[A-Z]/gm
  const normalizedQuestionText = sanitizeHtml(questionHtml, { allowedTags: ['br'], allowedAttributes: {} })
    .replace(/<br *\/*>/g, '\n')
    .replace(/([?!.:])\s*([A-Z][\)\.]\s+)/g, '$1\n$2')

  const choiceRegex = /(?:^|\n)\s*([A-Z])[\)\.](?=\s+\S)/gm
  const questionMatches = []
  let choiceMatch
  while ((choiceMatch = choiceRegex.exec(normalizedQuestionText)) !== null) {
    questionMatches.push(choiceMatch[1])
  }

  const options = []
  if (questionMatches.length > 0) {
    for (const choice of questionMatches) {
      if (!options.includes(choice)) {
        options.push(choice)
      }
    }
  }

  const solutionMatches = sanitizeHtml(solutionHtml, { allowedTags: [], allowedAttributes: {} }).match(regexcorrect)
  const correct = solutionMatches ? solutionMatches[0].substring(solutionMatches[0].length - 1) : ''

  return {
    options: options,
    correct: correct
  }
}

async function ensureMetadataFiles(workspaceDir) {
  const files = await listDirectoryFiles(workspaceDir)
  const questionIds = []

  if (!(await exists(path.join(workspaceDir, 'index.json')))) {
    for (const file of files) {
      if (!file.endsWith('-q.html')) {
        continue
      }
      const qid = file.slice(0, -'-q.html'.length)
      if (files.includes(`${qid}-s.html`)) {
        questionIds.push(qid)
      }
    }

    const index = {}
    for (const qid of questionIds) {
      index[qid] = { 0: 'General' }
    }
    await writeJson(path.join(workspaceDir, 'index.json'), index)
  }

  if (!(await exists(path.join(workspaceDir, 'tagnames.json')))) {
    await writeJson(path.join(workspaceDir, 'tagnames.json'), { tagnames: { 0: 'General' } })
  }

  if (!(await exists(path.join(workspaceDir, 'groups.json')))) {
    await writeJson(path.join(workspaceDir, 'groups.json'), {})
  }

  if (!(await exists(path.join(workspaceDir, 'panes.json')))) {
    await writeJson(path.join(workspaceDir, 'panes.json'), {})
  }

  if (!(await exists(path.join(workspaceDir, 'choices.json')))) {
    const index = await readJson(path.join(workspaceDir, 'index.json'))
    const choices = {}
    for (const qid of Object.keys(index)) {
      const questionHtml = await fsp.readFile(path.join(workspaceDir, `${qid}-q.html`), 'utf8')
      const solutionHtml = await fsp.readFile(path.join(workspaceDir, `${qid}-s.html`), 'utf8')
      choices[qid] = generateChoicesFromHtml(questionHtml, solutionHtml)
    }
    await writeJson(path.join(workspaceDir, 'choices.json'), choices)
  }
}

async function loadWorkspaceData(workspaceDir) {
  if (await hasNativeQbankManifest(workspaceDir)) {
    return loadNativeWorkspaceData(workspaceDir)
  }

  await ensureMetadataFiles(workspaceDir)

  const index = await readJson(path.join(workspaceDir, 'index.json'))
  const tagnames = await readJson(path.join(workspaceDir, 'tagnames.json'))
  const choices = await readJson(path.join(workspaceDir, 'choices.json'))
  const groups = await readJson(path.join(workspaceDir, 'groups.json'))
  const panes = await readJson(path.join(workspaceDir, 'panes.json'))
  const questionMetaPath = path.join(workspaceDir, 'question-meta.json')
  const questionMeta = await exists(questionMetaPath) ? await readJson(questionMetaPath) : {}

  let progress
  const progressPath = path.join(workspaceDir, 'progress.json')
  if (await exists(progressPath)) {
    progress = await readJson(progressPath)
  } else {
    progress = {
      blockhist: {},
      tagbuckets: createTagBuckets(index, tagnames)
    }
    await writeJson(progressPath, progress)
  }

  const qbankinfo = {
    index: index,
    tagnames: tagnames,
    choices: choices,
    groups: groups,
    panes: panes,
    questionMeta: questionMeta,
    progress: progress
  }

  normalizeProgress(qbankinfo.progress, qbankinfo)
  await writeJson(progressPath, qbankinfo.progress)
  return qbankinfo
}

function withPackPath(qbankinfo, packId, revision, blockToOpen) {
  return Object.assign({}, qbankinfo, {
    path: `/api/study-packs/${packId}/file?rev=${encodeURIComponent(String(revision || 0))}`,
    revision: revision,
    blockToOpen: blockToOpen || ''
  })
}

async function saveProgress(workspaceDir, progress) {
  await writeJson(path.join(workspaceDir, 'progress.json'), progress)
}

async function listWorkspaceManifest(workspaceDir) {
  const results = []

  async function walk(currentDir, prefix) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }
      const nextAbsolute = path.join(currentDir, entry.name)
      const nextRelative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(nextAbsolute, nextRelative)
      } else if (entry.isFile()) {
        results.push(nextRelative)
      }
    }
  }

  await walk(workspaceDir, '')
  results.sort()
  return results
}

async function findWorkspaceRoot(importDir) {
  const entries = await fsp.readdir(importDir, { withFileTypes: true })
  const files = entries.filter(function filterFiles(entry) {
    return entry.isFile()
  }).map(function mapFiles(entry) {
    return entry.name
  })

  if (files.includes(NATIVE_QBANK_MANIFEST) || files.includes('index.json') || files.some(function isQuestionFile(file) { return file.endsWith('-q.html') })) {
    return importDir
  }

  const directories = entries.filter(function filterDirectories(entry) {
    return entry.isDirectory()
  })

  if (directories.length === 1) {
    return findWorkspaceRoot(path.join(importDir, directories[0].name))
  }

  return importDir
}

function safeResolveWorkspaceFile(workspaceDir, relativePath) {
  const raw = String(relativePath || '')
  if (!raw || raw.startsWith('/') || raw.startsWith('\\') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('Invalid workspace path')
  }
  const parts = raw.split('/')
  if (parts.some(function invalidPart(part) { return !part || part === '.' || part === '..' })) {
    throw new Error('Invalid workspace path')
  }
  const resolved = path.resolve(workspaceDir, parts.join(path.sep))
  const normalizedRoot = path.resolve(workspaceDir)
  if (resolved !== normalizedRoot && resolved.startsWith(normalizedRoot + path.sep)) {
    return resolved
  }
  throw new Error('Invalid workspace path')
}

module.exports = {
  ensureMetadataFiles,
  exists,
  findWorkspaceRoot,
  listWorkspaceManifest,
  loadWorkspaceData,
  readJson,
  safeResolveWorkspaceFile,
  saveProgress,
  withPackPath,
  writeJson
}

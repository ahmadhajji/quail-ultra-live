#!/usr/bin/env node
// @ts-nocheck
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { findWorkspaceRoot, readJson } = require('../shared/qbank')

async function exists(targetPath) {
  try {
    await fsp.access(targetPath)
    return true
  } catch (_error) {
    return false
  }
}

function parseLocalAssetPaths(html) {
  const results = new Set()
  const assetRegex = /\b(?:src|href)=["']([^"']+)["']/gi
  let match
  while ((match = assetRegex.exec(html)) !== null) {
    const candidate = match[1]
    if (!candidate || /^(?:https?:|data:|mailto:|#|javascript:)/i.test(candidate)) {
      continue
    }
    results.add(candidate.split('?')[0].split('#')[0])
  }
  return Array.from(results)
}

function extractChoiceLetters(questionHtml) {
  const normalized = questionHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/([?!.:])\s*([A-Z][\)\.]\s+)/g, '$1\n$2')
  const letters = []
  const choiceRegex = /(?:^|\n)\s*([A-Z])[\)\.](?=\s+\S)/gm
  let match
  while ((match = choiceRegex.exec(normalized)) !== null) {
    letters.push(match[1])
  }
  return letters
}

function validateGroupChains(groups, knownQids, errors, warnings) {
  for (const [qid, group] of Object.entries(groups || {})) {
    if (!knownQids.has(qid)) {
      errors.push(`groups.json references missing qid "${qid}".`)
    }
    for (const key of ['prev', 'next']) {
      const target = group && typeof group[key] === 'string' ? group[key] : ''
      if (target && !knownQids.has(target)) {
        errors.push(`groups.json points ${qid}.${key} to missing qid "${target}".`)
      }
    }
  }

  for (const startQid of Object.keys(groups || {})) {
    const seen = new Set()
    let current = startQid
    while (current) {
      if (seen.has(current)) {
        warnings.push(`Circular group chain detected starting at "${startQid}".`)
        break
      }
      seen.add(current)
      const next = groups[current] && typeof groups[current].next === 'string' ? groups[current].next : ''
      if (!next) {
        break
      }
      current = next
    }
  }
}

async function main() {
  const requestedPath = process.argv[2]
  if (!requestedPath) {
    console.error('Usage: npm run validate:qbank -- /absolute/or/relative/path/to/qbank')
    process.exit(1)
  }

  const workspaceInput = path.resolve(process.cwd(), requestedPath)
  const workspaceRoot = await findWorkspaceRoot(workspaceInput)
  const entries = await fsp.readdir(workspaceRoot, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)

  const errors = []
  const warnings = []
  const qidsFromQuestions = new Set(files.filter((name) => name.endsWith('-q.html')).map((name) => name.slice(0, -'-q.html'.length)))
  const qidsFromSolutions = new Set(files.filter((name) => name.endsWith('-s.html')).map((name) => name.slice(0, -'-s.html'.length)))

  for (const qid of qidsFromQuestions) {
    if (!qidsFromSolutions.has(qid)) {
      errors.push(`Missing paired solution file for "${qid}-q.html".`)
    }
  }
  for (const qid of qidsFromSolutions) {
    if (!qidsFromQuestions.has(qid)) {
      errors.push(`Missing paired question file for "${qid}-s.html".`)
    }
  }

  const metadataFiles = ['index.json', 'tagnames.json', 'choices.json', 'groups.json', 'panes.json']
  for (const metadataFile of metadataFiles) {
    if (!(await exists(path.join(workspaceRoot, metadataFile)))) {
      warnings.push(`${metadataFile} is missing. The app can auto-generate some metadata, but validation is tighter when it exists explicitly.`)
    }
  }

  const index = await exists(path.join(workspaceRoot, 'index.json')) ? await readJson(path.join(workspaceRoot, 'index.json')) : {}
  const choices = await exists(path.join(workspaceRoot, 'choices.json')) ? await readJson(path.join(workspaceRoot, 'choices.json')) : {}
  const groups = await exists(path.join(workspaceRoot, 'groups.json')) ? await readJson(path.join(workspaceRoot, 'groups.json')) : {}
  const panes = await exists(path.join(workspaceRoot, 'panes.json')) ? await readJson(path.join(workspaceRoot, 'panes.json')) : {}
  const questionMeta = await exists(path.join(workspaceRoot, 'question-meta.json')) ? await readJson(path.join(workspaceRoot, 'question-meta.json')) : {}
  const tagnames = await exists(path.join(workspaceRoot, 'tagnames.json')) ? await readJson(path.join(workspaceRoot, 'tagnames.json')) : { tagnames: { 0: 'General' } }

  const knownQids = new Set([...qidsFromQuestions, ...Object.keys(index)])

  for (const qid of Object.keys(index)) {
    if (!qidsFromQuestions.has(qid)) {
      errors.push(`index.json references qid "${qid}" without matching "${qid}-q.html" and "${qid}-s.html" files.`)
    }
    if (!Array.isArray(Object.values(index[qid] || {})) || Object.keys(index[qid] || {}).length === 0) {
      warnings.push(`index.json entry "${qid}" has no tag values.`)
    }
  }

  for (const qid of Object.keys(choices)) {
    if (!knownQids.has(qid)) {
      errors.push(`choices.json references missing qid "${qid}".`)
    }
  }

  for (const [qid, meta] of Object.entries(questionMeta || {})) {
    if (!knownQids.has(qid)) {
      errors.push(`question-meta.json references missing qid "${qid}".`)
      continue
    }
    const sourceSlide = meta && meta.source_slide && typeof meta.source_slide.asset_path === 'string' ? meta.source_slide.asset_path : ''
    if (sourceSlide && !(await exists(path.join(workspaceRoot, sourceSlide)))) {
      warnings.push(`question-meta.json for "${qid}" points to missing source slide "${sourceSlide}".`)
    }
    const displayOrder = meta && meta.choice_presentation && Array.isArray(meta.choice_presentation.display_order)
      ? meta.choice_presentation.display_order
      : []
    if (displayOrder.length > 0) {
      const options = (choices[qid] && Array.isArray(choices[qid].options)) ? choices[qid].options : []
      const mismatch = displayOrder.some((choice) => !options.includes(choice))
      if (mismatch) {
        warnings.push(`question-meta.json display_order for "${qid}" does not match choices.json options.`)
      }
    }
    const metaChoiceLabels = meta && meta.choice_text_by_letter && typeof meta.choice_text_by_letter === 'object'
      ? meta.choice_text_by_letter
      : {}
    if (Object.keys(metaChoiceLabels).length > 0 && choices[qid] && Array.isArray(choices[qid].options)) {
      const missing = choices[qid].options.filter((choice) => !(choice in metaChoiceLabels))
      if (missing.length > 0) {
        warnings.push(`question-meta.json for "${qid}" is missing labels for choices: ${missing.join(', ')}.`)
      }
    }
    const relatedQids = Array.isArray(meta && meta.related_qids) ? meta.related_qids : []
    for (const relatedQid of relatedQids) {
      if (!knownQids.has(relatedQid)) {
        warnings.push(`question-meta.json for "${qid}" references missing related qid "${relatedQid}".`)
      }
    }
  }

  const tagCount = Object.keys((tagnames && tagnames.tagnames) || {}).length
  for (const [qid, tagMap] of Object.entries(index)) {
    const count = Object.keys(tagMap || {}).length
    if (count !== tagCount) {
      warnings.push(`index.json entry "${qid}" has ${count} tag columns but tagnames.json defines ${tagCount}.`)
    }
  }

  validateGroupChains(groups, knownQids, errors, warnings)

  for (const [title, pane] of Object.entries(panes || {})) {
    if (!pane || typeof pane.file !== 'string' || !pane.file.trim()) {
      warnings.push(`Pane "${title}" is missing a valid file target.`)
      continue
    }
    if (!(await exists(path.join(workspaceRoot, pane.file)))) {
      warnings.push(`Pane "${title}" points to missing file "${pane.file}".`)
    }
  }

  for (const qid of qidsFromQuestions) {
    const questionPath = path.join(workspaceRoot, `${qid}-q.html`)
    const solutionPath = path.join(workspaceRoot, `${qid}-s.html`)
    const [questionHtml, solutionHtml] = await Promise.all([
      fsp.readFile(questionPath, 'utf8'),
      fsp.readFile(solutionPath, 'utf8')
    ])

    const extractedChoices = extractChoiceLetters(questionHtml)
    const uniqueChoices = Array.from(new Set(extractedChoices))
    if (uniqueChoices.length < 2) {
      warnings.push(`Question "${qid}" does not expose a reliable A/B/C-style choice pattern in the stem.`)
    }
    if (uniqueChoices.length !== extractedChoices.length) {
      warnings.push(`Question "${qid}" has duplicate or ambiguous choice markers in the stem.`)
    }
    if (questionMeta[qid] && questionMeta[qid].choice_text_by_letter) {
      const htmlLetters = new Set(uniqueChoices)
      const metaLetters = new Set(Object.keys(questionMeta[qid].choice_text_by_letter))
      const mismatch = [...metaLetters].some((choice) => !htmlLetters.has(choice))
      if (mismatch) {
        warnings.push(`Question "${qid}" metadata choice labels differ from HTML-derived choice letters.`)
      }
    }

    for (const assetPath of [...parseLocalAssetPaths(questionHtml), ...parseLocalAssetPaths(solutionHtml)]) {
      if (!(await exists(path.join(workspaceRoot, assetPath)))) {
        warnings.push(`Question "${qid}" references missing local asset "${assetPath}".`)
      }
    }
  }

  const summary = {
    workspaceRoot,
    questionCount: qidsFromQuestions.size,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings
  }

  console.log(`QBank root: ${workspaceRoot}`)
  console.log(`Questions: ${summary.questionCount}`)
  console.log(`Errors: ${summary.errorCount}`)
  console.log(`Warnings: ${summary.warningCount}`)

  if (errors.length > 0) {
    console.log('\nErrors:')
    for (const error of errors) {
      console.log(`- ${error}`)
    }
  }

  if (warnings.length > 0) {
    console.log('\nWarnings:')
    for (const warning of warnings) {
      console.log(`- ${warning}`)
    }
  }

  console.log('\nJSON Summary:')
  console.log(JSON.stringify(summary, null, 2))

  if (errors.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error)
  process.exit(1)
})

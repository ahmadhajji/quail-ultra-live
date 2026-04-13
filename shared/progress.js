function deriveBlockMode(block) {
  return 'tutor'
}

function createEmptyQuestionState() {
  return {
    submitted: false,
    revealed: false,
    correct: false,
    eliminatedChoices: []
  }
}

function normalizeBlockRecord(block, choices) {
  const normalized = Object.assign({}, block)
  const blockqlist = Array.isArray(normalized.blockqlist) ? normalized.blockqlist : []
  const answers = Array.isArray(normalized.answers) ? normalized.answers.slice(0, blockqlist.length) : []
  while (answers.length < blockqlist.length) {
    answers.push('')
  }

  const highlights = Array.isArray(normalized.highlights) ? normalized.highlights.slice(0, blockqlist.length) : []
  while (highlights.length < blockqlist.length) {
    highlights.push('[]')
  }

  const notes = Array.isArray(normalized.notes) ? normalized.notes.slice(0, blockqlist.length) : []
  while (notes.length < blockqlist.length) {
    notes.push('')
  }

  const mode = 'tutor'
  const questionStates = Array.isArray(normalized.questionStates) ? normalized.questionStates.slice(0, blockqlist.length) : []
  while (questionStates.length < blockqlist.length) {
    questionStates.push(createEmptyQuestionState())
  }

  const resolvedQuestionStates = questionStates.map(function resolveState(state, index) {
    const answer = answers[index]
    const qid = blockqlist[index]
    const choiceMeta = choices[qid] || { correct: '' }
    const submitted = state && state.submitted !== undefined ? state.submitted : answer !== ''
    const revealedDefault = normalized.complete || (mode === 'tutor' && submitted)
    const revealed = state && state.revealed !== undefined ? state.revealed : revealedDefault
    const correct = state && state.correct !== undefined ? state.correct : (answer !== '' && answer === choiceMeta.correct)
    const eliminatedChoices = state && Array.isArray(state.eliminatedChoices) ? state.eliminatedChoices : []
    return {
      submitted: submitted,
      revealed: revealed,
      correct: correct,
      eliminatedChoices: eliminatedChoices
    }
  })

  normalized.answers = answers
  normalized.highlights = highlights
  normalized.notes = notes
  normalized.mode = mode
  normalized.questionStates = resolvedQuestionStates
  normalized.reviewLayout = normalized.reviewLayout || 'split'
  normalized.showans = true
  normalized.timelimit = -1
  normalized.elapsedtime = normalized.elapsedtime || 0
  normalized.numcorrect = normalized.numcorrect || 0
  normalized.currentquesnum = normalized.currentquesnum || 0
  normalized.complete = Boolean(normalized.complete)
  return normalized
}

function createTagBuckets(index, tagnames) {
  const tagbuckets = {}
  const numtags = Object.keys(tagnames.tagnames || {}).length
  const tags = []

  for (let i = 0; i < numtags; i++) {
    const tagname = tagnames.tagnames[i]
    tags.push(tagname)
    tagbuckets[tagname] = {}
  }

  for (const qid of Object.keys(index)) {
    for (let i = 0; i < numtags; i++) {
      const tagname = tags[i]
      const subtagname = index[qid][i]
      if (!tagbuckets[tagname][subtagname]) {
        tagbuckets[tagname][subtagname] = {
          all: [],
          unused: [],
          incorrects: [],
          flagged: []
        }
      }
      tagbuckets[tagname][subtagname].all.push(qid)
      tagbuckets[tagname][subtagname].unused.push(qid)
    }
  }

  return tagbuckets
}

function getBucketTarget(progress, tagnames, index, qid, bucket) {
  const primaryTag = tagnames.tagnames[0]
  const primarySubtag = index[qid][0]
  return progress.tagbuckets[primaryTag][primarySubtag][bucket]
}

function isInBucket(progress, tagnames, index, qid, bucket) {
  return getBucketTarget(progress, tagnames, index, qid, bucket).includes(qid)
}

function addToBucket(progress, tagnames, index, qid, bucket) {
  const numtags = Object.keys(tagnames.tagnames || {}).length
  for (let i = 0; i < numtags; i++) {
    const tagname = tagnames.tagnames[i]
    const subtagname = index[qid][i]
    const target = progress.tagbuckets[tagname][subtagname][bucket]
    if (!target.includes(qid)) {
      target.push(qid)
    }
  }
}

function removeFromBucket(progress, tagnames, index, qid, bucket) {
  const numtags = Object.keys(tagnames.tagnames || {}).length
  for (let i = 0; i < numtags; i++) {
    const tagname = tagnames.tagnames[i]
    const subtagname = index[qid][i]
    const target = progress.tagbuckets[tagname][subtagname][bucket]
    const existingIndex = target.indexOf(qid)
    if (existingIndex > -1) {
      target.splice(existingIndex, 1)
    }
  }
}

function replayBuckets(progress, index, tagnames) {
  progress.tagbuckets = createTagBuckets(index, tagnames)
  const blockKeys = Object.keys(progress.blockhist || {}).sort(function sortKeys(a, b) {
    return parseInt(a, 10) - parseInt(b, 10)
  })

  for (const blockKey of blockKeys) {
    const block = progress.blockhist[blockKey]
    for (let i = 0; i < block.blockqlist.length; i++) {
      const qid = block.blockqlist[i]
      if (isInBucket(progress, tagnames, index, qid, 'unused')) {
        removeFromBucket(progress, tagnames, index, qid, 'unused')
      }
      const state = block.questionStates[i]
      if (state && state.correct === false) {
        addToBucket(progress, tagnames, index, qid, 'incorrects')
      }
    }
  }
}

function normalizeProgress(progress, qbankinfo) {
  if (!progress.blockhist) {
    progress.blockhist = {}
  }

  if (!progress.tagbuckets) {
    progress.tagbuckets = createTagBuckets(qbankinfo.index, qbankinfo.tagnames)
  }

  for (const blockKey of Object.keys(progress.blockhist)) {
    progress.blockhist[blockKey] = normalizeBlockRecord(progress.blockhist[blockKey], qbankinfo.choices)
  }

  if (!progress.tagbuckets || Object.keys(progress.tagbuckets).length === 0) {
    replayBuckets(progress, qbankinfo.index, qbankinfo.tagnames)
  }

  return progress
}

function getNextBlockKey(progress) {
  const keys = Object.keys(progress.blockhist || {})
  if (keys.length === 0) {
    return '0'
  }
  const maxKey = Math.max.apply(null, keys.map(function toNumber(key) {
    return parseInt(key, 10)
  }))
  return String(maxKey + 1)
}

function startBlock(qbankinfo, blockqlist, preferences) {
  const progress = qbankinfo.progress

  for (const qid of blockqlist) {
    if (isInBucket(progress, qbankinfo.tagnames, qbankinfo.index, qid, 'unused')) {
      removeFromBucket(progress, qbankinfo.tagnames, qbankinfo.index, qid, 'unused')
    }
  }

  const blockKey = getNextBlockKey(progress)
  const mode = 'tutor'
  const timelimit = -1

  progress.blockhist[blockKey] = {
    blockqlist: blockqlist,
    answers: Array(blockqlist.length).fill(''),
    highlights: Array(blockqlist.length).fill('[]'),
    notes: Array(blockqlist.length).fill(''),
    questionStates: Array(blockqlist.length).fill(null).map(createEmptyQuestionState),
    complete: false,
    timelimit: timelimit,
    elapsedtime: 0,
    numcorrect: 0,
    mode: mode,
    qpoolstr: preferences.qpoolstr || 'Unused',
    tagschosenstr: preferences.tagschosenstr || '',
    allsubtagsenabled: preferences.allsubtagsenabled !== false,
    starttime: new Date().toLocaleString(),
    currentquesnum: 0,
    showans: true,
    reviewLayout: 'split'
  }

  return blockKey
}

function deleteBlock(qbankinfo, blockKey) {
  const block = qbankinfo.progress.blockhist[blockKey]
  if (!block) {
    return
  }

  for (const qid of block.blockqlist) {
    if (isInBucket(qbankinfo.progress, qbankinfo.tagnames, qbankinfo.index, qid, 'incorrects')) {
      removeFromBucket(qbankinfo.progress, qbankinfo.tagnames, qbankinfo.index, qid, 'incorrects')
    }
    if (isInBucket(qbankinfo.progress, qbankinfo.tagnames, qbankinfo.index, qid, 'flagged')) {
      removeFromBucket(qbankinfo.progress, qbankinfo.tagnames, qbankinfo.index, qid, 'flagged')
    }
    addToBucket(qbankinfo.progress, qbankinfo.tagnames, qbankinfo.index, qid, 'unused')
  }

  delete qbankinfo.progress.blockhist[blockKey]
}

module.exports = {
  addToBucket,
  createTagBuckets,
  deleteBlock,
  deriveBlockMode,
  getNextBlockKey,
  isInBucket,
  normalizeBlockRecord,
  normalizeProgress,
  removeFromBucket,
  replayBuckets,
  startBlock
}

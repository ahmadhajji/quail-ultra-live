let $ = jQuery = require('jquery')
let Bootstrap = require('bootstrap')
const {ipcRenderer} = require('electron')
const url = require('url')

let localinfo
let blockKey
let block
let numQuestions
let selectedQnum
let blockqlist
let qid
let numtags
let currentHighlightColor = '#fff59d'
let timewarning = true
let timerInterval
let hltr
let scrollToExplanationOnLoad = false
let currentChoiceLabels = {}
let timerStartedAt = 0
let timerBaseElapsed = 0

function refreshBlock() {
  block = localinfo.progress.blockhist[blockKey]
}

function currentState() {
  return block.questionStates[selectedQnum]
}

function currentAnswer() {
  return block.answers[selectedQnum]
}

function isInBucket(thisqid, bucket) {
  return localinfo.progress.tagbuckets[localinfo.tagnames.tagnames[0]][localinfo.index[thisqid][0]][bucket].includes(thisqid)
}

function addToBucket(thisqid, bucket) {
  for (let i = 0; i < numtags; i++) {
    localinfo.progress.tagbuckets[localinfo.tagnames.tagnames[i]][localinfo.index[thisqid][i]][bucket].push(thisqid)
  }
}

function removeFromBucket(thisqid, bucket) {
  for (let i = 0; i < numtags; i++) {
    const index = localinfo.progress.tagbuckets[localinfo.tagnames.tagnames[i]][localinfo.index[thisqid][i]][bucket].indexOf(thisqid)
    if (index > -1) {
      localinfo.progress.tagbuckets[localinfo.tagnames.tagnames[i]][localinfo.index[thisqid][i]][bucket].splice(index, 1)
    }
  }
}

function modeLabel(mode) {
  if (mode === 'timed') {
    return 'Timed'
  }
  if (mode === 'untimed') {
    return 'Untimed'
  }
  return 'Tutor'
}

function formatClock(totalSeconds) {
  const absSeconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(absSeconds / 3600)}:${Math.floor((absSeconds % 3600) / 60).toString().padStart(2, '0')}:${Math.floor(absSeconds % 60).toString().padStart(2, '0')}`
}

function timerShouldRun() {
  if (block.complete) {
    return false
  }
  if (block.mode === 'tutor') {
    return !currentState().submitted
  }
  return true
}

function getLiveElapsedTime() {
  if (block.complete) {
    return block.elapsedtime
  }
  if (!timerStartedAt) {
    return timerBaseElapsed
  }
  return timerBaseElapsed + ((Date.now() - timerStartedAt) / 1000)
}

function commitRunningElapsed() {
  if (block.complete || !timerStartedAt) {
    return
  }
  timerBaseElapsed = getLiveElapsedTime()
  timerStartedAt = 0
  block.elapsedtime = timerBaseElapsed
}

function syncTimerState() {
  if (block.complete) {
    commitRunningElapsed()
    updateTimer()
    return
  }

  if (timerShouldRun()) {
    if (!timerStartedAt) {
      timerStartedAt = Date.now()
    }
  } else {
    commitRunningElapsed()
  }

  block.elapsedtime = getLiveElapsedTime()
  updateTimer()
}

function persistProgress() {
  ipcRenderer.send('saveprogress', localinfo.progress)
}

function explanationVisible(index = selectedQnum) {
  const state = block.questionStates[index]
  return block.complete || (block.mode === 'tutor' && state.revealed)
}

function questionLocked(index = selectedQnum) {
  if (block.complete) {
    return true
  }
  if (block.mode === 'tutor') {
    return block.questionStates[index].submitted
  }
  return false
}

function syncQuestionState(index) {
  const state = block.questionStates[index]
  const answer = block.answers[index]
  const correct = localinfo.choices[blockqlist[index]].correct

  if (block.complete) {
    state.submitted = answer !== ''
    state.revealed = true
    state.correct = answer !== '' && answer === correct
    return
  }

  if (block.mode === 'tutor') {
    state.correct = answer !== '' && answer === correct
  } else {
    state.submitted = answer !== ''
    state.correct = answer !== '' && answer === correct
  }
}

function renderHeader() {
  $('#modeChip')
    .text(modeLabel(block.mode).toUpperCase())
    .removeClass('mode-tutor mode-timed mode-untimed')
    .addClass(`mode-${block.mode}`)

  const isReview = block.complete
  $('#btn-close span').text(isReview ? 'Back' : 'End Block')
  $('#btn-pause').toggleClass('exam-hidden', isReview)
}

function renderQuestionList() {
  $('#listgroup-questions').empty()
  for (let i = 0; i < numQuestions; i++) {
    const state = block.questionStates[i]
    const answer = block.answers[i]
    const classes = ['list-group-item']
    if (answer !== '') {
      classes.push('q-item-answered')
    }
    if (block.complete || (block.mode === 'tutor' && state.revealed)) {
      classes.push(state.correct ? 'q-item-correct' : 'q-item-incorrect')
    }
    if (i === selectedQnum) {
      classes.push('active')
    }

    let statusHtml = ''
    if (block.complete || (block.mode === 'tutor' && state.revealed)) {
      statusHtml = `<span class="q-status-dot ${state.correct ? 'correct' : 'incorrect'}">${state.correct ? '&#10003;' : '&#10005;'}</span>`
    }

    let flagHtml = ''
    if (isInBucket(blockqlist[i], 'flagged')) {
      flagHtml = '<span class="q-flag-dot">F</span>'
    }

    const html = `<li class="${classes.join(' ')}" data-qnum="${i}">
      <span>${i + 1}</span>
      ${flagHtml}
      ${statusHtml}
    </li>`
    $('#listgroup-questions').append(html)
  }

  $('.list-group-item').on('click', function() {
    const nextQnum = parseInt($(this).data('qnum'), 10)
    if (nextQnum !== selectedQnum) {
      commitRunningElapsed()
      selectedQnum = nextQnum
      block.currentquesnum = selectedQnum
      persistProgress()
    }
    loadQuestion()
  })
}

function setQuestionStatePill(cssClass, text) {
  $('#questionStatePill')
    .removeClass('awaiting answered correct incorrect review')
    .addClass(cssClass)
    .text(text)
}

function renderQuestionMeta() {
  $('#questionMetaTop').text(`Item ${selectedQnum + 1} of ${numQuestions}`)
  $('#questionIdTop').text(`Question Id: ${qid}`)
}

function renderExplanationMeta() {
  if (explanationVisible()) {
    $('#explanationSection').removeClass('exam-hidden')
    $('#explanationMeta').text(block.complete ? 'Full review is available for this completed block.' : 'Explanation visible immediately after answer submission.')
    $('#reviewStatePill').removeClass('awaiting answered correct incorrect review').addClass('review').text(block.complete ? 'Review' : 'Revealed')
  } else {
    $('#explanationSection').addClass('exam-hidden')
    if (block.mode === 'tutor') {
      $('#explanationMeta').text('Submit the current question to reveal the explanation.')
    } else {
      $('#explanationMeta').text('Explanation hidden until you end the block and enter review mode.')
    }
    $('#reviewStatePill').removeClass('awaiting answered correct incorrect review').addClass('awaiting').text('Hidden')
  }
}

function renderTopControls() {
  $('#btn-prevques').prop('disabled', selectedQnum === 0)
  $('#btn-nextques').text(selectedQnum === numQuestions - 1 ? (block.complete ? 'Back' : 'Finish') : 'Next')
  $('#btn-nextques-inline').text(selectedQnum === numQuestions - 1 ? (block.complete ? 'Back to Blocks' : (block.mode === 'tutor' ? 'Finish Review' : 'End Block')) : 'Next Question')
  $('#btn-flagged').toggleClass('active', isInBucket(qid, 'flagged'))
}

function renderActionButtons() {
  const state = currentState()
  const hasAnswer = currentAnswer() !== ''

  if (block.complete) {
    $('#btn-submit-answer').addClass('exam-hidden')
    $('#btn-nextques-inline').removeClass('exam-hidden').prop('disabled', false)
    return
  }

  if (block.mode === 'tutor') {
    $('#btn-submit-answer').removeClass('exam-hidden')
    $('#btn-submit-answer').prop('disabled', !hasAnswer || state.submitted)
    $('#btn-submit-answer').text(state.submitted ? 'Answer Submitted' : 'Submit Answer')
    $('#btn-nextques-inline').removeClass('exam-hidden').prop('disabled', !state.submitted)
  } else {
    $('#btn-submit-answer').addClass('exam-hidden')
    $('#btn-nextques-inline').removeClass('exam-hidden').prop('disabled', false)
  }
}

function createAnswerChoiceButtons() {
  $('#btngrp-choices').empty()
  const answer = currentAnswer()
  const state = currentState()
  const correctChoice = localinfo.choices[qid].correct
  const showOutcome = block.complete || (block.mode === 'tutor' && state.revealed)
  const eliminatedChoices = Array.isArray(state.eliminatedChoices) ? state.eliminatedChoices : []

  for (const choice of localinfo.choices[qid].options) {
    const row = $('<div class="exam-choice-row"></div>')
    const button = $('<button type="button" class="exam-choice-btn"></button>')
    const eliminateButton = $('<button type="button" class="exam-eliminate-btn">Eliminate</button>')
    button.append(`<span class="exam-choice-letter">${choice}</span>`)
    button.append(`<span class="exam-choice-label">${currentChoiceLabels[choice] || `Choice ${choice}`}</span>`)

    const isEliminated = eliminatedChoices.includes(choice)
    if (isEliminated) {
      button.addClass('choice-eliminated')
      eliminateButton.addClass('active').text('Restore')
    }

    if (showOutcome) {
      if (choice === correctChoice) {
        button.addClass('choice-correct')
      } else if (choice === answer) {
        button.addClass('choice-incorrect')
      }
      button.prop('disabled', true)
    } else {
      if (choice === answer) {
        button.addClass('active')
      }
      if (questionLocked() || isEliminated) {
        button.prop('disabled', true)
      }
    }

    button.on('click', function() {
      if (questionLocked()) {
        return
      }
      const previousAnswer = block.answers[selectedQnum]
      if (Array.isArray(state.eliminatedChoices)) {
        state.eliminatedChoices = state.eliminatedChoices.filter(function(value) {
          return value !== choice
        })
      }
      block.answers[selectedQnum] = choice
      syncQuestionState(selectedQnum)
      createAnswerChoiceButtons()
      renderQuestionMeta()
      renderQuestionList()
      renderActionButtons()
      persistProgress()
      if (previousAnswer === '' && block.mode === 'tutor') {
        ipcRenderer.send('answerselect')
      }
    })

    eliminateButton.on('click', function() {
      if (showOutcome || questionLocked()) {
        return
      }
      if (!Array.isArray(state.eliminatedChoices)) {
        state.eliminatedChoices = []
      }
      if (state.eliminatedChoices.includes(choice)) {
        state.eliminatedChoices = state.eliminatedChoices.filter(function(value) {
          return value !== choice
        })
      } else {
        state.eliminatedChoices.push(choice)
        if (block.answers[selectedQnum] === choice) {
          block.answers[selectedQnum] = ''
        }
      }
      syncQuestionState(selectedQnum)
      createAnswerChoiceButtons()
      renderQuestionMeta()
      renderActionButtons()
      persistProgress()
    })

    row.append(button)
    row.append(eliminateButton)
    $('#btngrp-choices').append(row)
  }
}

function setHighlightColor(color) {
  currentHighlightColor = color
  $('.highlight-swatch').removeClass('active')
  $(`.highlight-swatch[data-color="${color}"]`).addClass('active')
  if (hltr) {
    hltr.setColor(color)
  }
}

function applyAssetPaths(container, maxHeight) {
  const qbpath = url.pathToFileURL(localinfo.path).toString()

  function resolveAssetPath(rawPath) {
    if (!rawPath || rawPath.startsWith('data:') || rawPath.startsWith('blob:') || rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
      return rawPath
    }
    if (rawPath.startsWith('/api/')) {
      return rawPath
    }
    return `${qbpath}/${rawPath.replace(/^\.?\//, '')}`
  }

  container.find('img').each(function() {
    const source = $(this).attr('src')
    this.src = resolveAssetPath(source)
    this.style.maxWidth = '100%'
    this.style.maxHeight = maxHeight
    $(this).off('click').on('click', () => window.open(this.src))
  })

  container.find('audio').each(function() {
    if (this.src === '') {
      const source = $(this).find('source').get(0)
      if (source && source.getAttribute('src')) {
        this.src = resolveAssetPath(source.getAttribute('src'))
      }
    } else {
      this.src = resolveAssetPath($(this).attr('src'))
    }
  })

  container.find('video').each(function() {
    this.src = resolveAssetPath($(this).attr('src'))
  })

  container.find('a').each(function() {
    const href = $(this).attr('href')
    if (href) {
      this.href = resolveAssetPath(href)
    }
  })
}

function bindHighlightRemoval(highlights) {
  for (const highlight of highlights) {
    $(highlight).off('click').on('click', function(event) {
      const timestamp = $(event.target).data('timestamp')
      for (const otherHighlight of hltr.getHighlights()) {
        if ($(otherHighlight).data('timestamp') === timestamp) {
          hltr.removeHighlights(otherHighlight)
        }
      }
      block.highlights[selectedQnum] = hltr.serializeHighlights()
      persistProgress()
    })
  }
}

function extractChoiceLabels() {
  currentChoiceLabels = {}
  const cloned = $('#leftreplace').clone()
  cloned.find('br').replaceWith('\n')
  const rawText = cloned.text().replace(/\r/g, '').replace(/([?!.:])\s*([A-Z][\)\.]\s+)/g, '$1\n$2')
  const choiceRegex = /(?:^|\n)\s*([A-Z])[\)\.]\s*(.+?)(?=(?:\n\s*[A-Z][\)\.]\s)|$)/gs
  let match
  while ((match = choiceRegex.exec(rawText)) !== null) {
    currentChoiceLabels[match[1]] = match[2].replace(/\s+/g, ' ').trim()
  }
}

function isChoiceLine(text) {
  return /^[A-Z][\)\.]\s+\S+/.test(text.replace(/\u00a0/g, ' ').trim())
}

function stripChoicesFromQuestionDisplay() {
  $('#leftreplace').find('p, div').each(function() {
    const html = $(this).html()
    if (!html) {
      return
    }

    const segments = html.split(/<br\s*\/?>/i)
    const meaningfulSegments = segments.filter(function(segment) {
      return $('<div>').html(segment).text().replace(/\u00a0/g, ' ').trim() !== ''
    })

    if (meaningfulSegments.length === 0) {
      return
    }

    const choiceSegments = meaningfulSegments.filter(function(segment) {
      return isChoiceLine($('<div>').html(segment).text())
    })

    if (choiceSegments.length === 0) {
      return
    }

    if (choiceSegments.length === meaningfulSegments.length) {
      $(this).remove()
      return
    }

    const keptSegments = segments.filter(function(segment) {
      const text = $('<div>').html(segment).text().replace(/\u00a0/g, ' ').trim()
      return text === '' || !isChoiceLine(text)
    })

    $(this).html(
      keptSegments
        .join('<br>')
        .replace(/^(?:\s|<br\s*\/?>)+|(?:\s|<br\s*\/?>)+$/gi, '')
    )

    if ($(this).text().replace(/\u00a0/g, ' ').trim() === '') {
      $(this).remove()
    }
  })
}

function initHighlighter() {
  hltr = new TextHighlighter($('#leftreplace').get(0), {
    color: currentHighlightColor,
    onAfterHighlight: function(range, highlights) {
      bindHighlightRemoval(highlights)
      block.highlights[selectedQnum] = hltr.serializeHighlights()
      persistProgress()
    }
  })
  hltr.deserializeHighlights(block.highlights[selectedQnum])
  bindHighlightRemoval(hltr.getHighlights())
}

function updateContent() {
  stripChoicesFromQuestionDisplay()
  applyAssetPaths($('#leftreplace'), `${Math.floor(window.innerHeight * 0.4)}px`)
  applyAssetPaths($('#rightreplace'), `${Math.floor(window.innerHeight * 0.5)}px`)

  $('#continuousScroll').get(0).scrollTop = 0

  initHighlighter()

  if (scrollToExplanationOnLoad && explanationVisible()) {
    scrollToExplanationOnLoad = false
    const node = $('#explanationSection').get(0)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
}

function populatePanes() {
  $('#btngrp-panes').empty()
  for (const panetext in localinfo.panes) {
    const panebtnhtml = `<button class="btn btn-outline-primary openpane" type="button" data-key="${panetext}">${panetext}</button>`
    $('#btngrp-panes').append(panebtnhtml)
  }
  $('.openpane').on('click', function() {
    const paneurl = localinfo.path + '/' + localinfo.panes[$(this).data('key')].file
    const prefs = localinfo.panes[$(this).data('key')].prefs
    const title = $(this).data('key')
    window.open(paneurl, title, prefs)
  })
}

function updateTimer() {
  if (block.complete) {
    $('#timeLabel').text('Time Used')
    $('#timep').text(formatClock(block.elapsedtime))
    return
  }

  const elapsedtime = getLiveElapsedTime()
  if (block.mode === 'timed') {
    const remainingtime = block.timelimit - elapsedtime
    $('#timeLabel').text('Time Remaining')
    if (remainingtime >= 0) {
      $('#timep').text(formatClock(remainingtime))
    } else {
      $('#timep').text(`-${formatClock(Math.abs(remainingtime))}`)
      if (timewarning) {
        timewarning = false
        finishBlock(true)
      }
    }
  } else {
    $('#timeLabel').text('Time Used')
    $('#timep').text(formatClock(elapsedtime))
  }
}

function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval)
  }
  if (block.complete) {
    timerInterval = null
    updateTimer()
    return
  }
  timerBaseElapsed = block.elapsedtime || 0
  timerStartedAt = 0
  timerInterval = setInterval(updateTimer, 500)
  syncTimerState()
}

function freezeElapsedTime() {
  if (!block.complete) {
    commitRunningElapsed()
    block.elapsedtime = timerBaseElapsed
  }
}

function finalizeBlockResults() {
  let numcorrect = 0
  for (let i = 0; i < numQuestions; i++) {
    const thisqid = blockqlist[i]
    const answer = block.answers[i]
    const correctChoice = localinfo.choices[thisqid].correct
    const state = block.questionStates[i]

    state.submitted = answer !== ''
    state.revealed = true
    state.correct = answer !== '' && answer === correctChoice

    if (state.correct) {
      numcorrect++
      if (isInBucket(thisqid, 'incorrects')) {
        removeFromBucket(thisqid, 'incorrects')
      }
    } else if (!isInBucket(thisqid, 'incorrects')) {
      addToBucket(thisqid, 'incorrects')
    }
  }
  block.numcorrect = numcorrect
}

function finishBlock(force = false) {
  if (block.complete) {
    block.currentquesnum = selectedQnum
    ipcRenderer.send('pauseblock', localinfo.progress)
    return
  }

  if (!force && !confirm(`${timewarning ? '' : 'Time is up.\n'}End block and enter review mode?`)) {
    return
  }

  freezeElapsedTime()
  block.complete = true
  finalizeBlockResults()
  block.currentquesnum = selectedQnum
  persistProgress()
  renderScreen()
}

function loadQuestion() {
  refreshBlock()
  qid = blockqlist[selectedQnum]
  currentChoiceLabels = {}

  renderHeader()
  renderQuestionList()
  renderQuestionMeta()
  renderExplanationMeta()
  renderTopControls()
  renderActionButtons()
  syncTimerState()
  $('#btngrp-choices').empty()

  $('#leftreplace').load(`${url.pathToFileURL(localinfo.path).toString()}/${qid}-q.html`, function() {
    $('#rightreplace').load(`${url.pathToFileURL(localinfo.path).toString()}/${qid}-s.html`, function() {
      extractChoiceLabels()
      createAnswerChoiceButtons()
      renderActionButtons()
      updateContent()
    })
  })
}

function renderScreen() {
  renderHeader()
  loadQuestion()
  updateTimer()
}

$('#btn-prevques').on('click', function() {
  if (selectedQnum > 0) {
    commitRunningElapsed()
    selectedQnum--
    block.currentquesnum = selectedQnum
    persistProgress()
    loadQuestion()
  }
})

$('#btn-back').on('click', function() {
  ipcRenderer.send('navto-prevblocks')
})

$('#btn-nextques').on('click', function() {
  if (selectedQnum < numQuestions - 1) {
    commitRunningElapsed()
    selectedQnum++
    block.currentquesnum = selectedQnum
    persistProgress()
    loadQuestion()
  } else {
    $('#btn-close').click()
  }
})

$('#btn-nextques-inline').on('click', function() {
  if ($(this).prop('disabled')) {
    return
  }
  if (selectedQnum < numQuestions - 1) {
    $('#btn-nextques').click()
  } else {
    $('#btn-close').click()
  }
})

$('#btn-submit-answer').on('click', function() {
  if (block.complete || block.mode !== 'tutor') {
    return
  }
  if (currentAnswer() === '') {
    alert('Select an answer before submitting.')
    return
  }
  commitRunningElapsed()
  const state = currentState()
  state.submitted = true
  state.revealed = true
  syncQuestionState(selectedQnum)
  block.currentquesnum = selectedQnum
  scrollToExplanationOnLoad = true
  persistProgress()
  loadQuestion()
})

$('#btn-pause').on('click', function() {
  freezeElapsedTime()
  block.currentquesnum = selectedQnum
  ipcRenderer.send('pauseblock', localinfo.progress)
})

$('#btn-close').on('click', function() {
  finishBlock(false)
})

$('#btn-flagged').on('click', function() {
  if (isInBucket(qid, 'flagged')) {
    removeFromBucket(qid, 'flagged')
  } else {
    addToBucket(qid, 'flagged')
  }
  renderQuestionList()
  renderTopControls()
  persistProgress()
})

$('.highlight-swatch').on('click', function() {
  setHighlightColor($(this).data('color'))
})

ipcRenderer.on('qbankinfo', function(event, qbankinfo) {
  localinfo = qbankinfo
  numtags = Object.keys(localinfo.tagnames.tagnames).length
  blockKey = localinfo.blockToOpen
  refreshBlock()
  blockqlist = block.blockqlist
  numQuestions = blockqlist.length
  selectedQnum = Math.min(block.currentquesnum, Math.max(numQuestions - 1, 0))
  qid = blockqlist[selectedQnum]

  renderScreen()
  populatePanes()
  startTimer()
})

ipcRenderer.on('dopause', function() {
  if (block && block.complete) {
    $('#btn-close').click()
  } else {
    $('#btn-pause').click()
  }
})

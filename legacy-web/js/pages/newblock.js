let $ = jQuery = require('jquery')
let Bootstrap = require('bootstrap')
const {ipcRenderer} = require('electron')
const Store = require('electron-store')
const store = new Store()

let localinfo
let numtags
let tags = []
let subtags = {}
let qlist = []
let tagschosenstr = ''
let allsubtagsenabled = true

const qpoolSettingToTagbucketsEquiv = {
  'btn-qpool-unused': 'unused',
  'btn-qpool-incorrects': 'incorrects',
  'btn-qpool-flagged': 'flagged',
  'btn-qpool-all': 'all',
  'btn-qpool-custom': 'custom'
}

const qpoolSummaryCopy = {
  'btn-qpool-unused': ['Unused questions', 'The pool starts with unseen items only, which is closest to a fresh first pass through the bank.'],
  'btn-qpool-incorrects': ['Incorrect questions', 'This block focuses on questions you previously missed, which is useful for targeted remediation.'],
  'btn-qpool-flagged': ['Flagged questions', 'Only manually flagged questions are eligible, making this block a curated revisit set.'],
  'btn-qpool-all': ['All questions', 'Every question in the bank can be pulled into the block, subject to any active filters.'],
  'btn-qpool-custom': ['Custom question IDs', 'This block is driven by the IDs you pasted, which is useful for recreating specific sets or checklists.']
}

const modeSummaryCopy = {
  tutor: ['Tutor mode', 'Submit each question individually and reveal the explanation immediately after you lock the answer.'],
  timed: ['Timed mode', 'Work through the full block with a countdown, then convert the session into review when you end it.'],
  untimed: ['Untimed mode', 'Hide explanations while solving, but remove the clock so the block behaves like delayed review instead of exam simulation.']
}

function filterInt(value) {
  if (/^[-+]?(\d+|Infinity)$/.test(value)) {
    return Number(value)
  }
  return NaN
}

function getStoredMode() {
  if (store.has('mode-setting')) {
    return store.get('mode-setting')
  }
  const timed = store.has('timed-setting') ? store.get('timed-setting') : false
  const showans = store.has('showans-setting') ? store.get('showans-setting') : true
  if (timed) {
    return 'timed'
  }
  if (showans) {
    return 'tutor'
  }
  return 'untimed'
}

function setStoredMode(mode) {
  store.set('mode-setting', mode)
  store.set('timed-setting', mode === 'timed')
  store.set('showans-setting', mode === 'tutor')
}

function updateModeUI(mode) {
  $('.q-mode-btn').removeClass('active')
  $(`#btn-mode-${mode}`).addClass('active')
  $('#modeSummaryBadge').text(modeSummaryCopy[mode][0])
  $('#summaryMode').text(modeSummaryCopy[mode][0])
  $('#summaryModeCopy').text(modeSummaryCopy[mode][1])

  if (mode === 'timed') {
    $('#timed-info').removeClass('exam-hidden')
    $('#timed-copy').text('Timed blocks reveal the explanation only after you end the block or run out of time.')
  } else {
    $('#timed-info').addClass('exam-hidden')
    $('#timed-copy').text('This mode still records elapsed time, but it does not enforce a block timer.')
  }
}

function updateSummaryFilters() {
  if (tagschosenstr === '') {
    $('#summaryFilters').text('All subjects included')
    $('#summaryFiltersCopy').text('Filter buckets are intersected across tag groups, so every enabled axis must match.')
    return
  }

  if (allsubtagsenabled) {
    $('#summaryFilters').text('All subjects included')
    $('#summaryFiltersCopy').text('Every tag group is currently set to All Subtags, so the pool is not narrowed by subject filters.')
  } else {
    const text = $('<div>').html(tagschosenstr).text().replace(/\s+/g, ' ').trim()
    $('#summaryFilters').text('Filtered subject mix')
    $('#summaryFiltersCopy').text(text)
  }
}

function updateSummaryPool() {
  const qpoolSetting = store.get('qpool-setting')
  const summary = qpoolSummaryCopy[qpoolSetting] || qpoolSummaryCopy['btn-qpool-unused']
  $('#summaryPool').text(summary[0])
  $('#summaryPoolCopy').text(summary[1])
}

function setSegmentedSelection(groupSelector, selectedId) {
  $(groupSelector).find('button').each(function() {
    if (this.id === selectedId) {
      $(this).removeClass('btn-light').addClass('btn-primary')
    } else {
      $(this).removeClass('btn-primary').addClass('btn-light')
    }
  })
}

$('#navbtn-overview').click(function() {
  ipcRenderer.send('navto-overview')
})

$('#navbtn-prevblocks').click(function() {
  ipcRenderer.send('navto-prevblocks')
})

$('#btn-back').click(function() {
  ipcRenderer.send('navto-index')
})

$('#btngrp-qpool').on('click', 'button', function() {
  const buttonId = this.id
  setSegmentedSelection('#btngrp-qpool', buttonId)
  store.set('qpool-setting', buttonId)
  if (buttonId === 'btn-qpool-custom') {
    $('#div-qpool-customids').removeClass('exam-hidden')
    $('#tagscard').addClass('exam-hidden')
  } else {
    $('#div-qpool-customids').addClass('exam-hidden')
    $('#tagscard').removeClass('exam-hidden')
    if (tags.length === 1 && subtags[tags[0]].length === 1) {
      $('#tagscard').addClass('exam-hidden')
    }
  }
  updateSummaryPool()
  computeSubtagBadgeCounts()
  computeAvailableQuestions()
})

$('#btngrp-tags').on('click', 'button', function() {
  setSegmentedSelection('#btngrp-tags', this.id)
})

$('.q-mode-btn').on('click', function() {
  const mode = this.id.replace('btn-mode-', '')
  setStoredMode(mode)
  updateModeUI(mode)
})

if (store.has('numq-setting')) {
  $('#textinput-block-numques').val(store.get('numq-setting'))
}

$('#textinput-block-numques').on('input', function() {
  const value = $(this).val()
  if (value !== '') {
    const filtered = filterInt(value)
    if (isNaN(filtered) || filtered < 1) {
      $(this).val('')
      store.delete('numq-setting')
      alert('Invalid value')
    } else {
      store.set('numq-setting', filtered)
    }
  } else {
    store.delete('numq-setting')
  }
})

if (store.has('timeperq-setting')) {
  $('#textinput-block-timeperq').val(store.get('timeperq-setting'))
}

$('#textinput-block-timeperq').on('input', function() {
  const value = $(this).val()
  if (value !== '') {
    const filtered = filterInt(value)
    if (isNaN(filtered) || filtered < 1) {
      $(this).val('')
      store.delete('timeperq-setting')
      alert('Invalid value')
    } else {
      store.set('timeperq-setting', filtered)
    }
  } else {
    store.delete('timeperq-setting')
  }
})

if (store.has('sequential-setting')) {
  $('#toggle-block-sequential').prop('checked', store.get('sequential-setting'))
} else {
  store.set('sequential-setting', false)
}

$('#toggle-block-sequential').change(function() {
  store.set('sequential-setting', $(this).prop('checked'))
})

$('#btn-startblock').get(0).animate([
  { transform: 'scale(0.985)' },
  { transform: 'scale(1.015)' },
  { transform: 'scale(0.985)' }
], {
  duration: 2200,
  iterations: Infinity
})

function getRandom(arr, n) {
  const result = new Array(n)
  let len = arr.length
  const taken = new Array(len)
  if (n > len) {
    throw new RangeError('getRandom: more elements taken than available')
  }
  while (n--) {
    const x = Math.floor(Math.random() * len)
    result[n] = arr[x in taken ? taken[x] : x]
    taken[x] = --len in taken ? taken[len] : len
  }
  return result
}

function getPrev(qid) {
  if (Object.keys(localinfo.groups).includes(qid)) {
    return localinfo.groups[qid].prev
  }
  return null
}

function getNext(qid) {
  if (Object.keys(localinfo.groups).includes(qid)) {
    return localinfo.groups[qid].next
  }
  return null
}

function handleGrouped(blockqlist) {
  const desiredlength = blockqlist.length

  for (let i = 0; i < blockqlist.length; i++) {
    const next = getNext(blockqlist[i])
    if (next) {
      for (let j = 0; j < blockqlist.length; j++) {
        if (blockqlist[j] === next) {
          blockqlist.splice(j, 1)
          j--
        }
      }
      blockqlist.splice(i + 1, 0, next)
    }
  }

  for (let i = blockqlist.length - 1; i >= 0; i--) {
    const prev = getPrev(blockqlist[i])
    if (prev) {
      for (let j = 0; j < blockqlist.length; j++) {
        if (blockqlist[j] === prev) {
          blockqlist.splice(j, 1)
          j--
        }
      }
      blockqlist.splice(i, 0, prev)
      i++
    }
  }

  let numtocut = blockqlist.length - desiredlength
  let i = 0
  while (i < blockqlist.length && numtocut > 0) {
    let moveforward = true
    let j = numtocut - 1
    while (numtocut > 0 && j >= 0) {
      if (getPrev(blockqlist[i]) == null && getNext(blockqlist[i + j]) == null) {
        blockqlist.splice(i, j + 1)
        numtocut -= (j + 1)
        moveforward = false
      }
      j = Math.min(j - 1, numtocut - 1)
    }
    if (moveforward) {
      i++
    }
  }

  return blockqlist
}

$('#btn-startblock').on('click', function() {
  const numq = store.get('numq-setting')
  const timeperq = store.get('timeperq-setting')
  const mode = getStoredMode()
  if (numq === undefined || (mode === 'timed' && timeperq === undefined)) {
    alert('Invalid settings')
    return
  }
  if (numq > qlist.length) {
    alert(`A ${numq} question block was requested, but only ${qlist.length} questions are available with the current settings.`)
    return
  }

  store.set('recent-tagschosenstr', tagschosenstr)
  store.set('recent-allsubtagsenabled', allsubtagsenabled)

  let blockqlist
  if (store.get('sequential-setting')) {
    qlist.sort(function(a, b) {
      return parseInt(a) - parseInt(b)
    })
    blockqlist = qlist.slice(0, numq)
  } else {
    blockqlist = getRandom(qlist, numq)
  }

  blockqlist = handleGrouped(blockqlist)
  if (blockqlist.length !== numq) {
    alert(`A ${blockqlist.length} question block was necessary due to the inclusion of grouped questions.`)
  }

  ipcRenderer.send('startblock', blockqlist)
})

$('#textarea-qpool-customids').on('focusout', function() {
  computeAvailableQuestions()
})

function computeAvailableQuestions() {
  tagschosenstr = ''
  allsubtagsenabled = true

  const qpoolToUse = qpoolSettingToTagbucketsEquiv[store.get('qpool-setting')]
  if (qpoolToUse !== 'custom') {
    for (let i = 0; i < numtags; i++) {
      tagschosenstr += '<b><u>' + tags[i] + ':</u></b> '
      let tagqlist = []
      const numsubtags = subtags[tags[i]].length
      const allSubtagsEnabled = $(`#allsubtags-${i}`).prop('checked')
      if (allSubtagsEnabled) {
        tagschosenstr += 'All Subtags, '
      } else {
        allsubtagsenabled = false
      }
      for (let j = 0; j < numsubtags; j++) {
        const subtagqlist = localinfo.progress.tagbuckets[tags[i]][subtags[tags[i]][j]][qpoolToUse]
        if (allSubtagsEnabled || $(`#subtagCheck-${i}-${j}`).prop('checked')) {
          tagqlist = tagqlist.concat(subtagqlist)
          if (!allSubtagsEnabled) {
            tagschosenstr += subtags[tags[i]][j] + ', '
          }
        }
      }
      if (i === 0) {
        qlist = tagqlist
      } else {
        qlist = $.map(qlist, function(a) {
          return $.inArray(a, tagqlist) < 0 ? null : a
        })
      }
      tagschosenstr += '<br />'
    }
  } else {
    qlist = []
    try {
      let idstr = $('#textarea-qpool-customids').val()
      idstr = idstr.replace(/ /g, '')
      const customlist = idstr.split(',').filter(function(item) {
        return item !== ''
      })
      const qindex = Object.keys(localinfo.index)
      for (const customid of customlist) {
        if (!qindex.includes(customid)) {
          throw new Error(`Question ID "${customid}" not found in qbank.`)
        }
      }
      qlist = customlist
      tagschosenstr = '<b><u>Custom:</u></b> User supplied question IDs'
      allsubtagsenabled = true
    } catch (e) {
      alert('Error parsing question list: ' + e)
    }
  }

  $('#numAvailableQues').text(qlist.length)
  updateSummaryFilters()
}

function makePoolBadges() {
  let numUnused = 0
  let numIncorrects = 0
  let numFlagged = 0
  let numAll = 0
  const numsubtags = subtags[tags[0]].length
  for (let j = 0; j < numsubtags; j++) {
    numUnused += localinfo.progress.tagbuckets[tags[0]][subtags[tags[0]][j]].unused.length
    numIncorrects += localinfo.progress.tagbuckets[tags[0]][subtags[tags[0]][j]].incorrects.length
    numFlagged += localinfo.progress.tagbuckets[tags[0]][subtags[tags[0]][j]].flagged.length
    numAll += localinfo.progress.tagbuckets[tags[0]][subtags[tags[0]][j]].all.length
  }

  function getPoolBadge(num) {
    return `&nbsp;&nbsp;<span class="badge badge-pill badge-secondary">${num}</span>`
  }

  $('#btn-qpool-unused').append(getPoolBadge(numUnused))
  $('#btn-qpool-incorrects').append(getPoolBadge(numIncorrects))
  $('#btn-qpool-flagged').append(getPoolBadge(numFlagged))
  $('#btn-qpool-all').append(getPoolBadge(numAll))
}

function computeSubtagBadgeCounts() {
  const qpoolToUse = qpoolSettingToTagbucketsEquiv[store.get('qpool-setting')]
  if (qpoolToUse !== 'custom') {
    for (let i = 0; i < numtags; i++) {
      const numsubtags = subtags[tags[i]].length
      for (let j = 0; j < numsubtags; j++) {
        const badgetext = localinfo.progress.tagbuckets[tags[i]][subtags[tags[i]][j]][qpoolToUse].length
        $(`#subtagBadge-${i}-${j}`).text(badgetext)
      }
    }
  } else {
    $('.subtagBadge').text('')
  }
}

function populateTagsArea() {
  function accordionItem(tagnum, tagname) {
    const accitemnum = tagnum + 1
    return `<div class="card">
        <div class="card-header" role="tab">
            <h5 class="mb-0"><a data-toggle="collapse" aria-expanded="false" aria-controls="accordion-tags .item-${accitemnum}" href="#accordion-tags .item-${accitemnum}">${tagname}</a></h5>
        </div>
        <div class="collapse item-${accitemnum}" role="tabpanel" data-parent="#accordion-tags">
            <div id="accordionCard-${accitemnum}" class="card-body">
              <div class="custom-control custom-switch">
                <input type="checkbox" class="custom-control-input allSubtagCheck" data-tagnum="${tagnum}" disabled checked id="allsubtags-${tagnum}" />
                <label class="custom-control-label" for="allsubtags-${tagnum}">All Subtags</label>
              </div>
              <hr />
            </div>
        </div>
    </div>`
  }

  for (let i = 0; i < numtags; i++) {
    $('#accordion-tags').append(accordionItem(i, tags[i]))
  }

  function subtagToggleHtml(tagnum, subnum, text) {
    return `<div class="custom-control custom-switch mb-2">
      <input type="checkbox" class="custom-control-input subtagCheck subtagCheck-Tag${tagnum}" data-tagnum="${tagnum}" data-subnum="${subnum}" id="subtagCheck-${tagnum}-${subnum}" />
      <label class="custom-control-label d-md-flex align-items-md-center" for="subtagCheck-${tagnum}-${subnum}">
        ${text}
        &nbsp;<span id="subtagBadge-${tagnum}-${subnum}" class="badge badge-pill badge-secondary subtagBadge"></span>
      </label>
    </div>`
  }

  for (let i = 0; i < numtags; i++) {
    const numsubtags = subtags[tags[i]].length
    for (let j = 0; j < numsubtags; j++) {
      $(`#accordionCard-${i + 1}`).append(subtagToggleHtml(i, j, subtags[tags[i]][j]))
    }
  }

  computeSubtagBadgeCounts()

  let keepAccordionOpen = false

  function isAllTags() {
    let allchecked = true
    for (const c of $('.allSubtagCheck')) {
      allchecked = allchecked && c.checked
    }
    if (allchecked) {
      keepAccordionOpen = true
      $('#btn-tags-all').click()
    }
  }

  $('#btn-tags-all').on('click', function() {
    $('.allSubtagCheck').prop('checked', true)
    $('.subtagCheck').prop('checked', false)
    if (!keepAccordionOpen) {
      $('.collapse').collapse('hide')
    }
    keepAccordionOpen = false
    $('#btn-tags-filtered').get(0).disabled = true
    computeAvailableQuestions()
  })

  $('.subtagCheck').change(function() {
    const tagnum = $(this).data('tagnum')
    if ($(this).prop('checked')) {
      $(`#allsubtags-${tagnum}`).prop('checked', false)
      $(`#allsubtags-${tagnum}`).get(0).disabled = false
      $('#btn-tags-filtered').click()
      $('#btn-tags-filtered').get(0).disabled = false
    } else {
      let anychecked = false
      for (const c of $(`.subtagCheck-Tag${tagnum}`)) {
        anychecked = anychecked || c.checked
      }
      if (!anychecked) {
        $(`#allsubtags-${tagnum}`).prop('checked', true)
        $(`#allsubtags-${tagnum}`).get(0).disabled = true
        isAllTags()
      }
    }
    computeAvailableQuestions()
  })

  $('.allSubtagCheck').change(function() {
    const tagnum = $(this).data('tagnum')
    if ($(this).prop('checked')) {
      $(`.subtagCheck-Tag${tagnum}`).prop('checked', false)
      $(this).get(0).disabled = true
      isAllTags()
    }
    computeAvailableQuestions()
  })
}

ipcRenderer.on('qbankinfo', function(event, qbankinfo) {
  localinfo = qbankinfo

  numtags = Object.keys(localinfo.tagnames.tagnames).length
  for (let i = 0; i < numtags; i++) {
    const tagname = localinfo.tagnames.tagnames[i]
    tags.push(tagname)
    subtags[tagname] = Object.keys(localinfo.progress.tagbuckets[tagname]).sort()
  }

  if (!store.has('qpool-setting')) {
    store.set('qpool-setting', 'btn-qpool-unused')
  }

  const selectedMode = getStoredMode()
  updateModeUI(selectedMode)
  updateSummaryPool()

  makePoolBadges()
  populateTagsArea()

  $('.badge').click(function(e) {
    e.target.parentElement.click()
  })

  const btnid = store.get('qpool-setting')
  setSegmentedSelection('#btngrp-qpool', btnid)
  if (btnid === 'btn-qpool-custom') {
    $('#div-qpool-customids').removeClass('exam-hidden')
    $('#tagscard').addClass('exam-hidden')
  } else {
    $('#div-qpool-customids').addClass('exam-hidden')
  }
  $(`#${btnid}`).click()

  $('#spinner').remove()
  $('#pagecontent').removeClass('d-none')
})

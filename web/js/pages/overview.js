let $ = jQuery = require('jquery')
let Bootstrap = require('bootstrap')
const {ipcRenderer} = require('electron')

let localinfo

function formatPercent(part, total) {
  if (total === 0) {
    return '0.0%'
  }
  return `${(100 * part / total).toFixed(1)}%`
}

function formatDuration(seconds) {
  return `${Math.floor(seconds / 3600)} hours, ${Math.floor((seconds % 3600) / 60)} minutes, ${Math.floor(seconds % 60)} seconds`
}

$('#navbtn-newblock').click(function() {
  ipcRenderer.send('navto-newblock')
})

$('#navbtn-prevblocks').click(function() {
  ipcRenderer.send('navto-prevblocks')
})

$('#btn-back').click(function() {
  ipcRenderer.send('navto-index')
})

$('#btn-resetqbank').click(function() {
  ipcRenderer.send('resetqbank')
})

ipcRenderer.on('qbankinfo', function(event, qbankinfo) {
  localinfo = qbankinfo

  let numcorrect = 0
  let totalanswered = 0
  let completeblocks = 0
  let pausedblocks = 0
  let totaltime = 0
  let tutorblocks = 0
  let timedblocks = 0
  let untimedblocks = 0

  for (const i of Object.keys(localinfo.progress.blockhist)) {
    const thisblock = localinfo.progress.blockhist[i]
    if (thisblock.mode === 'timed') {
      timedblocks += 1
    } else if (thisblock.mode === 'untimed') {
      untimedblocks += 1
    } else {
      tutorblocks += 1
    }

    if (thisblock.complete) {
      completeblocks += 1
      totalanswered += thisblock.blockqlist.length
      numcorrect += thisblock.numcorrect
      totaltime += thisblock.elapsedtime
    } else {
      pausedblocks += 1
    }
  }

  const numincorrect = totalanswered - numcorrect
  const avgtime = totalanswered === 0 ? 0 : totaltime / totalanswered

  let numunused = 0
  let numall = 0
  let numflagged = 0
  const primaryTag = localinfo.tagnames.tagnames[0]
  for (const j in localinfo.progress.tagbuckets[primaryTag]) {
    numunused += localinfo.progress.tagbuckets[primaryTag][j].unused.length
    numall += localinfo.progress.tagbuckets[primaryTag][j].all.length
    numflagged += localinfo.progress.tagbuckets[primaryTag][j].flagged.length
  }
  const numseen = numall - numunused

  $('#stat-correct').text(`${numcorrect} (${formatPercent(numcorrect, totalanswered)})`)
  $('#stat-incorrect').text(`${numincorrect} (${formatPercent(numincorrect, totalanswered)})`)
  $('#stat-totalans').text(`${totalanswered}`)
  $('#stat-used').text(`${numseen}/${numall} (${formatPercent(numseen, numall)})`)
  $('#stat-flagged').text(`${numflagged}/${numseen || 0} (${formatPercent(numflagged, numseen)})`)
  $('#stat-totalqs').text(numall)
  $('#stat-completeblocks').text(completeblocks)
  $('#stat-pausedblocks').text(pausedblocks)
  $('#stat-tutorblocks').text(tutorblocks)
  $('#stat-timedblocks').text(timedblocks)
  $('#stat-untimedblocks').text(untimedblocks)
  $('#stat-avgtime').text(`${avgtime.toFixed(1)} sec`)
  $('#stat-totaltime').text(formatDuration(totaltime))
})

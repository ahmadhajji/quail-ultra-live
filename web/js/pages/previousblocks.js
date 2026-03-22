let $ = jQuery = require('jquery')
let Popper = require('popper.js')
let Bootstrap = require('bootstrap')
const {ipcRenderer} = require('electron')

let localinfo

function modeLabel(mode) {
  if (mode === 'timed') {
    return 'Timed'
  }
  if (mode === 'untimed') {
    return 'Untimed'
  }
  return 'Tutor'
}

$('#navbtn-overview').click(function() {
  ipcRenderer.send('navto-overview')
})

$('#navbtn-newblock').click(function() {
  ipcRenderer.send('navto-newblock')
})

$('#btn-back').click(function() {
  ipcRenderer.send('navto-index')
})

function populateTable() {
  const blockkeys = Object.keys(localinfo.progress.blockhist).sort(function(a, b) {
    return parseInt(b, 10) - parseInt(a, 10)
  })

  for (const thiskey of blockkeys) {
    const thisblock = localinfo.progress.blockhist[thiskey]
    const numquestions = thisblock.blockqlist.length
    const percentcorrect = thisblock.complete && numquestions > 0
      ? (100 * thisblock.numcorrect / numquestions).toFixed(1) + '%'
      : '<b><em>In Progress</em></b>'
    const stateLabel = thisblock.complete ? 'Completed Review' : 'Paused Session'
    let tagshtml = 'All Subtags'
    if (!thisblock.allsubtagsenabled) {
      tagshtml = `<a href="#" data-toggle="tooltip" data-html="true" container="body" title="${thisblock.tagschosenstr}">Filtered</a>`
    }

    let rowclass = ''
    if (thiskey === localinfo.blockToOpen) {
      rowclass = thisblock.complete ? 'table-success' : 'table-warning'
    }

    const rowhtml = `<tr id="row-${thiskey}" class="${rowclass}">
        <td>${parseInt(thiskey, 10) + 1}</td>
        <td>${modeLabel(thisblock.mode)}</td>
        <td>${stateLabel}</td>
        <td>${percentcorrect}</td>
        <td><button class="btn btn-link qlistbtn" data-thiskey="${thiskey}" type="button" style="padding: 0px;">${numquestions}</button></td>
        <td>${thisblock.qpoolstr}</td>
        <td>${tagshtml}</td>
        <td>${thisblock.starttime}</td>
        <td><button class="btn btn-link openbtn" data-thiskey="${thiskey}" type="button" style="padding: 0px;">${thisblock.complete ? 'Review' : 'Resume'}</button></td>
        <td><button class="btn btn-outline-danger deletebtn" data-thiskey="${thiskey}" type="button" style="padding: 0px 8px;font-size: 12px;">Delete</button></td>
    </tr>`

    $('#tablebody').append(rowhtml)
  }

  $('.openbtn').on('click', function(e) {
    const thiskey = $(e.target).data('thiskey')
    ipcRenderer.send('openblock', thiskey)
  })

  $('.qlistbtn').on('click', function(e) {
    const thiskey = $(e.target).data('thiskey')
    $('#qlistModalLabel').text(`Block ${parseInt(thiskey, 10) + 1} Question List`)
    $('#qlistModalP').text(localinfo.progress.blockhist[thiskey].blockqlist.toString().replaceAll(',', ', '))
    $('#qlistModal').modal('show')
  })

  $('.deletebtn').on('click', function(e) {
    const thiskey = $(e.target).data('thiskey')
    if (confirm(`Permanently delete block ${parseInt(thiskey, 10) + 1}? Questions will return to the unused pool. Incorrect and flagged history for that block will be discarded.`)) {
      $(`#row-${thiskey}`).remove()
      ipcRenderer.send('deleteblock', thiskey)
    }
  })

  $(function() {
    $('[data-toggle="tooltip"]').tooltip()
  })
}

ipcRenderer.on('qbankinfo', function(event, qbankinfo) {
  localinfo = qbankinfo
  populateTable()
})

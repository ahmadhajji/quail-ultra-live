let $ = window.jQuery
const MAX_FOLDER_BATCH_BYTES = 4 * 1024 * 1024
const MAX_FOLDER_BATCH_FILES = 40

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function ignoreRegistrationError(error) {
    console.warn('Service worker registration failed.', error)
  })
}

async function refreshSessionView() {
  const user = await window.QuailLive.getSession(true)
  const isAuthed = Boolean(user)

  $('#authPanel').toggleClass('d-none', isAuthed)
  $('#packsPanel').toggleClass('d-none', !isAuthed)
  $('#btn-logout').toggleClass('d-none', !isAuthed)
  $('#currentUserLabel').text(isAuthed ? `Signed in as ${user.username}` : '')

  if (!isAuthed) {
    return
  }

  await renderStudyPacks()
}

function setAuthError(message) {
  $('#authError').text(message || '')
}

function setPackStatus(message, isError) {
  $('#packLoading').text(isError ? '' : (message || ''))
  $('#packError').text(isError ? (message || '') : '')
}

function formatFolderSelection(files) {
  const selectedFiles = Array.from(files || [])
  if (selectedFiles.length === 0) {
    return 'No folder selected yet.'
  }

  const rootName = selectedFiles[0].webkitRelativePath
    ? selectedFiles[0].webkitRelativePath.split('/')[0]
    : selectedFiles[0].name
  return `${rootName} selected · ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready to upload`
}

function formatZipSelection(file) {
  if (!file) {
    return 'No zip selected yet.'
  }
  const sizeMb = ((file.size || 0) / (1024 * 1024)).toFixed(1)
  return `${file.name} · ${sizeMb} MB`
}

function syncFileSelectionLabels() {
  const folderFiles = $('#folder-input').get(0).files
  const zipFile = $('#zip-input').get(0).files[0]
  $('#folder-selection').text(formatFolderSelection(folderFiles))
  $('#zip-selection').text(formatZipSelection(zipFile))
}

function buildFolderUploadBatches(fileList) {
  const files = Array.from(fileList || [])
  const batches = []
  let currentBatch = []
  let currentBytes = 0

  for (const file of files) {
    if ((file.size || 0) > 95 * 1024 * 1024) {
      throw new Error(`"${file.name}" is too large to upload through the current public endpoint.`)
    }

    const wouldOverflow = currentBatch.length > 0 && (
      currentBatch.length >= MAX_FOLDER_BATCH_FILES ||
      (currentBytes + (file.size || 0)) > MAX_FOLDER_BATCH_BYTES
    )

    if (wouldOverflow) {
      batches.push(currentBatch)
      currentBatch = []
      currentBytes = 0
    }

    currentBatch.push(file)
    currentBytes += file.size || 0
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

function packCard(pack) {
  const exportUrl = `/api/study-packs/${pack.id}/export.zip`
  return `<div class="q-pack-card" data-pack-id="${pack.id}">
    <div>
      <div class="q-pack-title">${pack.name}</div>
      <div class="q-helper-copy">Questions: ${pack.questionCount} · Revision: ${pack.revision}</div>
      <div class="q-helper-copy">Updated: ${new Date(pack.updatedAt).toLocaleString()}</div>
    </div>
    <div class="q-pack-actions">
      <button class="btn btn-primary btn-sm open-pack" type="button" data-pack-id="${pack.id}">Open</button>
      <a class="btn btn-outline-primary btn-sm" href="${exportUrl}">Export Zip</a>
      <button class="btn btn-outline-danger btn-sm delete-pack" type="button" data-pack-id="${pack.id}">Delete</button>
    </div>
  </div>`
}

async function renderStudyPacks() {
  const packs = await window.QuailLive.listStudyPacks()
  $('#studyPackList').empty()
  $('#emptyPacks').toggleClass('d-none', packs.length > 0)

  for (const pack of packs) {
    $('#studyPackList').append(packCard(pack))
  }

  $('.open-pack').off('click').on('click', function onOpenClick() {
    window.QuailLive.navigate('overview', { pack: $(this).data('pack-id') })
  })

  $('.delete-pack').off('click').on('click', async function onDeleteClick() {
    const packId = $(this).data('pack-id')
    if (!confirm('Delete this Study Pack from your account? The uploaded bank and saved progress will be removed from the server.')) {
      return
    }
    try {
      setPackStatus('Deleting study pack...')
      await window.QuailLive.deleteStudyPack(packId)
      await renderStudyPacks()
      setPackStatus('')
    } catch (error) {
      setPackStatus(error.message || 'Delete failed', true)
    }
  })
}

async function submitAuth(mode) {
  const username = $('#auth-username').val().trim()
  const password = $('#auth-password').val()
  if (!username || !password) {
    setAuthError('Enter both username and password.')
    return
  }

  try {
    setAuthError('')
    if (mode === 'register') {
      await window.QuailLive.register(username, password)
    } else {
      await window.QuailLive.login(username, password)
    }
    $('#auth-password').val('')
    await refreshSessionView()
  } catch (error) {
    setAuthError(error.message || 'Authentication failed.')
  }
}

async function uploadFolder() {
  const files = $('#folder-input').get(0).files
  if (!files || files.length === 0) {
    setPackStatus('Choose a folder first.', true)
    return
  }
  let sessionId = ''

  try {
    const batches = buildFolderUploadBatches(files)
    sessionId = await window.QuailLive.beginFolderImport($('#pack-name').val().trim())

    for (let index = 0; index < batches.length; index += 1) {
      const formData = new FormData()
      for (const file of batches[index]) {
        const relativePath = file.webkitRelativePath || file.name
        formData.append('files', file, relativePath)
      }
      setPackStatus(`Uploading folder batch ${index + 1} of ${batches.length}...`)
      await window.QuailLive.uploadFolderImportBatch(sessionId, formData)
    }

    setPackStatus('Finalizing Study Pack on the server...')
    await window.QuailLive.completeFolderImport(sessionId, function updateFinalizeStatus(message) {
      setPackStatus(message || 'Finalizing Study Pack on the server...')
    })
    $('#folder-input').val('')
    syncFileSelectionLabels()
    $('#pack-name').val('')
    await renderStudyPacks()
    setPackStatus('Study Pack imported.')
  } catch (error) {
    if (sessionId) {
      try {
        await window.QuailLive.cancelFolderImport(sessionId)
      } catch (cancelError) {
        console.warn('Unable to cancel folder import session.', cancelError)
      }
    }
    setPackStatus(error.message || 'Folder import failed', true)
  }
}

async function uploadZip() {
  const file = $('#zip-input').get(0).files[0]
  if (!file) {
    setPackStatus('Choose a zip file first.', true)
    return
  }

  const formData = new FormData()
  formData.append('importType', 'zip')
  formData.append('packName', $('#pack-name').val().trim())
  formData.append('files', file, file.name)

  try {
    setPackStatus('Uploading zip and rebuilding Study Pack...')
    await window.QuailLive.importStudyPack(formData)
    $('#zip-input').val('')
    syncFileSelectionLabels()
    $('#pack-name').val('')
    await renderStudyPacks()
    setPackStatus('Study Pack imported.')
  } catch (error) {
    setPackStatus(error.message || 'Zip import failed', true)
  }
}

$('#btn-login').on('click', function onLoginClick() {
  submitAuth('login')
})

$('#btn-register').on('click', function onRegisterClick() {
  submitAuth('register')
})

$('#btn-import-folder').on('click', function onFolderUpload() {
  uploadFolder()
})

$('#btn-import-zip').on('click', function onZipUpload() {
  uploadZip()
})

$('.q-file-trigger').on('click', function onFileTriggerClick() {
  const inputId = $(this).data('file-target')
  $(`#${inputId}`).trigger('click')
})

$('#btn-logout').on('click', async function onLogoutClick() {
  await window.QuailLive.logout()
  await refreshSessionView()
})

$('#auth-password').on('keydown', function onPasswordKeydown(event) {
  if (event.key === 'Enter') {
    submitAuth('login')
  }
})

$('#folder-input').on('change', syncFileSelectionLabels)
$('#zip-input').on('change', syncFileSelectionLabels)

syncFileSelectionLabels()

refreshSessionView().catch(function onInitError(error) {
  setAuthError(error.message || 'Unable to initialize the home screen.')
})

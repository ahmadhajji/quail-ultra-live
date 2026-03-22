let $ = window.jQuery

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

  const formData = new FormData()
  formData.append('importType', 'folder')
  formData.append('packName', $('#pack-name').val().trim())

  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name
    formData.append('files', file, relativePath)
  }

  try {
    setPackStatus('Uploading folder and building Study Pack...')
    await window.QuailLive.importStudyPack(formData)
    $('#folder-input').val('')
    $('#pack-name').val('')
    await renderStudyPacks()
    setPackStatus('Study Pack imported.')
  } catch (error) {
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

$('#btn-logout').on('click', async function onLogoutClick() {
  await window.QuailLive.logout()
  await refreshSessionView()
})

$('#auth-password').on('keydown', function onPasswordKeydown(event) {
  if (event.key === 'Enter') {
    submitAuth('login')
  }
})

refreshSessionView().catch(function onInitError(error) {
  setAuthError(error.message || 'Unable to initialize the home screen.')
})

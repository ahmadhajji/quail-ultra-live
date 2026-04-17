import { useEffect, useMemo, useRef, useState } from 'react'
import { beginFolderImport, cancelFolderImport, completeFolderImport, deleteStudyPack, exportStudyPackZip, getAuthConfig, getSession, importStudyPack, listStudyPacks, login, logout, register, uploadFolderImportBatch, uploadFolderImportDirect, uploadZipImportDirect } from '../lib/api'
import { Brand } from '../components/Brand'
import { navigate } from '../lib/navigation'
import type { AppSettings, StudyPackSummary, User } from '../types/domain'

const MAX_FOLDER_BATCH_BYTES = 4 * 1024 * 1024
const MAX_FOLDER_BATCH_FILES = 40

function formatFolderSelection(files: FileList | null): string {
  const selectedFiles = Array.from(files ?? [])
  if (selectedFiles.length === 0) {
    return 'No folder selected yet.'
  }
  const rootName = selectedFiles[0]?.webkitRelativePath
    ? selectedFiles[0].webkitRelativePath.split('/')[0]
    : selectedFiles[0]?.name ?? ''
  return `${rootName} selected · ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready to upload`
}

function formatZipSelection(file: File | undefined): string {
  if (!file) {
    return 'No zip selected yet.'
  }
  const sizeMb = ((file.size || 0) / (1024 * 1024)).toFixed(1)
  return `${file.name} · ${sizeMb} MB`
}

function buildFolderUploadBatches(fileList: FileList): File[][] {
  const files = Array.from(fileList)
  const batches: File[][] = []
  let currentBatch: File[] = []
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

export function HomePage() {
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [packs, setPacks] = useState<StudyPackSummary[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState(new URLSearchParams(window.location.search).get('email') ?? '')
  const [packName, setPackName] = useState('')
  const [authError, setAuthError] = useState('')
  const [packError, setPackError] = useState('')
  const [packLoading, setPackLoading] = useState('')
  const [folderFiles, setFolderFiles] = useState<FileList | null>(null)
  const [zipFile, setZipFile] = useState<File | undefined>()
  const [authConfig, setAuthConfig] = useState<AppSettings>({ registrationMode: 'invite-only' })

  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get('invite') ?? '', [])
  const inviteModeEnabled = authConfig.registrationMode === 'invite-only'
  const registrationAvailable = inviteModeEnabled && Boolean(inviteToken)
  const directBlobUploads = authConfig.directBlobUploads === true

  async function refreshSessionView(): Promise<void> {
    const [currentUser, currentConfig] = await Promise.all([
      getSession(true),
      getAuthConfig(true)
    ])
    setUser(currentUser)
    setAuthConfig(currentConfig)
    if (currentUser) {
      setPacks(await listStudyPacks())
    } else {
      setPacks([])
    }
  }

  useEffect(() => {
    void refreshSessionView().catch((error) => {
      setAuthError(error instanceof Error ? error.message : 'Unable to initialize the home screen.')
    })
  }, [])

  const folderSelection = useMemo(() => formatFolderSelection(folderFiles), [folderFiles])
  const zipSelection = useMemo(() => formatZipSelection(zipFile), [zipFile])

  async function submitAuth(mode: 'login' | 'register'): Promise<void> {
    if (!username.trim() || !password) {
      setAuthError('Enter both username and password.')
      return
    }
    if (mode === 'register' && (!email.trim() || !inviteToken)) {
      setAuthError('A valid invite link and matching email are required for registration.')
      return
    }
    try {
      setAuthError('')
      if (mode === 'register') {
        await register(username.trim(), password, email.trim(), inviteToken)
      } else {
        await login(username.trim(), password)
      }
      setPassword('')
      await refreshSessionView()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.')
    }
  }

  async function uploadFolder(): Promise<void> {
    if (!folderFiles || folderFiles.length === 0) {
      setPackError('Choose a folder first.')
      return
    }
    let sessionId = ''
    try {
      setPackError('')
      sessionId = await beginFolderImport(packName.trim())
      if (directBlobUploads) {
        await uploadFolderImportDirect(sessionId, folderFiles, (message) => setPackLoading(message))
      } else {
        const batches = buildFolderUploadBatches(folderFiles)
        for (let index = 0; index < batches.length; index += 1) {
          const formData = new FormData()
          for (const file of batches[index] ?? []) {
            const relativePath = file.webkitRelativePath || file.name
            formData.append('files', file, relativePath)
          }
          setPackLoading(`Uploading folder batch ${index + 1} of ${batches.length}...`)
          await uploadFolderImportBatch(sessionId, formData)
        }
      }
      setPackLoading('Finalizing Study Pack on the server...')
      await completeFolderImport(sessionId, (message) => setPackLoading(message))
      setFolderFiles(null)
      if (folderInputRef.current) {
        folderInputRef.current.value = ''
      }
      setPackName('')
      await refreshSessionView()
      setPackLoading('Study Pack imported.')
    } catch (error) {
      if (sessionId) {
        try {
          await cancelFolderImport(sessionId)
        } catch (cancelError) {
          console.warn('Unable to cancel folder import session.', cancelError)
        }
      }
      setPackError(error instanceof Error ? error.message : 'Folder import failed.')
    }
  }

  async function uploadZip(): Promise<void> {
    if (!zipFile) {
      setPackError('Choose a zip file first.')
      return
    }
    let sessionId = ''
    try {
      setPackError('')
      if (directBlobUploads) {
        sessionId = await beginFolderImport(packName.trim())
        await uploadZipImportDirect(sessionId, zipFile, (message) => setPackLoading(message))
        setPackLoading('Finalizing Study Pack on the server...')
        await completeFolderImport(sessionId, (message) => setPackLoading(message))
      } else {
        const formData = new FormData()
        formData.append('importType', 'zip')
        formData.append('packName', packName.trim())
        formData.append('files', zipFile, zipFile.name)
        setPackLoading('Uploading zip and rebuilding Study Pack...')
        await importStudyPack(formData)
      }
      setZipFile(undefined)
      if (zipInputRef.current) {
        zipInputRef.current.value = ''
      }
      setPackName('')
      await refreshSessionView()
      setPackLoading('Study Pack imported.')
    } catch (error) {
      if (sessionId) {
        try {
          await cancelFolderImport(sessionId)
        } catch (cancelError) {
          console.warn('Unable to cancel zip import session.', cancelError)
        }
      }
      setPackError(error instanceof Error ? error.message : 'Zip import failed.')
    }
  }

  return (
    <div className="container-fluid d-flex flex-column" style={{ minHeight: '100vh' }}>
      <div className="row q-topbar">
        <div className="col-lg-6 d-flex align-items-center">
          <Brand title="Quail Ultra Live" subtitle="Account-backed Study Packs" />
        </div>
        <div className="col-lg-6 d-flex justify-content-lg-end justify-content-start mt-3 mt-lg-0 align-items-center">
          <span className="q-helper-copy mr-3">{user ? `Signed in as ${user.username}` : ''}</span>
          {user ? (
            <>
              {user.role === 'admin' ? (
                <button className="btn btn-outline-light btn-sm mr-2" type="button" onClick={() => navigate('admin')}>
                  Admin
                </button>
              ) : null}
              <button
                className="btn btn-outline-light btn-sm"
                type="button"
                onClick={async () => {
                  await logout()
                  await refreshSessionView()
                }}
              >
                Sign Out
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="q-live-grid">
        {!user ? (
          <section className="q-panel q-live-panel q-live-panel-auth">
            <div className="q-panel-header">
              <div>
                <p className="q-panel-title">Account Access</p>
                <p className="q-panel-subtitle">Sign in to your account, or create one if this is your first time using the web fork.</p>
              </div>
            </div>
            <div className="q-panel-body">
              <div className="q-form-grid">
                <div className="q-metric-box">
                  <div className="q-metric-label">Username</div>
                  <input aria-label="Username" className="q-input" type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Password</div>
                  <input
                    className="q-input"
                    type="password"
                    aria-label="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void submitAuth('login')
                      }
                    }}
                  />
                </div>
                {registrationAvailable ? (
                  <div className="q-metric-box">
                    <div className="q-metric-label">Invite Email</div>
                    <input
                      aria-label="Invite Email"
                      className="q-input"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
              <div className="mt-4 d-flex flex-wrap q-home-auth-actions">
                <button className="btn btn-primary mr-2 mb-2" type="button" onClick={() => void submitAuth('login')}>Sign In</button>
                {registrationAvailable ? (
                  <button className="btn btn-outline-primary mb-2" type="button" onClick={() => void submitAuth('register')}>Accept Invite</button>
                ) : null}
              </div>
              {!registrationAvailable ? (
                <p className="q-helper-copy mt-3 mb-0">
                  {inviteModeEnabled
                    ? 'Account creation is invite-only. Open the invite URL from the admin panel to register.'
                    : 'Account creation is currently closed. Sign in with an existing account.'}
                </p>
              ) : (
                <p className="q-helper-copy mt-3 mb-0">This invite is tied to the email above. Registration will stay locked for everyone else.</p>
              )}
              <p className="q-error-copy mt-3 mb-0">{authError}</p>
            </div>
          </section>
        ) : (
          <section className="q-panel q-live-panel q-live-panel-packs">
            <div className="q-panel-header">
              <div>
                <p className="q-panel-title">Study Packs</p>
                <p className="q-panel-subtitle">Import your qbank folder or zip once, reopen it from any device, and export a compatible archive whenever you want.</p>
              </div>
            </div>
            <div className="q-panel-body">
              <div className="q-form-grid">
                <div className="q-metric-box">
                  <div className="q-metric-label">Study Pack Name</div>
                  <input className="q-input" type="text" placeholder="Kaplan Step 1 Pack" value={packName} onChange={(event) => setPackName(event.target.value)} />
                  <p className="q-helper-copy mt-2 mb-0">Leave blank to reuse the uploaded folder or zip name.</p>
                </div>
              </div>

              <div className="q-import-grid mt-4">
                <div className="q-metric-box">
                  <div className="q-metric-label">Import Folder</div>
                  <p className="q-helper-copy">Choose an existing Quail/Quail Ultra folder containing your qbank files and optional <code>progress.json</code>.</p>
                  <div className="q-file-picker">
                    <input
                      ref={folderInputRef}
                      className="q-input-file q-input-file-hidden"
                      type="file"
                      webkitdirectory=""
                      directory=""
                      multiple
                      onChange={(event) => setFolderFiles(event.target.files)}
                    />
                    <button className="btn btn-outline-primary q-file-trigger" type="button" onClick={() => folderInputRef.current?.click()}>
                      Choose Folder
                    </button>
                    <div className="q-file-selection">{folderSelection}</div>
                  </div>
                  <button className="btn btn-primary mt-3" type="button" onClick={() => void uploadFolder()}>Upload Folder</button>
                </div>

                <div className="q-metric-box">
                  <div className="q-metric-label">Import Zip</div>
                  <p className="q-helper-copy">Upload a zip export of an existing Study Pack when you want to restore or move it.</p>
                  <div className="q-file-picker">
                    <input
                      ref={zipInputRef}
                      className="q-input-file q-input-file-hidden"
                      type="file"
                      accept=".zip,application/zip"
                      onChange={(event) => setZipFile(event.target.files?.[0])}
                    />
                    <button className="btn btn-outline-primary q-file-trigger" type="button" onClick={() => zipInputRef.current?.click()}>
                      Choose Zip
                    </button>
                    <div className="q-file-selection">{zipSelection}</div>
                  </div>
                  <button className="btn btn-outline-primary mt-3" type="button" onClick={() => void uploadZip()}>Upload Zip</button>
                </div>
              </div>

              <p className="q-error-copy mt-3 mb-0">{packError}</p>
              <div className="q-helper-copy mt-3">{packLoading}</div>

              <div className="q-panel mt-4 q-nested-panel">
                <div className="q-panel-header">
                  <div>
                    <p className="q-panel-title">Available Study Packs</p>
                    <p className="q-panel-subtitle">Open a pack to use the same overview, block builder, and exam flow as the desktop app.</p>
                  </div>
                </div>
                <div className="q-panel-body">
                  {packs.length === 0 ? <div className="q-helper-copy">No study packs uploaded yet.</div> : null}
                  <div className="q-pack-list">
                    {packs.map((pack) => {
                      return (
                        <div className="q-pack-card" key={pack.id}>
                          <div>
                            <div className="q-pack-title">{pack.name}</div>
                            <div className="q-helper-copy">Questions: {pack.questionCount} · Revision: {pack.revision}</div>
                            <div className="q-helper-copy">Updated: {new Date(pack.updatedAt).toLocaleString()}</div>
                          </div>
                          <div className="q-pack-actions">
                            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('overview', { pack: pack.id })}>Open</button>
                            <button
                              className="btn btn-outline-primary btn-sm"
                              type="button"
                              onClick={async () => {
                                try {
                                  setPackError('')
                                  setPackLoading('Preparing Study Pack export...')
                                  await exportStudyPackZip(pack, (message) => setPackLoading(message))
                                  setPackLoading('')
                                } catch (error) {
                                  setPackError(error instanceof Error ? error.message : 'Export failed.')
                                }
                              }}
                            >
                              Export Zip
                            </button>
                            <button
                              className="btn btn-outline-danger btn-sm"
                              type="button"
                              onClick={async () => {
                                if (!window.confirm('Delete this Study Pack from your account? The uploaded bank and saved progress will be removed from the server.')) {
                                  return
                                }
                                try {
                                  setPackError('')
                                  setPackLoading('Deleting study pack...')
                                  await deleteStudyPack(pack.id)
                                  await refreshSessionView()
                                  setPackLoading('')
                                } catch (error) {
                                  setPackError(error instanceof Error ? error.message : 'Delete failed.')
                                }
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

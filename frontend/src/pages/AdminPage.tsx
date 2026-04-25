import { Fragment, useEffect, useMemo, useState } from 'react'
import { AppShell } from '../components/AppShell'
import {
  createAdminUser,
  createInvite,
  deprecateNativePackQuestion,
  deleteAdminPack,
  deleteAdminUser,
  deleteLibraryPack,
  getAdminPackProgressSummary,
  getAppSettings,
  getNativePackContent,
  getNativePackQuestion,
  getSession,
  listAdminUsers,
  listInvites,
  listLibraryPacks,
  listUserPacks,
  promoteToLibrary,
  publishNativePackRevision,
  resetAdminPack,
  revokeInvite,
  updateAdminUser,
  updateAppSettings,
  updateNativePackQuestion,
  validateNativePackRevision
} from '../lib/api'
import { navigate } from '../lib/navigation'
import type {
  AdminUser,
  AppSettings,
  InviteCreationResult,
  InviteRecord,
  LibraryPackSummary,
  NativePackContent,
  NativePackDiff,
  NativeQuestionSummary,
  PackProgressSummary,
  StudyPackSummary,
  UserRole
} from '../types/domain'

type AdminTab = 'overview' | 'users' | 'invites' | 'library' | 'content' | 'settings'

interface CreateUserFormState {
  username: string
  password: string
  email: string
  role: UserRole
}

interface CreateInviteFormState {
  email: string
  role: UserRole
  expiresInDays: string
}

interface PromoteFormState {
  name: string
  description: string
}

const EMPTY_USER_FORM: CreateUserFormState = {
  username: '',
  password: '',
  email: '',
  role: 'user'
}

const EMPTY_INVITE_FORM: CreateInviteFormState = {
  email: '',
  role: 'user',
  expiresInDays: '7'
}

const EMPTY_PROMOTE_FORM: PromoteFormState = { name: '', description: '' }

function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

export function AdminPage() {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<import('../types/domain').User | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<AdminTab>('overview')

  const [users, setUsers] = useState<AdminUser[]>([])
  const [invites, setInvites] = useState<InviteRecord[]>([])
  const [libraryPacks, setLibraryPacks] = useState<LibraryPackSummary[]>([])
  const [settings, setSettings] = useState<AppSettings>({ registrationMode: 'invite-only' })
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(EMPTY_USER_FORM)
  const [createInviteForm, setCreateInviteForm] = useState<CreateInviteFormState>(EMPTY_INVITE_FORM)
  const [latestInvite, setLatestInvite] = useState<InviteCreationResult | null>(null)

  const [expandedUserId, setExpandedUserId] = useState<string>('')
  const [userPacks, setUserPacks] = useState<StudyPackSummary[]>([])
  const [userPacksLoading, setUserPacksLoading] = useState(false)
  const [progressSummaries, setProgressSummaries] = useState<Record<string, PackProgressSummary>>({})
  const [promoteFormByPack, setPromoteFormByPack] = useState<Record<string, PromoteFormState>>({})
  const [selectedNativePackId, setSelectedNativePackId] = useState('')
  const [nativeContent, setNativeContent] = useState<NativePackContent | null>(null)
  const [nativeContentLoading, setNativeContentLoading] = useState(false)
  const [nativeSourcePath, setNativeSourcePath] = useState('')
  const [nativeSourceStudyPackId, setNativeSourceStudyPackId] = useState('')
  const [nativeDiff, setNativeDiff] = useState<NativePackDiff | null>(null)
  const [selectedNativeQuestionId, setSelectedNativeQuestionId] = useState('')
  const [nativeQuestionDraft, setNativeQuestionDraft] = useState('')
  const [nativeQuestionSaving, setNativeQuestionSaving] = useState(false)

  async function refreshAdminData(): Promise<void> {
    const [nextSettings, nextUsers, nextInvites, nextLibrary] = await Promise.all([
      getAppSettings(true),
      listAdminUsers(),
      listInvites(),
      listLibraryPacks()
    ])
    setSettings(nextSettings)
    setUsers(nextUsers)
    setInvites(nextInvites)
    setLibraryPacks(nextLibrary)
  }

  async function loadExpandedUserPacks(userId: string): Promise<void> {
    setUserPacksLoading(true)
    try {
      const packs = await listUserPacks(userId)
      setUserPacks(packs)
      // Fetch progress summaries in parallel — best-effort, ignore failures.
      const summaries: Record<string, PackProgressSummary> = {}
      await Promise.all(packs.map(async (pack) => {
        try {
          summaries[pack.id] = await getAdminPackProgressSummary(pack.id)
        } catch {
          // ignore
        }
      }))
      setProgressSummaries(summaries)
    } finally {
      setUserPacksLoading(false)
    }
  }

  function nativeRevisionSource(): { sourcePath?: string; sourceStudyPackId?: string } {
    return {
      ...(nativeSourcePath.trim() ? { sourcePath: nativeSourcePath.trim() } : {}),
      ...(nativeSourceStudyPackId.trim() ? { sourceStudyPackId: nativeSourceStudyPackId.trim() } : {})
    }
  }

  async function loadNativeContent(packId = selectedNativePackId): Promise<void> {
    if (!packId) {
      setNativeContent(null)
      return
    }
    setNativeContentLoading(true)
    try {
      const content = await getNativePackContent(packId)
      setNativeContent(content)
      setSelectedNativeQuestionId('')
      setNativeQuestionDraft('')
      setNativeDiff(null)
    } finally {
      setNativeContentLoading(false)
    }
  }

  async function loadNativeQuestion(questionId: string): Promise<void> {
    if (!selectedNativePackId || !questionId) {
      return
    }
    const question = await getNativePackQuestion(selectedNativePackId, questionId)
    setSelectedNativeQuestionId(questionId)
    setNativeQuestionDraft(JSON.stringify(question, null, 2))
  }

  useEffect(() => {
    let cancelled = false
    async function initialize(): Promise<void> {
      try {
        const current = await getSession(true)
        if (!current) {
          navigate('index')
          return
        }
        if (current.role !== 'admin') {
          navigate('index')
          return
        }
        await refreshAdminData()
        if (!cancelled) {
          setSession(current)
          setError('')
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to load admin controls.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void initialize()
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    const totalPacks = users.reduce((acc, u) => acc + Number(u.packCount || 0), 0)
    const openInvites = invites.filter((i) => !i.usedAt && !i.revokedAt).length
    const disabledAccounts = users.filter((u) => u.status === 'disabled').length
    return {
      totalUsers: users.length,
      totalPacks,
      openInvites,
      disabledAccounts,
      libraryPacks: libraryPacks.length
    }
  }, [users, invites, libraryPacks])

  if (loading) {
    return (
      <AppShell user={session} active="admin" title="Admin">
        <div className="d-flex flex-column justify-content-center align-items-center" style={{ height: '60vh' }}>
          <div className="spinner-border" style={{ width: 72, height: 72 }} role="status" />
        </div>
      </AppShell>
    )
  }

  const groupedInvites = {
    open: invites.filter((i) => !i.usedAt && !i.revokedAt),
    used: invites.filter((i) => Boolean(i.usedAt)),
    revoked: invites.filter((i) => Boolean(i.revokedAt) && !i.usedAt)
  }

  return (
    <AppShell user={session} active="admin" title="Admin">
      <nav className="q-admin-tabs" aria-label="Admin sections">
        {([
          ['overview', 'Overview'],
          ['users', 'Users'],
          ['invites', 'Invites'],
          ['library', 'Library'],
          ['content', 'Content'],
          ['settings', 'Settings']
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`q-admin-tab${tab === key ? ' active' : ''}`}
            type="button"
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <div className="q-stats-grid">
          <div className="q-stat-card">
            <span className="q-stat-card-label">Total Users</span>
            <span className="q-stat-card-value">{stats.totalUsers}</span>
          </div>
          <div className="q-stat-card">
            <span className="q-stat-card-label">Total Packs</span>
            <span className="q-stat-card-value">{stats.totalPacks}</span>
          </div>
          <div className="q-stat-card">
            <span className="q-stat-card-label">Open Invites</span>
            <span className="q-stat-card-value">{stats.openInvites}</span>
          </div>
          <div className="q-stat-card">
            <span className="q-stat-card-label">Disabled Accounts</span>
            <span className="q-stat-card-value">{stats.disabledAccounts}</span>
          </div>
          <div className="q-stat-card">
            <span className="q-stat-card-label">Library Packs</span>
            <span className="q-stat-card-value">{stats.libraryPacks}</span>
          </div>
        </div>
      ) : null}

      {tab === 'users' ? (
        <section className="q-admin-section">
          <div className="q-panel">
            <div className="q-panel-header"><div><p className="q-panel-title">Users</p></div></div>
            <div className="q-panel-body">
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Joined</th>
                      <th>Packs</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((account) => (
                      <Fragment key={account.id}>
                        <tr>
                          <td>{account.username}</td>
                          <td>{account.email || 'No email'}</td>
                          <td>{account.role}</td>
                          <td>{account.status}</td>
                          <td>{formatDate(account.createdAt)}</td>
                          <td>{account.packCount}</td>
                          <td>
                            <div className="d-flex flex-wrap">
                              <button
                                className="btn btn-outline-primary btn-sm mr-2 mb-2"
                                type="button"
                                onClick={async () => {
                                  try {
                                    setError('')
                                    await updateAdminUser(account.id, { role: account.role === 'admin' ? 'user' : 'admin' })
                                    await refreshAdminData()
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : 'Unable to update role.')
                                  }
                                }}
                              >
                                {account.role === 'admin' ? 'Demote' : 'Promote'}
                              </button>
                              <button
                                className="btn btn-outline-secondary btn-sm mr-2 mb-2"
                                type="button"
                                onClick={async () => {
                                  try {
                                    setError('')
                                    await updateAdminUser(account.id, { status: account.status === 'active' ? 'disabled' : 'active' })
                                    await refreshAdminData()
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : 'Unable to update status.')
                                  }
                                }}
                              >
                                {account.status === 'active' ? 'Disable' : 'Activate'}
                              </button>
                              <button
                                className="btn btn-outline-primary btn-sm mr-2 mb-2"
                                type="button"
                                onClick={async () => {
                                  if (expandedUserId === account.id) {
                                    setExpandedUserId('')
                                    setUserPacks([])
                                    return
                                  }
                                  setExpandedUserId(account.id)
                                  await loadExpandedUserPacks(account.id)
                                }}
                              >
                                {expandedUserId === account.id ? 'Hide Packs' : 'View Packs'}
                              </button>
                              <button
                                className="btn btn-outline-danger btn-sm mb-2"
                                type="button"
                                onClick={async () => {
                                  if (!window.confirm(`Delete user ${account.username} and all uploaded packs?`)) return
                                  try {
                                    setError('')
                                    await deleteAdminUser(account.id)
                                    if (expandedUserId === account.id) {
                                      setExpandedUserId('')
                                      setUserPacks([])
                                    }
                                    await refreshAdminData()
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : 'Unable to delete user.')
                                  }
                                }}
                              >
                                Delete User
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expandedUserId === account.id ? (
                          <tr className="q-pack-inline-row">
                            <td colSpan={7} className="q-pack-inline-cell">
                              {userPacksLoading ? <div className="q-helper-copy">Loading packs...</div> : null}
                              {!userPacksLoading && userPacks.length === 0 ? <div className="q-helper-copy">This user has no study packs.</div> : null}
                              {userPacks.map((pack) => {
                                const summary = progressSummaries[pack.id]
                                const totalQ = summary?.totalQuestions ?? 0
                                const correctPct = totalQ > 0 ? `${((100 * (summary?.correctCount ?? 0)) / totalQ).toFixed(1)}%` : '—'
                                return (
                                  <div key={pack.id} className="q-pack-card">
                                    <div>
                                      <div className="q-pack-title">{pack.name}</div>
                                      <div className="q-helper-copy">Questions: {pack.questionCount} · Revision: {pack.revision}</div>
                                      <div className="q-helper-copy">Updated: {new Date(pack.updatedAt).toLocaleString()}</div>
                                      {summary ? (
                                        <div className="mt-2">
                                          <span className="q-progress-chip">Blocks: {summary.completedBlocks}/{summary.totalBlocks}</span>
                                          <span className="q-progress-chip">Correct: {correctPct}</span>
                                          <span className="q-progress-chip">Unused: {summary.unusedCount}</span>
                                          <span className="q-progress-chip">Incorrect: {summary.incorrectCount}</span>
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="q-pack-actions">
                                      <button
                                        className="btn btn-outline-secondary btn-sm"
                                        type="button"
                                        onClick={async () => {
                                          if (!window.confirm(`Reset progress for "${pack.name}"?`)) return
                                          try {
                                            setError('')
                                            await resetAdminPack(pack.id)
                                            await loadExpandedUserPacks(account.id)
                                          } catch (e) {
                                            setError(e instanceof Error ? e.message : 'Unable to reset pack.')
                                          }
                                        }}
                                      >
                                        Reset Progress
                                      </button>
                                      <button
                                        className="btn btn-outline-danger btn-sm"
                                        type="button"
                                        onClick={async () => {
                                          if (!window.confirm(`Delete study pack "${pack.name}"?`)) return
                                          try {
                                            setError('')
                                            await deleteAdminPack(pack.id)
                                            await loadExpandedUserPacks(account.id)
                                            await refreshAdminData()
                                          } catch (e) {
                                            setError(e instanceof Error ? e.message : 'Unable to delete pack.')
                                          }
                                        }}
                                      >
                                        Delete Pack
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'invites' ? (
        <section className="q-admin-section">
          <div className="q-panel">
            <div className="q-panel-header"><div><p className="q-panel-title">Create Invite</p></div></div>
            <div className="q-panel-body">
              <div className="q-form-grid">
                <div className="q-metric-box">
                  <div className="q-metric-label">Invite Email</div>
                  <input className="q-input" type="email" value={createInviteForm.email} onChange={(event) => setCreateInviteForm((current) => ({ ...current, email: event.target.value }))} />
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Role</div>
                  <select className="q-input" value={createInviteForm.role} onChange={(event) => setCreateInviteForm((current) => ({ ...current, role: event.target.value as UserRole }))}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Expires In (Days)</div>
                  <input className="q-input" type="number" min="1" max="90" value={createInviteForm.expiresInDays} onChange={(event) => setCreateInviteForm((current) => ({ ...current, expiresInDays: event.target.value }))} />
                </div>
              </div>
              <div className="mt-3">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={async () => {
                    try {
                      setError('')
                      const created = await createInvite({
                        email: createInviteForm.email,
                        role: createInviteForm.role,
                        expiresInDays: Number(createInviteForm.expiresInDays || '7')
                      })
                      setLatestInvite(created)
                      setCreateInviteForm(EMPTY_INVITE_FORM)
                      await refreshAdminData()
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Unable to create invite.')
                    }
                  }}
                >
                  Create Invite
                </button>
              </div>
              {latestInvite ? (
                <div className="q-metric-box mt-4">
                  <div className="q-metric-label">Latest Invite URL</div>
                  <input readOnly className="q-input" value={latestInvite.inviteUrl} />
                  <p className="q-helper-copy mt-2 mb-0">
                    {latestInvite.emailSent === true
                      ? `✓ Email sent to ${latestInvite.invite.email}.`
                      : 'Email is not configured. Copy the URL above and send it manually.'}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {(['open', 'used', 'revoked'] as const).map((group) => {
            const rows = groupedInvites[group]
            if (rows.length === 0) return null
            const title = group === 'open' ? 'Open' : group === 'used' ? 'Used' : 'Revoked'
            return (
              <div key={group} className="q-panel mt-4">
                <div className="q-panel-header"><div><p className="q-panel-title">{title} Invites</p></div></div>
                <div className="q-panel-body">
                  <div className="table-responsive">
                    <table className="table table-hover">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Created By</th>
                          <th>Expires</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((invite) => {
                          const status = invite.revokedAt ? 'Revoked' : (invite.usedAt ? `Used by ${invite.usedByUsername || 'unknown user'}` : 'Open')
                          return (
                            <tr key={invite.id}>
                              <td>{invite.email}</td>
                              <td>{invite.role}</td>
                              <td>{invite.createdByUsername || 'Unknown'}</td>
                              <td>{new Date(invite.expiresAt).toLocaleString()}</td>
                              <td>{status}</td>
                              <td>
                                {!invite.usedAt && !invite.revokedAt ? (
                                  <button
                                    className="btn btn-outline-danger btn-sm"
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        setError('')
                                        await revokeInvite(invite.id)
                                        await refreshAdminData()
                                      } catch (e) {
                                        setError(e instanceof Error ? e.message : 'Unable to revoke invite.')
                                      }
                                    }}
                                  >
                                    Revoke
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          })}
        </section>
      ) : null}

      {tab === 'library' ? (
        <section className="q-admin-section">
          <div className="q-panel">
            <div className="q-panel-header"><div><p className="q-panel-title">Promote a Study Pack to the Library</p></div></div>
            <div className="q-panel-body">
              <p className="q-helper-copy mb-3">Upload a study pack through the normal Home-page import flow, then promote it here. Library packs are shared with every user; progress stays per-user.</p>
              {users.find((u) => u.id === session?.id)?.packCount === 0 ? (
                <div className="q-helper-copy">You have no packs to promote. Import one from the Home page first.</div>
              ) : null}
              <AdminOwnPacksList
                currentUserId={session?.id ?? ''}
                promoteFormByPack={promoteFormByPack}
                setPromoteFormByPack={setPromoteFormByPack}
                onError={setError}
                onPromoted={async () => {
                  setPromoteFormByPack({})
                  await refreshAdminData()
                }}
              />
            </div>
          </div>

          <div className="q-panel mt-4">
            <div className="q-panel-header"><div><p className="q-panel-title">Library Packs</p></div></div>
            <div className="q-panel-body">
              {libraryPacks.length === 0 ? <div className="q-helper-copy">No library packs yet.</div> : null}
              <div className="q-library-grid" style={{ padding: 0 }}>
                {libraryPacks.map((pack) => (
                  <div key={pack.id} className="q-library-card">
                    <p className="q-library-card-title">{pack.name}</p>
                    {pack.description ? <p className="q-library-card-desc">{pack.description}</p> : null}
                    <div className="q-library-card-meta">{pack.questionCount} questions · {formatDate(pack.createdAt)}</div>
                    <div className="q-library-card-actions">
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={async () => {
                          if (!window.confirm(`Delete library pack "${pack.name}"? Users who imported it will lose access.`)) return
                          try {
                            setError('')
                            await deleteLibraryPack(pack.id)
                            await refreshAdminData()
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Unable to delete library pack.')
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'content' ? (
        <section className="q-admin-section">
          <div className="q-panel">
            <div className="q-panel-header"><div><p className="q-panel-title">Native Pack Content</p></div></div>
            <div className="q-panel-body">
              <div className="q-form-grid">
                <div className="q-metric-box">
                  <div className="q-metric-label">Library Pack</div>
                  <select
                    className="q-input"
                    value={selectedNativePackId}
                    onChange={(event) => {
                      setSelectedNativePackId(event.target.value)
                      setNativeContent(null)
                      setNativeDiff(null)
                      setSelectedNativeQuestionId('')
                      setNativeQuestionDraft('')
                    }}
                  >
                    <option value="">Select a library pack</option>
                    {libraryPacks.map((pack) => (
                      <option key={pack.id} value={pack.id}>{pack.name}</option>
                    ))}
                  </select>
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Revision Source Path</div>
                  <input
                    className="q-input"
                    value={nativeSourcePath}
                    onChange={(event) => setNativeSourcePath(event.target.value)}
                    placeholder="/Users/.../output/packs/pediatrics"
                  />
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Source Study Pack ID</div>
                  <input
                    className="q-input"
                    value={nativeSourceStudyPackId}
                    onChange={(event) => setNativeSourceStudyPackId(event.target.value)}
                    placeholder="Optional imported native pack id"
                  />
                </div>
              </div>
              <div className="mt-3 d-flex flex-wrap">
                <button
                  className="btn btn-outline-primary mr-2 mb-2"
                  type="button"
                  disabled={!selectedNativePackId || nativeContentLoading}
                  onClick={async () => {
                    try {
                      setError('')
                      await loadNativeContent()
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Unable to load native content.')
                    }
                  }}
                >
                  Load Content
                </button>
                <button
                  className="btn btn-outline-secondary mr-2 mb-2"
                  type="button"
                  disabled={!selectedNativePackId}
                  onClick={async () => {
                    try {
                      setError('')
                      setNativeDiff(await validateNativePackRevision(selectedNativePackId, nativeRevisionSource()))
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Unable to validate revision.')
                    }
                  }}
                >
                  Validate Revision
                </button>
                <button
                  className="btn btn-primary mb-2"
                  type="button"
                  disabled={!selectedNativePackId}
                  onClick={async () => {
                    if (!window.confirm('Publish this native revision to the selected library pack?')) return
                    try {
                      setError('')
                      const result = await publishNativePackRevision(selectedNativePackId, nativeRevisionSource())
                      setNativeDiff(result.diff)
                      await refreshAdminData()
                      await loadNativeContent(selectedNativePackId)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Unable to publish revision.')
                    }
                  }}
                >
                  Publish Revision
                </button>
              </div>
              {nativeContentLoading ? <div className="q-helper-copy mt-3">Loading native content...</div> : null}
              {nativeContent && !nativeContent.native ? (
                <p className="q-helper-copy mt-3 mb-0">{nativeContent.error || 'This pack is not native.'}</p>
              ) : null}
              {nativeContent?.native && nativeContent.manifest ? (
                <div className="q-stats-grid mt-4">
                  <div className="q-stat-card">
                    <span className="q-stat-card-label">Pack ID</span>
                    <span className="q-stat-card-value" style={{ fontSize: 18 }}>{nativeContent.manifest.packId}</span>
                  </div>
                  <div className="q-stat-card">
                    <span className="q-stat-card-label">Revision</span>
                    <span className="q-stat-card-value">{nativeContent.manifest.revision.number}</span>
                  </div>
                  <div className="q-stat-card">
                    <span className="q-stat-card-label">Ready</span>
                    <span className="q-stat-card-value">{nativeContent.manifest.activeQuestionCount}</span>
                  </div>
                  <div className="q-stat-card">
                    <span className="q-stat-card-label">Total</span>
                    <span className="q-stat-card-value">{nativeContent.manifest.totalQuestionCount}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {nativeDiff ? (
            <div className="q-panel mt-4">
              <div className="q-panel-header"><div><p className="q-panel-title">Revision Diff</p></div></div>
              <div className="q-panel-body">
                <div className="q-stats-grid">
                  <div className="q-stat-card"><span className="q-stat-card-label">Added</span><span className="q-stat-card-value">{nativeDiff.added.length}</span></div>
                  <div className="q-stat-card"><span className="q-stat-card-label">Changed</span><span className="q-stat-card-value">{nativeDiff.changed.length}</span></div>
                  <div className="q-stat-card"><span className="q-stat-card-label">Deprecated</span><span className="q-stat-card-value">{nativeDiff.deprecated.length}</span></div>
                  <div className="q-stat-card"><span className="q-stat-card-label">Blocked</span><span className="q-stat-card-value">{nativeDiff.blocked.length}</span></div>
                </div>
                {nativeDiff.errors.length > 0 ? (
                  <div className="q-error-copy mt-3">{nativeDiff.errors.slice(0, 6).join(' ')}</div>
                ) : null}
                {nativeDiff.warnings.length > 0 ? (
                  <div className="q-helper-copy mt-3">{nativeDiff.warnings.slice(0, 6).join(' ')}</div>
                ) : null}
                <NativeDiffTable title="Added" rows={nativeDiff.added} />
                <NativeDiffTable title="Changed" rows={nativeDiff.changed} />
                <NativeDiffTable title="Deprecated" rows={nativeDiff.deprecated} />
              </div>
            </div>
          ) : null}

          {nativeContent?.native ? (
            <div className="q-panel mt-4">
              <div className="q-panel-header"><div><p className="q-panel-title">Questions</p></div></div>
              <div className="q-panel-body">
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Status</th>
                        <th>Topic</th>
                        <th>Answer</th>
                        <th>Source</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(nativeContent.questions || []).map((question) => (
                        <tr key={question.id}>
                          <td>{question.id}</td>
                          <td>{question.status}</td>
                          <td>{String(question.tags.topic || '')}</td>
                          <td>{question.correctChoiceId}</td>
                          <td>{String(question.source.documentId || '')}:{String(question.source.slideNumber || '')}</td>
                          <td>
                            <button
                              className="btn btn-outline-primary btn-sm mr-2"
                              type="button"
                              onClick={async () => {
                                try {
                                  setError('')
                                  await loadNativeQuestion(question.id)
                                } catch (e) {
                                  setError(e instanceof Error ? e.message : 'Unable to load question.')
                                }
                              }}
                            >
                              Edit
                            </button>
                            {question.status !== 'deprecated' ? (
                              <button
                                className="btn btn-outline-danger btn-sm"
                                type="button"
                                onClick={async () => {
                                  if (!window.confirm(`Deprecate ${question.id}?`)) return
                                  try {
                                    setError('')
                                    await deprecateNativePackQuestion(selectedNativePackId, question.id, 'Deprecated from admin Content tab')
                                    await loadNativeContent(selectedNativePackId)
                                    await refreshAdminData()
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : 'Unable to deprecate question.')
                                  }
                                }}
                              >
                                Deprecate
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedNativeQuestionId ? (
                  <div className="q-metric-box mt-4">
                    <div className="q-metric-label">Question JSON: {selectedNativeQuestionId}</div>
                    <textarea
                      className="q-input"
                      style={{ minHeight: 360, fontFamily: 'var(--font-mono, monospace)' }}
                      value={nativeQuestionDraft}
                      onChange={(event) => setNativeQuestionDraft(event.target.value)}
                    />
                    <div className="mt-3">
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={nativeQuestionSaving}
                        onClick={async () => {
                          try {
                            setNativeQuestionSaving(true)
                            setError('')
                            const parsed = JSON.parse(nativeQuestionDraft)
                            await updateNativePackQuestion(selectedNativePackId, selectedNativeQuestionId, parsed, 'Manual admin edit')
                            await loadNativeContent(selectedNativePackId)
                            await refreshAdminData()
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Unable to save question.')
                          } finally {
                            setNativeQuestionSaving(false)
                          }
                        }}
                      >
                        Save Question
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'settings' ? (
        <section className="q-admin-section">
          <div className="q-panel">
            <div className="q-panel-header"><div><p className="q-panel-title">Runtime Controls</p></div></div>
            <div className="q-panel-body">
              <div className="q-form-grid">
                <div className="q-metric-box">
                  <div className="q-metric-label">Registration Mode</div>
                  <select
                    aria-label="Registration Mode"
                    className="q-input"
                    value={settings.registrationMode}
                    onChange={(event) => setSettings((current) => ({ ...current, registrationMode: event.target.value as AppSettings['registrationMode'] }))}
                  >
                    <option value="invite-only">Invite Only</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={settingsSaving}
                  onClick={async () => {
                    try {
                      setSettingsSaving(true)
                      setError('')
                      const next = await updateAppSettings(settings)
                      setSettings(next)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Unable to update settings.')
                    } finally {
                      setSettingsSaving(false)
                    }
                  }}
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>

          <div className="q-panel mt-4">
            <div className="q-panel-header"><div><p className="q-panel-title">Create User</p></div></div>
            <div className="q-panel-body">
              <div className="q-form-grid">
                <div className="q-metric-box">
                  <div className="q-metric-label">Username</div>
                  <input className="q-input" value={createUserForm.username} onChange={(event) => setCreateUserForm((current) => ({ ...current, username: event.target.value }))} />
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Email</div>
                  <input className="q-input" type="email" value={createUserForm.email} onChange={(event) => setCreateUserForm((current) => ({ ...current, email: event.target.value }))} />
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Password</div>
                  <input className="q-input" type="password" value={createUserForm.password} onChange={(event) => setCreateUserForm((current) => ({ ...current, password: event.target.value }))} />
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Role</div>
                  <select className="q-input" value={createUserForm.role} onChange={(event) => setCreateUserForm((current) => ({ ...current, role: event.target.value as UserRole }))}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={async () => {
                    try {
                      setError('')
                      await createAdminUser(createUserForm)
                      setCreateUserForm(EMPTY_USER_FORM)
                      await refreshAdminData()
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Unable to create user.')
                    }
                  }}
                >
                  Create User
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {error ? <p className="q-error-copy" style={{ padding: '0 24px 24px' }}>{error}</p> : null}
    </AppShell>
  )
}

function NativeDiffTable({ title, rows }: { title: string; rows: NativeQuestionSummary[] }) {
  if (rows.length === 0) {
    return null
  }
  return (
    <div className="mt-4">
      <p className="q-panel-title" style={{ fontSize: 16 }}>{title}</p>
      <div className="table-responsive">
        <table className="table table-hover">
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Topic</th>
              <th>Answer</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.id}`}>
                <td>{row.id}</td>
                <td>{row.status}</td>
                <td>{String(row.tags.topic || '')}</td>
                <td>{row.correctChoiceId}</td>
                <td>{row.changeSummary || row.titlePreview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Nested component: lists the current admin's own packs so they can be
// promoted to the library.
function AdminOwnPacksList({
  currentUserId,
  promoteFormByPack,
  setPromoteFormByPack,
  onError,
  onPromoted
}: {
  currentUserId: string
  promoteFormByPack: Record<string, PromoteFormState>
  setPromoteFormByPack: React.Dispatch<React.SetStateAction<Record<string, PromoteFormState>>>
  onError: (message: string) => void
  onPromoted: () => void | Promise<void>
}) {
  const [packs, setPacks] = useState<StudyPackSummary[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh(): Promise<void> {
    if (!currentUserId) return
    setLoading(true)
    try {
      setPacks(await listUserPacks(currentUserId))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [currentUserId])

  if (loading) return <div className="q-helper-copy">Loading your packs...</div>
  if (packs.length === 0) return <div className="q-helper-copy">You have no packs to promote.</div>

  return (
    <div className="q-pack-list">
      {packs.map((pack) => {
        const form = promoteFormByPack[pack.id] ?? { name: pack.name, description: '' }
        return (
          <div key={pack.id} className="q-pack-card">
            <div style={{ flex: 1 }}>
              <div className="q-pack-title">{pack.name}</div>
              <div className="q-helper-copy">Questions: {pack.questionCount}</div>
              <div className="mt-2 q-form-grid">
                <div className="q-metric-box">
                  <div className="q-metric-label">Library Name</div>
                  <input
                    className="q-input"
                    value={form.name}
                    onChange={(event) => setPromoteFormByPack((current) => ({
                      ...current,
                      [pack.id]: { ...form, name: event.target.value }
                    }))}
                  />
                </div>
                <div className="q-metric-box">
                  <div className="q-metric-label">Description</div>
                  <input
                    className="q-input"
                    value={form.description}
                    onChange={(event) => setPromoteFormByPack((current) => ({
                      ...current,
                      [pack.id]: { ...form, description: event.target.value }
                    }))}
                  />
                </div>
              </div>
            </div>
            <div className="q-pack-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  if (!window.confirm(`Promote "${pack.name}" to the library? This pack will move to the shared library.`)) return
                  try {
                    await promoteToLibrary(pack.id, form.name.trim() || pack.name, form.description.trim())
                    await onPromoted()
                    await refresh()
                  } catch (e) {
                    onError(e instanceof Error ? e.message : 'Unable to promote pack.')
                  }
                }}
              >
                Promote to Library
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

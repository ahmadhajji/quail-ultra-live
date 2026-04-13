import { useEffect, useState } from 'react'
import {
  createAdminUser,
  createInvite,
  deleteAdminPack,
  deleteAdminUser,
  getAppSettings,
  getSession,
  listAdminUsers,
  listInvites,
  listUserPacks,
  logout,
  revokeInvite,
  updateAdminUser,
  updateAppSettings
} from '../lib/api'
import { Brand } from '../components/Brand'
import { navigate } from '../lib/navigation'
import type { AdminUser, AppSettings, InviteCreationResult, InviteRecord, StudyPackSummary, UserRole } from '../types/domain'

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

export function AdminPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [invites, setInvites] = useState<InviteRecord[]>([])
  const [settings, setSettings] = useState<AppSettings>({ registrationMode: 'invite-only' })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(EMPTY_USER_FORM)
  const [createInviteForm, setCreateInviteForm] = useState<CreateInviteFormState>(EMPTY_INVITE_FORM)
  const [latestInvite, setLatestInvite] = useState<InviteCreationResult | null>(null)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedUserPacks, setSelectedUserPacks] = useState<StudyPackSummary[]>([])
  const [packsLoading, setPacksLoading] = useState(false)

  async function refreshAdminData(): Promise<void> {
    const [nextSettings, nextUsers, nextInvites] = await Promise.all([
      getAppSettings(true),
      listAdminUsers(),
      listInvites()
    ])
    setSettings(nextSettings)
    setUsers(nextUsers)
    setInvites(nextInvites)
  }

  async function loadSelectedUserPacks(userId: string): Promise<void> {
    setPacksLoading(true)
    try {
      setSelectedUserId(userId)
      setSelectedUserPacks(await listUserPacks(userId))
    } finally {
      setPacksLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function initialize(): Promise<void> {
      try {
        const session = await getSession(true)
        if (!session) {
          navigate('index')
          return
        }
        if (session.role !== 'admin') {
          navigate('index')
          return
        }
        await refreshAdminData()
        if (!cancelled) {
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

  if (loading) {
    return (
      <div className="container-fluid d-flex flex-column flex-grow-1 justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="spinner-border" style={{ width: 72, height: 72 }} role="status" />
      </div>
    )
  }

  return (
    <div className="container-fluid d-flex flex-column" style={{ minHeight: '100vh' }}>
      <div className="row q-topbar">
        <div className="col-lg-6 d-flex align-items-center">
          <button className="q-back-btn btn mr-2" type="button" onClick={() => navigate('index')}>&lsaquo;</button>
          <Brand title="Quail Ultra Live" subtitle="Admin Controls" />
        </div>
        <div className="col-lg-6 d-flex justify-content-lg-end justify-content-start mt-3 mt-lg-0 align-items-center">
          <button className="btn btn-outline-light btn-sm mr-2" type="button" onClick={() => navigate('index')}>
            Home
          </button>
          <button
            className="btn btn-outline-light btn-sm"
            type="button"
            onClick={async () => {
              await logout()
              navigate('index')
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="q-live-grid">
        <section className="q-panel q-live-panel">
          <div className="q-panel-header">
            <div>
              <p className="q-panel-title">Runtime Controls</p>
              <p className="q-panel-subtitle">Keep registration locked down while still allowing admin-managed invite onboarding.</p>
            </div>
          </div>
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
                    const nextSettings = await updateAppSettings(settings)
                    setSettings(nextSettings)
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : 'Unable to update settings.')
                  } finally {
                    setSettingsSaving(false)
                  }
                }}
              >
                Save Settings
              </button>
            </div>
          </div>
        </section>

        <section className="q-panel q-live-panel">
          <div className="q-panel-header">
            <div>
              <p className="q-panel-title">Create User</p>
              <p className="q-panel-subtitle">Directly provision a user account without exposing public self-signup.</p>
            </div>
          </div>
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
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : 'Unable to create user.')
                  }
                }}
              >
                Create User
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="q-live-grid">
        <section className="q-panel q-live-panel">
          <div className="q-panel-header">
            <div>
              <p className="q-panel-title">Invite Links</p>
              <p className="q-panel-subtitle">Generate email-bound invite URLs for manual sharing. Registration remains closed unless the invite is valid.</p>
            </div>
          </div>
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
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : 'Unable to create invite.')
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
              </div>
            ) : null}

            <div className="table-responsive mt-4">
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
                  {invites.map((invite) => {
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
                                } catch (nextError) {
                                  setError(nextError instanceof Error ? nextError.message : 'Unable to revoke invite.')
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
        </section>

        <section className="q-panel q-live-panel">
          <div className="q-panel-header">
            <div>
              <p className="q-panel-title">Users</p>
              <p className="q-panel-subtitle">Promote, disable, inspect storage usage, or delete user-owned packs and accounts.</p>
            </div>
          </div>
          <div className="q-panel-body">
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Packs</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((account) => (
                    <tr key={account.id}>
                      <td>{account.username}</td>
                      <td>{account.email || 'No email'}</td>
                      <td>{account.role}</td>
                      <td>{account.status}</td>
                      <td>{account.packCount}</td>
                      <td>
                        <div className="d-flex flex-wrap">
                          <button
                            className="btn btn-outline-primary btn-sm mr-2 mb-2"
                            type="button"
                            onClick={async () => {
                              try {
                                setError('')
                                await updateAdminUser(account.id, {
                                  role: account.role === 'admin' ? 'user' : 'admin'
                                })
                                await refreshAdminData()
                              } catch (nextError) {
                                setError(nextError instanceof Error ? nextError.message : 'Unable to update role.')
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
                                await updateAdminUser(account.id, {
                                  status: account.status === 'active' ? 'disabled' : 'active'
                                })
                                await refreshAdminData()
                              } catch (nextError) {
                                setError(nextError instanceof Error ? nextError.message : 'Unable to update status.')
                              }
                            }}
                          >
                            {account.status === 'active' ? 'Disable' : 'Activate'}
                          </button>
                          <button
                            className="btn btn-outline-primary btn-sm mr-2 mb-2"
                            type="button"
                            onClick={() => void loadSelectedUserPacks(account.id)}
                          >
                            View Packs
                          </button>
                          <button
                            className="btn btn-outline-danger btn-sm mb-2"
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`Delete user ${account.username} and all uploaded packs?`)) {
                                return
                              }
                              try {
                                setError('')
                                await deleteAdminUser(account.id)
                                if (selectedUserId === account.id) {
                                  setSelectedUserId('')
                                  setSelectedUserPacks([])
                                }
                                await refreshAdminData()
                              } catch (nextError) {
                                setError(nextError instanceof Error ? nextError.message : 'Unable to delete user.')
                              }
                            }}
                          >
                            Delete User
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="q-panel mt-4 q-nested-panel">
              <div className="q-panel-header">
                <div>
                  <p className="q-panel-title">Selected User Packs</p>
                  <p className="q-panel-subtitle">Inspect storage use and delete uploaded study packs without signing into the user account.</p>
                </div>
              </div>
              <div className="q-panel-body">
                {packsLoading ? <div className="q-helper-copy">Loading packs...</div> : null}
                {!packsLoading && selectedUserId && selectedUserPacks.length === 0 ? <div className="q-helper-copy">This user has no study packs.</div> : null}
                {!selectedUserId ? <div className="q-helper-copy">Select a user above to inspect their packs.</div> : null}
                {selectedUserPacks.map((pack) => (
                  <div key={pack.id} className="q-pack-card">
                    <div>
                      <div className="q-pack-title">{pack.name}</div>
                      <div className="q-helper-copy">Questions: {pack.questionCount} · Revision: {pack.revision}</div>
                      <div className="q-helper-copy">Updated: {new Date(pack.updatedAt).toLocaleString()}</div>
                    </div>
                    <div className="q-pack-actions">
                      <button
                        className="btn btn-outline-danger btn-sm"
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`Delete study pack "${pack.name}"?`)) {
                            return
                          }
                          try {
                            setError('')
                            await deleteAdminPack(pack.id)
                            if (selectedUserId) {
                              await loadSelectedUserPacks(selectedUserId)
                            }
                            await refreshAdminData()
                          } catch (nextError) {
                            setError(nextError instanceof Error ? nextError.message : 'Unable to delete study pack.')
                          }
                        }}
                      >
                        Delete Pack
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <p className="q-error-copy mt-3 mb-4">{error}</p>
    </div>
  )
}

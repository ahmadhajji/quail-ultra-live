import { useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { getSession, importLibraryPack, listLibraryPacks } from '../lib/api'
import { navigate } from '../lib/navigation'
import type { LibraryPackSummary, User } from '../types/domain'

export function LibraryPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [packs, setPacks] = useState<LibraryPackSummary[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    let cancelled = false

    async function run(): Promise<void> {
      try {
        const session = await getSession(true)
        if (!session) {
          navigate('index')
          return
        }
        const library = await listLibraryPacks()
        if (!cancelled) {
          setUser(session)
          setPacks(library)
        }
      } catch (next) {
        if (!cancelled) {
          setError(next instanceof Error ? next.message : 'Unable to load the library.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleImport(pack: LibraryPackSummary): Promise<void> {
    try {
      setBusyId(pack.id)
      setError('')
      await importLibraryPack(pack.id)
      // Navigate home so the newly-imported pack shows in the list.
      navigate('index')
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Unable to add this pack.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <AppShell user={user} active="library" title="Library">
      {loading ? (
        <div className="q-library-empty">Loading library...</div>
      ) : packs.length === 0 ? (
        <div className="q-library-empty">
          No library packs available yet. Admins can promote their own study packs to the library from the Admin page.
        </div>
      ) : (
        <div className="q-library-grid">
          {packs.map((pack) => (
            <div key={pack.id} className="q-library-card">
              <p className="q-library-card-title">{pack.name}</p>
              {pack.description ? <p className="q-library-card-desc">{pack.description}</p> : null}
              <div className="q-library-card-meta">{pack.questionCount} questions</div>
              <div className="q-library-card-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyId === pack.id}
                  onClick={() => void handleImport(pack)}
                >
                  {busyId === pack.id ? 'Adding...' : 'Add to My Packs'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error ? <p className="q-error-copy" style={{ padding: '0 24px' }}>{error}</p> : null}
    </AppShell>
  )
}

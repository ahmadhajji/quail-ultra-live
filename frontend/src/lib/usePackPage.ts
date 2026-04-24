import { useEffect, useState } from 'react'
import { getSession, listStudyPacks, loadPack } from './api'
import { getCurrentBlockKey, getCurrentPackId, navigate } from './navigation'
import type { QbankInfo, User } from '../types/domain'

interface PackPageState {
  loading: boolean
  user: User | null
  packId: string
  packName: string
  qbankinfo: QbankInfo | null
  error: string
  setQbankinfo: React.Dispatch<React.SetStateAction<QbankInfo | null>>
}

export function usePackPage(): PackPageState {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [qbankinfo, setQbankinfo] = useState<QbankInfo | null>(null)
  const [packName, setPackName] = useState('')
  const [error, setError] = useState('')
  const packId = getCurrentPackId()

  useEffect(() => {
    let cancelled = false

    async function run(): Promise<void> {
      try {
        const session = await getSession()
        if (!session) {
          navigate('index')
          return
        }
        if (!packId) {
          navigate('index')
          return
        }
        const loaded = await loadPack(packId, getCurrentBlockKey())
        if (!cancelled) {
          setUser(session)
          setQbankinfo(loaded)
          setError('')
        }
        // Resolve a human-readable pack name for display in the sidebar header.
        // Failure here must not block rendering; leave the name empty.
        try {
          const packs = await listStudyPacks()
          if (!cancelled) {
            const match = packs.find((pack) => pack.id === packId)
            setPackName(match?.name ?? '')
          }
        } catch {
          // ignore — sidebar will just not show the name
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load this study pack.'
        if (!cancelled) {
          setError(message)
        }
        window.alert(message)
        navigate('index')
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
  }, [packId])

  return {
    loading,
    user,
    packId,
    packName,
    qbankinfo,
    error,
    setQbankinfo
  }
}

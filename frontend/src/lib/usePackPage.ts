import { useEffect, useState } from 'react'
import { getSession, loadPack } from './api'
import { getCurrentBlockKey, getCurrentPackId, navigate } from './navigation'
import type { QbankInfo, User } from '../types/domain'

interface PackPageState {
  loading: boolean
  user: User | null
  packId: string
  qbankinfo: QbankInfo | null
  error: string
  setQbankinfo: React.Dispatch<React.SetStateAction<QbankInfo | null>>
}

export function usePackPage(): PackPageState {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [qbankinfo, setQbankinfo] = useState<QbankInfo | null>(null)
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
    qbankinfo,
    error,
    setQbankinfo
  }
}

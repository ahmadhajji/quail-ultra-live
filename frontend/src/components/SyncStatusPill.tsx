import { useEffect, useState } from 'react'
import { getSyncStatus, subscribeSyncStatus, type SyncStatus, type SyncStatusState } from '../lib/api'

const STATE_COPY: Record<SyncStatusState, { label: string; description: string }> = {
  synced: { label: 'Synced', description: 'All changes saved to the server.' },
  syncing: { label: 'Syncing', description: 'Saving your latest changes.' },
  pending: { label: 'Syncing', description: 'Saved locally. Sync pending.' },
  offline: { label: 'Offline', description: 'Saved locally. Will sync when the connection returns.' },
  error: { label: 'Retrying', description: 'Last sync failed. We will retry automatically.' }
}

/**
 * A subtle status pill that replaces the old per-event sync toast. Renders in
 * the top-right of the viewport and only draws attention when sync is not in
 * the healthy `synced` state. In `synced`, we still render a compact dot so
 * the user can confirm the app is saving — but it doesn't take over the eye.
 */
export function SyncStatusPill() {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus())

  useEffect(() => {
    return subscribeSyncStatus(setStatus)
  }, [])

  const copy = STATE_COPY[status.state]
  const className = `sync-status-pill sync-status-pill-${status.state}`

  return (
    <div className={className} role="status" aria-live="polite" aria-label={`${copy.label}. ${copy.description}`}>
      <span className="sync-status-pill-dot" aria-hidden="true" />
      <span className="sync-status-pill-label">{copy.label}</span>
    </div>
  )
}

import 'bootstrap/dist/css/bootstrap.min.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushDirtyProgress, installOnlineSyncHandler, registerServiceWorker } from './api'

let initialized = false

function initializeGlobalRuntime(): void {
  if (initialized) {
    return
  }
  initialized = true
  registerServiceWorker()
  installOnlineSyncHandler()
  void flushDirtyProgress()
}

export function bootstrap(element: React.ReactElement): void {
  initializeGlobalRuntime()
  const container = document.getElementById('root')
  if (!container) {
    throw new Error('Missing root container.')
  }
  createRoot(container).render(
    <StrictMode>
      {element}
    </StrictMode>
  )
}

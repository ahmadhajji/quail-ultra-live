import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { flushDirtyProgress, installOnlineSyncHandler, registerServiceWorker } from './api'
import { registerNavigateHandler } from './navigation'

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
      <BrowserRouter>
        <NavigationBridge />
        {element}
      </BrowserRouter>
    </StrictMode>
  )
}

function NavigationBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    registerNavigateHandler((to, options) => {
      navigate(to, options)
    })
    return () => {
      registerNavigateHandler(null)
    }
  }, [navigate])

  return null
}

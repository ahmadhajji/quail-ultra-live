import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { logout } from '../lib/api'
import { navigate, type PageName } from '../lib/navigation'
import { ThemeToggle } from './ThemeToggle'
import type { User } from '../types/domain'

const COLLAPSED_STORAGE_KEY = 'quail-sidebar-collapsed'

export type SidebarPage = 'home' | 'library' | 'admin' | 'overview' | 'newblock' | 'previousblocks' | 'other'

interface AppShellProps {
  user: User | null
  active: SidebarPage
  packId?: string
  packName?: string
  title: string
  rightSlot?: ReactNode
  children: ReactNode
  onSignOut?: () => void | Promise<void>
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(value))
  } catch {
    // ignore
  }
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 768
  })
  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

interface NavItemProps {
  active: boolean
  icon: string
  label: string
  collapsed: boolean
  onClick: () => void
  title?: string
}

function NavItem({ active, icon, label, collapsed, onClick, title }: NavItemProps) {
  return (
    <button
      type="button"
      className={`q-sidebar-item${active ? ' active' : ''}`}
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
    >
      <span className="q-sidebar-item-icon" aria-hidden="true">{icon}</span>
      {collapsed ? null : <span className="q-sidebar-item-label">{label}</span>}
    </button>
  )
}

export function AppShell({ user, active, packId, packName, title, rightSlot, children, onSignOut }: AppShellProps) {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed())
  const [mobileOpen, setMobileOpen] = useState<boolean>(false)

  useEffect(() => {
    writeCollapsed(collapsed)
  }, [collapsed])

  // Close mobile drawer when switching to desktop
  useEffect(() => {
    if (!isMobile && mobileOpen) {
      setMobileOpen(false)
    }
  }, [isMobile, mobileOpen])

  const effectiveCollapsed = isMobile ? false : collapsed
  const packHref = useMemo(() => packId ?? '', [packId])
  const inPackContext = Boolean(packId)

  async function handleSignOut() {
    if (onSignOut) {
      await onSignOut()
      return
    }
    await logout()
    navigate('index')
  }

  function go(page: PageName, params: Record<string, string> = {}) {
    navigate(page, params)
    if (isMobile) {
      setMobileOpen(false)
    }
  }

  function toggleSidebar() {
    if (isMobile) {
      setMobileOpen((current) => !current)
    } else {
      setCollapsed((current) => !current)
    }
  }

  const sidebarClasses = [
    'q-sidebar',
    effectiveCollapsed ? 'collapsed' : '',
    isMobile ? 'mobile' : '',
    isMobile && mobileOpen ? 'open' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={`q-app-shell${effectiveCollapsed ? ' shell-collapsed' : ''}`}>
      {isMobile && mobileOpen ? (
        <div
          className="q-sidebar-overlay"
          role="presentation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside className={sidebarClasses} aria-label="Main navigation">
        <div className="q-sidebar-header">
          <div className="q-sidebar-brand">
            <img className="q-sidebar-logo" src="/branding/quail-ultra.png" alt="Quail Ultra" />
            {effectiveCollapsed ? null : <span className="q-sidebar-brand-title">Quail Ultra</span>}
          </div>
        </div>

        <nav className="q-sidebar-nav">
          {user ? (
            <>
              <NavItem
                active={active === 'home'}
                icon="⌂"
                label="Home"
                collapsed={effectiveCollapsed}
                onClick={() => go('index')}
              />
              <NavItem
                active={active === 'library'}
                icon="▤"
                label="Library"
                collapsed={effectiveCollapsed}
                onClick={() => go('library')}
              />
              {user.role === 'admin' ? (
                <NavItem
                  active={active === 'admin'}
                  icon="✦"
                  label="Admin"
                  collapsed={effectiveCollapsed}
                  onClick={() => go('admin')}
                />
              ) : null}

              {inPackContext ? (
                <>
                  <div className="q-sidebar-section">
                    {effectiveCollapsed
                      ? <div className="q-sidebar-section-divider" aria-hidden="true" />
                      : <div className="q-sidebar-section-title" title={packName ?? ''}>
                          {packName ? packName : 'Pack'}
                        </div>}
                  </div>
                  <NavItem
                    active={active === 'overview'}
                    icon="◐"
                    label="Overview"
                    collapsed={effectiveCollapsed}
                    onClick={() => go('overview', { pack: packHref })}
                  />
                  <NavItem
                    active={active === 'newblock'}
                    icon="+"
                    label="New Block"
                    collapsed={effectiveCollapsed}
                    onClick={() => go('newblock', { pack: packHref })}
                  />
                  <NavItem
                    active={active === 'previousblocks'}
                    icon="≡"
                    label="Previous Blocks"
                    collapsed={effectiveCollapsed}
                    onClick={() => go('previousblocks', { pack: packHref })}
                  />
                </>
              ) : null}
            </>
          ) : (
            <div className="q-sidebar-empty">
              {effectiveCollapsed ? null : <span>Sign in to view navigation.</span>}
            </div>
          )}
        </nav>

        <div className="q-sidebar-footer">
          <ThemeToggle collapsed={effectiveCollapsed} />
          {user ? (
            <>
              {effectiveCollapsed ? null : (
                <div className="q-sidebar-user" title={user.username}>
                  Signed in as <strong>{user.username}</strong>
                </div>
              )}
              <button
                type="button"
                className="q-sidebar-signout"
                onClick={() => void handleSignOut()}
                title="Sign Out"
                aria-label="Sign Out"
              >
                <span aria-hidden="true">⎋</span>
                {effectiveCollapsed ? null : <span>Sign Out</span>}
              </button>
            </>
          ) : null}
          {!isMobile ? (
            <button
              type="button"
              className="q-sidebar-collapse-toggle"
              onClick={toggleSidebar}
              title={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <span aria-hidden="true">{effectiveCollapsed ? '›' : '‹'}</span>
            </button>
          ) : null}
        </div>
      </aside>

      <div className="q-main">
        <header className="q-appbar">
          <button
            type="button"
            className="q-hamburger"
            onClick={toggleSidebar}
            aria-label="Toggle navigation"
          >
            <span aria-hidden="true">☰</span>
          </button>
          <h1 className="q-appbar-title">{title}</h1>
          <div className="q-appbar-right">{rightSlot}</div>
        </header>
        <main className="q-main-content">{children}</main>
      </div>
    </div>
  )
}

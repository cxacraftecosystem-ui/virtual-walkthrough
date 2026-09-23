'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { googleSignedOut } from '../museum/api/google'
import { api, ApiError, can, ROLE_LABEL, type Role, type User } from './api'
import { AccessPage } from './pages/AccessPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { CommentsPage } from './pages/CommentsPage'
import { ContentPage } from './pages/ContentPage'
import { ErrorsPage } from './pages/ErrorsPage'
import { LoginPage } from './pages/LoginPage'
import { MediaPage } from './pages/MediaPage'
import { CapturePage } from './pages/CapturePage'
import { PrintsPage } from './pages/PrintsPage'
import { Modal, ToastProvider, hasUnsavedChanges, useConfirm } from './ui'
import { ExhibitionsPage } from './pages/ExhibitionsPage'
import { MakersPage } from './pages/MakersPage'
import { ExhibitionSwitcher } from './ExhibitionSwitcher'
import { useSelectedExhibition } from './exhibitionsApi'

type PageId = 'content' | 'exhibitions' | 'makers' | 'media' | 'capture' | 'prints' | 'analytics' | 'comments' | 'errors' | 'access'
type Group = 'Content' | 'Media' | 'Visitors' | 'Insights' | 'Settings'

/**
 * Sections, their sidebar group, the minimum role that sees them (the server enforces the same
 * rules) and the `g <key>` keyboard shortcut.
 */
const PAGES: { id: PageId; label: string; group: Group; min: Role; key: string; icon: string; masterLabel?: string }[] = [
  { id: 'content', label: 'Content', group: 'Content', min: 'curator', key: 'c', icon: 'M4 5h16M4 12h16M4 19h10' },
  { id: 'exhibitions', label: 'Exhibitions', group: 'Content', min: 'curator', key: 'x', icon: 'M3 20V8l9-5 9 5v12M8 20v-7h8v7' },
  { id: 'makers', label: 'Makers', group: 'Content', min: 'curator', key: 'k', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0' },
  { id: 'media', label: 'Media library', group: 'Media', min: 'curator', key: 'm', icon: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4' },
  { id: 'capture', label: 'Capture tools', group: 'Media', min: 'curator', key: 't', icon: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z' },
  { id: 'prints', label: 'Visitor prints', group: 'Visitors', min: 'curator', key: 'p', icon: 'M6 3h12v6H6zM4 9h16v8H4zM7 14h10v7H7z' },
  { id: 'comments', label: 'Comments', group: 'Visitors', min: 'admin', key: 'o', icon: 'M4 5h16v11H9l-5 4z' },
  { id: 'analytics', label: 'Analytics', group: 'Insights', min: 'admin', key: 'a', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'errors', label: 'Errors', group: 'Insights', min: 'admin', key: 'e', icon: 'M12 3 2 20h20L12 3Zm0 6v5m0 3v.5' },
  { id: 'access', label: 'Users', group: 'Settings', min: 'admin', key: 'u', icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-6', masterLabel: 'Users & access' },
]
const GROUPS: Group[] = ['Content', 'Media', 'Visitors', 'Insights', 'Settings']

function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, '').split('/')[0]
  return (PAGES.find((p) => p.id === h)?.id ?? 'content') as PageId
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

const initials = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?'

export function AdminApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [bootError, setBootError] = useState('')

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setUser(null)
        else {
          setUser(null)
          setBootError(e instanceof Error ? e.message : String(e))
        }
      })
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined)
    googleSignedOut()
    setUser(null)
  }, [])

  if (user === undefined) return <BootSkeleton />
  if (!user)
    return (
      <ToastProvider>
        <LoginPage onLogin={setUser} notice={bootError} />
      </ToastProvider>
    )
  if (!can(user, 'curator')) {
    return (
      <div className="adm-center">
        <div className="card narrow login">
          <span className="kicker">Hand Block Printing</span>
          <h1 className="display">No staff access</h1>
          <p className="muted">
            You are signed in as <strong>{user.email}</strong>, which is a visitor account. Ask the museum&apos;s master admin to add your email
            (or your organisation&apos;s domain) to the access list, then sign in again — with Google, so your address is verified.
          </p>
          <div className="row">
            <button className="btn primary" onClick={logout}>Sign out</button>
            <a className="btn ghost" href="/gallery">Open the museum</a>
          </div>
        </div>
      </div>
    )
  }
  return (
    <ToastProvider>
      <Shell user={user} onLogout={logout} />
    </ToastProvider>
  )
}

/** First paint while the session is checked: the shell's silhouette instead of a bare "Loading…". */
function BootSkeleton() {
  return (
    <div className="adm" aria-busy="true" aria-label="Loading the admin">
      <aside className="adm-side boot">
        <div className="side-brand">
          <span className="kicker">Hand Block Printing</span>
          <span className="display">Museum Admin</span>
        </div>
        <div className="skel-list" style={{ padding: '8px 12px' }}>
          {Array.from({ length: 7 }, (_, i) => <span key={i} className="skel line" />)}
        </div>
      </aside>
      <main className="adm-main">
        <span className="skel line title" />
        <span className="skel line" style={{ width: '40%', marginTop: 12 }} />
      </main>
    </div>
  )
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const exhibitionSel = useSelectedExhibition() // content pages remount per exhibition
  const [page, setPage] = useState<PageId>('content') // hash is read after mount (no window during SSR)
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [help, setHelp] = useState(false)
  const confirm = useConfirm()
  const mainRef = useRef<HTMLElement>(null)
  const lastHash = useRef('')

  const visible = PAGES.filter((p) => can(user, p.min))
  const current = visible.find((p) => p.id === page) ?? visible[0]
  const isMaster = user.role === 'master'
  const labelOf = (p: (typeof PAGES)[number]) => (isMaster && p.masterLabel ? p.masterLabel : p.label)

  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash())
      lastHash.current = window.location.hash
      setNavOpen(false)
      mainRef.current?.closest('.adm-root')?.scrollTo({ top: 0 })
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.title = `${current ? labelOf(current) : 'Admin'} · Museum Admin`
  })

  /** Navigate, asking first when a form has unsaved edits. */
  const go = useCallback(
    async (id: PageId) => {
      if (pageFromHash() === id && window.location.hash) return setNavOpen(false)
      if (hasUnsavedChanges() && !(await confirm({ title: 'Leave without saving?', body: 'You have unsaved changes on this page. They will be lost.', confirmLabel: 'Discard changes', danger: true })))
        return
      window.location.hash = `/${id}`
    },
    [confirm],
  )

  // keyboard: "/" focuses the page's search box, "g" + key jumps to a section, "?" lists shortcuts
  useEffect(() => {
    let gAt = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector('dialog[open]')) return
      if (e.key === '/') {
        const box = mainRef.current?.querySelector<HTMLInputElement>('input[type="search"]')
        if (box) {
          e.preventDefault()
          box.focus()
          box.select()
        }
        return
      }
      if (e.key === '?') return setHelp(true)
      if (e.key === 'g') {
        gAt = Date.now()
        return
      }
      if (Date.now() - gAt < 1200) {
        const p = visible.find((x) => x.key === e.key.toLowerCase())
        gAt = 0
        if (p) {
          e.preventDefault()
          void go(p.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, go])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.user-card')) setMenuOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [menuOpen])

  const id = current?.id ?? 'content'
  let body: ReactNode = null
  if (id === 'content') body = <ContentPage key={exhibitionSel || 'default'} canReset={can(user, 'admin')} />
  else if (id === 'exhibitions') body = <ExhibitionsPage canManage={can(user, 'admin')} />
  else if (id === 'makers') body = <MakersPage />
  else if (id === 'media') body = <MediaPage />
  else if (id === 'capture') body = <CapturePage />
  else if (id === 'prints') body = <PrintsPage />
  else if (id === 'analytics') body = <AnalyticsPage />
  else if (id === 'comments') body = <CommentsPage />
  else if (id === 'errors') body = <ErrorsPage />
  else if (id === 'access') body = <AccessPage me={user} canManageAccess={isMaster} />

  return (
    <div className={`adm ${navOpen ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#adm-main" onClick={(e) => {
        e.preventDefault()
        mainRef.current?.focus()
      }}>Skip to content</a>

      {/* phones / tablets: compact top bar with a menu button */}
      <header className="adm-mobilebar">
        <button className="icon-btn" onClick={() => setNavOpen((o) => !o)} aria-label={navOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={navOpen} aria-controls="adm-side">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            {navOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <span className="display mb-title">{current ? labelOf(current) : 'Museum Admin'}</span>
        <span className={`avatar small role-${user.role}`} aria-hidden="true">{initials(user.displayName || user.email)}</span>
      </header>
      <div className="side-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <aside className="adm-side" id="adm-side" aria-label="Admin navigation">
        <a className="side-brand" href="#/content" onClick={(e) => {
          e.preventDefault()
          void go('content')
        }}>
          <span className="kicker">Hand Block Printing</span>
          <span className="display">Museum Admin</span>
        </a>

        <div className="side-ex">
          <ExhibitionSwitcher />
        </div>

        <nav className="side-nav" aria-label="Sections">
          {GROUPS.map((g) => {
            const items = visible.filter((p) => p.group === g)
            if (!items.length) return null
            return (
              <div className="nav-group" key={g}>
                <span className="nav-group-label">{g}</span>
                {items.map((p) => (
                  <a
                    key={p.id}
                    href={`#/${p.id}`}
                    className={id === p.id ? 'nav-item active' : 'nav-item'}
                    aria-current={id === p.id ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      void go(p.id)
                    }}
                  >
                    <Icon d={p.icon} />
                    <span className="nav-label">{labelOf(p)}</span>
                    <kbd className="nav-kbd" aria-hidden="true">g {p.key}</kbd>
                  </a>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="side-foot">
          <a className="nav-item museum-link" href="/gallery" target="_blank" rel="noreferrer">
            <Icon d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
            <span className="nav-label">Open museum</span>
          </a>
          <div className="user-card">
            <button className="user-btn" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              <span className={`avatar role-${user.role}`} aria-hidden="true">{initials(user.displayName || user.email)}</span>
              <span className="user-text">
                <span className="user-name">{user.displayName || user.email}</span>
                <span className={`badge role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
              </span>
              <svg className="chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m7 14 5-5 5 5" /></svg>
            </button>
            {menuOpen && (
              <div className="user-menu" role="menu">
                <div className="user-menu-head">
                  <strong>{user.displayName}</strong>
                  <span className="muted small truncate" title={user.email}>{user.email}</span>
                </div>
                <button role="menuitem" onClick={() => {
                  setMenuOpen(false)
                  setHelp(true)
                }}>Keyboard shortcuts <kbd>?</kbd></button>
                <a role="menuitem" href="/gallery" target="_blank" rel="noreferrer">Open the museum ↗</a>
                <button role="menuitem" className="danger-text" onClick={onLogout}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="adm-main" id="adm-main" ref={mainRef} tabIndex={-1}>
        {body}
      </main>

      {help && (
        <Modal title="Keyboard shortcuts" size="small" onClose={() => setHelp(false)}>
          <dl className="shortcuts">
            <dt><kbd>/</kbd></dt>
            <dd>Search on this page</dd>
            <dt><kbd>?</kbd></dt>
            <dd>Show this list</dd>
            {visible.map((p) => (
              <FragmentRow key={p.id} k={`g ${p.key}`} label={`Go to ${labelOf(p)}`} />
            ))}
          </dl>
        </Modal>
      )}
    </div>
  )
}

function FragmentRow({ k, label }: { k: string; label: string }) {
  return (
    <>
      <dt>{k.split(' ').map((x, i) => <kbd key={i}>{x}</kbd>)}</dt>
      <dd>{label}</dd>
    </>
  )
}

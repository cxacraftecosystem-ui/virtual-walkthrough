'use client'

import { useCallback, useEffect, useState } from 'react'
import { googleSignedOut } from '../museum/api/google'
import { api, ApiError, can, ROLE_LABEL, type Role, type User } from './api'
import { AccessPage } from './pages/AccessPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { CommentsPage } from './pages/CommentsPage'
import { ContentPage } from './pages/ContentPage'
import { LoginPage } from './pages/LoginPage'
import { MediaPage } from './pages/MediaPage'
import { ToastProvider } from './ui'

/** Sections and the minimum role that sees them (the server enforces the same rules). */
const PAGES: { id: PageId; label: string; min: Role; masterLabel?: string }[] = [
  { id: 'content', label: 'Content', min: 'curator' },
  { id: 'media', label: 'Media', min: 'curator' },
  { id: 'analytics', label: 'Analytics', min: 'admin' },
  { id: 'comments', label: 'Comments', min: 'admin' },
  { id: 'access', label: 'Users', min: 'admin', masterLabel: 'Access' },
]
type PageId = 'content' | 'media' | 'analytics' | 'comments' | 'access'

function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, '').split('/')[0]
  return (PAGES.find((p) => p.id === h)?.id ?? 'content') as PageId
}

export function AdminApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [bootError, setBootError] = useState('')
  const [page, setPage] = useState<PageId>('content') // hash is read after mount (no window during SSR)

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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

  if (user === undefined) return <div className="adm-center muted">Loading…</div>
  if (!user) return (
    <ToastProvider>
      <LoginPage onLogin={setUser} notice={bootError} />
    </ToastProvider>
  )
  if (!can(user, 'curator')) {
    return (
      <div className="adm-center">
        <div className="card narrow">
          <h1 className="display">No staff access</h1>
          <p className="muted">
            You are signed in as {user.email}, which is a visitor account. Ask the museum&apos;s master admin to add your email (or your
            organisation&apos;s domain) to the access list, then sign in again — with Google, so your address is verified.
          </p>
          <div className="row">
            <button className="btn" onClick={logout}>Sign out</button>
            <a className="btn ghost" href="/">Open museum</a>
          </div>
        </div>
      </div>
    )
  }

  const visible = PAGES.filter((p) => can(user, p.min))
  const current = visible.find((p) => p.id === page)?.id ?? 'content'
  const isMaster = user.role === 'master'

  return (
    <ToastProvider>
      <div className="adm">
        <header className="adm-top">
          <div className="brand">
            <span className="kicker">Hand Block Printing</span>
            <span className="display">Museum Admin</span>
          </div>
          <nav className="tabs" aria-label="Sections">
            {visible.map((p) => (
              <a key={p.id} href={`#/${p.id}`} className={current === p.id ? 'tab active' : 'tab'} aria-current={current === p.id ? 'page' : undefined}>
                {isMaster && p.masterLabel ? p.masterLabel : p.label}
              </a>
            ))}
          </nav>
          <div className="who">
            <a className="btn ghost small" href="/" target="_blank" rel="noreferrer">Open museum ↗</a>
            <span className="muted small" title={user.email}>
              {user.displayName} · <span className={`badge role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
            </span>
            <button className="btn ghost small" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="adm-main">
          {current === 'content' && <ContentPage canReset={can(user, 'admin')} />}
          {current === 'media' && <MediaPage />}
          {current === 'analytics' && <AnalyticsPage />}
          {current === 'comments' && <CommentsPage />}
          {current === 'access' && <AccessPage me={user} canManageAccess={isMaster} />}
        </main>
      </div>
    </ToastProvider>
  )
}

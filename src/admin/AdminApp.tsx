'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type User } from './api'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { CommentsPage } from './pages/CommentsPage'
import { ContentPage } from './pages/ContentPage'
import { LoginPage } from './pages/LoginPage'
import { MediaPage } from './pages/MediaPage'
import { ToastProvider } from './ui'

const PAGES = [
  { id: 'content', label: 'Content' },
  { id: 'media', label: 'Media' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'comments', label: 'Comments' },
] as const
type PageId = (typeof PAGES)[number]['id']

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
    setUser(null)
  }, [])

  if (user === undefined) return <div className="adm-center muted">Loading…</div>
  if (!user) return (
    <ToastProvider>
      <LoginPage onLogin={setUser} notice={bootError} />
    </ToastProvider>
  )
  if (user.role !== 'admin') {
    return (
      <div className="adm-center">
        <div className="card narrow">
          <h1 className="display">Not an administrator</h1>
          <p className="muted">
            You are signed in as {user.email}, which is a visitor account. Sign in with an admin account to manage the museum.
          </p>
          <div className="row">
            <button className="btn" onClick={logout}>Sign out</button>
            <a className="btn ghost" href="/">Open museum</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ToastProvider>
      <div className="adm">
        <header className="adm-top">
          <div className="brand">
            <span className="kicker">Hand Block Printing</span>
            <span className="display">Museum Admin</span>
          </div>
          <nav className="tabs" aria-label="Sections">
            {PAGES.map((p) => (
              <a key={p.id} href={`#/${p.id}`} className={page === p.id ? 'tab active' : 'tab'} aria-current={page === p.id ? 'page' : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
          <div className="who">
            <a className="btn ghost small" href="/" target="_blank" rel="noreferrer">Open museum ↗</a>
            <span className="muted small" title={user.email}>{user.displayName}</span>
            <button className="btn ghost small" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="adm-main">
          {page === 'content' && <ContentPage />}
          {page === 'media' && <MediaPage />}
          {page === 'analytics' && <AnalyticsPage />}
          {page === 'comments' && <CommentsPage />}
        </main>
      </div>
    </ToastProvider>
  )
}

import { useState, type FormEvent } from 'react'
import { GoogleSignInButton } from '../../museum/ui/GoogleSignInButton'
import { api, type User } from '../api'
import { errMsg } from '../ui'

/** A hand-block motif (repeating rosette) for the login art panel. */
function BlockPattern() {
  return (
    <svg className="pattern" aria-hidden="true" width="100%" height="100%">
      <defs>
        <pattern id="adm-rosette" width="72" height="72" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="36" cy="36" r="6" />
            <path d="M36 14c6 8 6 14 0 22-6-8-6-14 0-22ZM36 58c6-8 6-14 0-22-6 8-6 14 0 22ZM14 36c8-6 14-6 22 0-8 6-14 6-22 0ZM58 36c-8-6-14-6-22 0 8 6 14 6 22 0Z" />
            <path d="M0 0l8 8M72 0l-8 8M0 72l8-8M72 72l-8-8" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#adm-rosette)" />
    </svg>
  )
}

export function LoginPage({ onLogin, notice }: { onLogin: (u: User) => void; notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [googleNote, setGoogleNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<User>) {
    setBusy(true)
    setError('')
    try {
      onLogin(await fn())
    } catch (err) {
      const m = errMsg(err)
      setError(/invalid|incorrect|wrong|credentials/i.test(m) ? 'That email and password don’t match an account. Check both and try again.' : m)
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return setError('Enter your email and password.')
    void run(() => api.login(email.trim(), password))
  }

  return (
    <div className="login-shell">
      <aside className="login-art">
        <BlockPattern />
        <span className="kicker">Hand Block Printing · Virtual Museum</span>
        <h2>Curate the galleries from anywhere.</h2>
        <p>Edit exhibition content, manage the media library, moderate visitor prints and comments, and see how people move through the museum.</p>
      </aside>
      <main className="login-pane">
        <form className="login-form" onSubmit={submit} noValidate>
          <span className="kicker">Staff sign-in</span>
          <h1>Museum Admin</h1>
          <p className="muted">Use the Google account your museum access was granted to.</p>
          {notice && <p className="alert" role="alert">{notice}</p>}
          <GoogleSignInButton
            className="google-login"
            onCredential={(credential) => void run(() => api.google(credential))}
            onError={(m) => setGoogleNote(m)}
            options={{ text: 'signin_with', shape: 'pill', size: 'large' }}
          >
            <div className="or-divider" aria-hidden="true">or with email and password</div>
          </GoogleSignInButton>
          {googleNote && <p className="note small">Google sign-in is unavailable here ({googleNote}). Use your email and password instead.</p>}
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@museum.org" />
          </label>
          <label className="field">
            <span>Password</span>
            <div className="pw-toggle">
              <input type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPw((s) => !s)} aria-pressed={showPw} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          {error && <p className="alert" role="alert">{error}</p>}
          <button className="btn primary block" disabled={busy} style={{ height: 40 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="small muted login-foot">
            Staff access is granted by the master admin&apos;s access list. Sign in with Google using a listed email to receive your role automatically.
          </p>
          <a className="small back" href="/gallery">← Back to the museum</a>
        </form>
      </main>
    </div>
  )
}

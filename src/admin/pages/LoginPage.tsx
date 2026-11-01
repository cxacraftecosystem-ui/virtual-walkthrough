/**
 * Staff sign-in, on the design system's auth layout: a deep-purple brand panel (the museum's name with
 * a small gold accent — the one place gold is allowed, and never on a data screen) beside the sign-in
 * card. Google first, then email and password; each method is drawn only when it can work (the Google
 * button hides itself when the site has no client id).
 *
 * The method used last time in this browser is remembered (and the email, for password sign-ins), so
 * the form opens on it and says so. Nothing else is stored.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { GoogleSignInButton } from '../../museum/ui/GoogleSignInButton'
import { SITE } from '../../site'
import { api, type User } from '../api'
import { Badge, Button, Field, Icon, Input, errMsg } from '../ui'
import './operations.css'

const LAST_KEY = 'museum.admin.lastSignIn'
type Method = 'google' | 'password'
interface Last {
  method: Method
  email?: string
}

function readLast(): Last | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? 'null') as Partial<Last> | null
    if (v && (v.method === 'google' || v.method === 'password')) return { method: v.method, email: typeof v.email === 'string' ? v.email : undefined }
  } catch {
    /* blocked or malformed: no hint */
  }
  return null
}
function writeLast(last: Last) {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify(last))
  } catch {
    /* storage blocked: no hint next time */
  }
}

/** The museum mark: a repeating rosette, quiet on the purple panel. */
function Pattern() {
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
  const [last] = useState<Last | null>(() => (typeof window === 'undefined' ? null : readLast()))
  const [email, setEmail] = useState(() => last?.email ?? '')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({})
  const [googleNote, setGoogleNote] = useState('')
  const [busy, setBusy] = useState<Method | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)

  // open on the method used last time: the password field when the email is remembered
  useEffect(() => {
    if (last?.method !== 'password') return
    ;(last.email ? pwRef : emailRef).current?.focus()
  }, [last])

  async function run(method: Method, fn: () => Promise<User>) {
    setBusy(method)
    setError('')
    try {
      const u = await fn()
      writeLast(method === 'password' ? { method, email: email.trim() } : { method })
      onLogin(u)
    } catch (err) {
      const m = errMsg(err)
      setError(/invalid|incorrect|wrong|credentials/i.test(m) ? 'That email and password don’t match an account. Check both and try again.' : m)
    } finally {
      setBusy(null)
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const errs: { email?: string; password?: string } = {}
    if (!email.trim()) errs.email = 'Enter your email address.'
    else if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) errs.email = 'That doesn’t look like an email address.'
    if (!password) errs.password = 'Enter your password.'
    setFieldError(errs)
    if (errs.email) return emailRef.current?.focus()
    if (errs.password) return pwRef.current?.focus()
    void run('password', () => api.login(email.trim(), password))
  }

  const lastBadge = (m: Method) => (last?.method === m ? <Badge tone="info">Used last time</Badge> : null)

  return (
    <div className="login-shell auth-shell">
      <aside className="login-art auth-art">
        <Pattern />
        <span className="auth-brand">
          <span className="auth-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 20V9l9-5 9 5v11" />
              <path d="M7 20v-7M12 20v-7M17 20v-7M3 20h18" />
            </svg>
          </span>
          <span className="auth-brand-name">{SITE.shortName}</span>
        </span>
        <span className="auth-gold">Staff workspace</span>
        <h2>Look after the galleries from anywhere.</h2>
        <p>Edit what visitors read and see, keep the media library in order, and review what visitors leave behind.</p>
      </aside>

      <main className="login-pane">
        <div className="card auth-card">
          <span className="kicker">{SITE.name}</span>
          <h1>Sign in</h1>
          <p className="muted">Use the account your museum access was given to.</p>
          {notice ? <p className="alert" role="alert">{notice}</p> : null}

          <div className={`auth-method${last?.method === 'google' ? ' is-last' : ''}`}>
            <GoogleSignInButton
              className="google-login"
              onCredential={(credential) => void run('google', () => api.google(credential))}
              onError={(m) => setGoogleNote(m)}
              options={{ text: 'continue_with', shape: 'pill', size: 'large' }}
            >
              {last?.method === 'google' ? <span className="auth-last">{lastBadge('google')}</span> : null}
              <div className="or-divider" aria-hidden="true">or with email</div>
            </GoogleSignInButton>
            {busy === 'google' ? <p className="small muted" role="status">Signing in with Google…</p> : null}
          </div>
          {googleNote ? <p className="note small">Google sign-in isn’t available here ({googleNote}). Use your email and password.</p> : null}

          <form className={`auth-form${last?.method === 'password' ? ' is-last' : ''}`} onSubmit={submit} noValidate>
            {last?.method === 'password' ? <span className="auth-last">{lastBadge('password')}</span> : null}
            <Field label="Email" error={fieldError.email}>
              <Input
                ref={emailRef}
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@museum.org"
              />
            </Field>
            <Field label="Password" error={fieldError.password}>
              {(w) => (
                <div className="pw-toggle">
                  <Input {...w} ref={pwRef} type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" onClick={() => setShowPw((s) => !s)} aria-pressed={showPw} aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'}>
                    <Icon name="eye" />
                  </button>
                </div>
              )}
            </Field>
            {error ? <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p> : null}
            <Button type="submit" variant="primary" block loading={busy === 'password'} loadingLabel="Signing in…" disabled={busy === 'google'}>
              Sign in
            </Button>
          </form>

          <p className="small muted login-foot">Staff roles come from the access list kept by the master admin. Signing in with Google on a listed address gives you your role straight away.</p>
          <a className="small back" href="/gallery">
            <Icon name="arrowLeft" width={14} height={14} /> Back to the museum
          </a>
        </div>
      </main>
    </div>
  )
}

export default LoginPage

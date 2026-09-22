/** Minimal sign-in / create-account dialog (only reachable when the backend is online). */
import { useEffect, useRef, useState } from 'react'
import { useMuseum } from '../state/store'
import { register, signIn, signInWithGoogle } from '../api/social'
import { GoogleSignInButton } from './GoogleSignInButton'
import { IconClose } from './icons'

export function AuthModal() {
  const auth = useMuseum((s) => s.auth)
  const online = useMuseum((s) => s.online)
  const closeAuth = useMuseum((s) => s.closeAuth)
  const openAuth = useMuseum((s) => s.openAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const mode = auth?.mode ?? 'signin'

  useEffect(() => {
    if (!auth) return
    setError(null)
    setBusy(false)
    const t = window.setTimeout(() => firstRef.current?.focus({ preventScroll: true }), 60)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        closeAuth()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [auth, closeAuth])

  if (!auth || !online) return null

  const isRegister = mode === 'register'
  const valid = /.+@.+\..+/.test(email.trim()) && password.length >= (isRegister ? 8 : 1) && (!isRegister || name.trim().length >= 1)

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const err = isRegister ? await register(email, password, name) : await signIn(email, password)
    setBusy(false)
    if (err) setError(err)
    else {
      setPassword('')
      closeAuth()
    }
  }

  const google = async (credential: string) => {
    setBusy(true)
    setError(null)
    const err = await signInWithGoogle(credential)
    setBusy(false)
    if (err) setError(err)
    else closeAuth()
  }

  return (
    <div
      className="ui-help ui-auth"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ui-auth-title"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeAuth()
      }}
    >
      <div className="ui-help__card ui-panel ui-auth__card">
        <button type="button" className="ui-icon-btn ui-help__close" aria-label="Close (Esc)" onClick={closeAuth}>
          <IconClose />
        </button>
        <div className="ui-kicker">Visitor account</div>
        <h2 id="ui-auth-title" className="ui-help__title ui-auth__title">
          {isRegister ? 'Create an account' : 'Welcome back'}
        </h2>
        <p className="ui-auth__lede">{auth.reason ?? 'Save favourite works and sign the guestbook.'}</p>

        <GoogleSignInButton className="ui-auth__google" onCredential={(c) => void google(c)} onError={setError}>
          <div className="ui-auth__or" aria-hidden="true">
            <span>or with email</span>
          </div>
        </GoogleSignInButton>

        <form
          className="ui-auth__form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {isRegister && (
            <label className="ui-auth__label">
              <span>Display name</span>
              <input
                ref={isRegister ? firstRef : undefined}
                className="ui-field"
                type="text"
                autoComplete="nickname"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label className="ui-auth__label">
            <span>Email</span>
            <input
              ref={isRegister ? undefined : firstRef}
              className="ui-field"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="ui-auth__label">
            <span>Password{isRegister && <em> · at least 8 characters</em>}</span>
            <input
              className="ui-field"
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="ui-auth__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="ui-btn ui-auth__submit" disabled={!valid || busy}>
            {busy ? 'One moment…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="ui-auth__switch">
          {isRegister ? 'Already have an account?' : 'New here?'}{' '}
          <button type="button" className="ui-info__link" onClick={() => openAuth(auth.reason, isRegister ? 'signin' : 'register')}>
            {isRegister ? 'Sign in' : 'Create an account'}
          </button>
        </p>
        <p className="ui-auth__note">Browsing the museum never requires an account.</p>
      </div>
    </div>
  )
}

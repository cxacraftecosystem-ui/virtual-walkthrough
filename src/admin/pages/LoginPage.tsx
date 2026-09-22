import { useState, type FormEvent } from 'react'
import { GoogleSignInButton } from '../../museum/ui/GoogleSignInButton'
import { api, type User } from '../api'
import { errMsg } from '../ui'

export function LoginPage({ onLogin, notice }: { onLogin: (u: User) => void; notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<User>) {
    setBusy(true)
    setError('')
    try {
      onLogin(await fn())
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(() => api.login(email, password))
  }

  return (
    <div className="adm-center">
      <form className="card narrow login" onSubmit={submit}>
        <span className="kicker">Hand Block Printing</span>
        <h1 className="display">Museum Admin</h1>
        <p className="muted">Sign in to edit exhibition content, manage media and review visitor activity.</p>
        {notice && <p className="alert">{notice}</p>}
        <GoogleSignInButton
          className="google-login"
          onCredential={(credential) => void run(() => api.google(credential))}
          onError={setError}
          options={{ text: 'signin_with', shape: 'rectangular' }}
        >
          <div className="or-divider" aria-hidden="true">or with a password</div>
        </GoogleSignInButton>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="alert" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted">
          Staff access is granted by the master admin&apos;s access list. Sign in with the Google account of a listed email to receive your role.
        </p>
        <a className="small muted back" href="/">← Back to the museum</a>
      </form>
    </div>
  )
}

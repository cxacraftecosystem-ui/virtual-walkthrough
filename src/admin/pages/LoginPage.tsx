import { useState, type FormEvent } from 'react'
import { api, type User } from '../api'
import { errMsg } from '../ui'

export function LoginPage({ onLogin, notice }: { onLogin: (u: User) => void; notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin(await api.login(email, password))
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="adm-center">
      <form className="card narrow login" onSubmit={submit}>
        <span className="kicker">Hand Block Printing</span>
        <h1 className="display">Museum Admin</h1>
        <p className="muted">Sign in to edit exhibition content, manage media and review visitor activity.</p>
        {notice && <p className="alert">{notice}</p>}
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="alert" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <a className="small muted back" href="/">← Back to the museum</a>
      </form>
    </div>
  )
}

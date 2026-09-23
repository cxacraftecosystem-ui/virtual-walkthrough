/**
 * Live tour HTML UI: invitation toast, tour panel (follow state, docent pointer, hand raise,
 * chat with docent mute), status toasts, and the HUD "Start live tour" control for curators.
 * Everything renders nothing while live presence is unavailable.
 */
import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useMuseum } from '../state/store'
import { liveConfigured } from './config'
import {
  acknowledgeHand,
  dismissInvite,
  joinTour,
  leaveTour,
  muteVisitor,
  sendChat,
  setFollowing,
  setHandRaised,
  startHosting,
  startLive,
  stopHosting,
} from './session'
import { liveToast, useLive } from './store'
import './live.css'

const STAFF = new Set(['curator', 'admin', 'master'])

export function IconLive() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" />
    </svg>
  )
}

/** HUD button (curator+ only, and only while realtime is online). */
export function LiveHudButton() {
  const role = useMuseum((s) => s.user?.role)
  const online = useLive((s) => s.status === 'online')
  const hosting = useLive((s) => s.hosting)
  const starting = useLive((s) => s.hostingStarting)
  if (!online || !role || !STAFF.has(role)) return null
  return (
    <button
      type="button"
      className={`ui-icon-btn${hosting ? ' live-hud-on' : ''}`}
      aria-label={hosting ? 'End live tour' : 'Start live tour'}
      data-tip={hosting ? 'End live tour' : 'Start live tour'}
      aria-pressed={!!hosting}
      disabled={starting}
      onClick={async () => {
        if (hosting) {
          await stopHosting()
          liveToast('Live tour ended')
        } else {
          const err = await startHosting()
          if (err) liveToast(err)
        }
      }}
    >
      <IconLive />
    </button>
  )
}

function Invitation() {
  const tours = useLive((s) => s.tours)
  const dismissed = useLive((s) => s.dismissed)
  const joined = useLive((s) => s.joined)
  const hosting = useLive((s) => s.hosting)
  if (joined || hosting) return null
  const t = Object.values(tours).find((x) => !dismissed.includes(x.tourId) && !x.lost)
  if (!t) return null
  return (
    <div className="live-invite ui-panel ui-interactive" role="status">
      <span className="live-dot" aria-hidden="true" />
      <span className="live-invite__text">
        Live tour by <strong>{t.name}</strong>
      </span>
      <button type="button" className="ui-btn live-btn" onClick={() => joinTour(t.tourId)}>
        Join
      </button>
      <button type="button" className="ui-btn ui-btn--ghost live-btn" onClick={() => dismissInvite(t.tourId)}>
        Not now
      </button>
    </div>
  )
}

function Toasts() {
  const toast = useLive((s) => s.toast)
  const [shown, setShown] = useState<typeof toast>(null)
  useEffect(() => {
    if (!toast) return
    setShown(toast)
    const t = window.setTimeout(() => setShown((s) => (s?.id === toast.id ? null : s)), 4200)
    return () => window.clearTimeout(t)
  }, [toast])
  const status = useLive((s) => s.status)
  return (
    <div className="live-toasts" aria-live="polite">
      {status === 'reconnecting' && <div className="live-toast ui-panel">Reconnecting to the live gallery…</div>}
      {shown && (
        <div key={shown.id} className="live-toast ui-panel">
          {shown.text}
        </div>
      )}
    </div>
  )
}

function Chat({ hostingTour }: { hostingTour: boolean }) {
  const chat = useLive((s) => s.chat)
  const muted = useLive((s) => s.muted)
  const selfMuted = useLive((s) => s.selfMuted)
  const selfId = useLive((s) => s.selfId)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat])
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = sendChat(text)
    setErr(r)
    if (!r) setText('')
  }
  return (
    <div className="live-chat">
      <ol className="live-chat__list" ref={list} aria-label="Tour chat">
        {chat.length === 0 && <li className="live-chat__empty">No messages yet.</li>}
        {chat.map((m) => (
          <li key={`${m.from}:${m.mid}`} className={`live-chat__msg${m.docent ? ' is-docent' : ''}${m.from === selfId ? ' is-self' : ''}`}>
            <span className="live-chat__name">
              {m.name}
              {m.docent && <em> · docent</em>}
            </span>
            <span className="live-chat__text">{m.text}</span>
            {hostingTour && !m.docent && m.from !== selfId && (
              <button type="button" className="live-link" onClick={() => muteVisitor(m.from, !muted.includes(m.from))}>
                {muted.includes(m.from) ? 'Unmute' : 'Mute'}
              </button>
            )}
          </li>
        ))}
      </ol>
      <form className="live-chat__form" onSubmit={submit}>
        <input
          className="live-chat__input"
          value={text}
          maxLength={240}
          disabled={selfMuted && !hostingTour}
          placeholder={selfMuted && !hostingTour ? 'Chat muted by the docent' : 'Ask the docent…'}
          aria-label="Chat message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button type="submit" className="ui-btn live-btn" disabled={!text.trim() || (selfMuted && !hostingTour)}>
          Send
        </button>
      </form>
      {err && <p className="live-chat__err">{err}</p>}
    </div>
  )
}

function TourPanel() {
  const joined = useLive((s) => s.joined)
  const hosting = useLive((s) => s.hosting)
  const tours = useLive((s) => s.tours)
  const following = useLive((s) => s.following)
  const focus = useLive((s) => s.focus)
  const hand = useLive((s) => s.handRaised)
  const hands = useLive((s) => s.hands)
  const followers = useLive((s) => s.followers)
  const open = useLive((s) => s.chatOpen)
  const set = useLive((s) => s.set)
  const select = useMuseum((s) => s.select)
  const photo = useMuseum((s) => s.phase !== 'entered')
  if ((!joined && !hosting) || photo) return null
  const tour = joined ? tours[joined] : null

  return (
    <section className={`live-panel ui-panel ui-interactive${open ? '' : ' is-collapsed'}`} aria-label="Live tour">
      <header className="live-panel__head">
        <span className="live-dot" aria-hidden="true" />
        <div className="live-panel__title">
          {hosting ? (
            <>
              <strong>You are hosting a live tour</strong>
              <small>
                {followers} {followers === 1 ? 'visitor' : 'visitors'} following
              </small>
            </>
          ) : (
            <>
              <strong>Live tour · {tour?.name ?? 'Docent'}</strong>
              <small>{tour?.lost ? 'Docent reconnecting…' : following ? 'Following the docent' : 'Exploring on your own'}</small>
            </>
          )}
        </div>
        <button type="button" className="ui-icon-btn live-collapse" aria-expanded={open} aria-label={open ? 'Collapse tour panel' : 'Expand tour panel'} onClick={() => set({ chatOpen: !open })}>
          <span aria-hidden="true">{open ? '–' : '+'}</span>
        </button>
      </header>

      {open && (
        <>
          {joined && focus && focus.title && (
            <div className="live-focus">
              <span>
                Docent is showing <strong>{focus.title}</strong>
              </span>
              <button type="button" className="live-link" onClick={() => select({ kind: focus.kind as never, id: focus.id })}>
                View
              </button>
            </div>
          )}

          <div className="live-actions">
            {joined && !following && (
              <button type="button" className="ui-btn live-btn" onClick={() => setFollowing(true)}>
                Rejoin docent
              </button>
            )}
            {joined && (
              <button type="button" className={`ui-btn ui-btn--ghost live-btn${hand ? ' is-on' : ''}`} aria-pressed={hand} onClick={() => setHandRaised(!hand)}>
                {hand ? 'Lower hand' : '✋ Raise hand'}
              </button>
            )}
            {joined && (
              <button type="button" className="ui-btn ui-btn--ghost live-btn" onClick={() => leaveTour()}>
                Leave
              </button>
            )}
            {hosting && (
              <button
                type="button"
                className="ui-btn ui-btn--ghost live-btn"
                onClick={async () => {
                  await stopHosting()
                  liveToast('Live tour ended')
                }}
              >
                End tour
              </button>
            )}
          </div>

          {hosting && hands.length > 0 && (
            <ul className="live-hands" aria-label="Raised hands">
              {hands.map((h) => (
                <li key={h.id}>
                  <span>✋ {h.name}</span>
                  <button type="button" className="live-link" onClick={() => acknowledgeHand(h.id)}>
                    Acknowledge
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Chat hostingTour={!!hosting} />
        </>
      )}
    </section>
  )
}

const K_OPT_IN = 'museum.live.optin'
const K_DISMISS = 'museum.live.optout'

/**
 * Live presence is opt-in (Realtime quota / fan-out, visitor privacy). It connects on its own only
 * when the visitor already opted in this session, arrived through a live link (`?live` / `#live`),
 * is staff (so curators can host), or this tab was hosting / following a tour before a reload.
 */
function autoJoin(role: string | undefined) {
  if (typeof window === 'undefined') return false
  if (role && STAFF.has(role)) return true
  if (new URLSearchParams(window.location.search).has('live') || /(^#|&)live(=|&|$)/.test(window.location.hash)) return true
  try {
    return !!(sessionStorage.getItem(K_OPT_IN) || sessionStorage.getItem('museum.live.host') || sessionStorage.getItem('museum.live.joined'))
  } catch {
    return false
  }
}

function JoinLive({ onJoin, onDismiss }: { onJoin: () => void; onDismiss: () => void }) {
  const t = useT()
  return (
    <div className="live-invite ui-panel ui-interactive" role="region" aria-label={t('live.join')}>
      <span className="live-dot" aria-hidden="true" />
      <span className="live-invite__text" title={t('live.joinHint')}>
        {t('live.joinHint')}
      </span>
      <button type="button" className="ui-btn live-btn" onClick={onJoin}>
        {t('live.join')}
      </button>
      <button type="button" className="ui-btn ui-btn--ghost live-btn" onClick={onDismiss}>
        {t('live.notNow')}
      </button>
    </div>
  )
}

/** Mount once in the UI overlay. Connects only after the visitor opts in (see autoJoin). */
export function LivePanel() {
  const entered = useMuseum((s) => s.phase === 'entered')
  const role = useMuseum((s) => s.user?.role)
  const status = useLive((s) => s.status)
  const [optedIn, setOptedIn] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof window !== 'undefined' && !!sessionStorage.getItem(K_DISMISS)
    } catch {
      return false
    }
  })
  const configured = liveConfigured()
  useEffect(() => {
    if (entered && (optedIn || autoJoin(role))) void startLive()
  }, [entered, optedIn, role])
  if (status === 'off') {
    if (!entered || !configured || optedIn || dismissed) return <Toasts />
    return (
      <>
        <JoinLive
          onJoin={() => {
            try {
              sessionStorage.setItem(K_OPT_IN, '1')
            } catch {
              /* private mode */
            }
            setOptedIn(true)
          }}
          onDismiss={() => {
            try {
              sessionStorage.setItem(K_DISMISS, '1')
            } catch {
              /* private mode */
            }
            setDismissed(true)
          }}
        />
        <Toasts />
      </>
    )
  }
  if (status === 'unavailable' || status === 'connecting') return <Toasts />
  return (
    <>
      <Invitation />
      <TourPanel />
      <Toasts />
    </>
  )
}

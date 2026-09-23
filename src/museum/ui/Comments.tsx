/**
 * Comment thread for an item, or the museum guestbook when `item` is omitted.
 * Renders nothing in static mode (backend offline).
 */
import { useEffect, useRef, useState } from 'react'
import { rich, useT } from '../i18n'
import { api, errorMessage, type Comment, type ItemKind } from '../api/client'
import { useMuseum } from '../state/store'
import { formatDate } from './items'

const MAX = 1000

interface Props {
  item?: { kind: ItemKind; id: string }
  /** Heading shown above the thread. */
  title?: string
  placeholder?: string
  tabIndex?: number
  compact?: boolean
}

export function CommentThread({ item, title: titleProp, placeholder: placeholderProp, tabIndex, compact }: Props) {
  const t = useT()
  const title = titleProp ?? t('comments.title')
  const placeholder = placeholderProp ?? t('comments.placeholder')
  const online = useMuseum((s) => s.online)
  const user = useMuseum((s) => s.user)
  const openAuth = useMuseum((s) => s.openAuth)
  const [list, setList] = useState<Comment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [justPosted, setJustPosted] = useState<string | null>(null)
  const reqId = useRef(0)
  const kind = item?.kind
  const id = item?.id

  useEffect(() => {
    if (!online) return
    const my = ++reqId.current
    setList(null)
    setError(null)
    setPostError(null)
    setJustPosted(null)
    api.comments
      .list(kind && id ? { kind, id } : undefined)
      .then((l) => {
        if (my === reqId.current) setList(Array.isArray(l) ? l : [])
      })
      .catch((e) => {
        if (my === reqId.current) setError(errorMessage(e))
      })
  }, [online, kind, id])

  if (!online) return null

  const body = draft.trim()
  const submit = async () => {
    if (!body || posting) return
    setPosting(true)
    setPostError(null)
    try {
      const c = await api.comments.post(body, kind && id ? { kind, id } : undefined)
      setDraft('')
      const pending = !!(c as { pending?: boolean } | undefined)?.pending
      setJustPosted(pending ? 'pending' : (c?.id ?? 'posted'))
      // Only approved comments are listed; show ours right away when the server returns it.
      if (c && c.body && !pending) setList((l) => [c, ...(l ?? []).filter((x) => x.id !== c.id)])
    } catch (e) {
      setPostError(errorMessage(e))
    } finally {
      setPosting(false)
    }
  }

  return (
    <section className={`ui-thread${compact ? ' ui-thread--compact' : ''}`} aria-label={title}>
      <div className="ui-thread__head">
        <span className="ui-kicker">{title}</span>
        {list && list.length > 0 && <span className="ui-thread__count">{list.length}</span>}
      </div>

      {user ? (
        <form
          className="ui-thread__form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <textarea
            className="ui-field ui-thread__input"
            value={draft}
            maxLength={MAX}
            rows={compact ? 2 : 3}
            placeholder={placeholder}
            aria-label={placeholder}
            tabIndex={tabIndex}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className="ui-thread__row">
            <span className="ui-thread__as">
              {rich(t('comments.as'), { name: <strong>{user.displayName}</strong> })}
              {draft.length > MAX * 0.8 && <em> · {t('comments.left', { n: MAX - draft.length })}</em>}
            </span>
            <button type="submit" className="ui-btn ui-btn--sm" disabled={!body || posting} tabIndex={tabIndex}>
              {posting ? t('comments.posting') : t('comments.post')}
            </button>
          </div>
          {postError && <p className="ui-thread__error" role="alert">{postError}</p>}
          {justPosted && !postError && <p className="ui-thread__ok" role="status">{t(justPosted === 'pending' ? 'comments.pending' : 'comments.thanks')}</p>}
        </form>
      ) : (
        <button type="button" className="ui-thread__signin" tabIndex={tabIndex} onClick={() => openAuth(t('social.signInNotes'))}>
          {t('comments.signIn')}
        </button>
      )}

      {error ? (
        <p className="ui-thread__empty">{t('comments.unavailable')}</p>
      ) : list === null ? (
        <p className="ui-thread__empty">{t('comments.loading')}</p>
      ) : list.length === 0 ? (
        <p className="ui-thread__empty">{item ? t('comments.empty') : t('comments.emptyGuestbook')}</p>
      ) : (
        <ol className="ui-thread__list">
          {list.map((c) => (
            <li key={c.id} className="ui-thread__item">
              <div className="ui-thread__meta">
                <span className="ui-thread__name">{c.displayName || t('comments.visitor')}</span>
                <time dateTime={c.createdAt}>{formatDate(c.createdAt)}</time>
              </div>
              <p className="ui-thread__body">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * Social UI (all hidden in static mode):
 *  - AccountMenu: compact HUD chip → favourites, guestbook, sign in / out
 *  - SocialDrawer: "My favourites" list with Go to, and the museum guestbook
 */
import { useEffect, useRef, useState } from 'react'
import { useLang, useT } from '../i18n'
import type { DictKey } from '../i18n/en'
import { itemTitle } from '../i18n/content'
import { useMuseum, type SelectionKind } from '../state/store'
import { signOut, toggleFavorite } from '../api/social'
import { goToItem } from '../tour/navigate'
import { CommentThread } from './Comments'
import { itemSummary } from './items'
import { IconArrowRight, IconBook, IconClose, IconHeart, IconSignOut, IconUser } from './icons'

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·'
}

/* ------------------------------------------------------------------ */
/* Account chip + menu                                                  */
/* ------------------------------------------------------------------ */

export function AccountMenu() {
  const online = useMuseum((s) => s.online)
  const user = useMuseum((s) => s.user)
  const favCount = useMuseum((s) => s.favorites.length)
  const drawer = useMuseum((s) => s.drawer)
  const setDrawer = useMuseum((s) => s.setDrawer)
  const openAuth = useMuseum((s) => s.openAuth)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const t = useT()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (!online) return null

  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div className="ui-account" ref={rootRef}>
      <button
        type="button"
        className={`ui-account__chip${user ? ' is-signed-in' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user ? t('social.account', { name: user.displayName }) : t('social.visitorAccount')}
        title={user ? user.displayName : t('social.accountTip')}
        onClick={() => setOpen((v) => !v)}
      >
        {user ? <span className="ui-account__avatar">{initials(user.displayName)}</span> : <IconUser />}
        <span className="ui-account__name">{user ? user.displayName : t('auth.signIn')}</span>
      </button>
      {open && (
        <div className="ui-quality__menu ui-panel ui-account__menu" role="menu" aria-label={t('social.visitorAccount')}>
          {user ? (
            <div className="ui-account__who">
              <span className="ui-account__avatar ui-account__avatar--lg">{initials(user.displayName)}</span>
              <span>
                <strong>{user.displayName}</strong>
                <small>{user.email}</small>
              </span>
            </div>
          ) : (
            <div className="ui-kicker ui-quality__menu-title">{t('social.visitor')}</div>
          )}
          <button
            type="button"
            role="menuitem"
            className="ui-quality__opt ui-account__opt"
            aria-pressed={drawer === 'favourites'}
            onClick={pick(() => (user ? setDrawer('favourites') : openAuth(t('social.signInFavs'))))}
          >
            <span>
              <IconHeart /> {t('social.favourites')}
            </span>
            {user && favCount > 0 ? <small>{favCount}</small> : null}
          </button>
          <button type="button" role="menuitem" className="ui-quality__opt ui-account__opt" onClick={pick(() => setDrawer('guestbook'))}>
            <span>
              <IconBook /> {t('social.guestbook')}
            </span>
          </button>
          <div className="ui-account__rule" />
          {user ? (
            <button type="button" role="menuitem" className="ui-quality__opt ui-account__opt" onClick={pick(() => void signOut())}>
              <span>
                <IconSignOut /> {t('social.signOut')}
              </span>
            </button>
          ) : (
            <>
              <button type="button" role="menuitem" className="ui-quality__opt ui-account__opt" onClick={pick(() => openAuth())}>
                <span>
                  <IconUser /> {t('auth.signIn')}
                </span>
              </button>
              <button type="button" role="menuitem" className="ui-quality__opt ui-account__opt" onClick={pick(() => openAuth(undefined, 'register'))}>
                <span className="ui-account__indent">{t('auth.register')}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

function parseKey(key: string): { kind: SelectionKind; id: string } | null {
  const i = key.indexOf(':')
  if (i < 0) return null
  return { kind: key.slice(0, i) as SelectionKind, id: key.slice(i + 1) }
}

function Favourites() {
  const favorites = useMuseum((s) => s.favorites)
  const setDrawer = useMuseum((s) => s.setDrawer)
  const select = useMuseum((s) => s.select)
  const t = useT()
  const lang = useLang()
  const items = favorites
    .map(parseKey)
    .filter((x): x is { kind: SelectionKind; id: string } => !!x)
    .map((x) => {
      const it = itemSummary(x.kind, x.id)
      return it ? { ...it, title: itemTitle(x.kind, x.id, lang, it.title), label: t(`kind.${x.kind}` as DictKey) } : { ...x, title: x.id, label: t('social.item') }
    })

  if (items.length === 0) {
    return (
      <div className="ui-drawer__empty">
        <IconHeart />
        <p>{t('social.noFavsTitle')}</p>
        <p className="ui-drawer__hint">{t('social.noFavsHint')}</p>
      </div>
    )
  }

  return (
    <ul className="ui-favs">
      {items.map((it) => (
        <li key={`${it.kind}:${it.id}`} className="ui-favs__item">
          <button
            type="button"
            className="ui-favs__main"
            onClick={() => {
              setDrawer(null)
              select({ kind: it.kind, id: it.id })
            }}
          >
            <span className="ui-favs__thumb" aria-hidden="true">
              {'image' in it && it.image ? <img src={it.image} alt="" loading="lazy" /> : <IconHeart filled />}
            </span>
            <span className="ui-favs__text">
              <span className="ui-favs__label">{it.label}</span>
              <span className="ui-favs__title">{it.title}</span>
            </span>
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--sm ui-favs__go"
            onClick={() => {
              setDrawer(null)
              select(null)
              goToItem(it.kind, it.id)
            }}
          >
            {t('social.goTo')} <IconArrowRight />
          </button>
          <button type="button" className="ui-icon-btn ui-favs__remove" aria-label={t('social.remove', { title: it.title })} data-tip={t('social.removeTip')} onClick={() => void toggleFavorite(it.kind, it.id)}>
            <IconClose />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function SocialDrawer() {
  const online = useMuseum((s) => s.online)
  const drawer = useMuseum((s) => s.drawer)
  const setDrawer = useMuseum((s) => s.setDrawer)
  const user = useMuseum((s) => s.user)
  const entered = useMuseum((s) => s.phase === 'entered')
  const t = useT()

  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useMuseum.getState().auth) {
        e.stopPropagation()
        setDrawer(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawer, setDrawer])

  // Favourites need an account.
  useEffect(() => {
    if (drawer === 'favourites' && !user) setDrawer(null)
  }, [drawer, user, setDrawer])

  if (!online || !entered || !drawer) return null

  return (
    <aside className="ui-drawer ui-panel" role="dialog" aria-labelledby="ui-drawer-title">
      <div className="ui-info__grip" aria-hidden="true" />
      <header className="ui-drawer__head">
        <div className="ui-kicker">{drawer === 'favourites' ? t('social.yourVisit') : t('social.theMuseum')}</div>
        <h2 id="ui-drawer-title" className="ui-drawer__title">
          {drawer === 'favourites' ? t('social.favourites') : t('social.guestbook')}
        </h2>
        <button type="button" className="ui-icon-btn ui-drawer__close" aria-label={t('social.close')} onClick={() => setDrawer(null)}>
          <IconClose />
        </button>
      </header>
      <div className="ui-drawer__body">
        {drawer === 'favourites' ? (
          <Favourites />
        ) : (
          <CommentThread title={t('social.leaveMessage')} placeholder={t('social.guestbookPlaceholder')} />
        )}
      </div>
    </aside>
  )
}

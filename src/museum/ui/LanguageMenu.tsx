/** Language switchers: HUD popover (`LanguageMenu`) and a compact segmented control (`LanguageSwitch`). */
import { useEffect, useRef, useState } from 'react'
import { LANGS, setLang, useLang, useT, type Lang } from '../i18n'

function IconLanguage() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5S9.6 6.1 12 3.5z" />
    </svg>
  )
}

export function LanguageMenu() {
  const lang = useLang()
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = LANGS.find((l) => l.value === lang)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    // Focus the checked option for keyboard users.
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="ui-quality ui-lang" ref={rootRef}>
      <button
        type="button"
        className="ui-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('lang.label')}: ${current?.native ?? lang}`}
        data-tip={open ? undefined : `${t('hud.languageTip')} · ${current?.native ?? ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <IconLanguage />
      </button>
      {open && (
        <div
          className="ui-quality__menu ui-panel"
          role="menu"
          aria-label={t('lang.choose')}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
            const i = items.indexOf(document.activeElement as HTMLButtonElement)
            items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
          }}
        >
          <div className="ui-kicker ui-quality__menu-title">{t('lang.label')}</div>
          {LANGS.map((l) => (
            <button
              key={l.value}
              type="button"
              role="menuitemradio"
              aria-checked={lang === l.value}
              className="ui-quality__opt"
              lang={l.bcp47}
              onClick={() => {
                setLang(l.value)
                setOpen(false)
              }}
            >
              <span>{l.native}</span>
              {l.value !== 'en' && <small lang="en">{l.english}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Segmented control (entry screen, help settings). */
export function LanguageSwitch({ className = '' }: { className?: string }) {
  const lang = useLang()
  const t = useT()
  return (
    <div className={`ui-langswitch ${className}`} role="radiogroup" aria-label={t('lang.choose')}>
      {LANGS.map((l) => (
        <button
          key={l.value}
          type="button"
          role="radio"
          aria-checked={lang === l.value}
          lang={l.bcp47}
          className={`ui-langswitch__opt${lang === l.value ? ' is-on' : ''}`}
          onClick={() => setLang(l.value as Lang)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            e.stopPropagation()
            const i = LANGS.findIndex((x) => x.value === lang)
            const next = LANGS[(i + (e.key === 'ArrowRight' ? 1 : -1) + LANGS.length) % LANGS.length]
            setLang(next.value)
            const sib = (e.currentTarget.parentElement?.children[LANGS.indexOf(next)] as HTMLElement | undefined)
            sib?.focus()
          }}
          tabIndex={lang === l.value ? 0 : -1}
        >
          {l.native}
        </button>
      ))}
    </div>
  )
}

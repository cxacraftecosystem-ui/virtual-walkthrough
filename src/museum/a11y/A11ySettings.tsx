/** Display & accessibility settings (help overlay): reduce motion, high contrast, larger text, language. */
import { useMuseum } from '../state/store'
import { useLang, useT } from '../i18n'
import type { DictKey } from '../i18n/en'
import { LanguageSwitch } from '../ui/LanguageMenu'

type Flag = 'reducedMotion' | 'highContrast' | 'largeText'
const ROWS: { flag: Flag; label: DictKey; note: DictKey }[] = [
  { flag: 'reducedMotion', label: 'help.reducedMotion', note: 'help.reducedMotionNote' },
  { flag: 'highContrast', label: 'help.highContrast', note: 'help.highContrastNote' },
  { flag: 'largeText', label: 'help.largeText', note: 'help.largeTextNote' },
]

function Toggle({ flag, label, note }: { flag: Flag; label: string; note: string }) {
  const on = useMuseum((s) => s[flag])
  const setA11y = useMuseum((s) => s.setA11y)
  const id = `ui-a11y-${flag}`
  return (
    <li className="ui-a11y__row">
      <span className="ui-a11y__text">
        <span id={id}>{label}</span>
        <small id={`${id}-note`}>{note}</small>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        aria-describedby={`${id}-note`}
        className={`ui-switch${on ? ' is-on' : ''}`}
        onClick={() => setA11y({ [flag]: !on })}
      >
        <span className="ui-switch__knob" aria-hidden="true" />
      </button>
    </li>
  )
}

export function A11ySettings() {
  const t = useT()
  const lang = useLang()
  return (
    <section className="ui-a11y" aria-labelledby="ui-a11y-title">
      <h3 id="ui-a11y-title" className="ui-kicker">
        {t('help.settings')}
      </h3>
      <ul className="ui-a11y__list">
        {ROWS.map((r) => (
          <Toggle key={r.flag} flag={r.flag} label={t(r.label)} note={t(r.note)} />
        ))}
        <li className="ui-a11y__row">
          <span className="ui-a11y__text">
            <span>{t('lang.label')}</span>
          </span>
          <LanguageSwitch />
        </li>
      </ul>
      <p className="ui-a11y__guide">
        <a href={`/guide${lang === 'en' ? '' : `?lang=${lang}`}`}>{t('help.guideLink')} →</a>
      </p>
    </section>
  )
}

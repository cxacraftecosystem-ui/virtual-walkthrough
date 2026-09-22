import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMuseum } from '../state/store'
import { IconClose } from './icons'
import { useTour } from '../tour/engine'

const HINT_MS = 7000

const K = ({ children }: { children: ReactNode }) => <kbd className="ui-kbd">{children}</kbd>
const G = ({ children }: { children: ReactNode }) => <span className="ui-help__gesture">{children}</span>

const DESKTOP: [string, ReactNode][] = [
  ['Look around', <G key="g">Drag</G>],
  [
    'Walk',
    <>
      <K>W</K>
      <K>A</K>
      <K>S</K>
      <K>D</K>
      <K>↑</K>
      <K>↓</K>
    </>,
  ],
  [
    'Turn',
    <>
      <K>←</K>
      <K>→</K>
    </>,
  ],
  ['Brisk walk', <K key="k">Shift</K>],
  ['Walk to a spot', <G key="g">Click the floor</G>],
  ['Artwork details', <G key="g">Click an artwork</G>],
  ['Open nearby item', <K key="k">E</K>],
  ['Mouse look (Esc to release)', <K key="k">L</K>],
  [
    'Map · Help',
    <>
      <K>M</K>
      <K>H</K>
    </>,
  ],
  [
    'Tour: pause · next',
    <>
      <K>Space</K>
      <K>]</K>
    </>,
  ],
  ['Close', <K key="k">Esc</K>],
]

const TOUCH: [string, ReactNode][] = [
  ['Look around', <G key="g">Drag with one finger</G>],
  ['Walk', <G key="g">Joystick</G>],
  ['Walk to a spot', <G key="g">Tap the floor</G>],
  ['Artwork details', <G key="g">Tap an artwork</G>],
  ['Travel between rooms', <G key="g">Tap a room on the map</G>],
  ['Guided tour', <G key="g">Route button, top right</G>],
]

export const isCoarsePointer = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

function List({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <ul className="ui-help__list">
      {rows.map(([label, keys]) => (
        <li key={label}>
          <span>{label}</span>
          <span className="ui-help__keys">{keys}</span>
        </li>
      ))}
    </ul>
  )
}

/** Full controls reference (H / ? button) plus the short hint strip after entering. */
export function HelpOverlay() {
  const helpOpen = useMuseum((s) => s.helpOpen)
  const setHelpOpen = useMuseum((s) => s.setHelpOpen)
  const entered = useMuseum((s) => s.phase === 'entered')
  const hintBlocked = useMuseum((s) => !!s.nearby || !!s.selection || !!s.inspecting || !!s.drawer)
  const touring = useTour((s) => s.active)
  const coarse = isCoarsePointer()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (helpOpen) closeRef.current?.focus({ preventScroll: true })
  }, [helpOpen])

  return (
    <>
      <HintStrip entered={entered} coarse={coarse} suppressed={helpOpen || hintBlocked || touring} />
      {helpOpen && entered && (
        <div
          className="ui-help"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ui-help-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setHelpOpen(false)
          }}
        >
          <div className="ui-help__card ui-panel">
            <button ref={closeRef} type="button" className="ui-icon-btn ui-help__close" aria-label="Close help (Esc)" onClick={() => setHelpOpen(false)}>
              <IconClose />
            </button>
            <div className="ui-kicker">Visitor guide</div>
            <h2 id="ui-help-title" className="ui-help__title">
              Moving through the galleries
            </h2>
            <div className="ui-help__cols">
              <section className={`ui-help__col${coarse ? ' ui-help__col--secondary' : ''}`} style={{ order: coarse ? 2 : 1 }}>
                <h3 className="ui-kicker">Mouse &amp; keyboard</h3>
                <List rows={DESKTOP} />
              </section>
              <section className={`ui-help__col${coarse ? '' : ' ui-help__col--secondary'}`} style={{ order: coarse ? 1 : 2 }}>
                <h3 className="ui-kicker">Touch</h3>
                <List rows={TOUCH} />
              </section>
            </div>
            <p className="ui-help__foot">
              Approach a hand-block table to inspect the carved block in 3D. Use the map to move between rooms, or take
              the guided tour (route button, top right) — any movement of your own pauses it.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function HintStrip({ entered, coarse, suppressed }: { entered: boolean; coarse: boolean; suppressed: boolean }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!entered) return
    const a = window.setTimeout(() => setVisible(true), 1300)
    const b = window.setTimeout(() => setVisible(false), 1300 + HINT_MS)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [entered])

  const shown = visible && !suppressed

  const items = coarse
    ? [
        ['Drag', 'to look'],
        ['Joystick', 'to walk'],
        ['Tap', 'an artwork'],
      ]
    : [
        ['Drag', 'to look'],
        ['W A S D', 'to walk'],
        ['Click', 'an artwork'],
        ['H', 'for help'],
      ]

  return (
    <div className={`ui-hint ui-panel${shown ? ' is-visible' : ''}`} role="status" aria-hidden={!shown || undefined}>
      <div className="ui-hint__items">
        {items.map(([k, v]) => (
          <span key={k}>
            {coarse || k === 'Drag' || k === 'Click' ? <strong style={{ fontWeight: 600 }}>{k}</strong> : <K>{k}</K>}
            {v}
          </span>
        ))}
      </div>
      <button type="button" className="ui-icon-btn" aria-label="Dismiss hint" tabIndex={shown ? 0 : -1} onClick={() => setVisible(false)}>
        <IconClose />
      </button>
    </div>
  )
}

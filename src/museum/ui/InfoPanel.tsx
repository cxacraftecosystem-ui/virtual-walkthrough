import { useEffect, useRef, useState } from 'react'
import { itemKey, useMuseum, type Selection } from '../state/store'
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { INFOGRAPHICS } from '../config/infographics'
import { SCENE_OBJECTS } from '../config/objects'
import { VIDEOS } from '../config/videos'
import { toggleFavorite } from '../api/social'
import { CommentThread } from './Comments'
import { IconClose, IconCube, IconHeart, IconPause, IconPlay } from './icons'

/**
 * CUSTOM WINDOW EVENTS (video screens):
 *   'museum:video_toggle'  detail { id }            — dispatched here when the visitor presses
 *                                                     Play / Pause for a video; the video
 *                                                     component should toggle playback.
 *   'museum:video_state'   detail { id, playing }   — OPTIONAL, dispatched by the video
 *                                                     component whenever playback starts/stops so
 *                                                     the button label stays in sync.
 */
export const VIDEO_TOGGLE_EVENT = 'museum:video_toggle'
export const VIDEO_STATE_EVENT = 'museum:video_state'

const videoPlaying = new Map<string, boolean>()
if (typeof window !== 'undefined') {
  window.addEventListener(VIDEO_STATE_EVENT, (e: Event) => {
    const d = (e as CustomEvent<{ id?: string; playing?: boolean }>).detail
    if (d?.id) videoPlaying.set(d.id, !!d.playing)
  })
}

function useVideoPlaying(id: string | undefined) {
  const [state, setState] = useState<{ id?: string; playing: boolean | null }>({ id, playing: id ? (videoPlaying.get(id) ?? null) : null })
  if (state.id !== id) setState({ id, playing: id ? (videoPlaying.get(id) ?? null) : null })
  useEffect(() => {
    if (!id) return
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; playing?: boolean }>).detail
      if (d?.id === id) setState({ id, playing: !!d.playing })
    }
    window.addEventListener(VIDEO_STATE_EVENT, on)
    return () => window.removeEventListener(VIDEO_STATE_EVENT, on)
  }, [id])
  return [state.id === id ? state.playing : null, (playing: boolean) => setState({ id, playing })] as const
}

interface ViewModel {
  kicker: string
  title: string
  facts: [string, string][]
  paragraphs: { heading?: string; text: string }[]
  steps?: string[]
  metadata?: [string, string][]
  image?: string
  placeholder: boolean
  /** Argument for store.inspect(): an exhibit id, or 'object:<id>'. */
  inspectId?: string
  inspectLabel?: string
  videoId?: string
  credit?: { author: string; source: string; license: string }
  related?: { label: string; selection: Selection }
}

function fact(label: string, value: string | undefined): [string, string][] {
  return value && value.trim() ? [[label, value]] : []
}

function resolve(sel: Selection): ViewModel | null {
  if (sel.kind === 'artwork') {
    const a = ARTWORKS.find((x) => x.id === sel.id)
    if (!a) return null
    const block = a.exhibitId ? EXHIBITS.find((e) => e.id === a.exhibitId) : undefined
    return {
      kicker: a.hero ? 'Hero work · Textile' : 'Textile',
      title: a.title,
      facts: [
        ...fact('Tradition', a.tradition),
        ...fact('Artisan', a.artisan),
        ...fact('Region', a.region),
        ...fact('Material', a.material),
        ...fact('Technique', a.technique),
        ...fact('Year', a.year),
      ],
      paragraphs: [
        ...(a.description ? [{ text: a.description }] : []),
        ...(a.context ? [{ heading: 'Context', text: a.context }] : []),
      ],
      metadata: a.metadata ? Object.entries(a.metadata) : undefined,
      image: a.image,
      placeholder: !!a.placeholder,
      inspectId: block?.id,
      inspectLabel: 'Inspect hand block in 3D',
      related: block ? { label: `Printed with ${block.title}`, selection: { kind: 'exhibit', id: block.id } } : undefined,
    }
  }
  if (sel.kind === 'exhibit') {
    const e = EXHIBITS.find((x) => x.id === sel.id)
    if (!e) return null
    const art = ARTWORKS.find((a) => a.id === e.artworkId)
    return {
      kicker: 'Hand block · Craft tool',
      title: e.title,
      facts: [
        ...fact('Tradition', e.tradition),
        ...fact('Artisan', e.artisan),
        ...fact('Region', e.region),
        ...fact('Material', e.material),
        ...fact('Technique', e.technique),
      ],
      paragraphs: e.description ? [{ text: e.description }] : [],
      placeholder: !!e.placeholder,
      inspectId: e.id,
      inspectLabel: 'Inspect hand block in 3D',
      related: art ? { label: `Prints the textile ${art.title}`, selection: { kind: 'artwork', id: art.id } } : undefined,
    }
  }
  if (sel.kind === 'object') {
    const o = SCENE_OBJECTS.find((x) => x.id === sel.id)
    if (!o) return null
    return {
      kicker: 'Installation',
      title: o.title,
      facts: [],
      paragraphs: o.description ? [{ text: o.description }] : [],
      placeholder: !!o.placeholder,
      inspectId: o.inspectable ? `object:${o.id}` : undefined,
      inspectLabel: 'Inspect in 3D',
      credit: o.credit,
    }
  }
  if (sel.kind === 'video') {
    const v = VIDEOS.find((x) => x.id === sel.id)
    if (!v) return null
    return {
      kicker: 'Film',
      title: v.title,
      facts: [],
      paragraphs: v.description ? [{ text: v.description }] : [],
      image: v.poster,
      placeholder: !!v.placeholder,
      videoId: v.id,
    }
  }
  const g = INFOGRAPHICS.find((x) => x.id === sel.id)
  if (!g) return null
  return {
    kicker: `Craft panel ${g.kicker}`,
    title: g.title,
    facts: [],
    paragraphs: g.body ? [{ text: g.body }] : [],
    steps: g.steps,
    placeholder: !!g.placeholder,
  }
}

export function InfoPanel() {
  const selection = useMuseum((s) => s.selection)
  const select = useMuseum((s) => s.select)
  const inspect = useMuseum((s) => s.inspect)
  const entered = useMuseum((s) => s.phase === 'entered')
  const online = useMuseum((s) => s.online)

  // Keep the last item rendered while the panel slides out.
  const [shown, setShown] = useState<Selection | null>(selection)
  if (selection && (selection.kind !== shown?.kind || selection.id !== shown?.id)) setShown(selection)

  const [imgFailed, setImgFailed] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLElement>(null)

  const vm = shown ? resolve(shown) : null
  const open = entered && !!selection && !!vm

  // A selection that resolves to nothing (item removed from the content, stale tour stop…)
  // would leave an invisible "open" panel that hides the joystick, map and prompts: drop it.
  useEffect(() => {
    if (selection && !resolve(selection)) select(null)
  }, [selection, select])
  const fav = useMuseum((s) => (shown ? s.favorites.includes(itemKey(shown.kind, shown.id)) : false))
  const [playing, setPlaying] = useVideoPlaying(vm?.videoId)

  useEffect(() => {
    if (!open) {
      const a = document.activeElement
      if (a instanceof HTMLElement && rootRef.current?.contains(a)) a.blur()
      return
    }
    bodyRef.current?.scrollTo({ top: 0 })
    // Focus without stealing keyboard walking: only when opened by keyboard users.
    if (document.activeElement && document.activeElement !== document.body) closeRef.current?.focus({ preventScroll: true })
  }, [open, shown])

  return (
    <aside
      ref={rootRef}
      className={`ui-info${open ? ' is-open' : ''}`}
      aria-hidden={!open || undefined}
      aria-labelledby="ui-info-title"
      role="dialog"
    >
      {vm && (
        <div className="ui-info__sheet ui-panel">
          <div className="ui-info__grip" aria-hidden="true" />
          <header className="ui-info__head">
            <div className="ui-kicker">{vm.kicker}</div>
            <h2 id="ui-info-title" className="ui-info__title">
              {vm.title}
            </h2>
            {vm.placeholder && (
              <span className="ui-info__badge" title="This item is a stand-in until the final content is supplied">
                Placeholder content
              </span>
            )}
            {online && shown && (
              <button
                type="button"
                className={`ui-icon-btn ui-info__fav${fav ? ' is-on' : ''}`}
                aria-pressed={fav}
                aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
                data-tip={fav ? 'Saved' : 'Add to favourites'}
                tabIndex={open ? 0 : -1}
                onClick={() => void toggleFavorite(shown.kind, shown.id)}
              >
                <IconHeart filled={fav} />
              </button>
            )}
            <button
              ref={closeRef}
              type="button"
              className="ui-icon-btn ui-info__close"
              aria-label="Close (Esc)"
              onClick={() => select(null)}
              tabIndex={open ? 0 : -1}
            >
              <IconClose />
            </button>
          </header>

          <div className="ui-info__body" ref={bodyRef}>
            {vm.image && imgFailed !== vm.image && (
              <figure className="ui-info__thumb">
                <img src={vm.image} alt={vm.title} loading="lazy" decoding="async" onError={() => setImgFailed(vm.image ?? null)} />
              </figure>
            )}

            {vm.facts.length > 0 && (
              <dl className="ui-info__facts">
                {vm.facts.map(([k, v]) => (
                  <FactRow key={k} k={k} v={v} />
                ))}
              </dl>
            )}

            {vm.paragraphs.map((p, i) => (
              <div key={i}>
                {p.heading && <div className="ui-kicker ui-info__section">{p.heading}</div>}
                <p className="ui-info__text">{p.text}</p>
              </div>
            ))}

            {vm.steps && vm.steps.length > 0 && (
              <>
                <div className="ui-kicker ui-info__section">Stages</div>
                <ol className="ui-info__steps">
                  {vm.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </>
            )}

            {vm.metadata && vm.metadata.length > 0 && (
              <>
                <div className="ui-kicker ui-info__section">Details</div>
                <dl className="ui-info__facts">
                  {vm.metadata.map(([k, v]) => (
                    <FactRow key={k} k={k} v={v} />
                  ))}
                </dl>
              </>
            )}

            {vm.related && (
              <button type="button" className="ui-info__link" tabIndex={open ? 0 : -1} onClick={() => select(vm.related!.selection)}>
                {vm.related.label} →
              </button>
            )}

            {vm.credit && (
              <p className="ui-info__credit">
                Model: {vm.credit.author} ·{' '}
                {/^https?:\/\//.test(vm.credit.source) ? (
                  <a href={vm.credit.source} target="_blank" rel="noopener noreferrer" tabIndex={open ? 0 : -1}>
                    {sourceLabel(vm.credit.source)}
                  </a>
                ) : (
                  vm.credit.source
                )}{' '}
                · {vm.credit.license}
              </p>
            )}

            {online && shown && open && <CommentThread key={`${shown.kind}:${shown.id}`} item={shown} tabIndex={open ? 0 : -1} compact />}
          </div>

          {(vm.inspectId || vm.videoId) && (
            <footer className="ui-info__foot">
              {vm.inspectId && (
                <button type="button" className="ui-btn" tabIndex={open ? 0 : -1} onClick={() => inspect(vm.inspectId!)}>
                  <IconCube />
                  {vm.inspectLabel ?? 'Inspect in 3D'}
                </button>
              )}
              {vm.videoId && (
                <button
                  type="button"
                  className="ui-btn"
                  tabIndex={open ? 0 : -1}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent(VIDEO_TOGGLE_EVENT, { detail: { id: vm.videoId } }))
                    // Optimistic until the screen reports its state (museum:video_state).
                    if (playing !== null) setPlaying(!playing)
                  }}
                >
                  {playing ? <IconPause /> : <IconPlay />}
                  {playing === null ? 'Play / pause film' : playing ? 'Pause film' : 'Play film'}
                </button>
              )}
            </footer>
          )}
        </div>
      )}
    </aside>
  )
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function FactRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  )
}

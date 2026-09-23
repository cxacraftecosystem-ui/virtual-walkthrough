/**
 * Entry-screen "Exhibitions" selector — shown only when more than one exhibition is published.
 * Each exhibition is a separate page (/gallery for the default, /gallery/<slug> for the others), so choosing
 * one navigates there and the museum boots with that exhibition's content.
 */
import { useEffect, useState } from 'react'
import { CURRENT_EXHIBITION } from '../content/exhibition'
import './ExhibitionPicker.css'

interface PublicExhibition {
  id: string
  slug: string
  title: string
  subtitle: string
  isDefault: boolean
  path: string
}

let cache: Promise<PublicExhibition[]> | null = null
function loadExhibitions(): Promise<PublicExhibition[]> {
  cache ??= fetch('/api/exhibitions', { credentials: 'include' })
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : []))
    .then((d: unknown) => (Array.isArray(d) ? (d as PublicExhibition[]) : []))
    .catch(() => [])
  return cache
}

export function ExhibitionPicker({ disabled = false }: { disabled?: boolean }) {
  const [list, setList] = useState<PublicExhibition[]>([])
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('static')) return
    let alive = true
    void loadExhibitions().then((l) => alive && setList(l))
    return () => {
      alive = false
    }
  }, [])
  if (list.length < 2) return null
  const current = CURRENT_EXHIBITION.id
  return (
    <nav className="ui-expick" aria-label="Exhibitions">
      <div className="ui-expick__label">Exhibitions</div>
      <ul className="ui-expick__list">
        {list.map((e) => {
          const here = e.id === current
          return (
            <li key={e.id}>
              <a
                className={`ui-expick__item${here ? ' is-current' : ''}`}
                href={e.path}
                aria-current={here ? 'page' : undefined}
                tabIndex={disabled ? -1 : undefined}
                title={e.subtitle || e.title}
              >
                {e.title}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The editor's live preview: how the item will read on its wall (image in its frame, film, model, panel). */
import { useState, type ReactNode } from 'react'
import type { ContentCollection } from '../../../museum/content/types'
import { resolveFrame, type FrameConfig, type FrameStyleId } from '../../../museum/config/frames'
import { ZONE_NAMES, getPath, surfaceRange } from '../../fields'
import { safeUrl } from '../../safeUrl'
import { parseHex, textOn } from './colour'

export function ItemPreview({ collection, draft }: { collection: ContentCollection; draft: Record<string, unknown> }) {
  const [broken, setBroken] = useState('')
  const s = (k: string) => (typeof draft[k] === 'string' ? (draft[k] as string) : '')
  const range = surfaceRange(getPath(draft, 'placement.surface'))
  const at = getPath(draft, 'placement.at')
  const place = range ? (
    <span>
      {range.label}
      {typeof at === 'number' && Number.isFinite(at) ? <> · {at.toFixed(2)} m ({range.axisLabel})</> : null}
    </span>
  ) : collection === 'objects' ? (
    <span>
      {ZONE_NAMES.get(s('zone')) ?? (s('zone') || 'No zone')} · {Array.isArray(draft.position) ? (draft.position as number[]).map((n) => Number(n).toFixed(1)).join(', ') : '–'}
    </span>
  ) : (
    <span className="danger-text">No wall chosen</span>
  )

  let visual: ReactNode
  if (collection === 'artworks') {
    const rawImg = s('image')
    const img = safeUrl(rawImg, 'image')
    const frame = resolveFrame((draft.frame as FrameConfig | FrameStyleId | undefined) ?? undefined)
    const K = 110 // px per metre in the preview
    const fw = Math.round(frame.frameWidth * K)
    const mw = Math.round(frame.matWidth * K)
    visual = (
      <div className="pv-frame">
        {img && broken !== img ? (
          <div
            className="pv-art framed"
            style={{ padding: fw, background: frame.material === 'none' ? frame.backingColor : frame.color, boxShadow: frame.material === 'none' ? undefined : 'inset 0 0 0 1px rgba(0,0,0,.25), 0 6px 14px -6px rgba(0,0,0,.45)' }}
          >
            <div style={{ padding: mw, background: frame.matColor }}>
              <img src={img} alt="" onError={() => setBroken(img)} style={{ maxHeight: 110 }} />
            </div>
          </div>
        ) : (
          <span className="pv-missing">{img ? 'Image not found' : rawImg ? 'This image address can’t be shown' : 'No image yet'}</span>
        )}
      </div>
    )
  } else if (collection === 'videos') {
    const poster = safeUrl(s('poster'), 'image')
    const src = safeUrl(s('src'), 'video')
    visual = (
      <div className="pv-frame">
        {src ? <video src={src} poster={poster} muted playsInline preload="metadata" controls /> : poster ? <img src={poster} alt="" /> : <span className="pv-missing">{s('src') ? 'This video address can’t be played' : 'No video yet'}</span>}
      </div>
    )
  } else if (collection === 'exhibits' || collection === 'objects') {
    const model = s('model')
    // an exhibit without a model shows the building's stand-in; its colour (when set) is the tile, and the
    // label takes whichever of dark or cream reads on it
    const ink = collection === 'exhibits' && !model && parseHex(s('inkColor')) ? s('inkColor') : ''
    visual = (
      <div className="pv-frame" style={ink ? { background: ink } : undefined}>
        <span className="pv-missing" style={ink ? { color: textOn(ink) ?? undefined } : undefined}>
          {model ? (
            <>
              3D model
              <br />
              <span className="mono">{model.split('/').pop()}</span>
            </>
          ) : collection === 'exhibits' ? (
            <>
              No 3D model yet
              <br />
              A stand-in piece is shown
            </>
          ) : (
            `Built-in model · ${s('kind') || 'object'}`
          )}
        </span>
      </div>
    )
  } else {
    visual = (
      <div className="pv-frame pv-panel">
        <span className="pv-missing">
          <span className="kicker">{s('kicker') || 'Panel'}</span>
          <br />
          <strong>{s('title') || 'Untitled'}</strong>
        </span>
      </div>
    )
  }
  const modelHref = safeUrl(s('model'), 'link')
  return (
    <div className="preview-panel">
      {visual}
      <div className="pv-meta">
        <span className="kicker">Preview</span>
        {place}
        {collection === 'artworks' && (
          <span className="muted">Frame: {typeof draft.frame === 'object' && draft.frame ? `${String((draft.frame as { style?: string }).style)} (custom)` : s('frame').replace(/-/g, ' ') || 'default (thin black)'}</span>
        )}
        {modelHref && (
          <a className="small" href={modelHref} target="_blank" rel="noreferrer">
            Open model file
          </a>
        )}
        {s('description') && <span className="muted truncate">{s('description')}</span>}
      </div>
    </div>
  )
}

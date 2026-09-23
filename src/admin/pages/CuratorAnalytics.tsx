/**
 * Curator analytics (Analytics page): floor-plan heatmap (walls from src/museum/config/layout.ts
 * + 0.5 m heat cells), tour funnel, attention ranking, CSV export and the retention setting.
 * Per exhibition and date range; all data anonymous (random session ids only).
 */
import { useEffect, useMemo, useState } from 'react'
import { WALLS, ZONES } from '../../museum/config/layout'
import { BUNDLED_TOUR_STOPS } from '../../museum/config/tour'
import { type CuratorData, exApi, type HeatmapData, type RetentionInfo } from '../exhibitionsApi'
import { useExhibitionList } from '../ExhibitionSwitcher'
import { errMsg, formatDate, formatDuration, useToast } from '../ui'
import '../exhibitions.css'

/** Sequential single-hue ramp (blue 150 → 700), light = little time, dark = a lot. */
const RAMP = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b']
const KINDS = ['', 'artwork', 'exhibit', 'object', 'infographic', 'video'] as const
const COLLECTION: Record<string, string> = { artwork: 'artworks', exhibit: 'exhibits', object: 'objects', infographic: 'infographics', video: 'videos' }
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Plan extents (m), from the walls. */
const BOUNDS = WALLS.reduce(
  (b, w) => ({ minX: Math.min(b.minX, w.min[0]), maxX: Math.max(b.maxX, w.max[0]), minZ: Math.min(b.minZ, w.min[2]), maxZ: Math.max(b.maxZ, w.max[2]) }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
)
const PAD = 1

export function CuratorAnalytics() {
  const exhibitions = useExhibitionList()
  const [exhibition, setExhibition] = useState('')
  const [from, setFrom] = useState(() => iso(Date.now() - 29 * DAY))
  const [to, setTo] = useState(() => iso(Date.now()))
  const [zone, setZone] = useState('')
  const [kind, setKind] = useState('')
  const [heat, setHeat] = useState<HeatmapData | null>(null)
  const [cur, setCur] = useState<CuratorData | null>(null)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [stopTitles, setStopTitles] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const exId = exhibition || exhibitions?.find((e) => e.isDefault)?.id || ''
  const params = useMemo(() => ({ exhibition: exId, from, to }), [exId, from, to])

  useEffect(() => {
    if (!exId) return
    let alive = true
    setError('')
    setHeat(null)
    exApi
      .heatmap({ ...params, zone: zone || undefined })
      .then((h) => alive && setHeat(h))
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [params, zone, exId])

  useEffect(() => {
    if (!exId) return
    let alive = true
    setCur(null)
    exApi
      .curator({ ...params, kind: kind || undefined })
      .then((d) => alive && setCur(d))
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [params, kind, exId])

  // item + tour-stop titles of the chosen exhibition
  useEffect(() => {
    if (!exId) return
    let alive = true
    fetch(`/api/content?exhibition=${encodeURIComponent(exId)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Record<string, unknown> | null) => {
        if (!alive || !c) return
        const t: Record<string, string> = {}
        for (const [k, col] of Object.entries(COLLECTION)) for (const it of (c[col] as { id: string; title?: string }[] | undefined) ?? []) t[`${k}/${it.id}`] = it.title ?? it.id
        setTitles(t)
        const stops = (Array.isArray(c.tour) && c.tour.length ? c.tour : BUNDLED_TOUR_STOPS) as { id: string; title: string }[]
        setStopTitles(Object.fromEntries(stops.map((s) => [s.id, s.title])))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [exId])

  const quick = (days: number) => {
    setTo(iso(Date.now()))
    setFrom(iso(Date.now() - (days - 1) * DAY))
  }
  const csv = (dataset: string, extra: Record<string, string | undefined> = {}) => exApi.exportUrl(dataset, { ...params, ...extra })

  return (
    <section aria-labelledby="cur-title" style={{ marginTop: 28 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 id="cur-title">Curator analytics</h1>
          <p className="muted">Where visitors walk and linger, how far they follow the guided tour, and what holds their attention — per exhibition.</p>
        </div>
      </div>

      <div className="cur-filters" role="group" aria-label="Curator analytics filters">
        <label className="field">
          <span>Exhibition</span>
          <select value={exId} onChange={(e) => setExhibition(e.target.value)}>
            {(exhibitions ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.title}{e.status === 'draft' ? ' (draft)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <div className="row">
          {[7, 30, 90].map((d) => (
            <button key={d} className="btn small ghost" onClick={() => quick(d)}>{d} days</button>
          ))}
        </div>
      </div>
      {error && <p className="alert">{error}</p>}

      <div className="cur-grid">
        <section className="card">
          <div className="cur-head">
            <h2>Floor-plan heatmap</h2>
            <label className="row small">
              Zone
              <select value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone filter">
                <option value="">All zones</option>
                {ZONES.map((z) => (
                  <option key={z.id} value={z.id}>{z.short}</option>
                ))}
              </select>
            </label>
            <a className="btn small ghost" href={csv('heatmap', { zone: zone || undefined })} download>CSV</a>
          </div>
          {!heat ? <p className="muted">Loading…</p> : <Heatmap data={heat} zone={zone} />}
        </section>

        <section className="card">
          <div className="cur-head">
            <h2>Time per zone</h2>
            <a className="btn small ghost" href={csv('zones')} download>CSV</a>
          </div>
          {!heat ? (
            <p className="muted">Loading…</p>
          ) : heat.zones.length === 0 ? (
            <div className="empty">No position samples in this range</div>
          ) : (
            <div className="bars">
              {heat.zones.map((z) => {
                const max = heat.zones[0].seconds || 1
                const label = ZONES.find((x) => x.id === z.zone)?.short ?? (z.zone || 'Outside zones')
                return (
                  <div className="bar-row" key={z.zone} title={`${label}: ${formatDuration(z.seconds)}`}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                    <div className="track">
                      <div className="fill" style={{ width: `${(z.seconds / max) * 100}%` }} />
                    </div>
                    <span className="v">{formatDuration(z.seconds)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <div className="cur-grid" style={{ marginTop: 16 }}>
        <section className="card" style={{ padding: 0 }}>
          <div className="cur-head" style={{ padding: '18px 18px 0' }}>
            <h2>Attention ranking</h2>
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Item kind">
              {KINDS.map((k) => (
                <option key={k} value={k}>{k ? `${k}s` : 'All kinds'}</option>
              ))}
            </select>
            <a className="btn small ghost" href={csv('attention', { kind: kind || undefined })} download>CSV</a>
          </div>
          {!cur ? (
            <p className="muted" style={{ padding: 18 }}>Loading…</p>
          ) : cur.attention.length === 0 ? (
            <div className="empty">No item views in this range</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Item</th>
                    <th className="num">Visitors</th>
                    <th className="num">Avg. attention</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cur.attention.slice(0, 40).map((a, i) => (
                    <tr key={`${a.itemKind}/${a.itemId}`}>
                      <td className="num muted">{i + 1}</td>
                      <td>
                        <div>{titles[`${a.itemKind}/${a.itemId}`] ?? a.itemId}</div>
                        <div className="mono muted">{a.itemKind} · {a.itemId}</div>
                      </td>
                      <td className="num">{a.viewers.toLocaleString()}</td>
                      <td className="num">{formatDuration(a.avgDwellSec)}</td>
                      <td className="num">{formatDuration(a.dwellSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="cur-head">
            <h2>Guided-tour funnel</h2>
            <a className="btn small ghost" href={csv('funnel')} download>CSV</a>
          </div>
          {!cur ? <p className="muted">Loading…</p> : <Funnel data={cur.funnel} titles={stopTitles} />}
        </section>
      </div>

      <Retention />
    </section>
  )
}

/* ------------------------------------------------------------------ */

function Heatmap({ data, zone }: { data: HeatmapData; zone: string }) {
  const [hover, setHover] = useState<{ cx: number; cz: number; n: number } | null>(null)
  const x0 = BOUNDS.minX - PAD
  const z0 = BOUNDS.minZ - PAD
  const W = BOUNDS.maxX - BOUNDS.minX + 2 * PAD
  const H = BOUNDS.maxZ - BOUNDS.minZ + 2 * PAD
  const s = data.cellSize
  const max = data.maxSamples || 1
  // sqrt scale: a few long pauses should not wash out the rest of the plan
  const color = (n: number) => RAMP[Math.min(RAMP.length - 1, Math.floor(Math.sqrt(n / max) * RAMP.length))]
  const zoneRects = zone ? ZONES.filter((z) => z.id === zone) : ZONES
  const pct = (x: number, z: number) => ({ left: `${((x - x0) / W) * 100}%`, top: `${((z - z0) / H) * 100}%` })

  return (
    <>
      <div className="heat-wrap" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`${x0} ${z0} ${W} ${H}`} role="img" aria-label={`Heatmap of visitor positions, ${data.totalSamples} samples (north is up)`}>
          {zoneRects.map((z) => (
            <g key={z.id}>
              <rect className="heat-zone" x={z.rect.minX} y={z.rect.minZ} width={z.rect.maxX - z.rect.minX} height={z.rect.maxZ - z.rect.minZ} />
              <text className="heat-zone-label" x={(z.rect.minX + z.rect.maxX) / 2} y={z.rect.minZ + 1.4}>{z.short}</text>
            </g>
          ))}
          {data.cells.map(([cx, cz, n]) => (
            <rect
              key={`${cx}:${cz}`}
              className="heat-cell"
              x={cx * s}
              y={cz * s}
              width={s}
              height={s}
              fill={color(n)}
              onMouseEnter={() => setHover({ cx, cz, n })}
            />
          ))}
          {WALLS.map((w) => (
            <rect
              key={w.id}
              className={`heat-wall${w.kind === 'glazing' ? ' glazing' : w.max[1] < 2.5 ? ' low' : ''}`}
              x={w.min[0]}
              y={w.min[2]}
              width={Math.max(w.max[0] - w.min[0], 0.08)}
              height={Math.max(w.max[2] - w.min[2], 0.08)}
              pointerEvents="none"
            />
          ))}
        </svg>
        {hover && (
          <div className="chart-tip" style={pct(hover.cx * s + s / 2, hover.cz * s)}>
            {formatDuration(hover.n * data.sampleSec)} · x {(hover.cx * s).toFixed(1)}, z {(hover.cz * s).toFixed(1)} m
          </div>
        )}
      </div>
      <div className="heat-legend">
        <span>less time</span>
        <span className="ramp" style={{ background: `linear-gradient(90deg, ${RAMP.join(', ')})` }} aria-hidden="true" />
        <span>more (max {formatDuration(max * data.sampleSec)} in one 0.5 m cell)</span>
        <span className="spacer" />
        <span>{data.cells.length.toLocaleString()} cells · {formatDuration(data.totalSamples * data.sampleSec)} sampled · north ↑</span>
      </div>
    </>
  )
}

function Funnel({ data, titles }: { data: CuratorData['funnel']; titles: Record<string, string> }) {
  if (data.starts === 0 && data.steps.length === 0) return <div className="empty">No guided tours in this range</div>
  const base = Math.max(data.starts, ...data.steps.map((s) => s.sessions), 1)
  const rows = [
    { key: 'start', idx: '', label: 'Tour started', n: data.starts },
    ...data.steps.map((s) => ({ key: s.stopId, idx: String(s.index + 1), label: titles[s.stopId] ?? s.stopId, n: s.sessions })),
    { key: 'complete', idx: '', label: 'Tour completed', n: data.completes },
  ]
  return (
    <div role="table" aria-label="Tour funnel: sessions reaching each stop">
      {rows.map((r, i) => {
        const prev = i > 0 ? rows[i - 1].n : r.n
        const drop = prev > 0 && r.n < prev ? Math.round(((prev - r.n) / prev) * 100) : 0
        return (
          <div className="funnel-row" role="row" key={r.key} title={`${r.label}: ${r.n} session${r.n === 1 ? '' : 's'}${drop ? `, −${drop}% vs previous` : ''}`}>
            <span className="idx" role="cell">{r.idx}</span>
            <span className="t" role="cell">{r.label}</span>
            <div className="track" role="presentation">
              <div className="fill" style={{ width: `${(r.n / base) * 100}%` }} />
            </div>
            <span className="v" role="cell">
              {r.n.toLocaleString()} {drop > 0 && <span className="drop">−{drop}%</span>}
            </span>
          </div>
        )
      })}
      <p className="muted small" style={{ marginTop: 8 }}>Distinct sessions reaching each stop; “−%” = drop-off from the previous row.</p>
    </div>
  )
}

function Retention() {
  const [info, setInfo] = useState<RetentionInfo | null>(null)
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  useEffect(() => {
    exApi
      .retention()
      .then((r) => {
        setInfo(r)
        setDays(String(r.days))
      })
      .catch(() => undefined)
  }, [])
  if (!info) return null
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      const r = await exApi.retention()
      setInfo(r)
      setDays(String(r.days))
      toast(ok)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const last = info.lastCleanup
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Privacy &amp; retention</h2>
      <p className="muted small">
        Only a random per-tab session id is stored — no accounts, IP addresses or user agents. Positions are aggregated into 0.5 m cells per day on arrival;
        raw positions are never kept. Events and heatmap rows older than the retention period are deleted automatically (at most once a day) and by the cleanup job.
      </p>
      <div className="cur-retention">
        <label className="row">
          Keep analytics for
          <input type="number" min={7} max={1825} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Retention in days" />
          days
        </label>
        <button className="btn small" disabled={busy || Number(days) === info.days} onClick={() => run(() => exApi.putRetention(Number(days)), 'Retention saved')}>Save</button>
        <button className="btn small ghost" disabled={busy} onClick={() => run(() => exApi.cleanup(), 'Cleanup finished')}>Run cleanup now</button>
        <span className="muted small">
          {last ? `Last cleanup ${formatDate(last.ranAt)}: ${last.deletedEvents} events, ${last.deletedHeatRows} heatmap rows removed.` : 'No cleanup has run yet.'}
        </span>
      </div>
    </section>
  )
}

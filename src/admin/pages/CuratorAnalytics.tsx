/**
 * Curator analytics (Analytics page): floor-plan heatmap (FLOOR_PLAN paths + 0.5 m heat cells), time
 * per zone, attention ranking (linked to the content editor and the museum), tour funnel, CSV exports
 * and the retention setting. Per exhibition and date range; all data anonymous.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FLOOR_PLAN } from '../../museum/config/plan'
import { BUNDLED_TOUR_STOPS } from '../../museum/config/tour'
import { UPPER_ZONE_IDS } from '../fields'
import { type CuratorData, exApi, type HeatmapData, type RetentionInfo } from '../exhibitionsApi'
import { useExhibitionList } from '../ExhibitionSwitcher'
import { Button, DataTable, EmptyState, Field, Input, Segmented, Select, Skeleton, errMsg, formatDate, formatDuration, useConfirm, useToast, type Column, type SelectOption } from '../ui'
import { HBars, ItemLinks } from './analytics/parts'
import { collectionOfKind } from './content/model'
import '../exhibitions.css'

/** Sequential single-hue ramp, light = little time, dark = a lot (classes heat-l0…l6, themed in exhibitions.css). */
const STEPS = 7
const KINDS: SelectOption[] = [
  { value: 'artwork', label: 'Artworks' },
  { value: 'exhibit', label: 'Exhibits' },
  { value: 'object', label: 'Objects' },
  { value: 'infographic', label: 'Panels' },
  { value: 'video', label: 'Films' },
]
const DAY = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Local calendar date (never toISOString, which is UTC). */
const ymd = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const validDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime())
/** The ground-floor rooms of the plan (an upper storey would be drawn over the rooms below it). */
const PLAN_ZONES = FLOOR_PLAN.zones.filter((z) => !UPPER_ZONE_IDS.has(z.id))
const ZONE_NAME = new Map(FLOOR_PLAN.zones.map((z) => [z.id, z.name]))
const PAD = 1

type Preset = '7' | '30' | '90' | 'custom'

export function CuratorAnalytics() {
  const exhibitions = useExhibitionList()
  const [exhibition, setExhibition] = useState('')
  const [preset, setPreset] = useState<Preset>('30')
  const [from, setFrom] = useState(() => ymd(Date.now() - 29 * DAY))
  const [to, setTo] = useState(() => ymd(Date.now()))
  const [fromText, setFromText] = useState(from)
  const [toText, setToText] = useState(to)
  const [zone, setZone] = useState('')
  const [kind, setKind] = useState('')
  const [heat, setHeat] = useState<HeatmapData | null>(null)
  const [cur, setCur] = useState<CuratorData | null>(null)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [stopTitles, setStopTitles] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const ex = exhibitions?.find((e) => e.id === exhibition) ?? exhibitions?.find((e) => e.isDefault)
  const exId = ex?.id ?? ''
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
        for (const k of ['artwork', 'exhibit', 'object', 'infographic', 'video']) {
          const col = collectionOfKind(k)
          for (const it of (col ? (c[col] as { id: string; title?: string }[] | undefined) : undefined) ?? []) t[`${k}/${it.id}`] = it.title ?? it.id
        }
        setTitles(t)
        const stops = (Array.isArray(c.tour) && c.tour.length ? c.tour : BUNDLED_TOUR_STOPS) as { id: string; title: string }[]
        setStopTitles(Object.fromEntries(stops.map((s) => [s.id, s.title])))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [exId])

  function pick(p: Preset) {
    setPreset(p)
    if (p === 'custom') return
    const f = ymd(Date.now() - (Number(p) - 1) * DAY)
    const t = ymd(Date.now())
    setFrom(f)
    setTo(t)
    setFromText(f)
    setToText(t)
  }
  const fromErr = !validDate(fromText) ? 'Use yyyy-mm-dd.' : validDate(toText) && fromText > toText ? 'Starts after the end.' : ''
  const toErr = !validDate(toText) ? 'Use yyyy-mm-dd.' : ''
  const applyCustom = () => {
    if (fromErr || toErr) return
    setFrom(fromText)
    setTo(toText)
  }

  const csv = (dataset: string, extra: Record<string, string | undefined> = {}) => exApi.exportUrl(dataset, { ...params, ...extra })
  const museumBase = ex?.path || '/gallery'
  const exOptions: SelectOption[] = (exhibitions ?? []).map((e) => ({ value: e.id, label: e.title, description: e.status === 'draft' ? 'Draft' : e.path }))
  const zoneOptions: SelectOption[] = PLAN_ZONES.map((z) => ({ value: z.id, label: z.name }))

  type Att = CuratorData['attention'][number]
  const attColumns: Column<Att>[] = [
    { id: 'item', header: 'Item', sortValue: (a) => (titles[`${a.itemKind}/${a.itemId}`] ?? a.itemId).toLowerCase(), cell: (a) => <ItemLinks kind={a.itemKind} id={a.itemId} title={titles[`${a.itemKind}/${a.itemId}`]} museumBase={museumBase} /> },
    { id: 'viewers', header: 'Visitors', align: 'right', sortValue: (a) => a.viewers, cell: (a) => a.viewers.toLocaleString() },
    { id: 'avg', header: 'Avg. attention', align: 'right', sortValue: (a) => a.avgDwellSec, cell: (a) => formatDuration(a.avgDwellSec) },
    { id: 'total', header: 'Total', align: 'right', hidePhone: true, sortValue: (a) => a.dwellSec, cell: (a) => formatDuration(a.dwellSec) },
  ]

  return (
    <section aria-labelledby="cur-title" className="cur-section">
      <div className="cur-intro">
        <h2 id="cur-title" className="cur-title">Curator analytics</h2>
        <p className="muted">Where visitors walk and linger, what holds their attention and how far they follow the tour.</p>
      </div>

      <div className="cur-filters" role="group" aria-label="Curator analytics filters">
        <Field group label="Exhibition">
          {(w) => <Select {...w} value={exId} options={exOptions} onChange={setExhibition} />}
        </Field>
        <Field group label="Period">
          {() => (
            <Segmented<Preset>
              label="Period"
              value={preset}
              onChange={pick}
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: '90', label: '90 days' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          )}
        </Field>
        {preset === 'custom' ? (
          <form
            className="cur-custom"
            onSubmit={(e) => {
              e.preventDefault()
              applyCustom()
            }}
          >
            <Field label="From" error={fromErr || undefined}>
              <Input className="mono" inputMode="numeric" placeholder="yyyy-mm-dd" value={fromText} onChange={(e) => setFromText(e.target.value.trim())} onBlur={applyCustom} />
            </Field>
            <Field label="To" error={toErr || undefined}>
              <Input className="mono" inputMode="numeric" placeholder="yyyy-mm-dd" value={toText} onChange={(e) => setToText(e.target.value.trim())} onBlur={applyCustom} />
            </Field>
            <Button type="submit" size="sm" disabled={!!(fromErr || toErr)}>Apply</Button>
          </form>
        ) : (
          <span className="muted small cur-range">
            {from} to {to}
          </span>
        )}
      </div>
      {error && <p className="alert">{error}</p>}

      <div className="cur-grid">
        <section className="card">
          <div className="cur-head">
            <h2>Floor-plan heatmap</h2>
            <Select size="sm" value={zone} onChange={setZone} options={zoneOptions} placeholder="All zones" clearable aria-label="Zone" className="ct-filter" />
            <Button size="sm" variant="ghost" icon="file" href={csv('heatmap', { zone: zone || undefined })} download>
              CSV
            </Button>
          </div>
          {!heat ? <Skeleton rows={6} /> : <Heatmap data={heat} zone={zone} />}
        </section>

        <section className="card">
          <div className="cur-head">
            <h2>Time per zone</h2>
            <Button size="sm" variant="ghost" icon="file" href={csv('zones')} download>
              CSV
            </Button>
          </div>
          {!heat ? (
            <Skeleton rows={6} />
          ) : (
            <HBars
              rows={heat.zones.map((z) => ({ label: ZONE_NAME.get(z.zone) ?? (z.zone || 'Outside zones'), value: z.seconds, text: formatDuration(z.seconds) }))}
              empty="No visitor positions in this period."
            />
          )}
        </section>
      </div>

      <div className="cur-grid" style={{ marginTop: 16 }}>
        <div>
          <div className="cur-head">
            <h2>Attention ranking</h2>
            <Select size="sm" value={kind} onChange={setKind} options={KINDS} placeholder="All kinds" clearable aria-label="Item kind" className="ct-filter" />
            <Button size="sm" variant="ghost" icon="file" href={csv('attention', { kind: kind || undefined })} download>
              CSV
            </Button>
          </div>
          <DataTable
            rows={cur ? cur.attention.slice(0, 40) : null}
            columns={attColumns}
            getRowId={(a) => `${a.itemKind}/${a.itemId}`}
            caption="Items ranked by visitor attention"
            density="compact"
            defaultSort={null}
            empty={<EmptyState title="No item views in this period" icon="analytics" as="h3" />}
            footer={cur && cur.attention.length > 40 ? <div className="ui-table-foot">Showing the top 40 of {cur.attention.length.toLocaleString()} items. The CSV has all of them.</div> : null}
          />
        </div>

        <section className="card">
          <div className="cur-head">
            <h2>Guided-tour funnel</h2>
            <Button size="sm" variant="ghost" icon="file" href={csv('funnel')} download>
              CSV
            </Button>
          </div>
          {!cur ? <Skeleton rows={6} /> : <Funnel data={cur.funnel} titles={stopTitles} />}
        </section>
      </div>

      <Retention />
    </section>
  )
}

/* ------------------------------------------------------------------ */

/** Smallest label, as a share of the stylesheet's size, before a name that does not fit is left off. */
const MIN_LABEL_SCALE = 0.6

/**
 * One room of the plan with its name. Rooms come in any shape and size (FLOOR_PLAN is the building's
 * own), so the name is measured against the room's drawn width: a long name in a narrow room is set
 * smaller, and left off (the outline keeps it as a tooltip) when even that would spill into the next.
 */
function ZoneOutline({ zone }: { zone: (typeof PLAN_ZONES)[number] }) {
  const pathRef = useRef<SVGPathElement>(null)
  const textRef = useRef<SVGTextElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const path = pathRef.current
    const text = textRef.current
    if (!path || !text || typeof text.getComputedTextLength !== 'function') return
    const room = path.getBBox().width * 0.92
    const len = text.getComputedTextLength()
    if (!len || !room) return
    const fit = Math.min(1, room / len)
    setScale(fit >= MIN_LABEL_SCALE ? fit : 0)
  }, [zone.d, zone.name])
  return (
    <g>
      <path ref={pathRef} className="heat-zone" d={zone.d}>
        <title>{zone.name}</title>
      </path>
      <text
        ref={textRef}
        className="heat-zone-label"
        x={zone.cx}
        y={zone.cz}
        transform={scale && scale < 1 ? `translate(${zone.cx} ${zone.cz}) scale(${scale.toFixed(3)}) translate(${-zone.cx} ${-zone.cz})` : undefined}
        style={scale ? undefined : { display: 'none' }}
        aria-hidden={scale === 0 || undefined}
      >
        {zone.name}
      </text>
    </g>
  )
}

function Heatmap({ data, zone }: { data: HeatmapData; zone: string }) {
  const [hover, setHover] = useState<{ cx: number; cz: number; n: number } | null>(null)
  const b = FLOOR_PLAN.bounds
  const x0 = b.minX - PAD
  const z0 = b.minZ - PAD
  const W = b.maxX - b.minX + 2 * PAD
  const H = b.maxZ - b.minZ + 2 * PAD
  const s = data.cellSize
  const max = data.maxSamples || 1
  // sqrt scale: a few long pauses should not wash out the rest of the plan
  const step = (n: number) => Math.min(STEPS - 1, Math.floor(Math.sqrt(n / max) * STEPS))
  const zones = zone ? PLAN_ZONES.filter((z) => z.id === zone) : PLAN_ZONES
  const pct = (x: number, z: number) => ({ left: `${((x - x0) / W) * 100}%`, top: `${((z - z0) / H) * 100}%` })

  if (!data.cells.length)
    return <div className="empty">No visitor positions in this period.</div>
  return (
    <>
      <div className="heat-wrap" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`${x0} ${z0} ${W} ${H}`} role="img" aria-label={`Heatmap of where visitors spent time, ${formatDuration(data.totalSamples * data.sampleSec)} in all (north is up)`}>
          {zones.map((z) => (
            <ZoneOutline key={z.id} zone={z} />
          ))}
          {data.cells.map(([cx, cz, n]) => (
            <rect key={`${cx}:${cz}`} className={`heat-cell heat-l${step(n)}`} x={cx * s} y={cz * s} width={s} height={s} onMouseEnter={() => setHover({ cx, cz, n })} />
          ))}
          {FLOOR_PLAN.walls.map((w) => (
            <path key={w.id} className={`heat-wall k-${w.kind}`} d={w.d} pointerEvents="none" />
          ))}
        </svg>
        {hover && (
          <div className="chart-tip" style={pct(hover.cx * s + s / 2, hover.cz * s)}>
            {formatDuration(hover.n * data.sampleSec)} · x {(hover.cx * s).toFixed(1)}, z {(hover.cz * s).toFixed(1)} m
          </div>
        )}
      </div>
      <div className="heat-legend">
        <span>Less time</span>
        <span className="ramp" aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={`heat-l${i}`} />
          ))}
        </span>
        <span>More (up to {formatDuration(max * data.sampleSec)} in one {s} m square)</span>
        <span className="spacer" />
        <span>North ↑</span>
      </div>
    </>
  )
}

function Funnel({ data, titles }: { data: CuratorData['funnel']; titles: Record<string, string> }) {
  if (data.starts === 0 && data.steps.length === 0) return <div className="empty">No guided tours in this period.</div>
  const base = Math.max(data.starts, ...data.steps.map((s) => s.sessions), 1)
  const rows = [
    { key: 'start', idx: '', label: 'Tour started', n: data.starts },
    ...data.steps.map((s) => ({ key: s.stopId, idx: String(s.index + 1), label: titles[s.stopId] ?? s.stopId, n: s.sessions })),
    { key: 'complete', idx: '', label: 'Tour finished', n: data.completes },
  ]
  return (
    <div role="table" aria-label="Tour funnel: sessions reaching each stop">
      {rows.map((r, i) => {
        const prev = i > 0 ? rows[i - 1].n : r.n
        const drop = prev > 0 && r.n < prev ? Math.round(((prev - r.n) / prev) * 100) : 0
        return (
          <div className="funnel-row" role="row" key={r.key} title={`${r.label}: ${r.n} ${r.n === 1 ? 'session' : 'sessions'}${drop ? `, −${drop}% from the row before` : ''}`}>
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
      <p className="muted small" style={{ marginTop: 8 }}>Sessions reaching each stop; “−%” is the drop from the row before.</p>
    </div>
  )
}

function Retention() {
  const [info, setInfo] = useState<RetentionInfo | null>(null)
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
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
  const n = Number(days)
  const daysErr = !Number.isInteger(n) || n < 7 || n > 1825 ? 'Between 7 and 1,825 days.' : ''
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
  const cleanup = async () => {
    const ok = await confirm({
      title: 'Run the cleanup now?',
      body: `Visit statistics older than ${info.days} days are deleted for good.`,
      confirmLabel: 'Delete old statistics',
      danger: true,
    })
    if (ok) void run(() => exApi.cleanup(), 'Cleanup finished')
  }
  const save = async () => {
    if (daysErr) return
    if (n < info.days && !(await confirm({ title: `Keep statistics for ${n} days?`, body: `Statistics older than ${n} days are deleted at the next cleanup.`, confirmLabel: 'Save', tone: 'warning' }))) return
    void run(() => exApi.putRetention(n), 'Retention saved')
  }
  const last = info.lastCleanup
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Privacy and retention</h2>
      <p className="muted small">
        Only a random per-tab session id is stored: no accounts, IP addresses or browser details. Positions are counted into 0.5 m squares per day; raw positions are never kept.
        Older statistics are deleted automatically once a day.
      </p>
      <div className="cur-retention">
        <Field label="Keep statistics for (days)" error={daysErr || undefined}>
          <Input type="number" inputMode="numeric" min={7} max={1825} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Button size="sm" disabled={busy || !!daysErr || n === info.days} onClick={() => void save()}>
          Save
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void cleanup()}>
          Run cleanup now…
        </Button>
        <span className="muted small">
          {last ? `Last cleanup ${formatDate(last.ranAt)}: ${last.deletedEvents.toLocaleString()} events and ${last.deletedHeatRows.toLocaleString()} heatmap rows removed.` : 'No cleanup has run yet.'}
        </span>
      </div>
    </section>
  )
}


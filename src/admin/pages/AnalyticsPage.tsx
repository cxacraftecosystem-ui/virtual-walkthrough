/**
 * Analytics: anonymous visit statistics for the last 7 / 30 / 90 days, each tile compared with the
 * period before it, plus the curator analytics (heatmap, attention, tour funnel) below. Top items link
 * to their content editor and to the museum.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type AnalyticsSummary } from '../api'
import { ZONE_NAMES } from '../fields'
import { DataTable, EmptyState, Icon, PageHeader, Skeleton, Stat, Tabs, errMsg, formatDuration, type Column } from '../ui'
import { CuratorAnalytics } from './CuratorAnalytics'
import { HBars, ItemLinks } from './analytics/parts'
import { collectionOfKind, useMuseumBase } from './content/model'
import '../exhibitions.css'

const RANGES = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
] as const
type RangeId = (typeof RANGES)[number]['id']

/** The previous period's figures, from the summary of twice the range minus this range. */
interface Previous {
  sessions: number
  avgSessionSec: number
  dwell: number
}
function previousOf(cur: AnalyticsSummary, twice: AnalyticsSummary): Previous {
  const sessions = Math.max(0, twice.sessions - cur.sessions)
  const totalSec = twice.avgSessionSec * twice.sessions - cur.avgSessionSec * cur.sessions
  const dwell = (s: AnalyticsSummary) => s.zoneDwell.reduce((n, z) => n + z.seconds, 0)
  return { sessions, avgSessionSec: sessions > 0 ? Math.max(0, totalSec / sessions) : 0, dwell: Math.max(0, dwell(twice) - dwell(cur)) }
}

/** "+12% vs previous 7 days" — words and a sign, never colour alone. */
function Delta({ now, before, days }: { now: number; before: number | null; days: number }) {
  if (before === null) return <span className="muted">Comparing…</span>
  if (before === 0) return <span className="muted">{now > 0 ? `New vs the previous ${days} days` : `None in the previous ${days} days either`}</span>
  const pct = Math.round(((now - before) / before) * 100)
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  return (
    <span className={`an-delta ${dir}`}>
      <Icon name={dir === 'up' ? 'arrowUpRight' : dir === 'down' ? 'chevronDown' : 'dash'} />
      {pct > 0 ? '+' : ''}
      {pct}% vs previous {days} days
    </span>
  )
}

export function AnalyticsPage() {
  const [range, setRange] = useState<RangeId>('7')
  const days = Number(range)
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [prev, setPrev] = useState<Previous | null>(null)
  const [error, setError] = useState('')
  const [titles, setTitles] = useState<Record<string, string>>({})
  const museumBase = useMuseumBase()

  useEffect(() => {
    let alive = true
    setData(null)
    setPrev(null)
    setError('')
    Promise.all([api.summary(days), api.summary(days * 2).catch(() => null)])
      .then(([cur, twice]) => {
        if (!alive) return
        setData(cur)
        setPrev(twice ? previousOf(cur, twice) : { sessions: 0, avgSessionSec: 0, dwell: 0 })
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [days])

  useEffect(() => {
    api
      .content()
      .then((c) => {
        const t: Record<string, string> = {}
        for (const kind of ['artwork', 'exhibit', 'infographic', 'video', 'object']) {
          const col = collectionOfKind(kind)
          if (col) for (const it of c[col]) t[`${kind}/${it.id}`] = it.title
        }
        setTitles(t)
      })
      .catch(() => undefined)
  }, [])

  const totalDwell = data?.zoneDwell.reduce((s, z) => s + z.seconds, 0) ?? 0
  const topZone = data?.zoneDwell[0]
  const totalViews = data?.topItems.reduce((s, i) => s + i.views, 0) ?? 0
  const zoneName = (z: string) => ZONE_NAMES.get(z) ?? prettyZone(z)

  type Top = AnalyticsSummary['topItems'][number]
  const columns: Column<Top>[] = useMemo(
    () => [
      {
        id: 'item',
        header: 'Item',
        sortValue: (i) => (titles[`${i.itemKind}/${i.itemId}`] ?? i.itemId).toLowerCase(),
        cell: (i) => <ItemLinks kind={i.itemKind} id={i.itemId} title={titles[`${i.itemKind}/${i.itemId}`]} museumBase={museumBase} />,
      },
      { id: 'kind', header: 'Kind', hidePhone: true, sortValue: (i) => i.itemKind, cell: (i) => i.itemKind },
      { id: 'views', header: 'Views', align: 'right', sortValue: (i) => i.views, cell: (i) => i.views.toLocaleString() },
      { id: 'dwell', header: 'Dwell', align: 'right', sortValue: (i) => i.dwellSec, cell: (i) => formatDuration(i.dwellSec) },
    ],
    [titles, museumBase],
  )

  return (
    <>
      <PageHeader
        title="Analytics"
        icon="analytics"
        description="Anonymous visit statistics: random session ids only, no personal data."
        actions={<Tabs label="Time range" tabs={RANGES.map((r) => ({ id: r.id, label: r.label }))} value={range} onChange={setRange} />}
      />
      {error && <p className="alert">{error}</p>}
      {!data ? (
        !error && <Skeleton kind="tiles" rows={4} />
      ) : (
        <>
          <div className="home-tiles an-tiles">
            <Stat icon="users" label="Sessions" value={data.sessions.toLocaleString()} sub={<Delta now={data.sessions} before={prev?.sessions ?? null} days={days} />} />
            <Stat icon="clock" label="Average visit" value={formatDuration(data.avgSessionSec)} sub={<Delta now={data.avgSessionSec} before={prev ? prev.avgSessionSec : null} days={days} />} />
            <Stat icon="exhibitions" label="Time in the galleries" value={formatDuration(totalDwell)} sub={<Delta now={totalDwell} before={prev?.dwell ?? null} days={days} />} />
            <Stat icon="home" label="Most time spent in" value={topZone ? zoneName(topZone.zone) : '–'} sub={topZone ? formatDuration(topZone.seconds) : 'No visits yet'} />
          </div>

          <div className="charts">
            <section className="card">
              <h2>Sessions per day</h2>
              <DailyChart daily={data.daily} />
            </section>
            <section className="card">
              <h2>Time spent per zone</h2>
              <HBars rows={data.zoneDwell.map((z) => ({ label: zoneName(z.zone), value: z.seconds, text: formatDuration(z.seconds) }))} empty="No time recorded in any zone yet." />
            </section>
          </div>

          <div className="charts" style={{ marginTop: 16 }}>
            <div>
              <h2 className="an-h2">Top items</h2>
              <DataTable
                rows={data.topItems}
                columns={columns}
                getRowId={(i) => `${i.itemKind}/${i.itemId}`}
                caption="Most viewed items"
                defaultSort={{ id: 'views', dir: 'desc' }}
                density="compact"
                empty={<EmptyState title="No item views yet" icon="analytics" as="h3" />}
                footer={data.topItems.length ? <div className="ui-table-foot">Top {data.topItems.length} items · {totalViews.toLocaleString()} views</div> : null}
              />
            </div>
            <section className="card">
              <h2>Graphics quality</h2>
              <HBars rows={data.quality.map((q) => ({ label: q.tier, value: q.count, text: `${q.count.toLocaleString()} ${q.count === 1 ? 'session' : 'sessions'}` }))} empty="No quality data yet." />
            </section>
          </div>
        </>
      )}
      <CuratorAnalytics />
    </>
  )
}

const prettyZone = (z: string) => (z ? z.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : 'Outside zones')

/** Column chart of sessions per day (SVG), with a hover tooltip per column. */
function DailyChart({ daily }: { daily: { date: string; sessions: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 600
  const H = 200
  const pad = { l: 32, r: 8, t: 12, b: 24 }
  const max = Math.max(...daily.map((d) => d.sessions), 1)
  const ticks = useMemo(() => niceTicks(max), [max])
  const top = ticks[ticks.length - 1]
  const n = daily.length
  const bw = (W - pad.l - pad.r) / Math.max(n, 1)
  const barW = Math.max(Math.min(bw - 2, 28), 1)
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top)
  const labelEvery = Math.ceil(n / 8)
  const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const total = daily.reduce((s, d) => s + d.sessions, 0)

  return (
    <div className="daily" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sessions per day: ${total.toLocaleString()} over ${n} days`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={pad.l - 6} y={y(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = pad.l + i * bw + (bw - barW) / 2
          const h = Math.max(y(0) - y(d.sessions), d.sessions > 0 ? 2 : 0)
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect className="hit" x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} />
              <path className={`col ${hover === i ? 'hover' : ''}`} d={roundedTop(x, y(0) - h, barW, h, Math.min(4, barW / 2))} />
              {i % labelEvery === 0 && (
                <text className="axis" x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle">
                  {fmt(d.date)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && daily[hover] && (
        <div className="chart-tip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: `${(y(daily[hover].sessions) / H) * 100}%` }}>
          {fmt(daily[hover].date)}: <strong>{daily[hover].sessions}</strong> {daily[hover].sessions === 1 ? 'session' : 'sessions'}
        </div>
      )}
    </div>
  )
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return ''
  const rr = Math.min(r, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

function niceTicks(max: number) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]
  const step = steps.find((s) => max / s <= 4) ?? Math.ceil(max / 4)
  const top = Math.max(Math.ceil(max / step), 1) * step
  const out: number[] = []
  for (let v = 0; v <= top; v += step) out.push(v)
  return out
}

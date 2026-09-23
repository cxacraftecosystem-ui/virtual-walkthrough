import { useEffect, useMemo, useState } from 'react'
import { api, type AnalyticsSummary } from '../api'
import { Skeleton, errMsg, formatDuration } from '../ui'
import { CuratorAnalytics } from './CuratorAnalytics'

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]
const KIND_TO_COLLECTION: Record<string, 'artworks' | 'exhibits' | 'infographics' | 'videos' | 'objects'> = {
  artwork: 'artworks',
  exhibit: 'exhibits',
  infographic: 'infographics',
  video: 'videos',
  object: 'objects',
}

export function AnalyticsPage() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [error, setError] = useState('')
  const [titles, setTitles] = useState<Record<string, string>>({})

  useEffect(() => {
    setData(null)
    api.summary(days).then(setData).catch((e) => setError(errMsg(e)))
  }, [days])

  useEffect(() => {
    api
      .content()
      .then((c) => {
        const t: Record<string, string> = {}
        for (const [kind, col] of Object.entries(KIND_TO_COLLECTION)) for (const it of c[col]) t[`${kind}/${it.id}`] = it.title
        setTitles(t)
      })
      .catch(() => undefined)
  }, [])

  const totalDwell = data?.zoneDwell.reduce((s, z) => s + z.seconds, 0) ?? 0
  const topZone = data?.zoneDwell[0]
  const totalViews = data?.topItems.reduce((s, i) => s + i.views, 0) ?? 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Anonymous visit statistics (random session ids only, no personal data).</p>
        </div>
        <span className="spacer" />
        <nav className="tabs" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.days} className={days === r.days ? 'tab active' : 'tab'} onClick={() => setDays(r.days)}>{r.label}</button>
          ))}
        </nav>
      </div>
      {error && <p className="alert">{error}</p>}
      {!data ? (
        !error && <Skeleton rows={5} />
      ) : (
        <>
          <div className="stats">
            <Stat label="Sessions" value={data.sessions.toLocaleString()} sub={`last ${data.days} days`} />
            <Stat label="Avg. session length" value={formatDuration(data.avgSessionSec)} sub="first to last event" />
            <Stat label="Total dwell in zones" value={formatDuration(totalDwell)} sub={`${data.zoneDwell.length} zones visited`} />
            <Stat label="Most time spent in" value={topZone ? prettyZone(topZone.zone) : '—'} sub={topZone ? formatDuration(topZone.seconds) : 'no data yet'} />
            <Stat label="Item views" value={totalViews.toLocaleString()} sub="top 20 items" />
          </div>

          <div className="charts">
            <section className="card">
              <h2>Daily sessions</h2>
              <DailyChart daily={data.daily} />
            </section>
            <section className="card">
              <h2>Time spent per zone</h2>
              <HBars rows={data.zoneDwell.map((z) => ({ label: prettyZone(z.zone), value: z.seconds, text: formatDuration(z.seconds) }))} empty="No zone dwell events yet" />
            </section>
          </div>

          <div className="charts" style={{ marginTop: 16 }}>
            <section className="card" style={{ padding: 0 }}>
              <h2 style={{ padding: '18px 18px 0' }}>Top items</h2>
              {data.topItems.length === 0 ? (
                <div className="empty">No item views yet</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Kind</th>
                        <th className="num">Views</th>
                        <th className="num">Dwell</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topItems.map((i) => (
                        <tr key={`${i.itemKind}/${i.itemId}`}>
                          <td>
                            <div>{titles[`${i.itemKind}/${i.itemId}`] ?? i.itemId}</div>
                            <div className="mono muted">{i.itemId}</div>
                          </td>
                          <td className="muted">{i.itemKind}</td>
                          <td className="num">{i.views.toLocaleString()}</td>
                          <td className="num">{formatDuration(i.dwellSec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="card">
              <h2>Graphics quality tiers</h2>
              <HBars rows={data.quality.map((q) => ({ label: q.tier, value: q.count, text: `${q.count} session${q.count === 1 ? '' : 's'}` }))} empty="No quality data yet" />
            </section>
          </div>
        </>
      )}
      <CuratorAnalytics />
    </>
  )
}

const prettyZone = (z: string) => z.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

/** Horizontal bars: single series, values in text ink, hover shows the exact value. */
function HBars({ rows, empty }: { rows: { label: string; value: number; text: string }[]; empty: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label} title={`${r.label}: ${r.text}`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="v">{r.text}</span>
        </div>
      ))}
    </div>
  )
}

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
  const bw = (W - pad.l - pad.r) / n
  const barW = Math.max(Math.min(bw - 2, 28), 1)
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top)
  const labelEvery = Math.ceil(n / 8)
  const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

  return (
    <div className="daily" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sessions per day">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={pad.l - 6} y={y(t) + 3} textAnchor="end">{t}</text>
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
                <text className="axis" x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle">{fmt(d.date)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: `${(y(daily[hover].sessions) / H) * 100}%` }}>
          {fmt(daily[hover].date)}: <strong>{daily[hover].sessions}</strong> session{daily[hover].sessions === 1 ? '' : 's'}
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

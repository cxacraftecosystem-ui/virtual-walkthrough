/**
 * Activity (#/activity, curator+): every change made through the admin, newest first — who, what and
 * when — for this museum.
 *
 * - Filters: what was changed (a kind of record, sent to the server), exhibition (server), and — over
 *   the entries loaded so far — the person and the kind of action. The screen says when a filter only
 *   looks at what is loaded.
 * - `#/activity?target=<kind>:<id>` shows one record's history (the "History" links elsewhere in the
 *   admin and on each entry here point at it); the filters stay in the address so it can be shared.
 * - Entries load 50 at a time as the list is scrolled (or with "Load more"), grouped by day, with
 *   relative times and links to the record where it still makes sense.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ROLE_LABEL, api, type AuditEntry, type Role, type User } from '../api'
import { useExhibitionList } from '../ExhibitionSwitcher'
import { Badge, Button, EmptyState, Icon, IconButton, PageHeader, Select, Skeleton, Tabs, errMsg, formatDate, formatRelative, type IconName } from '../ui'
import { hashQuery } from './triage'
import './operations.css'

const LIMIT = 50

/** Server-side record kinds (`target_kind`). */
const KINDS: { value: string; label: string; icon: IconName }[] = [
  { value: 'artworks', label: 'Artworks', icon: 'content' },
  { value: 'exhibits', label: 'Exhibits', icon: 'content' },
  { value: 'infographics', label: 'Infographics', icon: 'content' },
  { value: 'videos', label: 'Videos', icon: 'content' },
  { value: 'objects', label: 'Objects', icon: 'content' },
  { value: 'exhibition', label: 'Exhibitions', icon: 'exhibitions' },
  { value: 'artisan', label: 'Makers', icon: 'makers' },
  { value: 'media', label: 'Media', icon: 'media' },
  { value: 'print', label: 'Visitor prints', icon: 'prints' },
  { value: 'comment', label: 'Comments', icon: 'comments' },
  { value: 'error', label: 'Errors', icon: 'errors' },
  { value: 'user', label: 'Users', icon: 'users' },
  { value: 'access', label: 'Access list', icon: 'users' },
  { value: 'analytics', label: 'Analytics', icon: 'analytics' },
]
const KIND_OF = Object.fromEntries(KINDS.map((k) => [k.value, k]))
const SINGULAR: Record<string, string> = {
  artworks: 'artwork',
  exhibits: 'exhibit',
  infographics: 'infographic',
  videos: 'video',
  objects: 'object',
  exhibition: 'exhibition',
  artisan: 'maker',
  media: 'file',
  print: 'print',
  comment: 'comment',
  error: 'error',
  user: 'account',
  access: 'access entry',
}

/** Action groups (client-side, by the action's prefix). */
type Group = 'all' | 'content' | 'exhibition' | 'artisan' | 'media' | 'visitors' | 'errors' | 'access' | 'analytics'
const GROUPS: { id: Group; label: string; prefixes: string[] }[] = [
  { id: 'all', label: 'All', prefixes: [] },
  { id: 'content', label: 'Content', prefixes: ['content.'] },
  { id: 'exhibition', label: 'Exhibitions', prefixes: ['exhibition.'] },
  { id: 'artisan', label: 'Makers', prefixes: ['artisan.'] },
  { id: 'media', label: 'Media', prefixes: ['media.'] },
  { id: 'visitors', label: 'Prints & comments', prefixes: ['prints.', 'comments.'] },
  { id: 'errors', label: 'Errors', prefixes: ['errors.'] },
  { id: 'access', label: 'Users & access', prefixes: ['users.', 'access.'] },
  { id: 'analytics', label: 'Analytics', prefixes: ['analytics.'] },
]
const inGroup = (a: AuditEntry, g: Group) => g === 'all' || (GROUPS.find((x) => x.id === g)?.prefixes ?? []).some((p) => a.action.startsWith(p))

const VERB_TONE: Record<string, 'ok' | 'danger' | 'info' | 'neutral'> = { create: 'ok', upload: 'ok', restore: 'ok', delete: 'danger', reset: 'danger', cleanup: 'danger' }
const verbOf = (action: string) => action.split('.').pop() ?? action
const VERB_LABEL: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  delete: 'Deleted',
  restore: 'Restored',
  reset: 'Reset',
  upload: 'Uploaded',
  bulk: 'Bulk',
  status: 'Reviewed',
  hide: 'Hidden',
  unhide: 'Unhidden',
  resolve: 'Resolved',
  reopen: 'Reopened',
  role: 'Role',
  put: 'Added',
  default: 'Default',
  duplicate: 'Duplicated',
  tour: 'Tour',
  welcome: 'Welcome',
  exhibition: 'Texts',
  retention: 'Retention',
  cleanup: 'Clean-up',
}

/** Where an entry's record can be opened in the admin (deleted records still open their list). */
function targetHref(a: AuditEntry): string | null {
  const id = encodeURIComponent(a.targetId)
  const deleted = verbOf(a.action) === 'delete'
  switch (a.targetKind) {
    case 'artworks':
    case 'exhibits':
    case 'infographics':
    case 'videos':
    case 'objects':
      return a.targetId && !deleted ? `#/content/${a.targetKind}/${id}` : null
    case 'exhibition':
      return a.action === 'content.exhibition' || a.action === 'content.welcome' ? '#/content/texts' : '#/exhibitions'
    case 'artisan':
      return a.targetId && !deleted ? `#/makers/${id}` : '#/makers'
    case 'media':
      return a.targetId && !deleted ? `#/media/${id}` : null
    case 'print':
      return a.targetId && !deleted ? `#/prints/${id}` : '#/prints'
    case 'comment':
      return a.targetId && !deleted ? `#/comments/${id}` : '#/comments'
    case 'error':
      return a.targetId && !deleted ? `#/errors/${id}` : '#/errors'
    case 'user':
      return a.targetId ? `#/access/${id}` : '#/access'
    case 'access':
      return '#/access'
    case 'analytics':
      return '#/analytics'
    default:
      return null
  }
}

const dayKey = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function dayLabel(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Today'
  if (dayKey(iso) === dayKey(y.toISOString())) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const initials = (s: string | null) =>
  (s ?? '')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '·'

/** Filters as they sit in the address: #/activity?target=…&exhibition=…&actor=…&group=… */
interface Filters {
  target: string
  exhibition: string
  actor: string
  group: Group
}
function readFilters(): Filters {
  const p = hashQuery()
  const g = p.get('group') as Group | null
  return { target: p.get('target') ?? '', exhibition: p.get('exhibition') ?? '', actor: p.get('actor') ?? '', group: g && GROUPS.some((x) => x.id === g) ? g : 'all' }
}
function writeFilters(f: Filters) {
  const p = new URLSearchParams()
  if (f.target) p.set('target', f.target)
  if (f.exhibition) p.set('exhibition', f.exhibition)
  if (f.actor) p.set('actor', f.actor)
  if (f.group !== 'all') p.set('group', f.group)
  const s = p.toString()
  const hash = `#/activity${s ? `?${s}` : ''}`
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
}

export function ActivityPage(_props: { user?: User }) {
  const [filters, setFilters] = useState<Filters>(readFilters)
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const exhibitions = useExhibitionList()
  const gen = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)

  const update = (patch: Partial<Filters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch }
      writeFilters(next)
      return next
    })

  // the address is the source of truth when it changes from outside (a History link, back/forward)
  useEffect(() => {
    const onHash = () => {
      if (!window.location.hash.startsWith('#/activity')) return
      const f = readFilters()
      setFilters((cur) => (JSON.stringify(cur) === JSON.stringify(f) ? cur : f))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const { target, exhibition } = filters
  useEffect(() => {
    const g = ++gen.current
    setEntries(null)
    setError('')
    api
      .activity({ limit: LIMIT, target: target || undefined, exhibition: exhibition || undefined })
      .then((r) => {
        if (g !== gen.current) return
        setEntries(r.entries)
        setNextBefore(r.nextBefore)
      })
      .catch((e) => {
        if (g !== gen.current) return
        setError(errMsg(e))
        setEntries([])
        setNextBefore(null)
      })
  }, [target, exhibition])

  const more = useCallback(async () => {
    if (nextBefore === null || loadingMore) return
    const g = gen.current
    setLoadingMore(true)
    try {
      const r = await api.activity({ limit: LIMIT, before: nextBefore, target: target || undefined, exhibition: exhibition || undefined })
      if (g !== gen.current) return
      setEntries((cur) => [...(cur ?? []), ...r.entries])
      setNextBefore(r.nextBefore)
    } catch (e) {
      if (g === gen.current) setError(errMsg(e)) // keep what is shown
    } finally {
      setLoadingMore(false)
    }
  }, [nextBefore, loadingMore, target, exhibition])

  // load the next page as the end of the list comes into view
  useEffect(() => {
    const el = sentinel.current
    if (!el || nextBefore === null || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((list) => list.some((x) => x.isIntersecting) && void more(), { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, nextBefore, entries])

  const actors = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const a of entries ?? []) m.set(a.actorEmail ?? '', a.actorRole)
    if (filters.actor && !m.has(filters.actor)) m.set(filters.actor, null)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [entries, filters.actor])

  const clientFiltering = !!filters.actor || filters.group !== 'all'
  const shown = useMemo(
    () => (entries ?? []).filter((a) => (!filters.actor || (a.actorEmail ?? '') === filters.actor) && inGroup(a, filters.group)),
    [entries, filters.actor, filters.group],
  )
  const days = useMemo(() => {
    const out: { key: string; label: string; items: AuditEntry[] }[] = []
    for (const a of shown) {
      const k = dayKey(a.at)
      const last = out[out.length - 1]
      if (last && last.key === k) last.items.push(a)
      else out.push({ key: k, label: dayLabel(a.at), items: [a] })
    }
    return out
  }, [shown])

  const [tKind, ...tRest] = filters.target.split(':')
  const tId = tRest.join(':')
  const targetKindOnly = filters.target && !filters.target.includes(':') ? filters.target : ''
  const exTitle = (id: string | null) => (id ? exhibitions?.find((e) => e.id === id)?.title ?? id : null)

  return (
    <>
      <PageHeader icon="activity" title="Activity" description="Every change made in the admin for this museum — who, what and when." />

      <div className="toolbar ops-toolbar act-filters">
        <Select
          size="sm"
          value={targetKindOnly}
          onChange={(v) => update({ target: v })}
          clearable
          placeholder="Any record"
          options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
          aria-label="Record kind"
          disabled={!!tId}
        />
        <Select
          size="sm"
          value={filters.exhibition}
          onChange={(v) => update({ exhibition: v })}
          clearable
          placeholder="Every exhibition"
          options={(exhibitions ?? []).map((e) => ({ value: e.id, label: e.title }))}
          aria-label="Exhibition"
        />
        <Select
          size="sm"
          value={filters.actor}
          onChange={(v) => update({ actor: v })}
          clearable
          placeholder="Anyone"
          options={actors.map(([email, role]) => ({ value: email, label: email || 'Scheduled job', description: role ? ROLE_LABEL[role as Role] ?? role : undefined }))}
          aria-label="Person"
        />
      </div>
      <Tabs<Group> label="Kind of change" value={filters.group} onChange={(g) => update({ group: g })} tabs={GROUPS.map((g) => ({ id: g.id, label: g.label }))} className="ops-tabs act-groups" />

      {tId ? (
        <div className="note act-target" role="status">
          <Icon name={KIND_OF[tKind]?.icon ?? 'activity'} />
          <span className="grow">
            History of {SINGULAR[tKind] ?? tKind} <span className="mono">{tId}</span>
          </span>
          {(() => {
            const href = targetHref({ id: 0, at: '', actorEmail: null, actorRole: null, action: '', targetKind: tKind, targetId: tId, exhibitionId: null, summary: '' })
            return href ? <Button size="sm" href={href} icon="arrowRight">Open</Button> : null
          })()}
          <IconButton icon="close" size="sm" label="Show all activity" onClick={() => update({ target: '' })} />
        </div>
      ) : null}
      {clientFiltering && nextBefore !== null ? (
        <p className="small muted act-scope">Person and kind filters look at the {entries?.length ?? 0} entries loaded so far; scroll to load older ones.</p>
      ) : null}
      {error ? <p className="alert" role="alert">{entries && entries.length ? `Couldn’t load more: ${error}` : error}</p> : null}

      {entries === null ? (
        <div className="card"><Skeleton kind="list" rows={8} /></div>
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState icon="activity" title={entries.length ? 'Nothing matches these filters' : filters.target || filters.exhibition ? 'No changes recorded here' : 'Nothing recorded yet'}>
            {entries.length ? (nextBefore !== null ? 'Load older entries or loosen a filter.' : 'Loosen a filter to see more.') : filters.target || filters.exhibition ? undefined : 'Changes by staff appear here as they happen.'}
          </EmptyState>
          {entries.length && nextBefore !== null ? (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <Button size="sm" onClick={() => void more()} loading={loadingMore} loadingLabel="Loading…">Load older entries</Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card act-card">
          {days.map((d) => (
            <section key={d.key} className="act-day" aria-label={d.label}>
              <h2 className="act-day-h">{d.label}</h2>
              <ol className="feed act-feed">
                {d.items.map((a) => {
                  const href = targetHref(a)
                  const verb = verbOf(a.action)
                  const kind = KIND_OF[a.targetKind]
                  const ex = exTitle(a.exhibitionId)
                  const own = filters.target === `${a.targetKind}:${a.targetId}`
                  return (
                    <li key={a.id}>
                      <span className="feed-dot" aria-hidden="true" title={a.actorEmail ?? 'Scheduled job'}>{initials(a.actorEmail)}</span>
                      <div className="feed-text">
                        <div className="act-line">
                          {href ? <a href={href} className="act-summary">{a.summary}</a> : <span className="act-summary">{a.summary}</span>}
                          <Badge tone={VERB_TONE[verb] ?? 'neutral'}>{VERB_LABEL[verb] ?? verb}</Badge>
                        </div>
                        <div className="feed-meta">
                          <span>{a.actorEmail ?? 'Scheduled job'}</span>
                          {a.actorRole ? <span> · {ROLE_LABEL[a.actorRole as Role] ?? a.actorRole}</span> : null}
                          {' · '}
                          <time dateTime={a.at} title={formatDate(a.at)}>{formatRelative(a.at)}</time>
                          {kind ? <span> · {kind.label}</span> : null}
                          {ex && a.targetKind !== 'exhibition' ? <span> · {ex}</span> : null}
                          {a.targetId && !own ? (
                            <>
                              {' · '}
                              <a href={`#/activity?target=${encodeURIComponent(a.targetKind)}:${encodeURIComponent(a.targetId)}`} onClick={(e) => {
                                e.preventDefault()
                                update({ target: `${a.targetKind}:${a.targetId}`, group: 'all', actor: '' })
                              }}>History</a>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
          <div ref={sentinel} className="act-more">
            {nextBefore !== null ? (
              <Button size="sm" onClick={() => void more()} loading={loadingMore} loadingLabel="Loading…">Load older entries</Button>
            ) : (
              <span className="muted small">{entries.length > LIMIT ? 'That’s everything recorded.' : ''}</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default ActivityPage

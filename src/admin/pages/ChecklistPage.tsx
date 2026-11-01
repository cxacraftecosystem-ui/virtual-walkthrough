/**
 * Checklist: what each item of the selected exhibition still lacks (placeholder flag, media, alt text,
 * translations, maker, placement), grouped by zone or by collection with progress bars, filters and
 * "jump to field" links, plus a CSV of what the workshop still needs to send.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ContentCollection } from '../../museum/content/types'
import { SITE } from '../../site'
import { api, type Item } from '../api'
import { currentExhibition, useExhibitionList } from '../ExhibitionSwitcher'
import { exApi, useSelectedExhibition } from '../exhibitionsApi'
import { ZONE_NAMES, itemZone } from '../fields'
import { Badge, Button, EmptyState, PageHeader, ProgressBar, SearchInput, Segmented, Select, Skeleton, errMsg, type SelectOption } from '../ui'
import { ISSUE_LABEL, itemIssues, type Issue, type IssueCode, type IssueOwner, type RefSets } from './content/completeness'
import { COLLECTIONS, contentHref, metaOf, titleOf } from './content/model'
import '../exhibitions.css'

type Entry = { collection: ContentCollection; item: Item; issues: Issue[]; zone: string | null }
type GroupBy = 'zone' | 'collection'

/** Local calendar date, yyyy-mm-dd (never toISOString, which is UTC). */
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const csvCell = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v)

export function ChecklistPage() {
  const exList = useExhibitionList()
  const selected = useSelectedExhibition()
  const ex = currentExhibition(exList, selected)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [groupBy, setGroupBy] = useState<GroupBy>('zone')
  const [who, setWho] = useState<'' | IssueOwner>('')
  const [code, setCode] = useState<'' | IssueCode>('')
  const [collection, setCollection] = useState<'' | ContentCollection>('')
  const [showDone, setShowDone] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    setError('')
    setEntries(null)
    ;(async () => {
      const [lists, artisans] = await Promise.all([Promise.all(COLLECTIONS.map((c) => api.list(c.id))), exApi.artisans().catch(() => null)])
      const by = Object.fromEntries(COLLECTIONS.map((c, i) => [c.id, lists[i]])) as Record<ContentCollection, Item[]>
      const refs: RefSets = {
        artisans: artisans ? new Set(artisans.map((a) => a.id)) : null,
        artworks: new Set(by.artworks.map((i) => i.id)),
        exhibits: new Set(by.exhibits.map((i) => i.id)),
      }
      const out: Entry[] = []
      for (const c of COLLECTIONS) for (const item of by[c.id]) out.push({ collection: c.id, item, issues: itemIssues(c.id, item, refs), zone: itemZone(item) })
      if (alive) setEntries(out)
    })().catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [reload])

  const issueMatches = (i: Issue) => (!who || i.who === who) && (!code || i.code === code)
  const visible = useMemo(() => {
    if (!entries) return null
    const q = query.trim().toLowerCase()
    return entries
      .filter((e) => !collection || e.collection === collection)
      .filter((e) => !q || e.item.id.toLowerCase().includes(q) || titleOf(e.item).toLowerCase().includes(q))
      .map((e) => ({ ...e, shownIssues: e.issues.filter(issueMatches) }))
      .filter((e) => showDone || e.shownIssues.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, collection, query, who, code, showDone])

  const groups = useMemo(() => {
    if (!entries || !visible) return []
    const keyOf = (e: Entry) => (groupBy === 'zone' ? (e.zone ?? '') : e.collection)
    const nameOf = (k: string) => (groupBy === 'zone' ? (k ? (ZONE_NAMES.get(k) ?? k) : 'No zone') : metaOf(k as ContentCollection).label)
    const map = new Map<string, { key: string; name: string; total: number; complete: number; rows: typeof visible }>()
    for (const e of entries) {
      if (collection && e.collection !== collection) continue
      const k = keyOf(e)
      const g = map.get(k) ?? { key: k, name: nameOf(k), total: 0, complete: 0, rows: [] }
      g.total++
      if (!e.issues.filter(issueMatches).length) g.complete++
      map.set(k, g)
    }
    for (const e of visible) map.get(keyOf(e))?.rows.push(e)
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, visible, groupBy, collection, who, code])

  const total = entries ? entries.filter((e) => !collection || e.collection === collection).length : 0
  const complete = entries ? entries.filter((e) => (!collection || e.collection === collection) && !e.issues.filter(issueMatches).length).length : 0
  const workshopRows = entries ? entries.flatMap((e) => e.issues.filter((i) => i.who === 'workshop').map((i) => ({ e, i }))) : []

  function downloadCsv() {
    if (!entries) return
    const head = ['Collection', 'Id', 'Title', 'Zone', 'Wall', 'Needed', 'Admin link']
    const origin = window.location.origin
    const lines = [head.join(',')]
    for (const { e, i } of workshopRows) {
      const surface = (e.item.placement as { surface?: string } | undefined)?.surface ?? ''
      lines.push(
        [metaOf(e.collection).label, e.item.id, titleOf(e.item), e.zone ? (ZONE_NAMES.get(e.zone) ?? e.zone) : '', surface, i.label, `${origin}/admin${contentHref(e.collection, e.item.id, i.field)}`]
          .map((v) => csvCell(String(v)))
          .join(','),
      )
    }
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${SITE.id}-${ex?.slug || ex?.id || 'exhibition'}-content-needed-${today()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const codeOptions: SelectOption[] = (Object.keys(ISSUE_LABEL) as IssueCode[]).map((c) => ({ value: c, label: ISSUE_LABEL[c] }))
  const collectionOptions: SelectOption[] = COLLECTIONS.map((c) => ({ value: c.id, label: c.label }))
  const filtered = !!(who || code || collection || query)

  return (
    <>
      <PageHeader
        title="Content checklist"
        icon="checklist"
        eyebrow={ex?.title}
        description="What each item of this exhibition still needs before it is complete."
        actions={
          <Button icon="file" onClick={downloadCsv} disabled={!entries || workshopRows.length === 0} title="A spreadsheet of what the workshop still needs to send">
            Download workshop list (CSV)
          </Button>
        }
      />
      {error ? (
        <div className="card">
          <EmptyState title="Couldn’t check the content" icon="alert" action={<Button onClick={() => setReload((n) => n + 1)}>Try again</Button>}>
            {error}
          </EmptyState>
        </div>
      ) : !entries ? (
        <Skeleton kind="page" rows={6} />
      ) : (
        <>
          <section className="card ck-summary" aria-label="Overall progress">
            <div className="row">
              <strong className="ck-big num">{total ? Math.round((complete / total) * 100) : 100}%</strong>
              <span className="muted">
                {complete.toLocaleString()} of {total.toLocaleString()} items complete{filtered ? ' for these filters' : ''} · {workshopRows.length.toLocaleString()} {workshopRows.length === 1 ? 'thing' : 'things'} to ask the workshop for
              </span>
            </div>
            <ProgressBar value={total ? (complete / total) * 100 : 100} label="Items complete" done={complete === total} />
          </section>

          <div className="toolbar ck-toolbar">
            <SearchInput value={query} onChange={setQuery} label="Search items" placeholder="Search items" />
            <Select size="sm" value={collection} onChange={(v) => setCollection(v as ContentCollection | "")} options={collectionOptions} placeholder="All collections" clearable aria-label="Collection" className="ct-filter" />
            <Select size="sm" value={code} onChange={(v) => setCode(v as IssueCode | "")} options={codeOptions} placeholder="Every gap" clearable aria-label="Kind of gap" className="ct-filter" />
            <Segmented<'' | IssueOwner>
              label="Who closes the gap"
              value={who}
              onChange={setWho}
              options={[
                { value: '', label: 'Everyone' },
                { value: 'workshop', label: 'Workshop' },
                { value: 'curator', label: 'Curator' },
              ]}
            />
            <span className="spacer" />
            <Segmented<GroupBy>
              label="Group by"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'zone', label: 'By zone' },
                { value: 'collection', label: 'By collection' },
              ]}
            />
            <Button size="sm" variant="ghost" aria-pressed={showDone} onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Hide complete items' : 'Show complete items'}
            </Button>
          </div>

          {groups.every((g) => g.rows.length === 0) ? (
            <div className="card">
              <EmptyState title={filtered ? 'Nothing matches these filters' : 'Everything is complete'} icon={filtered ? 'filter' : 'check'} as="h2">
                {filtered ? undefined : 'No item of this exhibition is missing anything checked here.'}
              </EmptyState>
            </div>
          ) : (
            groups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <section className="card ck-group" key={g.key || 'none'} aria-labelledby={`ck-${g.key || 'none'}`}>
                  <div className="ck-group-head">
                    <h2 id={`ck-${g.key || 'none'}`}>{g.name}</h2>
                    <span className="muted small num">
                      {g.complete} of {g.total} complete
                    </span>
                    <div className="ck-group-bar">
                      <ProgressBar value={g.total ? (g.complete / g.total) * 100 : 100} label={`${g.name}: items complete`} done={g.complete === g.total} />
                    </div>
                  </div>
                  <ul className="ck-list">
                    {g.rows.map((e) => (
                      <li key={`${e.collection}/${e.item.id}`}>
                        <div className="ck-item">
                          <a className="cell-title" href={contentHref(e.collection, e.item.id)}>
                            {titleOf(e.item)}
                          </a>
                          <span className="cell-sub">
                            {groupBy === 'zone' ? metaOf(e.collection).label : e.zone ? (ZONE_NAMES.get(e.zone) ?? e.zone) : 'No zone'} · <span className="mono">{e.item.id}</span>
                          </span>
                        </div>
                        {e.shownIssues.length ? (
                          <ul className="ck-issues">
                            {e.shownIssues.map((i, n) => (
                              <li key={n}>
                                <a href={contentHref(e.collection, e.item.id, i.field)} title="Open the item at this field">
                                  {i.label}
                                </a>
                                <Badge tone={i.who === 'workshop' ? 'warn' : 'neutral'}>{i.who === 'workshop' ? 'Workshop' : 'Curator'}</Badge>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <Badge tone="ok">Complete</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
          )}
        </>
      )}
    </>
  )
}

export default ChecklistPage

/**
 * Home (#/home, the landing page): a role-aware overview.
 * - Greeting and the exhibition being edited, with its status and how much of it still waits for
 *   content from the workshop (items marked placeholder vs all items).
 * - Tiles for what needs attention — prints waiting for a decision, comments this week, open errors,
 *   staff accounts — each shown only to roles that can open the page it links to.
 * - Quick actions, the latest activity (links to #/activity) and "Continue where you left off": the
 *   last five items edited in this browser (src/admin/recent.ts, written by ContentPage).
 * The shell owns the overview request (it also drives the nav badges) and passes it in.
 */
import { useEffect, useState } from 'react'
import { SITE } from '../../site'
import { can, ROLE_LABEL, type AuditEntry, type Overview, type User } from '../api'
import { useSelectedExhibition } from '../exhibitionsApi'
import { currentExhibition, useExhibitionList } from '../ExhibitionSwitcher'
import { RECENT_CHANGED, readRecent, type RecentItem } from '../recent'
import { Button, EmptyState, Icon, PageHeader, ProgressBar, Skeleton, Stat, StatusBadge, formatRelative, type IconName } from '../ui'

const TAB_LABEL: Record<string, string> = { artworks: 'Artwork', exhibits: 'Exhibit', infographics: 'Infographic', videos: 'Video', objects: 'Object', texts: 'Exhibition text' }

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
const firstName = (u: User) => (u.displayName || u.email.split('@')[0]).split(/\s+/)[0]
const initials = (s: string | null) =>
  (s ?? '?')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?'

function useRecentItems(exhibition: string) {
  const [items, setItems] = useState<RecentItem[]>(() => readRecent(exhibition))
  useEffect(() => {
    const load = () => setItems(readRecent(exhibition))
    load()
    window.addEventListener(RECENT_CHANGED, load)
    window.addEventListener('storage', load)
    return () => {
      window.removeEventListener(RECENT_CHANGED, load)
      window.removeEventListener('storage', load)
    }
  }, [exhibition])
  return items
}

export default function HomePage({ user, overview, error, onRefresh }: { user: User; overview: Overview | null; error?: string; onRefresh?: () => void }) {
  const selected = useSelectedExhibition()
  const list = useExhibitionList()
  const ex = currentExhibition(list, selected)
  // recent items are kept per exhibition id (recent.ts); '' while the default is not known yet
  const recentItems = useRecentItems(selected || (ex?.id ?? ''))
  const c = overview?.counts
  const isAdmin = can(user, 'admin')
  const exTitle = overview?.exhibition.title ?? ex?.title ?? SITE.defaultExhibitionTitle
  const exStatus = overview?.exhibition.status ?? ex?.status
  const items = c?.items ?? 0
  const placeholders = c?.placeholders ?? 0
  const ready = Math.max(0, items - placeholders)
  const pct = items ? (ready / items) * 100 : 0
  // nothing yet, and nothing on its way: the first overview request failed (the shell keeps retrying)
  const loading = overview === null && !error
  const failed = overview === null && !!error

  const tiles: { key: string; label: string; value: number | null | undefined; sub: string; icon: IconName; href: string; tone?: 'warn' | 'danger'; show: boolean }[] = [
    { key: 'prints', label: 'Prints to review', value: c?.pendingPrints, sub: c?.pendingPrints ? 'Waiting for a decision' : 'Nothing waiting', icon: 'prints', href: '#/prints', tone: c?.pendingPrints ? 'warn' : undefined, show: can(user, 'curator') },
    { key: 'checklist', label: 'Needs content', value: c ? placeholders : undefined, sub: placeholders ? 'Placeholders in this exhibition' : 'Every item has its content', icon: 'checklist', href: '#/checklist', show: can(user, 'curator') },
    { key: 'comments', label: 'Comments this week', value: c?.comments7d, sub: c?.hiddenComments ? `${c.hiddenComments} hidden in total` : 'Last 7 days', icon: 'comments', href: '#/comments', show: isAdmin },
    { key: 'errors', label: 'Open errors', value: c?.openErrors, sub: c?.errors24h ? `${c.errors24h} in the last 24 h` : 'None in the last 24 h', icon: 'errors', href: '#/errors', tone: c?.openErrors ? 'danger' : undefined, show: isAdmin },
    { key: 'users', label: 'Accounts', value: c?.users, sub: 'Visitors and staff', icon: 'users', href: '#/access', show: isAdmin },
  ]

  const actions: { label: string; href: string; icon: IconName; show: boolean }[] = [
    { label: 'New artwork', href: '#/content/artworks/+new', icon: 'plus', show: true },
    { label: 'New exhibit', href: '#/content/exhibits/+new', icon: 'plus', show: true },
    { label: 'Upload media', href: '#/media', icon: 'media', show: true },
    { label: 'Capture tools', href: '#/capture', icon: 'capture', show: true },
    { label: 'Exhibition texts', href: '#/content/texts', icon: 'content', show: true },
    { label: 'New exhibition', href: '#/exhibitions/+new', icon: 'exhibitions', show: isAdmin },
  ]

  return (
    <>
      <PageHeader
        eyebrow={`${ROLE_LABEL[user.role]} · ${SITE.shortName}`}
        title={`${greeting()}, ${firstName(user)}`}
        description={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={onRefresh ? <Button size="sm" icon="refresh" onClick={onRefresh}>Refresh</Button> : undefined}
      />
      {error ? <p className="alert" role="alert">Couldn’t refresh the overview: {error}</p> : null}

      {loading ? (
        <Skeleton kind="tiles" rows={4} />
      ) : (
        <div className="home-tiles">
          {tiles
            .filter((t) => t.show)
            .map((t) => (
              <Stat key={t.key} label={t.label} value={t.value === null || t.value === undefined ? '–' : t.value.toLocaleString()} sub={t.sub} icon={t.icon} tone={t.tone} href={t.href} />
            ))}
        </div>
      )}

      <div className="home-grid" style={{ marginTop: 16 }}>
        <div className="home-col">
          <section className="card ex-card" aria-labelledby="home-ex">
            <div className="ex-card-head">
              <div className="t">
                <span className="kicker">Editing exhibition</span>
                <h2 id="home-ex">{exTitle}</h2>
              </div>
              <span className="row">
                {exStatus ? <StatusBadge status={exStatus} /> : null}
                {ex?.isDefault ? <StatusBadge status="default" /> : null}
              </span>
            </div>
            <div className="ex-progress">
              <div className="row">
                <span>{c ? (items ? <><strong className="num">{ready}</strong> of <span className="num">{items}</span> items have their content</> : 'No items yet') : failed ? <span className="muted">Progress couldn’t be loaded.</span> : <span className="skel line" style={{ width: 200 }} aria-hidden="true" />}</span>
                <span className="muted num">{c && items ? `${Math.round(pct)}%` : ''}</span>
              </div>
              <ProgressBar value={pct} label="Items with their content" done={!!c && items > 0 && placeholders === 0} />
              {c && placeholders > 0 ? <span className="small muted">{placeholders} still marked as placeholders.</span> : null}
            </div>
            <div className="btn-row">
              <Button variant="primary" href="#/content" icon="content">Open content</Button>
              <Button href="#/checklist" icon="checklist">Checklist</Button>
              {ex?.path ? (
                <Button href={ex.path} target="_blank" rel="noreferrer" icon="external">
                  Preview<span className="sr-only"> (opens in a new tab)</span>
                </Button>
              ) : null}
            </div>
          </section>

          <section className="card" aria-labelledby="home-activity">
            <div className="card-head">
              <h2 id="home-activity">Recent activity</h2>
              <a className="small" href="#/activity">All activity</a>
            </div>
            {loading ? (
              <Skeleton kind="list" rows={4} />
            ) : !overview ? (
              <EmptyState
                title="Couldn’t load recent activity"
                icon="activity"
                as="h3"
                action={onRefresh ? <Button size="sm" icon="refresh" onClick={onRefresh}>Try again</Button> : undefined}
              >
                {error}
              </EmptyState>
            ) : overview.recent.length === 0 ? (
              <EmptyState title="Nothing recorded yet" icon="activity" as="h3">Changes by staff appear here.</EmptyState>
            ) : (
              <ul className="feed">
                {overview.recent.map((a: AuditEntry) => (
                  <li key={a.id}>
                    <span className="feed-dot" aria-hidden="true">{initials(a.actorEmail)}</span>
                    <div className="feed-text">
                      {a.summary}
                      <div className="feed-meta">
                        {a.actorEmail ?? 'System'} · <time dateTime={a.at} title={new Date(a.at).toLocaleString()}>{formatRelative(a.at)}</time>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="home-col">
          <section className="card" aria-labelledby="home-continue">
            <div className="card-head">
              <h2 id="home-continue">Continue where you left off</h2>
            </div>
            {recentItems.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Items you open in Content appear here.</p>
            ) : (
              <ul className="continue-list">
                {recentItems.map((r) => (
                  <li key={`${r.tab}/${r.id}`}>
                    <a href={`#/content/${r.tab}/${encodeURIComponent(r.id)}`}>
                      <Icon name={r.tab === 'texts' ? 'content' : 'edit'} width={16} height={16} style={{ color: 'rgb(var(--ink-300))', flex: 'none' }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{r.title}</span>
                        <span className="ct-kind">{TAB_LABEL[r.tab] ?? r.tab} · {formatRelative(r.at)}</span>
                      </span>
                      <Icon name="chevronRight" width={16} height={16} style={{ color: 'rgb(var(--ink-300))', flex: 'none' }} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="home-actions">
            <div className="card-head">
              <h2 id="home-actions">Quick actions</h2>
            </div>
            <div className="quick-actions">
              {actions
                .filter((a) => a.show)
                .map((a) => (
                  <Button key={a.href} href={a.href} icon={a.icon}>{a.label}</Button>
                ))}
            </div>
            <p className="small muted" style={{ margin: '12px 0 0' }}>
              Press <kbd>Ctrl</kbd> <kbd>K</kbd> to find any page, item, maker or file.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}

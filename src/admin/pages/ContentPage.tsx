/**
 * Content: everything a visitor sees in the galleries, per exhibition (the sidebar switcher).
 * Address `#/content/<tab>[/<id>][?field=<path>]`: a collection list, an item editor, the
 * exhibition texts or the trash. Modules live in ./content/.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContentCollection } from '../../museum/content/types'
import { ApiError, api, type ContentStamp } from '../api'
import { currentExhibition, useExhibitionList } from '../ExhibitionSwitcher'
import { useSelectedExhibition } from '../exhibitionsApi'
import { Button, PageHeader, Tabs, errMsg, useConfirm, useConfirmLeave, useToast, type TabItem } from '../ui'
import { CollectionView } from './content/CollectionView'
import { COLLECTIONS, contentHref, metaOf, readContentHash, useMuseumBase, type ContentAddress, type Tab } from './content/model'
import { ContentRefsProvider } from './content/refs'
import { makeExpectedFor, mergeStamps, type Stamps } from './content/stamps'
import { TextsEditor } from './content/TextsEditor'
import { TrashView } from './content/TrashView'
import '../exhibitions.css'

/** `canReset`: admins only (curators edit items but cannot bulk-reset). */
export function ContentPage({ canReset = false }: { canReset?: boolean }) {
  // only rendered client-side (after the session check), so the hash is readable on first render
  const [addr, setAddr] = useState<ContentAddress>(() => readContentHash())
  const [counts, setCounts] = useState<Partial<Record<ContentCollection, number>>>({})
  const [version, setVersion] = useState<number | null>(null)
  const [stamps, setStamps] = useState<Stamps | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const exhibition = useSelectedExhibition()
  const exList = useExhibitionList()
  /**
   * The exhibition being edited, by id: the selection, or (selection '' = the default) whichever is the
   * default now. Local drafts and recent items are kept under it, so a later change of default never offers
   * one exhibition's edits in another. undefined while the list loads; null when it could not be read
   * (drafts are then not kept).
   */
  const exhibitionId = exhibition || (exList === null ? undefined : (currentExhibition(exList, '')?.id ?? null))
  const museumBase = useMuseumBase()
  const toast = useToast()
  const confirm = useConfirm()
  const leave = useConfirmLeave()
  const addrRef = useRef(addr)
  useEffect(() => {
    addrRef.current = addr
  })

  const refreshMeta = useCallback(() => {
    api
      .content()
      .then((c) => {
        setVersion(c.version)
        setCounts({ artworks: c.artworks.length, exhibits: c.exhibits.length, infographics: c.infographics.length, videos: c.videos.length, objects: c.objects.length })
      })
      .catch(() => undefined)
  }, [])
  // Stamps guard every write (stamps.ts). A failed load leaves them null (never {}: that would send writes
  // unguarded); a write then fetches them again before it is sent.
  const stampsRef = useRef<Stamps | null>(null)
  useEffect(() => {
    stampsRef.current = stamps
  })
  const stampsLoad = useRef<Promise<Stamps> | null>(null)
  const loadStamps = useCallback((): Promise<Stamps> => {
    stampsLoad.current ??= api
      .contentStamps()
      .then((r) => {
        const merged = mergeStamps(stampsRef.current, r.stamps)
        stampsRef.current = merged
        setStamps(merged)
        return merged
      })
      .finally(() => {
        stampsLoad.current = null
      })
    return stampsLoad.current
  }, [])
  const refreshStamps = useCallback(() => void loadStamps().catch(() => undefined), [loadStamps])
  const expectedFor = useMemo(() => makeExpectedFor(() => stampsRef.current, loadStamps, (body) => new ApiError(409, body.message, body)), [loadStamps])
  useEffect(() => {
    refreshMeta()
    refreshStamps()
  }, [refreshMeta, refreshStamps, resetKey])

  const onStamp = useCallback((key: string, stamp: ContentStamp | null) => {
    setStamps((s) => {
      const next = { ...(s ?? {}) }
      if (stamp) next[key] = stamp
      else delete next[key]
      return next
    })
  }, [])

  /** Move within the page; asks first when an edit would be lost (unless the caller already did). */
  const go = useCallback(
    async (next: ContentAddress, opts: { replace?: boolean; force?: boolean } = {}) => {
      if (!opts.force && !(await leave())) return
      const h = contentHref(next.tab, next.id, next.field)
      if (window.location.hash !== h) window.history[opts.replace ? 'replaceState' : 'pushState'](null, '', h)
      setAddr(next)
      if (!opts.replace) document.querySelector('.adm-root')?.scrollTo({ top: 0 })
    },
    [leave],
  )
  const navigateItem = useCallback(
    (id: string | null, opts?: { replace?: boolean; force?: boolean }) => void go({ tab: addrRef.current.tab, id, field: null }, opts),
    [go],
  )

  // Back / Forward and plain links inside the page
  useEffect(() => {
    const onHash = async () => {
      const h = window.location.hash
      if (!/^#\/?content(\/|$|\?)/.test(h)) return // leaving the page: the shell guards that
      const next = readContentHash(h)
      const cur = addrRef.current
      if (next.tab === cur.tab && next.id === cur.id) return setAddr(next)
      const prev = contentHref(cur.tab, cur.id, cur.field)
      window.history.pushState(null, '', prev) // keep the old address while asking
      if (await leave()) {
        window.history.replaceState(null, '', h)
        setAddr(next)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [leave])

  async function reset() {
    const ok = await confirm({
      title: 'Reset all content of this exhibition?',
      body: 'Every artwork, exhibit, panel, video, object and text goes back to the museum’s default content. Replaced items stay in the trash.',
      confirmLabel: 'Reset content',
      danger: true,
      typeToConfirm: 'reset',
    })
    if (!ok) return
    try {
      await api.reset()
      toast('Content reset to the defaults')
      setResetKey((k) => k + 1)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const tabs: TabItem<Tab>[] = [
    ...COLLECTIONS.map((c) => ({ id: c.id as Tab, label: c.label, count: counts[c.id] ?? null })),
    { id: 'texts', label: 'Exhibition & welcome' },
    { id: 'trash', label: 'Trash' },
  ]
  const editing = addr.tab !== 'texts' && addr.tab !== 'trash' && !!addr.id && addr.id !== '+new'

  return (
    <ContentRefsProvider key={resetKey}>
      <PageHeader
        title="Content"
        eyebrow={editing ? metaOf(addr.tab as ContentCollection).label : undefined}
        back={editing ? { href: contentHref(addr.tab), label: `Back to ${metaOf(addr.tab as ContentCollection).label.toLowerCase()}`, onClick: () => navigateItem(null) } : undefined}
        description={
          <>
            What visitors see in the galleries. Saved changes reach new visits straight away
            {version !== null ? (
              <>
                {' '}
                · content version <span className="num">{version}</span>
              </>
            ) : null}
            .
          </>
        }
        actions={
          canReset && !editing ? (
            <Button variant="danger" size="sm" onClick={() => void reset()}>
              Reset to defaults…
            </Button>
          ) : undefined
        }
      />
      {!editing ? <Tabs className="subtabs" label="Collections" tabs={tabs} value={addr.tab} onChange={(t) => t !== addr.tab && void go({ tab: t, id: null, field: null })} /> : null}
      {addr.tab === 'texts' ? (
        <TextsEditor key={`texts-${resetKey}`} onSaved={refreshMeta} />
      ) : addr.tab === 'trash' ? (
        <TrashView
          key={`trash-${resetKey}`}
          onRestored={() => {
            refreshMeta()
            refreshStamps()
          }}
        />
      ) : exhibitionId === undefined ? (
        <div className="card">
          <div className="skel-lines" aria-busy="true" aria-label="Loading">
            <span className="skel line title" />
            <span className="skel line" />
            <span className="skel line short" />
          </div>
        </div>
      ) : (
        <CollectionView
          key={`${addr.tab}-${resetKey}`}
          collection={addr.tab}
          address={addr}
          exhibitionId={exhibitionId}
          museumBase={museumBase}
          stamps={stamps}
          expectedFor={expectedFor}
          onStamp={onStamp}
          navigate={navigateItem}
          onCountChanged={refreshMeta}
        />
      )}
    </ContentRefsProvider>
  )
}

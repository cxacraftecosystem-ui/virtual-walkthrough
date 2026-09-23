import type { Metadata } from 'next'
import { connection } from 'next/server'
import type { ReactNode } from 'react'
import type { ArtworkConfig } from '../../src/museum/config/artworks'
import type { ExhibitConfig } from '../../src/museum/config/exhibits'
import type { InfographicConfig } from '../../src/museum/config/infographics'
import type { SceneObjectConfig } from '../../src/museum/config/objects'
import type { VideoConfig } from '../../src/museum/config/videos'
import { bcp47, isLang, LANGS, loc, translate, type DictKey, type Lang } from '../../src/museum/i18n/core'
import { groupByRoom, loadGuideContent, roomCount, type GuideContent, type RoomItems } from './guideData'
import { PrintButton } from './PrintButton'
import './guide.css'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const langOf = (v: string | string[] | undefined): Lang => {
  const l = first(v)
  return isLang(l) ? l : 'en'
}


export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const lang = langOf((await searchParams).lang)
  return {
    title: `${translate(lang, 'guide.title')} — Hand Block Printing`,
    description: translate(lang, 'guide.lede'),
    alternates: { languages: Object.fromEntries(LANGS.map((l) => [l.bcp47, `/guide?lang=${l.value}`])) },
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const paras = (text: string | undefined) =>
  (text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

function Paragraphs({ text, className }: { text: string | undefined; className?: string }) {
  return paras(text).map((p, i) => (
    <p key={i} className={className}>
      {p}
    </p>
  ))
}

function Facts({ facts }: { facts: [string, ReactNode | undefined][] }) {
  const shown = facts.filter(([, v]) => v !== undefined && v !== '')
  if (!shown.length) return null
  return (
    <dl className="guide-facts">
      {shown.map(([k, v]) => (
        <div key={k} className="guide-fact">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Alt({ lang, text }: { lang: Lang; text: string }) {
  return (
    <p className="guide-alt">
      <span className="guide-label">{translate(lang, 'guide.alt')}: </span>
      {text}
    </p>
  )
}

function Placeholder({ lang, on }: { lang: Lang; on: boolean | undefined }) {
  if (!on) return null
  return (
    <p className="guide-placeholder">
      <span aria-hidden="true">◌ </span>
      {translate(lang, 'guide.placeholder')}
    </p>
  )
}

const itemId = (kind: string, id: string) => `${kind}-${id}`.replace(/[^A-Za-z0-9_-]/g, '-')

interface Ctx {
  lang: Lang
  t: (key: DictKey, vars?: Record<string, string | number>) => string
  artworkTitle: (id: string | undefined) => { title: string; href: string } | undefined
  artisanName: (item: { artisan?: string; artisanId?: string }, localised: string | undefined) => string | undefined
}

function ArtworkItem({ a, ctx }: { a: ArtworkConfig; ctx: Ctx }) {
  const { lang, t } = ctx
  const title = str(loc(a, 'title', lang)) ?? a.id
  const alt = str(loc(a, 'alt', lang)) ?? title
  const context = str(loc(a, 'context', lang))
  const image = str(a.image)
  return (
    <article className="guide-item" id={itemId('artwork', a.id)} aria-labelledby={`${itemId('artwork', a.id)}-h`}>
      <div className="guide-item__body">
        <h4 id={`${itemId('artwork', a.id)}-h`}>{title}</h4>
        <Placeholder lang={lang} on={a.placeholder} />
        <Facts
          facts={[
            [t('info.tradition'), str(loc(a, 'tradition', lang))],
            [t('info.artisan'), ctx.artisanName(a, str(loc(a, 'artisan', lang)))],
            [t('info.region'), str(loc(a, 'region', lang))],
            [t('info.material'), str(loc(a, 'material', lang))],
            [t('info.technique'), str(loc(a, 'technique', lang))],
            [t('info.year'), str(a.year)],
          ]}
        />
        <Paragraphs text={str(loc(a, 'description', lang))} />
        {context && (
          <div className="guide-context">
            <p className="guide-label">{t('info.context')}</p>
            <Paragraphs text={context} />
          </div>
        )}
        <Alt lang={lang} text={alt} />
      </div>
      {image && (
        <figure className="guide-thumb">
          <img src={image} alt={alt} loading="lazy" decoding="async" width={240} height={240} />
        </figure>
      )}
    </article>
  )
}

function ExhibitItem({ e, ctx }: { e: ExhibitConfig; ctx: Ctx }) {
  const { lang, t } = ctx
  const title = str(loc(e, 'title', lang)) ?? e.id
  const printed = ctx.artworkTitle(e.artworkId)
  return (
    <article className="guide-item" id={itemId('exhibit', e.id)} aria-labelledby={`${itemId('exhibit', e.id)}-h`}>
      <div className="guide-item__body">
        <h4 id={`${itemId('exhibit', e.id)}-h`}>{title}</h4>
        <Placeholder lang={lang} on={e.placeholder} />
        <Facts
          facts={[
            [t('info.tradition'), str(loc(e, 'tradition', lang))],
            [t('info.artisan'), ctx.artisanName(e, str(loc(e, 'artisan', lang)))],
            [t('info.region'), str(loc(e, 'region', lang))],
            [t('info.material'), str(loc(e, 'material', lang))],
            [t('info.technique'), str(loc(e, 'technique', lang))],
          ]}
        />
        <Paragraphs text={str(loc(e, 'description', lang))} />
        {printed && (
          <p>
            <a href={printed.href}>{t('info.printsTextile', { title: printed.title })}</a>
          </p>
        )}
        <Alt lang={lang} text={str(loc(e, 'alt', lang)) ?? title} />
      </div>
    </article>
  )
}

function InfographicItem({ g, ctx }: { g: InfographicConfig; ctx: Ctx }) {
  const { lang, t } = ctx
  const title = str(loc(g, 'title', lang)) ?? g.id
  const kicker = str(loc(g, 'kicker', lang))
  const localSteps = lang !== 'en' ? g.i18n?.[lang]?.steps : undefined
  const steps = (Array.isArray(localSteps) && localSteps.length ? localSteps : Array.isArray(g.steps) ? g.steps : []).filter((s) => typeof s === 'string' && s.trim())
  const alt = str((g as { alt?: unknown }).alt)
  const hid = `${itemId('panel', g.id)}-h`
  return (
    <article className="guide-item" id={itemId('panel', g.id)} aria-labelledby={hid}>
      <div className="guide-item__body">
        {kicker && <p className="guide-kicker">{kicker}</p>}
        <h4 id={hid}>{title}</h4>
        <Placeholder lang={lang} on={g.placeholder} />
        <Paragraphs text={str(loc(g, 'body', lang))} />
        {steps.length > 0 && (
          <>
            <p className="guide-label" id={`${hid}-steps`}>
              {t('guide.steps')}
            </p>
            <ol className="guide-steps" aria-labelledby={`${hid}-steps`}>
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </>
        )}
        {alt && <Alt lang={lang} text={alt} />}
      </div>
    </article>
  )
}

function VideoItem({ v, ctx }: { v: VideoConfig; ctx: Ctx }) {
  const { lang } = ctx
  const title = str(loc(v, 'title', lang)) ?? v.id
  return (
    <article className="guide-item" id={itemId('film', v.id)} aria-labelledby={`${itemId('film', v.id)}-h`}>
      <div className="guide-item__body">
        <h4 id={`${itemId('film', v.id)}-h`}>{title}</h4>
        <Placeholder lang={lang} on={v.placeholder} />
        <Paragraphs text={str(loc(v, 'description', lang))} />
        <Alt lang={lang} text={str(loc(v, 'alt', lang)) ?? title} />
      </div>
    </article>
  )
}

function ObjectItem({ o, ctx }: { o: SceneObjectConfig; ctx: Ctx }) {
  const { lang } = ctx
  const title = str(loc(o, 'title', lang)) ?? o.id
  return (
    <article className="guide-item" id={itemId('object', o.id)} aria-labelledby={`${itemId('object', o.id)}-h`}>
      <div className="guide-item__body">
        <h4 id={`${itemId('object', o.id)}-h`}>{title}</h4>
        <Placeholder lang={lang} on={o.placeholder} />
        <Paragraphs text={str(loc(o, 'description', lang))} />
        <Alt lang={lang} text={str(loc(o, 'alt', lang)) ?? title} />
      </div>
    </article>
  )
}

function Group({ id, heading, children }: { id: string; heading: string; children: ReactNode[] }) {
  if (!children.length) return null
  return (
    <section className="guide-group" aria-labelledby={id}>
      <h3 id={id}>{heading}</h3>
      {children}
    </section>
  )
}

function Room({ room, ctx }: { room: RoomItems; ctx: Ctx }) {
  const { t } = ctx
  const z = room.zone
  const hid = `room-${z}-h`
  return (
    <section className="guide-room" id={`room-${z}`} aria-labelledby={hid}>
      <h2 id={hid}>{t(`zone.${z}` as DictKey)}</h2>
      {roomCount(room) === 0 && <p className="guide-empty">{t('guide.empty')}</p>}
      <Group id={`room-${z}-works`} heading={t('guide.works')}>
        {room.artworks.map((a) => (
          <ArtworkItem key={a.id} a={a} ctx={ctx} />
        ))}
      </Group>
      <Group id={`room-${z}-exhibits`} heading={t('guide.exhibits')}>
        {room.exhibits.map((e) => (
          <ExhibitItem key={e.id} e={e} ctx={ctx} />
        ))}
      </Group>
      <Group id={`room-${z}-panels`} heading={t('guide.panels')}>
        {room.infographics.map((g) => (
          <InfographicItem key={g.id} g={g} ctx={ctx} />
        ))}
      </Group>
      <Group id={`room-${z}-films`} heading={t('guide.films')}>
        {room.videos.map((v) => (
          <VideoItem key={v.id} v={v} ctx={ctx} />
        ))}
      </Group>
      <Group id={`room-${z}-objects`} heading={t('guide.objects')}>
        {room.objects.map((o) => (
          <ObjectItem key={o.id} o={o} ctx={ctx} />
        ))}
      </Group>
    </section>
  )
}

function makeCtx(lang: Lang, content: GuideContent): Ctx {
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(lang, key, vars)
  const artworks = new Map((content.artworks ?? []).map((a) => [a.id, a]))
  const artisans = new Map((Array.isArray(content.artisans) ? content.artisans : []).map((p) => [p.id, p]))
  return {
    lang,
    t,
    artworkTitle: (id) => {
      const a = id ? artworks.get(id) : undefined
      return a ? { title: str(loc(a, 'title', lang)) ?? a.id, href: `#${itemId('artwork', a.id)}` } : undefined
    },
    artisanName: (item, localised) => localised ?? (item.artisanId ? str(artisans.get(item.artisanId)?.name) : undefined),
  }
}

export default async function GuidePage({ searchParams }: { searchParams: SearchParams }) {
  const lang = langOf((await searchParams).lang)
  await connection() // content can change at any time: always render at request time
  const content = await loadGuideContent()
  const ctx = makeCtx(lang, content)
  const { t } = ctx
  const rooms = groupByRoom(content)
  const ex = content.exhibition
  const title = str(loc(ex, 'title', lang)) ?? 'Hand Block Printing'
  const kicker = str(loc(ex, 'kicker', lang))
  const subtitle = str(loc(ex, 'subtitle', lang))
  const intro = str(loc(ex, 'intro', lang))
  // the welcome heading falls back to the dictionary word (not the English title) in hi / bn
  const welcomeTitle = (lang === 'en' ? str(content.welcome?.title) : str(content.welcome?.i18n?.[lang]?.title)) ?? t('guide.welcome')
  const welcomeBody = str(loc(content.welcome, 'body', lang))
  const museumHref = lang === 'en' ? '/' : `/?lang=${lang}`

  return (
    <div className="guide-root" lang={bcp47(lang)}>
      <a className="guide-skip" href="#main">
        {translate(lang, 'guide.skip')}
      </a>
      <header className="guide-header">
        <div className="guide-bar">
          <a className="guide-back" href={museumHref}>
            <span aria-hidden="true">← </span>
            {t('guide.back')}
          </a>
          <nav className="guide-langs" aria-label={t('lang.choose')}>
            <ul>
              {LANGS.map((l) => (
                <li key={l.value}>
                  <a
                    href={`/guide?lang=${l.value}`}
                    lang={l.bcp47}
                    hrefLang={l.bcp47}
                    aria-current={l.value === lang ? 'page' : undefined}
                    className={l.value === lang ? 'is-current' : undefined}
                  >
                    {l.native}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <PrintButton label={t('guide.print')} />
        </div>
        <div className="guide-hero">
          <p className="guide-kicker">
            {t('guide.title')}
            {kicker ? ` · ${kicker}` : ''}
          </p>
          <h1>{title}</h1>
          {subtitle && <p className="guide-subtitle">{subtitle}</p>}
          <p className="guide-lede">{t('guide.lede')}</p>
        </div>
      </header>

      <nav className="guide-toc" aria-labelledby="guide-toc-h">
        <h2 id="guide-toc-h">{t('guide.contents')}</h2>
        <p className="guide-muted">{t('guide.rooms')}</p>
        <ol>
          <li>
            <a href="#welcome">{welcomeTitle}</a>
          </li>
          {rooms.map((r) => (
            <li key={r.zone}>
              <a href={`#room-${r.zone}`}>{t(`zone.${r.zone}` as DictKey)}</a>
            </li>
          ))}
        </ol>
      </nav>

      <main id="main" className="guide-main" tabIndex={-1}>
        <section className="guide-welcome" id="welcome" aria-labelledby="welcome-h">
          <h2 id="welcome-h">{welcomeTitle}</h2>
          <Paragraphs text={intro} className="guide-intro" />
          <Paragraphs text={welcomeBody} />
        </section>
        {rooms.map((r) => (
          <Room key={r.zone} room={r} ctx={ctx} />
        ))}
      </main>

      <footer className="guide-footer">
        <p>
          <a href={museumHref}>{t('guide.back')}</a>
        </p>
        {typeof content.version === 'number' && content.version > 0 && <p className="guide-muted">{t('guide.source', { v: content.version })}</p>}
      </footer>
    </div>
  )
}

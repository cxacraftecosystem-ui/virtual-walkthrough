/**
 * Admin → Capture tools: the real-content pipeline (see docs/CONTENT_CAPTURE.md).
 *  - Deep zoom: a large photograph of a work → DZI pyramid tiled in the browser (Web Worker) →
 *    parallel tile upload → assigned to an artwork's `deepZoom` ("Examine closely" viewer).
 *  - 3D scan import: Polycam / RealityScan glTF → optimised in the browser (glTF-Transform +
 *    meshoptimizer: weld, simplify, WebP textures, metres) → preview → upload → assigned to an
 *    exhibit's or scene object's `model`.
 * While a tool is tiling or uploading, leaving the page (or the tab) asks first. Replacing an item's
 * existing deep zoom or model asks first. The assignment re-reads the item and is guarded by its
 * stamp, so it never overwrites an edit made meanwhile.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type OpenSeadragon from 'openseadragon'
import type { ContentCollection } from '../../museum/content/types'
import { dziTileCount } from '../../museum/deepzoom/dzi'
import { api, isConflict, uploadMedia, type Item, type MediaConfig, type SavedItem } from '../api'
import { pyramidInfo } from '../pipeline/dziTiler'
import { createDeepZoom, type DeepZoomProgress } from '../pipeline/deepZoomUpload'
import { ModelPreview } from '../pipeline/ModelPreview'
import { runScanOptimize } from '../pipeline/runScan'
import { SCAN_DEFAULTS, type ScanResult, type ScanStats } from '../pipeline/scanOptimize'
import { safeUrl } from '../safeUrl'
import { Badge, Button, ButtonRow, Combobox, Field, Icon, Input, PageHeader, ProgressBar, Select, errMsg, formatBytes, useConfirm, useToast, useUnsavedGuard, type ComboOption } from '../ui'
import { titleOf } from './content/model'
import '../pipeline/capture.css'

export function CapturePage() {
  const [cfg, setCfg] = useState<MediaConfig | null>(null)
  useEffect(() => {
    api.mediaConfig().then(setCfg).catch(() => undefined)
  }, [])
  return (
    <>
      <PageHeader
        title="Capture tools"
        icon="capture"
        description="Turn workshop photographs and phone scans into museum-ready media. Files are prepared in this browser, then uploaded to the media library."
      />
      <div className="cap-grid">
        <DeepZoomTool />
        <ScanTool cfg={cfg} />
      </div>
    </>
  )
}

/** Re-read the item and save `patch` of it, guarded by its current stamp. */
async function assignTo(c: ContentCollection, id: string, patch: (fresh: Item) => Item): Promise<SavedItem> {
  const [list, stamps] = await Promise.all([api.list(c), api.contentStamps().catch(() => ({ stamps: {} as Record<string, { updatedAt: string }> }))])
  const fresh = list.find((i) => i.id === id)
  if (!fresh) throw new Error('This item no longer exists in the exhibition.')
  try {
    return await api.put(c, patch(fresh), { expectedUpdatedAt: stamps.stamps[`${c}/${id}`]?.updatedAt })
  } catch (e) {
    if (isConflict(e)) throw new Error('Someone saved this item a moment ago. press the button again to assign the file to the latest version.', { cause: e })
    throw e
  }
}

const itemOptions = (items: Item[], has: (i: Item) => string | null): ComboOption[] =>
  items.map((i) => {
    const note = has(i)
    return { value: i.id, label: titleOf(i), description: note ? `${i.id} · ${note}` : i.id, thumb: typeof i.image === 'string' && i.image ? safeUrl(i.image, 'image') : undefined }
  })

/** A file choice drawn as the dashed "add here" trigger. */
function FilePick({ label, accept, multiple, disabled, onFiles, chosen }: { label: string; accept: string; multiple?: boolean; disabled?: boolean; onFiles: (f: File[]) => void; chosen?: string }) {
  const id = useId()
  return (
    <div className="field span-all">
      <span className="field-label" id={`${id}-l`}>{label}</span>
      <div className="row">
        <label className={`file-trigger${disabled ? ' is-disabled' : ''}`} htmlFor={id}>
          <Icon name="file" />
          {multiple ? 'Choose files' : 'Choose a file'}
          <input
            id={id}
            type="file"
            className="sr-only"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            aria-labelledby={`${id}-l`}
            onChange={(e) => {
              onFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </label>
        {chosen ? <span className="small muted">{chosen}</span> : null}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Deep zoom                                                           */
/* ================================================================== */

function DeepZoomTool() {
  const [artworks, setArtworks] = useState<Item[] | null>(null)
  const [target, setTarget] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [format, setFormat] = useState<'jpg' | 'webp'>('jpg')
  const [quality, setQuality] = useState(0.85)
  const [widthCm, setWidthCm] = useState('')
  const [progress, setProgress] = useState<DeepZoomProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [thumb, setThumb] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const toast = useToast()
  const confirm = useConfirm()
  useUnsavedGuard(busy)

  useEffect(() => {
    api
      .list('artworks')
      .then((l) => {
        setArtworks(l)
        setTarget((t) => t || (l.find((a) => a.hero === true)?.id ?? l[0]?.id ?? ''))
      })
      .catch((e) => setError(errMsg(e)))
  }, [])

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setThumb(url)
    let alive = true
    createImageBitmap(file)
      .then((b) => {
        if (alive) setDims({ w: b.width, h: b.height })
        b.close()
      })
      .catch(() => alive && setError('This browser can’t open this image. Use a JPEG, PNG or WebP file.'))
    return () => {
      alive = false
      URL.revokeObjectURL(url)
    }
  }, [file])

  const current = artworks?.find((a) => a.id === target)
  /** The object URL of the chosen file; checked like any other address before it reaches <img src>. */
  const safeThumb = safeUrl(thumb, 'image')
  const estimate = useMemo(() => (dims ? dziTileCount(pyramidInfo(dims.w, dims.h, { format })) : 0), [dims, format])
  const options = useMemo(() => itemOptions(artworks ?? [], (a) => (a.deepZoom ? 'has deep zoom' : null)), [artworks])
  const cmErr = widthCm.trim() && !(Number(widthCm) > 0) ? 'Enter a width in centimetres.' : ''

  async function start() {
    if (!file || !current || cmErr) return
    if (typeof current.deepZoom === 'string' && current.deepZoom) {
      const ok = await confirm({
        title: `Replace the deep zoom of “${titleOf(current)}”?`,
        body: 'Its current zoomable image is swapped for the new one. The old tiles stay in the media library.',
        confirmLabel: 'Replace deep zoom',
        tone: 'warning',
      })
      if (!ok) return
    }
    setBusy(true)
    setError('')
    setResult(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const rec = await createDeepZoom(file, { format, quality, signal: ctrl.signal }, setProgress)
      setResult(rec.url)
      const cm = Number(widthCm)
      const saved = await assignTo('artworks', current.id, (fresh) => {
        const next: Item = { ...fresh, deepZoom: rec.url }
        if (widthCm.trim() && Number.isFinite(cm) && cm > 0) next.physicalWidth = Math.round(cm) / 100
        return next
      })
      setArtworks((l) => (l ?? []).map((a) => (a.id === saved.id ? saved : a)))
      toast(`Deep zoom ready and assigned to “${titleOf(saved)}”`)
    } catch (e) {
      setError((e as Error).name === 'AbortError' ? 'Cancelled.' : errMsg(e))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const pct = (n: number) => (progress && progress.total ? Math.round((n / progress.total) * 100) : 0)
  return (
    <section className="card cap-tool" aria-labelledby="dz-title">
      <div className="cap-head">
        <h2 id="dz-title">Deep zoom</h2>
        <p className="muted small">
          A large photograph of a work becomes a zoomable image for the visitor’s “Examine closely” viewer. Use the full-resolution file from the camera or stitching software: 6,000–16,000 px is ideal.
        </p>
      </div>

      <div className="grid-2">
        <Field group label="Artwork" required className="span-all" hint={typeof current?.deepZoom === 'string' && current.deepZoom ? <span className="mono">Has a deep zoom: {current.deepZoom}</span> : undefined}>
          {(w) => <Combobox {...w} value={target} options={options} onChange={(v) => setTarget(v)} disabled={busy || !artworks} placeholder={artworks ? 'Search artworks…' : 'Loading…'} />}
        </Field>
        <FilePick
          label="Photograph (JPEG, PNG or WebP)"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          chosen={file ? `${file.name} · ${formatBytes(file.size)}` : undefined}
          onFiles={(f) => {
            setFile(f[0] ?? null)
            setDims(null)
            setProgress(null)
            setResult(null)
            setError('')
          }}
        />
        <Field group label="Tile format">
          {(w) => (
            <Select
              {...w}
              value={format}
              onChange={(v) => setFormat(v as 'jpg' | 'webp')}
              disabled={busy}
              options={[
                { value: 'jpg', label: 'JPEG', description: 'Works everywhere' },
                { value: 'webp', label: 'WebP', description: 'Smaller; not for very old Safari' },
              ]}
            />
          )}
        </Field>
        <Field label={`Quality · ${Math.round(quality * 100)}`}>
          <input type="range" min={0.6} max={0.95} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={busy} />
        </Field>
        <Field
          label="Physical width of the work (cm)"
          className="span-all"
          error={cmErr || undefined}
          hint="Optional. Edge to edge of the photographed area: adds a centimetre scale to the viewer and hangs the work at true size."
        >
          <Input type="number" inputMode="decimal" min={1} step={0.5} placeholder={current?.physicalWidth ? String(Number(current.physicalWidth) * 100) : 'e.g. 112'} value={widthCm} onChange={(e) => setWidthCm(e.target.value)} disabled={busy} />
        </Field>
      </div>

      {file && (
        <div className="cap-file">
          {safeThumb && <img src={safeThumb} alt="" />}
          <div className="small">
            <strong>{file.name}</strong> · {formatBytes(file.size)}
            {dims && (
              <>
                <br />
                {dims.w.toLocaleString()} × {dims.h.toLocaleString()} px ({((dims.w * dims.h) / 1e6).toFixed(1)} MP) → about {estimate.toLocaleString()} tiles{' '}
                {Math.max(dims.w, dims.h) > 16384 && <Badge tone="warn">Reduced to 16,384 px</Badge>}
                {Math.max(dims.w, dims.h) < 3000 && <Badge tone="warn">Low resolution for deep zoom</Badge>}
              </>
            )}
          </div>
        </div>
      )}

      {progress && (
        <div className="cap-progress" aria-live="polite">
          <div className="upload-row">
            <span>Tiling{progress.phase === 'decoding' ? ' (reading the image…)' : ''}</span>
            <ProgressBar value={pct(progress.tilesMade)} label="Tiling" done={pct(progress.tilesMade) === 100} />
            <span className="muted num">{pct(progress.tilesMade)}%</span>
          </div>
          <div className="upload-row">
            <span>
              Uploading {progress.tilesUploaded.toLocaleString()} / {progress.total.toLocaleString()} · {formatBytes(progress.bytes)}
            </span>
            <ProgressBar value={pct(progress.tilesUploaded)} label="Uploading" done={progress.phase === 'done'} />
            <span className="muted num">{progress.phase === 'done' ? 'Done' : progress.phase === 'finishing' ? '…' : `${pct(progress.tilesUploaded)}%`}</span>
          </div>
          {progress.scaled && progress.info && (
            <p className="muted small">
              Reduced from {progress.originalWidth} × {progress.originalHeight} px to {progress.info.width} × {progress.info.height} px (the browser’s limit).
            </p>
          )}
        </div>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
      {busy ? <p className="muted small">Keep this tab open until it finishes.</p> : null}

      <ButtonRow align="start">
        <Button variant="primary" onClick={() => void start()} disabled={!file || !dims || !current || !!cmErr} loading={busy} loadingLabel="Working…">
          Create deep zoom and assign
        </Button>
        {busy && (
          <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        )}
      </ButtonRow>

      {result && <DziPreview url={result} />}
    </section>
  )
}

function DziPreview({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let viewer: OpenSeadragon.Viewer | null = null
    let cancelled = false
    void import('openseadragon').then((mod) => {
      const OSD = ((mod as unknown as { default?: typeof OpenSeadragon }).default ?? mod) as typeof OpenSeadragon
      if (cancelled || !host.current) return
      viewer = OSD({ element: host.current, tileSources: url, showNavigationControl: false, crossOriginPolicy: 'Anonymous', maxZoomPixelRatio: 2 })
    })
    return () => {
      cancelled = true
      viewer?.destroy()
    }
  }, [url])
  return (
    <div className="cap-dzi">
      <div ref={host} className="cap-dzi-stage" />
      <div className="mono muted small" style={{ padding: '6px 2px' }}>{url}</div>
    </div>
  )
}

/* ================================================================== */
/* 3D scan import                                                      */
/* ================================================================== */

type Target = 'exhibits' | 'objects'

function ScanTool({ cfg }: { cfg: MediaConfig | null }) {
  const [files, setFiles] = useState<File[]>([])
  const [target, setTarget] = useState<Target>('exhibits')
  const [items, setItems] = useState<Item[] | null>(null)
  const [itemId, setItemId] = useState('')
  const [tris, setTris] = useState(SCAN_DEFAULTS.targetTriangles)
  const [maxTex, setMaxTex] = useState(SCAN_DEFAULTS.maxTexture)
  const [heightCm, setHeightCm] = useState('')
  const [upAxis, setUpAxis] = useState<'y' | 'z'>('y')
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const toast = useToast()
  const confirm = useConfirm()
  useUnsavedGuard(busy)

  useEffect(() => {
    let alive = true
    setItems(null)
    api
      .list(target)
      .then((l) => {
        if (!alive) return
        setItems(l)
        setItemId(l[0]?.id ?? '')
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [target])

  const glbUrl = useMemo(() => (result ? URL.createObjectURL(new Blob([result.glb as BlobPart], { type: 'model/gltf-binary' })) : null), [result])
  useEffect(() => () => void (glbUrl && URL.revokeObjectURL(glbUrl)), [glbUrl])
  const options = useMemo(() => itemOptions(items ?? [], (i) => (i.model ? 'has a model' : null)), [items])

  const baseName = (files.find((f) => /\.(glb|gltf)$/i.test(f.name))?.name ?? 'scan').replace(/\.(glb|gltf)$/i, '')
  const hErr = heightCm.trim() && !(Number(heightCm) > 0) ? 'Enter a height in centimetres.' : ''

  async function optimise() {
    if (hErr) return
    setBusy(true)
    setError('')
    setResult(null)
    setUploadPct(null)
    setLog([])
    try {
      const h = Number(heightCm)
      const r = await runScanOptimize(
        files,
        { ...SCAN_DEFAULTS, targetTriangles: tris, maxTexture: maxTex, height: heightCm.trim() && h > 0 ? h / 100 : 0, upAxis },
        (m) => setLog((l) => [...l, m]),
      )
      setResult(r)
      setLog((l) => [...l, 'Done.'])
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function uploadAndAssign() {
    if (!result || !cfg) return
    const item = items?.find((i) => i.id === itemId)
    if (!item) return
    if (typeof item.model === 'string' && item.model) {
      const ok = await confirm({
        title: `Replace the 3D model of “${titleOf(item)}”?`,
        body: 'Its current model is swapped for this one. The old file stays in the media library.',
        confirmLabel: 'Replace model',
        tone: 'warning',
      })
      if (!ok) return
    }
    setBusy(true)
    setError('')
    try {
      const file = new File([result.glb as BlobPart], `${baseName}-optimised.glb`, { type: 'model/gltf-binary' })
      const rec = await uploadMedia(file, 'models', cfg, setUploadPct)
      const saved = await assignTo(target, item.id, (fresh) => {
        const next: Item = { ...fresh, model: rec.url, modelScale: 1 }
        if (target === 'objects') next.height = Math.round(result.after.size[1] * 1000) / 1000
        return next
      })
      setItems((l) => (l ?? []).map((i) => (i.id === saved.id ? saved : i)))
      toast(`Uploaded ${formatBytes(rec.size)} and assigned to “${titleOf(saved)}”`)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card cap-tool" aria-labelledby="scan-title">
      <div className="cap-head">
        <h2 id="scan-title">3D scan import</h2>
        <p className="muted small">
          Export from Polycam, RealityScan or Luma as <strong>glTF or GLB</strong> (for .gltf, choose the .gltf, .bin and texture files together). The model is cleaned, simplified, its textures resized and
          converted to WebP, and scaled to real metres.
        </p>
      </div>
      <div className="grid-2">
        <FilePick
          label="Scan files"
          accept=".glb,.gltf,.bin,.jpg,.jpeg,.png,.webp"
          multiple
          disabled={busy}
          chosen={files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatBytes(files.reduce((n, f) => n + f.size, 0))}` : undefined}
          onFiles={(f) => {
            setFiles(f)
            setResult(null)
            setError('')
            setLog([])
          }}
        />
        <Field group label="Triangle budget">
          {(w) => (
            <Select
              {...w}
              value={String(tris)}
              onChange={(v) => setTris(Number(v))}
              disabled={busy}
              options={[
                { value: '15000', label: '15k', description: 'Small object, phones' },
                { value: '40000', label: '40k', description: 'Hand-held object (recommended)' },
                { value: '80000', label: '80k', description: 'Large or intricate carving' },
                { value: '150000', label: '150k', description: 'Hero piece (high quality tier only)' },
              ]}
            />
          )}
        </Field>
        <Field group label="Largest texture">
          {(w) => (
            <Select
              {...w}
              value={String(maxTex)}
              onChange={(v) => setMaxTex(Number(v))}
              disabled={busy}
              options={[
                { value: '1024', label: '1024 px' },
                { value: '2048', label: '2048 px', description: 'Recommended' },
                { value: '4096', label: '4096 px', description: 'Heavy' },
              ]}
            />
          )}
        </Field>
        <Field label="Real height (cm)" error={hErr || undefined} hint="Measured with a ruler, lying as it will be shown. Empty: keep the scan’s units.">
          <Input type="number" inputMode="decimal" min={0.1} step={0.1} placeholder="e.g. 6.5" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} disabled={busy} />
        </Field>
        <Field group label="Up axis in the file">
          {(w) => (
            <Select
              {...w}
              value={upAxis}
              onChange={(v) => setUpAxis(v as 'y' | 'z')}
              disabled={busy}
              options={[
                { value: 'y', label: 'Y up', description: 'glTF standard: Polycam, RealityScan' },
                { value: 'z', label: 'Z up', description: 'Rotated −90° about X' },
              ]}
            />
          )}
        </Field>
      </div>
      <ButtonRow align="start">
        <Button variant="primary" onClick={() => void optimise()} disabled={files.length === 0 || !!hErr} loading={busy && !result} loadingLabel="Optimising…">
          Optimise
        </Button>
        {result && glbUrl && (
          <Button variant="ghost" icon="file" href={glbUrl} download={`${baseName}-optimised.glb`}>
            Download .glb
          </Button>
        )}
      </ButtonRow>
      {log.length > 0 && <pre className="cap-log" aria-live="polite">{log.join('\n')}</pre>}
      {error && <p className="alert" role="alert">{error}</p>}

      {result && glbUrl && (
        <>
          <ModelPreview url={glbUrl} size={result.after.size} />
          <StatsTable before={result.before} after={result.after} />
          {result.warnings.length > 0 && (
            <ul className="cap-warn">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="group">
            <h3>Upload and assign</h3>
            <div className="grid-2">
              <Field group label="Assign to">
                {(w) => (
                  <Select
                    {...w}
                    value={target}
                    onChange={(v) => setTarget(v as Target)}
                    disabled={busy}
                    options={[
                      { value: 'exhibits', label: 'Exhibit' },
                      { value: 'objects', label: 'Object', description: 'Installation in a room' },
                    ]}
                  />
                )}
              </Field>
              <Field group label="Item" required>
                {(w) => <Combobox {...w} value={itemId} options={options} onChange={(v) => setItemId(v)} disabled={busy || !items} placeholder={items ? 'Search by title or id…' : 'Loading…'} />}
              </Field>
            </div>
            {uploadPct !== null && (
              <div className="upload-row" style={{ marginTop: 10 }} aria-live="polite">
                <span>Uploading {baseName}-optimised.glb</span>
                <ProgressBar value={uploadPct * 100} label="Uploading model" done={uploadPct >= 1} />
                <span className="muted num">{Math.round(uploadPct * 100)}%</span>
              </div>
            )}
            {busy ? <p className="muted small">Keep this tab open until it finishes.</p> : null}
            <ButtonRow align="start">
              <Button variant="primary" onClick={() => void uploadAndAssign()} disabled={!cfg || !itemId} loading={busy} loadingLabel="Uploading…">
                Upload and assign model
              </Button>
              <span className="muted small">Shown at its real size: the file is already in metres.</span>
            </ButtonRow>
          </div>
        </>
      )}
    </section>
  )
}

function StatsTable({ before, after }: { before: ScanStats; after: ScanStats }) {
  const tex = (s: ScanStats) => (s.maxTextureSize ? `${s.textures} · max ${s.maxTextureSize[0]}×${s.maxTextureSize[1]}` : String(s.textures))
  const dims = (s: ScanStats) => s.size.map((v) => (v < 10 ? v.toFixed(3) : v.toFixed(1))).join(' × ')
  const rows: [string, string, string][] = [
    ['File size', formatBytes(before.bytes), formatBytes(after.bytes)],
    ['Triangles', before.triangles.toLocaleString(), after.triangles.toLocaleString()],
    ['Vertices', before.vertices.toLocaleString(), after.vertices.toLocaleString()],
    ['Meshes / materials', `${before.meshes} / ${before.materials}`, `${after.meshes} / ${after.materials}`],
    ['Textures', tex(before), tex(after)],
    ['Texture data', formatBytes(before.textureBytes), formatBytes(after.textureBytes)],
    ['Size (x × y × z)', `${dims(before)} units`, `${dims(after)} m`],
  ]
  return (
    <div className="card ui-table-panel" style={{ marginTop: 12 }}>
      <div className="ui-table-scroll">
        <table className="ui-table compact">
          <caption className="sr-only">Before and after optimising</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Measure</span>
              </th>
              <th scope="col" className="num">Before</th>
              <th scope="col" className="num">After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, a, b]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td className="num">{a}</td>
                <td className="num">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

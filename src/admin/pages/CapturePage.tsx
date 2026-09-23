/**
 * Admin → Capture tools: the real-content pipeline (see docs/CONTENT_CAPTURE.md).
 *  - Deep zoom: a large textile photograph → DZI pyramid tiled in the browser (Web Worker) →
 *    parallel tile upload → assigned to an artwork's `deepZoom` ("Examine closely" viewer).
 *  - 3D scan import: Polycam / RealityScan glTF → optimised in the browser (glTF-Transform +
 *    meshoptimizer: weld, simplify, WebP textures, metres) → preview → upload → assigned to an
 *    exhibit's or scene object's `model`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type OpenSeadragon from 'openseadragon'
import { dziTileCount } from '../../museum/deepzoom/dzi'
import { api, uploadMedia, type Item, type MediaConfig } from '../api'
import { pyramidInfo } from '../pipeline/dziTiler'
import { createDeepZoom, type DeepZoomProgress } from '../pipeline/deepZoomUpload'
import { ModelPreview } from '../pipeline/ModelPreview'
import { runScanOptimize } from '../pipeline/runScan'
import { SCAN_DEFAULTS, type ScanResult, type ScanStats } from '../pipeline/scanOptimize'
import { errMsg, formatBytes, useToast } from '../ui'
import '../pipeline/capture.css'

export function CapturePage() {
  const [cfg, setCfg] = useState<MediaConfig | null>(null)
  useEffect(() => {
    api.mediaConfig().then(setCfg).catch(() => undefined)
  }, [])
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Capture tools</h1>
          <p className="muted">
            Turn workshop photographs and phone scans into museum-ready media. Everything is processed in this browser, then uploaded
            {cfg ? (cfg.directUpload ? ' straight to S3' : ' to the local media store') : ''}. Field guide: <span className="mono">docs/CONTENT_CAPTURE.md</span>.
          </p>
        </div>
      </div>
      <div className="cap-grid">
        <DeepZoomTool />
        <ScanTool cfg={cfg} />
      </div>
    </>
  )
}

/* ================================================================== */
/* Deep zoom                                                           */
/* ================================================================== */

function DeepZoomTool() {
  const [artworks, setArtworks] = useState<Item[]>([])
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
      .catch(() => alive && setError('This image format cannot be decoded by the browser (use JPEG, PNG or WebP).'))
    return () => {
      alive = false
      URL.revokeObjectURL(url)
    }
  }, [file])

  const current = artworks.find((a) => a.id === target)
  const estimate = useMemo(() => (dims ? dziTileCount(pyramidInfo(dims.w, dims.h, { format })) : 0), [dims, format])

  async function start() {
    if (!file || !current) return
    setBusy(true)
    setError('')
    setResult(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const rec = await createDeepZoom(file, { format, quality, signal: ctrl.signal }, setProgress)
      const next: Item = { ...current, deepZoom: rec.url }
      const cm = Number(widthCm)
      if (widthCm.trim() && Number.isFinite(cm) && cm > 0) next.physicalWidth = Math.round(cm) / 100
      const saved = await api.put('artworks', next)
      setArtworks((l) => l.map((a) => (a.id === saved.id ? saved : a)))
      setResult(rec.url)
      toast(`Deep zoom ready and assigned to “${String(saved.title ?? saved.id)}”`)
    } catch (e) {
      setError((e as Error).name === 'AbortError' ? 'Cancelled.' : errMsg(e))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const pct = (n: number) => (progress && progress.total ? Math.round((n / progress.total) * 100) : 0)
  return (
    <section className="card cap-tool">
      <div className="cap-head">
        <h2>Deep zoom</h2>
        <p className="muted small">
          A large photograph of a textile becomes a zoomable tile pyramid (Deep Zoom Image, 254 px tiles) for the visitor&apos;s
          “Examine closely” viewer. Use the full-resolution file from the camera or stitching software — 6 000 – 16 000 px is ideal.
        </p>
      </div>

      <div className="grid-2">
        <label className="field span-all">
          <span>Artwork</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
            {artworks.map((a) => (
              <option key={a.id} value={a.id}>
                {String(a.title ?? a.id)} — {a.id}
                {a.deepZoom ? ' (has deep zoom)' : ''}
              </option>
            ))}
          </select>
          {typeof current?.deepZoom === 'string' && <span className="hint mono">current: {current.deepZoom}</span>}
        </label>
        <label className="field span-all">
          <span>Photograph (JPEG, PNG or WebP)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setDims(null)
              setProgress(null)
              setResult(null)
              setError('')
            }}
          />
        </label>
        <label className="field">
          <span>Tile format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as 'jpg' | 'webp')} disabled={busy}>
            <option value="jpg">JPEG (universal)</option>
            <option value="webp">WebP (smaller; not for very old Safari)</option>
          </select>
        </label>
        <label className="field">
          <span>Quality · {Math.round(quality * 100)}</span>
          <input type="range" min={0.6} max={0.95} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={busy} />
        </label>
        <label className="field span-all">
          <span>Physical width of the textile (cm) — optional</span>
          <input type="number" min={1} step={0.5} placeholder={current?.physicalWidth ? String(Number(current.physicalWidth) * 100) : 'e.g. 112'} value={widthCm} onChange={(e) => setWidthCm(e.target.value)} disabled={busy} />
          <span className="hint">Measured edge to edge of the photographed area. Enables the viewer&apos;s centimetre scale bar and hangs the work 1:1 in the gallery.</span>
        </label>
      </div>

      {file && (
        <div className="cap-file">
          {thumb && <img src={thumb} alt="" />}
          <div className="small">
            <strong>{file.name}</strong> · {formatBytes(file.size)}
            {dims && (
              <>
                <br />
                {dims.w.toLocaleString()} × {dims.h.toLocaleString()} px ({((dims.w * dims.h) / 1e6).toFixed(1)} MP) → ~{estimate.toLocaleString()} tiles
                {Math.max(dims.w, dims.h) > 16384 && <span className="badge warn" style={{ marginLeft: 6 }}>will be reduced to 16 384 px</span>}
                {Math.max(dims.w, dims.h) < 3000 && <span className="badge warn" style={{ marginLeft: 6 }}>low resolution for deep zoom</span>}
              </>
            )}
          </div>
        </div>
      )}

      {progress && (
        <div className="cap-progress">
          <div className="upload-row">
            <span>Tiling{progress.phase === 'decoding' ? ' (decoding…)' : ''}</span>
            <div className="progress"><div style={{ width: `${pct(progress.tilesMade)}%` }} /></div>
            <span className="muted">{pct(progress.tilesMade)}%</span>
          </div>
          <div className="upload-row">
            <span>
              Uploading {progress.tilesUploaded.toLocaleString()} / {progress.total.toLocaleString()} · {formatBytes(progress.bytes)}
            </span>
            <div className="progress"><div style={{ width: `${pct(progress.tilesUploaded)}%` }} /></div>
            <span className="muted">{progress.phase === 'done' ? 'done' : progress.phase === 'finishing' ? '…' : `${pct(progress.tilesUploaded)}%`}</span>
          </div>
          {progress.scaled && progress.info && (
            <p className="muted small">Reduced from {progress.originalWidth} × {progress.originalHeight} px to {progress.info.width} × {progress.info.height} px (browser canvas limit).</p>
          )}
        </div>
      )}
      {error && <p className="alert">{error}</p>}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={start} disabled={!file || !dims || !current || busy}>
          {busy ? 'Working…' : 'Create deep zoom & assign'}
        </button>
        {busy && <button className="btn ghost" onClick={() => abortRef.current?.abort()}>Cancel</button>}
      </div>

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
  const [items, setItems] = useState<Item[]>([])
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

  useEffect(() => {
    api
      .list(target)
      .then((l) => {
        setItems(l)
        setItemId(l[0]?.id ?? '')
      })
      .catch((e) => setError(errMsg(e)))
  }, [target])

  const glbUrl = useMemo(() => (result ? URL.createObjectURL(new Blob([result.glb as BlobPart], { type: 'model/gltf-binary' })) : null), [result])
  useEffect(() => () => void (glbUrl && URL.revokeObjectURL(glbUrl)), [glbUrl])

  const baseName = (files.find((f) => /\.(glb|gltf)$/i.test(f.name))?.name ?? 'scan').replace(/\.(glb|gltf)$/i, '')

  async function optimise() {
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
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    setBusy(true)
    setError('')
    try {
      const file = new File([result.glb as BlobPart], `${baseName}-optimised.glb`, { type: 'model/gltf-binary' })
      const rec = await uploadMedia(file, 'models', cfg, setUploadPct)
      const next: Item = { ...item, model: rec.url, modelScale: 1 }
      if (target === 'objects') next.height = Math.round(result.after.size[1] * 1000) / 1000
      const saved = await api.put(target, next)
      setItems((l) => l.map((i) => (i.id === saved.id ? saved : i)))
      toast(`Uploaded ${formatBytes(rec.size)} and assigned to “${String(saved.title ?? saved.id)}”`)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card cap-tool">
      <div className="cap-head">
        <h2>3D scan import</h2>
        <p className="muted small">
          Export from Polycam / RealityScan / Luma as <strong>glTF or GLB</strong> (for .gltf choose the .gltf, .bin and all texture files together).
          The model is cleaned, simplified to a triangle budget, its textures resized and converted to WebP, and scaled to real metres.
        </p>
      </div>
      <div className="grid-2">
        <label className="field span-all">
          <span>Scan files</span>
          <input
            type="file"
            multiple
            accept=".glb,.gltf,.bin,.jpg,.jpeg,.png,.webp"
            disabled={busy}
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []))
              setResult(null)
              setError('')
              setLog([])
            }}
          />
          {files.length > 0 && <span className="hint">{files.length} file(s) · {formatBytes(files.reduce((n, f) => n + f.size, 0))}</span>}
        </label>
        <label className="field">
          <span>Triangle budget</span>
          <select value={tris} onChange={(e) => setTris(Number(e.target.value))} disabled={busy}>
            <option value={15000}>15k — small object, phones</option>
            <option value={40000}>40k — hand block (recommended)</option>
            <option value={80000}>80k — large / intricate carving</option>
            <option value={150000}>150k — hero piece (high tier only)</option>
          </select>
        </label>
        <label className="field">
          <span>Max texture size</span>
          <select value={maxTex} onChange={(e) => setMaxTex(Number(e.target.value))} disabled={busy}>
            <option value={1024}>1024 px</option>
            <option value={2048}>2048 px (recommended)</option>
            <option value={4096}>4096 px (heavy)</option>
          </select>
        </label>
        <label className="field">
          <span>Real height (cm)</span>
          <input type="number" min={0.1} step={0.1} placeholder="e.g. 6.5" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} disabled={busy} />
          <span className="hint">Measured with a ruler, lying as it will be displayed. Empty = keep the scan&apos;s units.</span>
        </label>
        <label className="field">
          <span>Up axis in the file</span>
          <select value={upAxis} onChange={(e) => setUpAxis(e.target.value as 'y' | 'z')} disabled={busy}>
            <option value="y">Y up (glTF standard — Polycam, RealityScan)</option>
            <option value="z">Z up (rotate −90° about X)</option>
          </select>
        </label>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={optimise} disabled={busy || files.length === 0}>{busy && !result ? 'Optimising…' : 'Optimise'}</button>
        {result && glbUrl && (
          <a className="btn ghost" href={glbUrl} download={`${baseName}-optimised.glb`}>Download .glb</a>
        )}
      </div>
      {log.length > 0 && <pre className="cap-log">{log.join('\n')}</pre>}
      {error && <p className="alert">{error}</p>}

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
            <h3>Upload &amp; assign</h3>
            <div className="grid-2">
              <label className="field">
                <span>Assign to</span>
                <select value={target} onChange={(e) => setTarget(e.target.value as Target)} disabled={busy}>
                  <option value="exhibits">Exhibit (hand-block table)</option>
                  <option value="objects">Scene object</option>
                </select>
              </label>
              <label className="field">
                <span>Item</span>
                <select value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={busy}>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {String(i.title ?? i.id)} — {i.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {uploadPct !== null && (
              <div className="upload-row" style={{ marginTop: 10 }}>
                <span>Uploading {baseName}-optimised.glb</span>
                <div className="progress"><div style={{ width: `${Math.round(uploadPct * 100)}%` }} /></div>
                <span className="muted">{Math.round(uploadPct * 100)}%</span>
              </div>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={uploadAndAssign} disabled={busy || !cfg || !itemId}>Upload &amp; assign model</button>
              <span className="muted small">Sets <span className="mono">model</span> and <span className="mono">modelScale: 1</span> (the file is already in metres).</span>
            </div>
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
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th />
            <th className="num">Before</th>
            <th className="num">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="num">{a}</td>
              <td className="num">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

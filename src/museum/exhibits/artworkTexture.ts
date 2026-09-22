/**
 * Artwork texture loading with graceful failure. A missing or broken image never
 * breaks rendering: it resolves to an intentional "image unavailable" card.
 */
import * as THREE from 'three'

const loader = new THREE.TextureLoader()
const cache = new Map<string, Promise<THREE.Texture>>()

export interface LoadedArtworkTexture {
  texture: THREE.Texture
  width: number
  height: number
  missing: boolean
}

function unavailableTexture(aspect: number): THREE.Texture {
  const w = 512
  const h = Math.round(w / Math.max(0.2, Math.min(5, aspect)))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#ebe5da'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = '#b9ae9e'
  g.lineWidth = 2
  g.strokeRect(14, 14, w - 28, h - 28)
  g.fillStyle = '#8a7f71'
  g.textAlign = 'center'
  g.font = '500 22px Inter, system-ui, sans-serif'
  g.fillText('IMAGE UNAVAILABLE', w / 2, h / 2 - 6)
  g.font = '400 16px Inter, system-ui, sans-serif'
  g.fillText('awaiting artwork file', w / 2, h / 2 + 20)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function loadArtworkTexture(url: string, fallbackAspect: number, anisotropy: number): Promise<LoadedArtworkTexture> {
  let p = cache.get(url)
  if (!p) {
    p = loader.loadAsync(url).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace
      t.generateMipmaps = true
      t.minFilter = THREE.LinearMipmapLinearFilter
      return t
    })
    cache.set(url, p)
  }
  return p.then(
    (t) => {
      t.anisotropy = anisotropy
      const img = t.image as HTMLImageElement | ImageBitmap
      const width = 'naturalWidth' in img ? img.naturalWidth : img.width
      const height = 'naturalHeight' in img ? img.naturalHeight : img.height
      return { texture: t, width, height, missing: false }
    },
    (err) => {
      console.warn(`[museum] artwork image failed to load: ${url}`, err)
      cache.delete(url)
      const t = unavailableTexture(fallbackAspect)
      const img = t.image as HTMLCanvasElement
      return { texture: t, width: img.width, height: img.height, missing: true }
    },
  )
}

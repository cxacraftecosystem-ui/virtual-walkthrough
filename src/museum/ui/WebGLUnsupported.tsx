import { Rosette } from './icons'

/** True when a WebGL2 (or, failing that, WebGL1) context can be created. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl2 = canvas.getContext('webgl2')
    if (gl2) return true
    const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')
    return !!gl
  } catch {
    return false
  }
}

export function WebGLUnsupported() {
  return (
    <div className="ui-nogl" role="alert">
      <div className="ui-nogl__inner">
        <Rosette style={{ width: 40, height: 40, color: '#8a5a3b', opacity: 0.8 }} />
        <div className="ui-kicker" style={{ marginTop: 18 }}>
          A Virtual Exhibition
        </div>
        <h1 className="ui-nogl__title">Hand Block Printing</h1>
        <p>
          This exhibition is a 3D walkthrough and needs WebGL, which isn&rsquo;t available in this browser right now.
        </p>
        <ul>
          <li>Enable hardware acceleration in your browser settings, then restart it.</li>
          <li>Try a current version of Chrome, Edge, Firefox or Safari.</li>
          <li>Update your graphics drivers, or try another device.</li>
        </ul>
        <p>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  )
}

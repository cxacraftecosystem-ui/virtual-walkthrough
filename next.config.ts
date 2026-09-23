import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The floating dev badge overlaps the museum minimap.
  devIndicators: false,
  // three's example modules ship untranspiled ESM.
  transpilePackages: ['three'],
  // Large GLB/video/image assets are served from /public (or S3 in production).
  images: { unoptimized: true },
  // Media uploads through route handlers (local mode); production uses presigned S3 uploads.
  experimental: {
    serverActions: { bodySizeLimit: '500mb' },
  },
  // Server-only packages that must not be bundled.
  serverExternalPackages: ['pg'],
  async headers() {
    const security = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
      // AR/VR need xr-spatial-tracking; camera stays self-only for WebXR AR passthrough.
      { key: 'Permissions-Policy', value: 'xr-spatial-tracking=(self), camera=(self), microphone=(), geolocation=()' },
    ]
    const immutable = [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }]
    return [
      { source: '/:path*', headers: security },
      { source: '/admin/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/deepzoom/:path*', headers: immutable },
      { source: '/models/:path*', headers: immutable },
      { source: '/videos/:path*', headers: immutable },
      { source: '/artworks/:path*', headers: immutable },
    ]
  },
}

export default nextConfig

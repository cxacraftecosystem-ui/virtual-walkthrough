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
}

export default nextConfig

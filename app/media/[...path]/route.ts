// Local-disk media (.data/media) with HTTP Range support; in S3 mode redirects to the bucket/CDN.
import { serveMediaFile } from '@/server/handlers/media'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: Request, ctx: Ctx) {
  return serveMediaFile(req, (await ctx.params).path)
}

export async function HEAD(req: Request, ctx: Ctx) {
  return serveMediaFile(req, (await ctx.params).path)
}

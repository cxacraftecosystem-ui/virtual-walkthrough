// Thin Route Handler wrapper — logic lives in src/server/handlers/media.ts
import { listMedia, uploadMedia } from '@/server/handlers/media'

export const runtime = 'nodejs'
export const maxDuration = 60

export const GET = listMedia
export const POST = uploadMedia

// Thin Route Handler wrapper — logic lives in src/server/handlers/media.ts
import { completeMedia } from '@/server/handlers/media'

export const runtime = 'nodejs'

export const POST = completeMedia

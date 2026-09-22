// Thin Route Handler wrapper — logic lives in src/server/handlers/media.ts
import { mediaConfig } from '@/server/handlers/media'

export const runtime = 'nodejs'

export const GET = mediaConfig

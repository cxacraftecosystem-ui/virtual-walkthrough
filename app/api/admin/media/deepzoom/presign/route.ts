// Thin Route Handler wrapper — logic lives in src/server/handlers/deepzoom.ts
import { presignDeepZoom } from '@/server/handlers/deepzoom'

export const runtime = 'nodejs'
export const maxDuration = 60

export const POST = presignDeepZoom

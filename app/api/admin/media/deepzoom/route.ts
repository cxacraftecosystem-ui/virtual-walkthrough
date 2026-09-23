// Thin Route Handler wrapper — logic lives in src/server/handlers/deepzoom.ts
import { startDeepZoom } from '@/server/handlers/deepzoom'

export const runtime = 'nodejs'

export const POST = startDeepZoom

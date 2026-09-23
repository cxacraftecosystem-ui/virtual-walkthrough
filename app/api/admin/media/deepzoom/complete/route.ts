// Thin Route Handler wrapper — logic lives in src/server/handlers/deepzoom.ts
import { completeDeepZoom } from '@/server/handlers/deepzoom'

export const runtime = 'nodejs'

export const POST = completeDeepZoom

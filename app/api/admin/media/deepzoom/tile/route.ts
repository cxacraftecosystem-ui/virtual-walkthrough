// Thin Route Handler wrapper — logic lives in src/server/handlers/deepzoom.ts
import { uploadDeepZoomTile } from '@/server/handlers/deepzoom'

export const runtime = 'nodejs'

export const POST = uploadDeepZoomTile

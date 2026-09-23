// Thin Route Handler wrapper — logic lives in src/server/handlers/content.ts
import { putTour } from '@/server/handlers/content'

export const runtime = 'nodejs'

export const PUT = putTour

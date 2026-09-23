// Thin Route Handler wrapper — logic lives in src/server/handlers/curatorAnalytics.ts
import { heatmapRoute } from '@/server/handlers/curatorAnalytics'

export const runtime = 'nodejs'

export const GET = heatmapRoute

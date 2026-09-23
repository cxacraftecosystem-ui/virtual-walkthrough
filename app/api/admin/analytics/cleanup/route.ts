// Thin Route Handler wrapper — logic lives in src/server/handlers/curatorAnalytics.ts
import { cleanupRoute } from '@/server/handlers/curatorAnalytics'

export const runtime = 'nodejs'

export const GET = cleanupRoute
export const POST = cleanupRoute

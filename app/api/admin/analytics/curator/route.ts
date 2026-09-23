// Thin Route Handler wrapper — logic lives in src/server/handlers/curatorAnalytics.ts
import { curatorRoute } from '@/server/handlers/curatorAnalytics'

export const runtime = 'nodejs'

export const GET = curatorRoute

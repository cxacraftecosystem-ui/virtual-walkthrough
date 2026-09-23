// Thin Route Handler wrapper — logic lives in src/server/handlers/curatorAnalytics.ts
import { getRetention, putRetention } from '@/server/handlers/curatorAnalytics'

export const runtime = 'nodejs'

export const GET = getRetention
export const PUT = putRetention

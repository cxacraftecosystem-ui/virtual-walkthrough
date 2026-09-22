// Thin Route Handler wrapper — logic lives in src/server/handlers/analytics.ts
import { postEvents } from '@/server/handlers/analytics'

export const runtime = 'nodejs'

export const POST = postEvents

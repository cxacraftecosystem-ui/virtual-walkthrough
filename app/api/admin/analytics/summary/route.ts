// Thin Route Handler wrapper — logic lives in src/server/handlers/analytics.ts
import { summary } from '@/server/handlers/analytics'

export const runtime = 'nodejs'

export const GET = summary

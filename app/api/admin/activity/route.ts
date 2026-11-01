// Thin Route Handler wrapper — logic lives in src/server/handlers/overview.ts
import { activity } from '@/server/handlers/overview'

export const runtime = 'nodejs'

export const GET = activity

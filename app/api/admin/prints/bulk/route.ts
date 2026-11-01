// Thin Route Handler wrapper — logic lives in src/server/handlers/prints.ts
import { adminBulkPrints } from '@/server/handlers/prints'

export const runtime = 'nodejs'

export const POST = adminBulkPrints

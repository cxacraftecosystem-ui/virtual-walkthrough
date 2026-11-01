// Thin Route Handler wrapper — logic lives in src/server/handlers/errors.ts
import { bulkErrors } from '@/server/handlers/errors'

export const runtime = 'nodejs'

export const POST = bulkErrors

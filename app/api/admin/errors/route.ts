// Thin Route Handler wrapper — logic lives in src/server/handlers/errors.ts
import { listErrors } from '@/server/handlers/errors'

export const runtime = 'nodejs'

export const GET = listErrors

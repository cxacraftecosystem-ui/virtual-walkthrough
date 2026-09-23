// Thin Route Handler wrapper — logic lives in src/server/handlers/errors.ts
import { postError } from '@/server/handlers/errors'

export const runtime = 'nodejs'

export const POST = postError

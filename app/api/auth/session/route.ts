// Thin Route Handler wrapper — logic lives in src/server/handlers/auth.ts
import { session } from '@/server/handlers/auth'

export const runtime = 'nodejs'

export const GET = session

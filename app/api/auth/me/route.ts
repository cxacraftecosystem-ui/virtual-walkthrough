// Thin Route Handler wrapper — logic lives in src/server/handlers/auth.ts
import { me } from '@/server/handlers/auth'

export const runtime = 'nodejs'

export const GET = me

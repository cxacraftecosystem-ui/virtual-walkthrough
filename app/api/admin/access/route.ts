// Thin Route Handler wrapper — logic lives in src/server/handlers/users.ts
import { listAccess, putAccess } from '@/server/handlers/users'

export const runtime = 'nodejs'

export const GET = listAccess
export const POST = putAccess

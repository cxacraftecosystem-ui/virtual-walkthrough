// Thin Route Handler wrapper — logic lives in src/server/handlers/users.ts
import { listUsers } from '@/server/handlers/users'

export const runtime = 'nodejs'

export const GET = listUsers

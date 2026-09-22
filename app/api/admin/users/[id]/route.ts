// Thin Route Handler wrapper — logic lives in src/server/handlers/users.ts
import { patchUser } from '@/server/handlers/users'

export const runtime = 'nodejs'

export const PATCH = patchUser

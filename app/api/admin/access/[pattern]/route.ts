// Thin Route Handler wrapper — logic lives in src/server/handlers/users.ts
import { patchAccess, deleteAccess } from '@/server/handlers/users'

export const runtime = 'nodejs'

export const PATCH = patchAccess
export const DELETE = deleteAccess

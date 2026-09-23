// Thin Route Handler wrapper — logic lives in src/server/handlers/errors.ts
import { deleteError, getError, patchError } from '@/server/handlers/errors'

export const runtime = 'nodejs'

export const GET = getError
export const PATCH = patchError
export const DELETE = deleteError

// Thin Route Handler wrapper — logic lives in src/server/handlers/prints.ts
import { adminDeletePrint, adminPatchPrint } from '@/server/handlers/prints'

export const runtime = 'nodejs'

export const PATCH = adminPatchPrint
export const DELETE = adminDeletePrint

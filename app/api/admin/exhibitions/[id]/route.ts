// Thin Route Handler wrapper — logic lives in src/server/handlers/exhibitions.ts
import { adminPatchExhibition, adminDeleteExhibition } from '@/server/handlers/exhibitions'

export const runtime = 'nodejs'

export const PATCH = adminPatchExhibition
export const DELETE = adminDeleteExhibition

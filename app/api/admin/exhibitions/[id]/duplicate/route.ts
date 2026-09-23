// Thin Route Handler wrapper — logic lives in src/server/handlers/exhibitions.ts
import { adminDuplicateExhibition } from '@/server/handlers/exhibitions'

export const runtime = 'nodejs'

export const POST = adminDuplicateExhibition

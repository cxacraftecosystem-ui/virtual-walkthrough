// Thin Route Handler wrapper — logic lives in src/server/handlers/exhibitions.ts
import { adminListExhibitions, adminCreateExhibition } from '@/server/handlers/exhibitions'

export const runtime = 'nodejs'

export const GET = adminListExhibitions
export const POST = adminCreateExhibition

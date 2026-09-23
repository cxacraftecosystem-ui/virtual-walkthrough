// Thin Route Handler wrapper — logic lives in src/server/handlers/prints.ts
import { listPrints, submitPrint } from '@/server/handlers/prints'

export const runtime = 'nodejs'

export const GET = listPrints
export const POST = submitPrint

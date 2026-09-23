// Thin Route Handler wrapper — logic lives in src/server/handlers/live.ts
import { liveVerify } from '@/server/handlers/live'

export const runtime = 'nodejs'

export const GET = liveVerify

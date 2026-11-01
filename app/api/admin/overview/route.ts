// Thin Route Handler wrapper — logic lives in src/server/handlers/overview.ts
import { overview } from '@/server/handlers/overview'

export const runtime = 'nodejs'

export const GET = overview

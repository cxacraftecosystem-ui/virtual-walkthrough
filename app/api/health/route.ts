// Thin Route Handler wrapper — logic lives in src/server/handlers/content.ts
import { health } from '@/server/handlers/content'

export const runtime = 'nodejs'

export const GET = health

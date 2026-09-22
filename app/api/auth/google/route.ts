// Thin Route Handler wrapper — logic lives in src/server/handlers/auth.ts
import { google } from '@/server/handlers/auth'

export const runtime = 'nodejs'

export const POST = google

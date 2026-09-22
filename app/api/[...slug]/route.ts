// Thin Route Handler wrapper — logic lives in src/server/handlers/content.ts
import { apiNotFound } from '@/server/handlers/content'

export const runtime = 'nodejs'

export const GET = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound

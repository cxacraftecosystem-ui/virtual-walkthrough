// Thin Route Handler wrapper — logic lives in src/server/handlers/comments.ts
import { adminBulkComments } from '@/server/handlers/comments'

export const runtime = 'nodejs'

export const POST = adminBulkComments

// Thin Route Handler wrapper — logic lives in src/server/handlers/comments.ts
import { adminListComments } from '@/server/handlers/comments'

export const runtime = 'nodejs'

export const GET = adminListComments

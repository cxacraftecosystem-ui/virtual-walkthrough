// Thin Route Handler wrapper — logic lives in src/server/handlers/comments.ts
import { listComments, postComment } from '@/server/handlers/comments'

export const runtime = 'nodejs'

export const GET = listComments
export const POST = postComment

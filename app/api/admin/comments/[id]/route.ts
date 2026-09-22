// Thin Route Handler wrapper — logic lives in src/server/handlers/comments.ts
import { adminPatchComment, adminDeleteComment } from '@/server/handlers/comments'

export const runtime = 'nodejs'

export const PATCH = adminPatchComment
export const DELETE = adminDeleteComment

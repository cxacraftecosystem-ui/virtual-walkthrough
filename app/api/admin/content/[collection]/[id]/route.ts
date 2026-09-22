// Thin Route Handler wrapper — logic lives in src/server/handlers/content.ts
import { putContentItem, deleteContentItem } from '@/server/handlers/content'

export const runtime = 'nodejs'

export const PUT = putContentItem
export const DELETE = deleteContentItem

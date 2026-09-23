// Thin Route Handler wrapper — logic lives in src/server/handlers/artisans.ts
import { adminPutArtisan, adminDeleteArtisan } from '@/server/handlers/artisans'

export const runtime = 'nodejs'

export const PUT = adminPutArtisan
export const DELETE = adminDeleteArtisan

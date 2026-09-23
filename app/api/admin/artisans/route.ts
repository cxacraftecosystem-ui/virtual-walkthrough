// Thin Route Handler wrapper — logic lives in src/server/handlers/artisans.ts
import { adminListArtisans } from '@/server/handlers/artisans'

export const runtime = 'nodejs'

export const GET = adminListArtisans

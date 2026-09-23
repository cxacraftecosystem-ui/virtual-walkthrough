// Thin Route Handler wrapper — logic lives in src/server/handlers/artisans.ts
import { publicArtisans } from '@/server/handlers/artisans'

export const runtime = 'nodejs'

export const GET = publicArtisans

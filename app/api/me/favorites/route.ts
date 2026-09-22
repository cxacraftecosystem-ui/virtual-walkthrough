// Thin Route Handler wrapper — logic lives in src/server/handlers/favorites.ts
import { listFavorites } from '@/server/handlers/favorites'

export const runtime = 'nodejs'

export const GET = listFavorites

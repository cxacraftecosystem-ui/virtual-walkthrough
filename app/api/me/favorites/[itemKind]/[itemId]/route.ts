// Thin Route Handler wrapper — logic lives in src/server/handlers/favorites.ts
import { addFavorite, removeFavorite } from '@/server/handlers/favorites'

export const runtime = 'nodejs'

export const PUT = addFavorite
export const DELETE = removeFavorite

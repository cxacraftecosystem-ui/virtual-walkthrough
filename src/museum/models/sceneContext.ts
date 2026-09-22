import { createContext } from 'react'

/**
 * True inside the museum scene (<SceneObjects/>), false in the 3D inspection studio.
 * Models with scene-only extras (accent lights, glow rings, display furniture, slow
 * turntables) use it to render just the object itself when shown in the inspector.
 */
export const InMuseumScene = createContext(false)

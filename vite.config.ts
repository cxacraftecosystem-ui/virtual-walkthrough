import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('@react-three') || id.includes('postprocessing') || id.includes('n8ao')) return 'r3f'
          return undefined
        },
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
})

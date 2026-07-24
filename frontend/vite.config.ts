import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The .excalidraw source files live in ../docs (repo root), imported directly
  // as the single source of truth for the durability diagrams. Allow Vite's dev
  // server to read them from outside the frontend root.
  server: {
    fs: {
      allow: ['..'],
    },
  },
})

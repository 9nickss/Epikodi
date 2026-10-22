import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // relative base so the built index.html works when loaded via file:// in Electron
  base: './',
  plugins: [react()],
  server: {
    // bind to all interfaces in the Docker dev container (otherwise Vite's
    // default ::1-only binding is unreachable from wait-on / the published port)
    host: process.env.DOCKER ? '0.0.0.0' : undefined,
    port: 5173,
    strictPort: true,
  },
})

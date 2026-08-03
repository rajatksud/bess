import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    // In production the Express server serves both the built frontend and the
    // API from the same origin (see server/app.ts), so the frontend API client
    // always uses relative /api/v1/... URLs. This proxy makes that same
    // relative-URL code work against `pnpm dev:server` (port 8080) while using
    // Vite's dev server for the frontend on port 3000.
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});

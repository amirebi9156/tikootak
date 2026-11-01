import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// برای توسعه لوکال: `npm run dev` و پروکسی به همان Caddy داخل داکر (https://localhost)
const backend = { target: 'https://localhost', secure: false, changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: {
    proxy: {
      '/api': backend,
      '/_matrix': backend,
      '/livekit': { ...backend, ws: true },
    },
  },
});

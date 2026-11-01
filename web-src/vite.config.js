import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// خروجی بیلد مستقیم داخل ../web/dist می‌ره و Caddy از همون‌جا سرو می‌کنه
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          matrix: ['matrix-js-sdk'],
          livekit: ['livekit-client'],
        },
      },
    },
  },
});

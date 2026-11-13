import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// نسخهٔ برنامه از فایل VERSION ریشهٔ پروژه خوانده می‌شود (یک منبع حقیقت؛ همان عددی که منوی مدیریت و ریلیز نشان می‌دهند)
let appVersion = '';
try { appVersion = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(); } catch { /* بیلد بدون VERSION: نسخه نشان داده نمی‌شود */ }

// خروجی بیلد مستقیم داخل ../web/dist می‌ره و Caddy از همون‌جا سرو می‌کنه
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
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

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app under /StarFoundry/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'StarFoundry',
        short_name: 'StarFoundry',
        description: 'Production planner for the Star Technology modpack',
        theme_color: '#14161c',
        background_color: '#14161c',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      // The HiGHS wasm (~3.5 MB) and the data bundle (~4 MB) must be precached for offline use.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,wasm,json}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 },
    }),
  ],
  worker: { format: 'es' },
});

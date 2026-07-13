/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'AisleFlow',
        short_name: 'AisleFlow',
        description: 'Shared grocery list',
        display: 'standalone',
        start_url: '/',
        theme_color: '#1976d2',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Belt-and-braces: the persisted query cache is the primary
          // offline data source; this covers a cold SW-served load.
          {
            urlPattern: ({ url, request }) =>
              url.pathname === '/api/items' && request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-items',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 1 },
            },
          },
        ],
      },
      // The SW is exercised against the prod build; dev stays SW-free.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5174,
    allowedHosts: ['aisle-flow.duckdns.org'],
    proxy: {
      '/api': 'http://localhost:8081',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
